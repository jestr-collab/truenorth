# analyzers/stereo_width.py

import numpy as np
import librosa

def compute_stereo_width_over_time(y, sr, frame_ms: int = 50, hop_ms: int = 25):
    """
    Stereo width over time, based on mid/side energy.
    If mono, returns is_mono=True and width 0.
    Returns:
      {
        "frame_ms": ...,
        "hop_ms": ...,
        "is_mono": bool,
        "points": [
          {"time": float, "width": float}, ...
        ]
      }
    """
    # y is (n_samples,) or (n_channels, n_samples)
    if y.ndim == 1:
        return {
            "frame_ms": frame_ms,
            "hop_ms": hop_ms,
            "is_mono": True,
            "points": [],
        }

    # Expect shape (2, n_samples) for L/R
    if y.shape[0] != 2:
        # Fallback: treat as mono if unexpected channel count
        mono = np.mean(y, axis=0)
        return {
            "frame_ms": frame_ms,
            "hop_ms": hop_ms,
            "is_mono": True,
            "points": [],
        }

    L, R = y

    frame_length = int(sr * frame_ms / 1000)
    hop_length = int(sr * hop_ms / 1000)

    # STFT for L/R
    n_fft = 1
    while n_fft < frame_length:
        n_fft *= 2

    SL = np.abs(librosa.stft(L, n_fft=n_fft, hop_length=hop_length))
    SR = np.abs(librosa.stft(R, n_fft=n_fft, hop_length=hop_length))

    # Mid/Side
    mid = (SL + SR) / 2.0
    side = (SL - SR) / 2.0

    # Per-frame energies
    mid_energy = np.mean(mid**2, axis=0)
    side_energy = np.mean(side**2, axis=0)

    # Width metric: side / (mid + side), clipped to [0,1]
    denom = mid_energy + side_energy + 1e-12
    width = np.clip(side_energy / denom, 0.0, 1.0)

    times = librosa.frames_to_time(np.arange(width.shape[0]), sr=sr, hop_length=hop_length)

    points = [
        {"time": float(t), "width": float(w)}
        for t, w in zip(times, width)
    ]

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "is_mono": False,
        "points": points,
    }
