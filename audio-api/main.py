from fastapi import FastAPI, UploadFile, File, HTTPException
import librosa
import tempfile
import os
import numpy as np

from analyzers import (
    compute_lufs,
    compute_crest_factor_over_time,
    compute_transient_density,
    compute_brightness_over_time,
    compute_low_end_over_time,
    compute_stereo_width_over_time,
)

app = FastAPI()


@app.get("/")
def root():
    return {"status": "ok", "message": "audio-api Phase 1 skeleton running"}


@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    if ext not in [".wav", ".flac", ".ogg"]:
        raise HTTPException(
            status_code=400,
            detail="Please upload a WAV/FLAC/OGG file for now (we'll add MP3/M4A support later).",
        )

    contents = await file.read()

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        # NOTE: mono=False so we can compute stereo width
        y, sr = librosa.load(tmp_path, sr=None, mono=False)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not read audio file: {e}",
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    # Ensure ndarray
    y = np.asarray(y, dtype=float)

    # Make a mono mixdown for mono-based features
    if y.ndim == 1:
        y_mono = y
    else:
        # librosa returns (n_channels, n_samples)
        y_mono = np.mean(y, axis=0)

    duration = librosa.get_duration(y=y_mono, sr=sr)

    # ---- Features ----
    lufs = compute_lufs(y_mono, sr)
    crest = compute_crest_factor_over_time(y_mono, sr)
    transients = compute_transient_density(y_mono, sr)
    brightness = compute_brightness_over_time(y_mono, sr)
    low_end = compute_low_end_over_time(y_mono, sr)
    width = compute_stereo_width_over_time(y, sr)  # uses stereo if available

    features = {
        "lufs": lufs,
        "crest": crest,
        "transient_density": transients,
        "brightness": brightness,
        "low_end": low_end,
        "width": width,
    }
    # DEBUG: see what keys the backend thinks it’s returning
    print("DEBUG FEATURES KEYS:", list(features.keys()))


    return {
        "filename": filename,
        "sample_rate": sr,
        "duration_sec": float(duration),
        "features": features,
    }
