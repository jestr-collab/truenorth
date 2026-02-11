import numpy as np
import librosa

def compute_low_end_over_time(
    y,
    sr,
    frame_ms: int = 50,
    hop_ms: int = 25,
):
    """
    Band-split low-end analysis with stereo width per frame.
    
    Computes energy shares for Sub (20-60 Hz), Bass (60-120 Hz), LowMid (120-250 Hz),
    and stereo width in the low-end band (20-120 Hz) using Mid/Side analysis.
    
    Args:
        y: Audio signal, shape (n_samples,) for mono or (2, n_samples) for stereo
        sr: Sample rate
        frame_ms: Frame length in milliseconds
        hop_ms: Hop length in milliseconds
    
    Returns:
        {
            "frame_ms": int,
            "hop_ms": int,
            "bands_hz": {"sub": [20, 60], "bass": [60, 120], "lowmid": [120, 250]},
            "labels": ["sub", "bass", "lowmid"],
            "points": [
                {
                    "time": float,
                    "sub": float,           # 0-1 energy share
                    "bass": float,         # 0-1 energy share
                    "lowmid": float,       # 0-1 energy share
                    "low_end_total": float, # 0-1 total low-end share
                    "low_width": float      # 0-1 stereo width in low-end
                },
                ...
            ]
        }
    """
    y = np.asarray(y, dtype=float)
    
    # 1. Handle input shape (mono vs stereo)
    is_mono = y.ndim == 1
    
    if is_mono:
        y_mono = y
        y_stereo = None
    else:
        # Ensure shape (2, n_samples)
        if y.shape[0] == 2:
            y_stereo = y
            y_mono = np.mean(y, axis=0)
        elif y.shape[1] == 2:
            # Transposed: (n_samples, 2) -> (2, n_samples)
            y_stereo = y.T
            y_mono = np.mean(y_stereo, axis=0)
        else:
            # Multi-channel: take mean
            y_mono = np.mean(y, axis=0)
            y_stereo = None
            is_mono = True
    
    # 2. Compute STFT parameters
    frame_length = int(sr * frame_ms / 1000)
    hop_length = int(sr * hop_ms / 1000)
    
    n_fft = 1
    while n_fft < frame_length:
        n_fft *= 2
    
    # 3. Compute STFT for mono (for band energy analysis)
    S_mono = np.abs(librosa.stft(y_mono, n_fft=n_fft, hop_length=hop_length)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    
    # 4. Create frequency masks
    sub_mask = (freqs >= 20) & (freqs < 60)
    bass_mask = (freqs >= 60) & (freqs < 120)
    lowmid_mask = (freqs >= 120) & (freqs < 250)
    low_mask = (freqs >= 20) & (freqs < 120)  # Total low-end band
    
    # 5. Compute band energies (per frame)
    sub_energy = S_mono[sub_mask].sum(axis=0)
    bass_energy = S_mono[bass_mask].sum(axis=0)
    lowmid_energy = S_mono[lowmid_mask].sum(axis=0)
    low_total = S_mono[low_mask].sum(axis=0)
    total_energy = S_mono.sum(axis=0) + 1e-12
    
    # 6. Compute energy shares (normalized by total energy)
    sub_share = np.clip(sub_energy / total_energy, 0.0, 1.0)
    bass_share = np.clip(bass_energy / total_energy, 0.0, 1.0)
    lowmid_share = np.clip(lowmid_energy / total_energy, 0.0, 1.0)
    low_end_total = np.clip(low_total / total_energy, 0.0, 1.0)
    
    # 7. Compute stereo width (if stereo)
    if is_mono:
        low_width = np.zeros_like(sub_share)
    else:
        # Compute STFT for L and R channels
        SL = np.abs(librosa.stft(y_stereo[0], n_fft=n_fft, hop_length=hop_length))
        SR = np.abs(librosa.stft(y_stereo[1], n_fft=n_fft, hop_length=hop_length))
        
        # Mid/Side decomposition
        mid = (SL + SR) / 2.0
        side = (SL - SR) / 2.0
        
        # Extract low-end band from Mid/Side (20-120 Hz)
        mid_low = mid[low_mask]
        side_low = side[low_mask]
        
        # Compute per-frame energies in low-end
        E_mid = np.sum(mid_low ** 2, axis=0)
        E_side = np.sum(side_low ** 2, axis=0)
        
        # Width formula: side / (mid + side), clamped to [0, 1]
        eps = 1e-12
        low_width = np.clip(E_side / (E_mid + E_side + eps), 0.0, 1.0)
    
    # 8. Build time grid (ensure frame alignment)
    n_frames = len(sub_share)
    times = librosa.frames_to_time(
        np.arange(n_frames),
        sr=sr,
        hop_length=hop_length,
    )
    
    # 9. Build points array
    points = [
        {
            "time": float(t),
            "sub": float(s),
            "bass": float(b),
            "lowmid": float(lm),
            "low_end_total": float(lt),
            "low_width": float(w),
        }
        for t, s, b, lm, lt, w in zip(
            times, sub_share, bass_share, lowmid_share, low_end_total, low_width
        )
    ]
    
    result = {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "bands_hz": {"sub": [20, 60], "bass": [60, 120], "lowmid": [120, 250]},
        "labels": ["sub", "bass", "lowmid"],
        "points": points,
    }
    
    # Validation: ensure all points have required fields
    if points:
        first_point = points[0]
        required_fields = ["time", "sub", "bass", "lowmid", "low_end_total", "low_width"]
        missing = [f for f in required_fields if f not in first_point]
        if missing:
            raise ValueError(f"Missing required fields in points: {missing}")
    
    return result
