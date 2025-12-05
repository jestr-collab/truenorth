import numpy as np
import librosa

def compute_low_end_over_time(
    y,
    sr,
    frame_ms: int = 50,
    hop_ms: int = 25,
    cutoff_hz: float = 120.0,
):
    """
    Fraction of energy in low-end (< cutoff_hz) over time.
    Returns:
      {
        "frame_ms": ...,
        "hop_ms": ...,
        "cutoff_hz": ...,
        "points": [
          {"time": float, "low_end_ratio": float [0-1]}, ...
        ]
      }
    """
    y = np.asarray(y, dtype=float)

    frame_length = int(sr * frame_ms / 1000)
    hop_length = int(sr * hop_ms / 1000)

    n_fft = 1
    while n_fft < frame_length:
        n_fft *= 2

    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    low_mask = freqs <= cutoff_hz
    low_energy = S[low_mask].sum(axis=0)
    total_energy = S.sum(axis=0) + 1e-12

    ratio = np.clip(low_energy / total_energy, 0.0, 1.0)

    times = librosa.frames_to_time(
        np.arange(ratio.shape[0]),
        sr=sr,
        hop_length=hop_length,
    )

    points = [
        {"time": float(t), "low_end_ratio": float(r)}
        for t, r in zip(times, ratio)
    ]

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "cutoff_hz": cutoff_hz,
        "points": points,
    }
