from __future__ import annotations

import os
from typing import Dict, List, Tuple, Optional
import numpy as np
import librosa
import soundfile as sf

EPS = 1e-12

# ---------------- safe math helpers ---------------- #

def safe_log10(x: float) -> float:
    """Compute log10(max(x, eps)) to avoid log10(0) = -inf."""
    return float(np.log10(max(float(x), EPS)))


def safe_div(a: float, b: float) -> float:
    """Divide a by (b + eps) to avoid division by zero."""
    return float(a / (float(b) + EPS))


def safe_norm(x: np.ndarray) -> np.ndarray:
    """Normalize by max only if max > eps, otherwise return zeros."""
    if x.size == 0:
        return x
    x_max = float(np.max(x))
    if x_max > EPS:
        return x / x_max
    return np.zeros_like(x)


DEFAULT_FP_SETTINGS = {
    "sr": 22050,
    "hop_length": 256,
    "max_events": 200,
    "max_duration_sec": 300.0,  # 5 minutes (Render-safe default)
    "onset_backtrack": True,
    "event_pre_ms": 20,
    "presence_window_ms": 150,
    "wet_early_ms": 80,
    "wet_late_ms": 320,
    "bands_hz": {
        "low": (20, 200),
        "mid": (200, 2000),
        "high": (2000, 8000),
    },
    "guardrails": {
        "short_file_seconds_min": 0.5,
        "fallback_if_no_onsets": True,
    },
}

# ---------------- helpers ---------------- #

def _rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    x = x.astype(np.float64, copy=False)
    return float(np.sqrt(np.mean(x * x) + EPS))


def _robust_normalize(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    p10 = np.percentile(values, 10)
    p90 = np.percentile(values, 90)
    denom = (p90 - p10) if (p90 - p10) > EPS else 1.0
    return np.clip((values - p10) / denom, 0.0, 1.0)


def _slice(y: np.ndarray, start: int, end: int) -> np.ndarray:
    start = max(0, start)
    end = min(int(end), len(y))
    if end <= start:
        return y[:0]
    return y[int(start):int(end)]


def _band_energy_props(
    window: np.ndarray,
    sr: int,
    bands: Dict[str, Tuple[int, int]],
) -> Dict[str, float]:
    if window.size < 64:
        return {"low": 0.0, "mid": 0.0, "high": 0.0}

    w = window.astype(np.float64, copy=False) * np.hanning(len(window))
    spec = np.fft.rfft(w)
    mag2 = np.abs(spec) ** 2
    freqs = np.fft.rfftfreq(len(w), 1.0 / sr)

    out: Dict[str, float] = {}
    total = 0.0
    for name, (f0, f1) in bands.items():
        mask = (freqs >= f0) & (freqs < f1)
        e = float(np.sum(mag2[mask]))
        out[name] = e
        total += e

    if total <= 0.0:
        return {"low": 0.0, "mid": 0.0, "high": 0.0}

    return {k: float(safe_div(v, total)) for k, v in out.items()}


def _fallback_events_from_rms(mono: np.ndarray, sr: int, hop_length: int, max_events: int) -> np.ndarray:
    rms_env = librosa.feature.rms(y=mono, frame_length=2048, hop_length=hop_length)[0]
    if rms_env.size == 0:
        return np.array([], dtype=int)
    idx = np.argsort(rms_env)[::-1][:max_events]
    return np.sort(idx.astype(int))


# ---------------- main computation ---------------- #

def compute_spatial_fingerprint_from_path(
    wav_path: str,
    *,
    filename: Optional[str] = None,
    settings: Optional[dict] = None,
) -> dict:
    """
    Compute Spatial Fingerprint from WAV file.
    Returns normalized, visualization-agnostic event metrics.

    Angle: tanh(ILD_db / 6) -> [-1, 1]
      - ILD = 20*log10(R/L) where positive = right louder, negative = left louder
      - Positive angle = right side, negative angle = left side
      - Angle ≈ 0 for mono/balanced stereo
    Presence: robust normalized RMS around event -> [0, 1]
    Wetness: (late energy / early energy) scaled -> [0, 1]
    Band: argmax of low/mid/high proportion around event
    """

    cfg = dict(DEFAULT_FP_SETTINGS)
    if settings:
        cfg.update(settings)
    cfg["max_duration_sec"] = float(os.getenv("FP_MAX_DURATION_SEC", cfg["max_duration_sec"]))
    cfg["max_events"] = int(os.getenv("FP_MAX_EVENTS", cfg["max_events"]))

    sr_target = int(cfg["sr"])
    hop_length = int(cfg["hop_length"])
    max_events = int(cfg["max_events"])
    max_duration = float(cfg["max_duration_sec"])

    warnings: List[str] = []

    # ---- Get duration without loading full file (avoids OOM on large WAVs) ----
    info = sf.info(wav_path)
    sr = int(info.samplerate)
    file_frames = info.frames
    file_duration_s = float(file_frames / sr) if sr > 0 else 0.0
    analysis_trimmed = file_duration_s > max_duration

    # ---- Load only up to cap (trim before any resampling/analysis) ----
    max_frames = int(sr * max_duration)
    data, sr = sf.read(wav_path, frames=max_frames, always_2d=True)
    data = data.astype(np.float32, copy=False).T  # -> (ch, n)

    if data.shape[0] == 1:
        L = data[0]
        R = data[0]
        warnings.append("mono_input_duplicated_to_stereo")
    else:
        # soundfile: column 0 = left, column 1 = right
        L = data[0]
        R = data[1]

    # resample if needed
    if sr != sr_target:
        L = librosa.resample(L, orig_sr=sr, target_sr=sr_target)
        R = librosa.resample(R, orig_sr=sr, target_sr=sr_target)
        sr = sr_target

    mono = 0.5 * (L + R)
    duration_s = float(len(mono) / sr) if sr > 0 else 0.0
    analyzed_duration_sec = duration_s

    if duration_s < float(cfg["guardrails"]["short_file_seconds_min"]):
        warnings.append("short_file_may_reduce_event_quality")

    # ---- Onset detection ----
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop_length)
    frames = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=hop_length,
        backtrack=bool(cfg["onset_backtrack"]),
        units="frames",
    ).astype(int)

    if frames.size == 0 and bool(cfg["guardrails"].get("fallback_if_no_onsets", True)):
        warnings.append("no_onsets_detected_used_rms_peak_fallback")
        frames = _fallback_events_from_rms(mono, sr, hop_length, max_events)

    if frames.size == 0:
        out = {
            "filename": filename,
            "duration_s": duration_s,
            "analysis_trimmed": analysis_trimmed,
            "analyzed_duration_sec": analyzed_duration_sec,
            "fingerprint": {"events": [], "summary": {"event_count": 0}},
        }
        if warnings:
            out["warnings"] = warnings
        return out

    # Cap by strength if too many
    if frames.size > max_events and onset_env.size > 0:
        strengths = onset_env[np.clip(frames, 0, len(onset_env) - 1)]
        top = np.argsort(strengths)[::-1][:max_events]
        frames = np.sort(frames[top])

    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop_length)

    # ---- Windows ----
    pre = int((float(cfg["event_pre_ms"]) / 1000.0) * sr)
    presence_len = int((float(cfg["presence_window_ms"]) / 1000.0) * sr)
    wet_early = int((float(cfg["wet_early_ms"]) / 1000.0) * sr)
    wet_late = int((float(cfg["wet_late_ms"]) / 1000.0) * sr)

    bands = cfg["bands_hz"]

    presence_raw: List[float] = []
    wet_raw: List[float] = []
    angle_raw: List[float] = []
    band_props: List[Dict[str, float]] = []

    for t in times:
        center = int(float(t) * sr)
        start = center - pre
        end = center + presence_len

        wL = _slice(L, start, end)
        wR = _slice(R, start, end)
        wM = 0.5 * (wL + wR)

        # Presence
        presence_raw.append(_rms(wM))

        # Wetness ratio (late/early)
        early = _slice(mono, center, center + wet_early)
        late = _slice(mono, center + wet_early, center + wet_early + wet_late)

        e_early = float(np.mean(early * early) + EPS) if early.size else EPS
        e_late = float(np.mean(late * late) + EPS) if late.size else EPS
        wet_raw.append(safe_div(e_late, e_early))

        # Angle (ILD -> tanh normalize)
        rL = _rms(wL)
        rR = _rms(wR)
        ratio = safe_div(rR + EPS, rL + EPS)  # R/L
        ild_db = 20.0 * safe_log10(ratio)
        angle_raw.append(float(np.tanh(ild_db / 6.0)))

        # Band proportions
        band_props.append(_band_energy_props(wM, sr, bands))

    presence = _robust_normalize(np.asarray(presence_raw, dtype=np.float64))
    wetness = np.clip(np.asarray(wet_raw, dtype=np.float64) / 1.5, 0.0, 1.0)
    angle = np.asarray(angle_raw, dtype=np.float64)

    events: List[dict] = []
    band_counts = {"low": 0, "mid": 0, "high": 0}

    for i, t in enumerate(times):
        bp = band_props[i]
        band = max(bp, key=bp.get) if bp else "mid"
        if band in band_counts:
            band_counts[band] += 1

        events.append(
            {
                "id": int(i),
                "t_s": float(t),
                "angle": float(angle[i]),
                "presence": float(presence[i]),
                "wetness": float(wetness[i]),
                "band": band,
                "band_energy": {
                    "low": float(bp.get("low", 0.0)),
                    "mid": float(bp.get("mid", 0.0)),
                    "high": float(bp.get("high", 0.0)),
                },
            }
        )

    summary = {
        "event_count": int(len(events)),
        "presence_p50": float(np.percentile(presence, 50)) if presence.size else 0.0,
        "wetness_p50": float(np.percentile(wetness, 50)) if wetness.size else 0.0,
        "angle_mean": float(np.mean(angle)) if angle.size else 0.0,
        "band_counts": band_counts,
    }

    out = {
        "filename": filename,
        "duration_s": float(duration_s),
        "analysis_trimmed": analysis_trimmed,
        "analyzed_duration_sec": float(analyzed_duration_sec),
        "fingerprint": {"events": events, "summary": summary},
    }
    if warnings:
        out["warnings"] = warnings
    return out
