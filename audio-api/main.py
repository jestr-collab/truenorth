from typing import Optional

import os
import tempfile

import librosa
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException

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
async def health():
    return {"status": "ok", "message": "audio-api Phase 1 skeleton running"}


# ---------- core helper: run analyzers on ONE file ----------

async def run_all_analyzers(upload_file: UploadFile) -> dict:
    """Take an UploadFile, save it temporarily, run ALL features, return JSON."""
    filename = upload_file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    # basic extension check (same rules as before)
    if ext not in [".wav", ".flac", ".ogg"]:
        raise HTTPException(
            status_code=400,
            detail="Please upload a WAV/FLAC/OGG file for now (we'll add MP3/M4A support later).",
        )

    # 1) Save to a temp path
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp_path = tmp.name
        content = await upload_file.read()
        tmp.write(content)

    try:
        # 2) Load audio (mono=False so we can compute stereo width)
        try:
            y, sr = librosa.load(tmp_path, sr=None, mono=False)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Could not read audio file: {e}",
            )

        y = np.asarray(y, dtype=float)

        # mono mixdown for mono-based features
        if y.ndim == 1:
            y_mono = y
        else:
            y_mono = np.mean(y, axis=0)

        duration = librosa.get_duration(y=y_mono, sr=sr)

        # 3) Run all your existing analyzers
        lufs = compute_lufs(y_mono, sr)
        crest = compute_crest_factor_over_time(y_mono, sr)
        transients = compute_transient_density(y_mono, sr)
        brightness = compute_brightness_over_time(y_mono, sr)
        low_end = compute_low_end_over_time(y_mono, sr)
        width = compute_stereo_width_over_time(y, sr)

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
            "sample_rate": int(sr),
            "duration_sec": float(duration),
            "features": features,
        }
    finally:
        # 4) Clean up temp file
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ---------- main endpoint: single OR reference ----------

@app.post("/analyze")
async def analyze(
    main_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
):
    # always analyze the main file
    main_result = await run_all_analyzers(main_file)

    # analyze reference if provided
    ref_result = None
    if ref_file is not None:
        ref_result = await run_all_analyzers(ref_file)

    return {
        "main": main_result,
        "reference": ref_result,
    }
