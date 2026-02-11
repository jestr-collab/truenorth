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
            {"time": 0.05, "crest_db": 12.3, "punch_db": 8.5},
            {"time": 0.075, "crest_db": 11.8, "punch_db": 7.2},
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
    # RMS gate: below this we set crest to null (avoids end-of-track spike from peak/rms blow-up)
    min_rms = 1e-5
    max_crest_db = 40.0  # Clamp crest to prevent false spikes from numerical edge cases
    # Trim tail: exclude last 100ms from plotted series to avoid partial/edge frames
    trim_tail_sec = 0.1

    # Window sizes for punch calculation
    punch_short_ms = 10.0  # Short window for peak (5-15ms range, using 10ms)
    punch_long_ms = 200.0  # Long window for RMS body (150-300ms range, using 200ms)
    punch_short_len = int(sr * punch_short_ms / 1000.0)
    punch_long_len = int(sr * punch_long_ms / 1000.0)

    start = 0
    while start + frame_len <= n:
        frame = y[start:start + frame_len]
        center_idx = start + frame_len / 2.0
        time_sec = float(center_idx / sr)

        peak_abs = np.max(np.abs(frame))
        peak_pos = np.max(frame) if frame.size > 0 else 0
        peak_neg = np.min(frame) if frame.size > 0 else 0
        rms = float(np.sqrt(np.mean(frame ** 2)))

        # RMS gate: near-silent frames -> null to avoid false spike
        if rms < min_rms:
            crest_db = None
            peak_pos_db = None
            peak_neg_db = None
            rms_db = None
            punch_db = None
        elif rms > 0 and peak_abs > 0:
            crest = 20.0 * np.log10((peak_abs + eps) / (rms + eps))
            crest_db = float(np.clip(crest, 0.0, max_crest_db))
            # Convert to dB for visualization (positive and negative peaks)
            peak_pos_db = 20.0 * np.log10(np.abs(peak_pos) + eps) if peak_pos != 0 else None
            peak_neg_db = 20.0 * np.log10(np.abs(peak_neg) + eps) if peak_neg != 0 else None
            rms_db = 20.0 * np.log10(rms + eps)

            # Punch: peak_db_short - rms_db_long
            # Measures how much the transient jumps out of the local body
            # Uses different window sizes than crest, so will differ from crest
            punch_short_start = max(0, int(center_idx - punch_short_len / 2))
            punch_short_end = min(n, int(center_idx + punch_short_len / 2))
            punch_short_frame = y[punch_short_start:punch_short_end]
            
            punch_long_start = max(0, int(center_idx - punch_long_len / 2))
            punch_long_end = min(n, int(center_idx + punch_long_len / 2))
            punch_long_frame = y[punch_long_start:punch_long_end]
            
            if punch_short_frame.size > 0 and punch_long_frame.size > 0:
                # Use absolute peak magnitude (max(|pos|,|neg|)) for short window
                peak_short_abs = np.max(np.abs(punch_short_frame))
                rms_long = np.sqrt(np.mean(punch_long_frame ** 2))
                
                if peak_short_abs > 0 and rms_long > 0:
                    peak_short_db = 20.0 * np.log10(peak_short_abs + eps)
                    rms_long_db = 20.0 * np.log10(rms_long + eps)
                    punch_db = float(peak_short_db - rms_long_db)
                    # Clamp extremes to prevent NaN/inf (reasonable range: -60 to +60 dB)
                    punch_db = float(np.clip(punch_db, -60.0, 60.0))
                else:
                    punch_db = None
            else:
                punch_db = None
        else:
            crest_db = None
            peak_pos_db = None
            peak_neg_db = None
            rms_db = None
            punch_db = None

        points.append({
            "time": time_sec,
            "crest_db": crest_db,
            "peak_pos_db": peak_pos_db,
            "peak_neg_db": peak_neg_db,
            "rms_db": rms_db,
            "punch_db": punch_db,
        })

        start += hop_len

    if not points:
        return None

    # Sanitize: replace non-finite numerics with None before JSON
    def _sanitize_point(p):
        out = {"time": p["time"], "crest_db": p["crest_db"], "peak_pos_db": p["peak_pos_db"],
               "peak_neg_db": p["peak_neg_db"], "rms_db": p["rms_db"], "punch_db": p["punch_db"]}
        for k in list(out.keys()):
            if out[k] is not None and isinstance(out[k], (int, float)) and not np.isfinite(out[k]):
                out[k] = None
        return out

    points = [_sanitize_point(p) for p in points]
    # Trim tail: drop last ~100ms to avoid edge/partial-frame spikes
    duration_sec = (n - frame_len / 2) / sr if n else 0
    trim_time = duration_sec - trim_tail_sec
    points = [p for p in points if p["time"] <= trim_time]

    return {
        "frame_ms": frame_ms,
        "hop_ms": hop_ms,
        "points": points,
    }
