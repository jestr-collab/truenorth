import numpy as np
import librosa

def compute_brightness_over_time(y, sr, frame_ms: int = 50, hop_ms: int = 25):
    """
    Brightness over time using spectral centroid as proxy.
    Returns:
      {
        "frame_ms": ...,
        "hop_ms": ...,
        "points": [
          {"time": float, "brightness": float [0-1]}, ...
        ]
      }
    """
    y = np.asarray(y, dtype=float)

    frame_length = int(sr * frame_ms / 1000)
    hop_length = int(sr * hop_ms / 1000)

    # power-of-two FFT
    n_fft = 1
    while n_fft < frame_length:
        n_fft *= 2

    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # spectral centroid per frame
    num = (freqs[:, None] * S).sum(axis=0)
    den = S.sum(axis=0) + 1e-12
    centroid = num / den  # Hz

    times = librosa.frames_to_time(
        np.arange(centroid.shape[0]),
        sr=sr,
        hop_length=hop_length,
    )

    # normalize by Nyquist so 0–1-ish
    max_freq = sr / 2.0
    brightness = np.clip(centroid / (max_freq + 1e-12), 0.0, 1.0)

    points = [
        {"time": float(t), "brightness": float(b)}
        for t, b in zip(times, brightness)
    ]

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "points": points,
    }
