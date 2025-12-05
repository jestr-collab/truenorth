import numpy as np

def frame_signal(y, sr, frame_ms=50, hop_ms=25):
    """Convert time-domain signal into overlapping frames (placeholder util)."""
    frame_len = int(sr * frame_ms / 1000)
    hop_len = int(sr * hop_ms / 1000)
    frames = []
    for start in range(0, len(y) - frame_len + 1, hop_len):
        frames.append(y[start:start + frame_len])
    return np.array(frames)
