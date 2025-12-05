import numpy as np
import librosa


def compute_transient_density(
    y,
    sr,
    window_sec: float = 1.0,
    hop_sec: float = 0.25,
):
    y = np.asarray(y, dtype=float).flatten()
    if y.size == 0:
        return {
            "window_sec": float(window_sec),
            "hop_sec": float(hop_sec),
            "points": [],
        }

    try:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        times = librosa.times_like(onset_env, sr=sr)
    except Exception:
        return {
            "window_sec": float(window_sec),
            "hop_sec": float(hop_sec),
            "points": [],
        }

    if onset_env.size == 0 or times.size == 0:
        return {
            "window_sec": float(window_sec),
            "hop_sec": float(hop_sec),
            "points": [],
        }

    window = float(window_sec)
    hop = float(hop_sec)
    t_max = float(times[-1])
    points = []

    t = 0.0
    while t < t_max:
        mask = (times >= t) & (times < t + window)
        seg = onset_env[mask]

        if seg.size > 0:
            mean = float(np.mean(seg))
            std = float(np.std(seg))
            thresh = mean + 0.5 * std
            count = int(np.sum(seg > thresh))
            density = count / window if window > 0 else 0.0
        else:
            density = 0.0

        center_time = t + window / 2.0
        points.append({"time": center_time, "density": float(density)})
        t += hop

    return {
        "window_sec": window,
        "hop_sec": hop,
        "points": points,
    }
