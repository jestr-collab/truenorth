import numpy as np
import librosa


def compute_brightness_over_time(y, sr, frame_ms=50, hop_ms=25):
    """
    Brightness = spectral centroid (in Hz) over time.

    Returns:
    {
        "frame_ms": 50,
        "hop_ms": 25,
        "points": [
            {"time": 0.05, "brightness_hz": 3200.0},
            ...
        ]
    }
    """
    # Ensure 1D mono array for brightness
    y = np.asarray(y, dtype=float)
    if y.ndim > 1:
        y = np.mean(y, axis=0)

    n = y.size
    if n == 0:
        return None

    frame_len = int(sr * frame_ms / 1000.0)
    hop_len = int(sr * hop_ms / 1000.0)

    if frame_len <= 0 or hop_len <= 0 or frame_len > n:
        return None

    # Choose n_fft at least as large as frame_len (power of two)
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2

    centroid = librosa.feature.spectral_centroid(
        y=y,
        sr=sr,
        n_fft=n_fft,
        hop_length=hop_len,
    )[0]  # shape: (n_frames,)

    times = librosa.frames_to_time(
        np.arange(centroid.shape[0]),
        sr=sr,
        hop_length=hop_len,
        n_fft=n_fft,
    )

    points = [
        {"time": float(t), "brightness_hz": float(c)}
        for t, c in zip(times, centroid)
    ]

    if not points:
        return None

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "points": points,
    }
