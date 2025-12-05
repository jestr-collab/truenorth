import numpy as np


def compute_crest_factor_over_time(y, sr, frame_ms=50, hop_ms=25):
    """
    Compute crest factor over time.

    Crest factor (in dB) = 20 * log10(peak / rms)

    Returns a dict:
    {
        "frame_ms": 50,
        "hop_ms": 25,
        "points": [
            {"time": 0.05, "crest_db": 12.3},
            {"time": 0.075, "crest_db": 11.8},
            ...
        ]
    }
    """
    y = np.asarray(y, dtype=float).flatten()
    n = y.size
    if n == 0:
        return None

    frame_len = int(sr * frame_ms / 1000.0)
    hop_len = int(sr * hop_ms / 1000.0)

    if frame_len <= 0 or hop_len <= 0 or frame_len > n:
        return None

    points = []
    eps = 1e-12  # avoid division by zero

    start = 0
    while start + frame_len <= n:
        frame = y[start:start + frame_len]

        peak = np.max(np.abs(frame))
        rms = np.sqrt(np.mean(frame ** 2))

        if rms > 0 and peak > 0:
            crest = 20.0 * np.log10((peak + eps) / (rms + eps))
            crest_db = float(crest)
        else:
            crest_db = None

        center_idx = start + frame_len / 2.0
        time_sec = float(center_idx / sr)

        points.append({"time": time_sec, "crest_db": crest_db})

        start += hop_len

    if not points:
        return None

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "points": points,
    }
