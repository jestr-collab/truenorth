import numpy as np
import pyloudnorm as pyln


def compute_lufs(
    y,
    sr,
    window_sec: float = 3.0,
    hop_sec: float = 1.0,
):
    """
    Compute integrated LUFS, optional loudness range (LRA),
    and a short-term LUFS curve over time.

    Returns:
    {
        "integrated": -20.25,
        "lra": null or float,
        "short_term": {
            "window_sec": 3.0,
            "hop_sec": 1.0,
            "points": [
                {"time": 1.5, "lufs": -21.1},
                {"time": 2.5, "lufs": -19.8},
                ...
            ]
        }
    }
    or None if the signal is silent/invalid.
    """
    if y is None:
        return None

    # Ensure 1D float array
    y = np.asarray(y, dtype=float).flatten()
    if y.size == 0:
        return None

    # If the whole signal is silent, loudness is undefined
    rms_total = np.sqrt(np.mean(y ** 2))
    if rms_total == 0:
        return None

    meter = pyln.Meter(sr)

    # -------- Integrated loudness --------
    integrated = float(meter.integrated_loudness(y))
    if not np.isfinite(integrated):
        return None

    # -------- Loudness range (if supported) --------
    try:
        lra_val = meter.loudness_range(y)
        lra = float(lra_val) if np.isfinite(lra_val) else None
    except AttributeError:
        # Older pyloudnorm versions may not have this
        lra = None

    # -------- Short-term LUFS curve --------
    window_samples = int(window_sec * sr)
    hop_samples = int(hop_sec * sr)

    points = []
    if window_samples > 0 and hop_samples > 0 and window_samples <= y.size:
        start = 0
        while start + window_samples <= y.size:
            frame = y[start:start + window_samples]

            # Skip completely silent frames
            if np.any(frame):
                try:
                    frame_lufs = float(meter.integrated_loudness(frame))
                except Exception:
                    frame_lufs = None
            else:
                frame_lufs = None

            # Center time of the window (for plotting)
            center_idx = start + window_samples / 2.0
            time_sec = float(center_idx / sr)

            points.append(
                {"time": time_sec, "lufs": frame_lufs}
            )

            start += hop_samples

    short_term = {
        "window_sec": float(window_sec),
        "hop_sec": float(hop_sec),
        "points": points,
    }

    return {
        "integrated": integrated,
        "lra": lra,
        "short_term": short_term,
    }
