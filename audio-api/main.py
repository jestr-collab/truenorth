from typing import Optional, Any
import os
import tempfile
import traceback
import math
import json
import time

import librosa
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware

from analyzers.spatial_fingerprint import DEFAULT_FP_SETTINGS

from analyzers import (
    compute_lufs,
    compute_crest_factor_over_time,
    compute_transient_density,
    compute_brightness_over_time,
    compute_low_end_over_time,
    compute_stereo_width_over_time,
    compute_spatial_fingerprint,
)

app = FastAPI()

# -------------------------------------------------------
# CORS
# -------------------------------------------------------
IS_DEV = os.environ.get("ENVIRONMENT") != "production"

_cors_origins = [
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    "http://127.0.0.1:5502",
    "http://127.0.0.1:5503",
    "http://localhost:5500",
    "http://localhost:5501",
    "http://localhost:5502",
    "http://localhost:5503",
    "https://truenorth.onrender.com",
]

# Pull any extra origins from Render environment variables
_env_origins = os.environ.get("CORS_ORIGINS") or os.environ.get("CORS_ORIGIN")
if _env_origins:
    for o in _env_origins.replace(",", " ").split():
        o = o.strip()
        if o and o not in _cors_origins:
            _cors_origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if IS_DEV else _cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------
# Health
# -------------------------------------------------------

@app.get("/")
async def root():
    return {"status": "ok", "message": "audio-api Phase 1 skeleton running"}


@app.get("/health")
async def health():
    return {"status": "ok"}


# -------------------------------------------------------
# Global caps (Render 512MB-safe)
# -------------------------------------------------------

MAX_ANALYZE_SECONDS = float(os.environ.get("FP_MAX_DURATION_SEC", "300"))
ANALYSIS_SR = int(os.environ.get("ANALYSIS_SR", "22050"))


# -------------------------------------------------------
# JSON sanitizer
# -------------------------------------------------------

def sanitize_for_json(payload: Any, path: str = "", non_finite_paths: list = None) -> Any:
    """Recursively replace non-finite floats (NaN, Inf, -Inf) with None."""
    if non_finite_paths is None:
        non_finite_paths = []

    if isinstance(payload, dict):
        return {
            k: sanitize_for_json(v, f"{path}.{k}" if path else k, non_finite_paths)
            for k, v in payload.items()
        }
    elif isinstance(payload, list):
        return [
            sanitize_for_json(item, f"{path}[{i}]" if path else f"[{i}]", non_finite_paths)
            for i, item in enumerate(payload)
        ]
    elif isinstance(payload, (float, np.floating)):
        val = float(payload)
        if not math.isfinite(val):
            if len(non_finite_paths) < 10:
                non_finite_paths.append(f"{path}={val}")
            return None
        return val
    elif isinstance(payload, (int, np.integer)):
        return int(payload)
    else:
        return payload


# -------------------------------------------------------
# Core helper: run all analyzers on ONE file
# -------------------------------------------------------

async def run_all_analyzers(upload_file: UploadFile) -> dict:
    """Take an UploadFile, save it temporarily, run ALL features, return dict."""
    filename = upload_file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    if ext not in [".wav", ".flac", ".ogg"]:
        raise HTTPException(
            status_code=400,
            detail="Please upload a WAV/FLAC/OGG file for now (we'll add MP3/M4A support later).",
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp_path = tmp.name
        content = await upload_file.read()
        tmp.write(content)

    try:
        try:
            info = sf.info(tmp_path)
            file_duration_sec = float(info.frames / info.samplerate) if info.samplerate else 0.0
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Could not read audio file: {e}")

        analysis_trimmed = file_duration_sec > MAX_ANALYZE_SECONDS
        analyzed_duration_sec = min(file_duration_sec, MAX_ANALYZE_SECONDS)

        try:
            y, sr = librosa.load(
                tmp_path,
                sr=ANALYSIS_SR,
                mono=False,
                duration=MAX_ANALYZE_SECONDS,
                dtype=np.float32,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Could not read audio file: {e}")

        if y.ndim == 1:
            y_mono = y
        else:
            y_mono = np.mean(y, axis=0).astype(np.float32)

        full_duration = librosa.get_duration(y=y_mono, sr=sr)

        lufs = compute_lufs(y_mono, sr)
        crest = compute_crest_factor_over_time(y_mono, sr)
        transients = compute_transient_density(y_mono, sr)
        brightness = compute_brightness_over_time(y_mono, sr)
        low_end = compute_low_end_over_time(y, sr)
        width = compute_stereo_width_over_time(y, sr)

        features = {
            "lufs": lufs,
            "crest": crest,
            "transient_density": transients,
            "brightness": brightness,
            "low_end": low_end,
            "width": width,
        }

        return {
            "filename": filename,
            "sample_rate": int(sr),
            "duration_sec": float(file_duration_sec),
            "analysis_trimmed": analysis_trimmed,
            "analyzed_duration_sec": float(analyzed_duration_sec),
            "features": features,
        }
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# -------------------------------------------------------
# /analyze — full feature set, single or with reference
# -------------------------------------------------------

@app.post("/analyze")
async def analyze(
    main_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
):
    main_result = await run_all_analyzers(main_file)

    ref_result = None
    if ref_file is not None:
        ref_result = await run_all_analyzers(ref_file)

    payload = {"main": main_result, "reference": ref_result}
    payload = sanitize_for_json(payload)
    return JSONResponse(content=jsonable_encoder(payload))


# -------------------------------------------------------
# /analyze/summary — lightweight summary only
# -------------------------------------------------------

@app.post("/analyze/summary")
async def analyze_summary(
    main_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
):
    main_result = await run_all_analyzers(main_file)
    ref_result = None
    if ref_file is not None:
        ref_result = await run_all_analyzers(ref_file)

    def summarize(track):
        if not track:
            return None
        f = track.get("features", {})
        return {
            "filename": track.get("filename"),
            "sample_rate": track.get("sample_rate"),
            "duration_sec": track.get("duration_sec"),
            "lufs_integrated": (f.get("lufs") or {}).get("integrated"),
            "crest_stats": (f.get("crest") or {}).get("stats")
            if isinstance(f.get("crest"), dict)
            else None,
        }

    payload = {"main": summarize(main_result), "reference": summarize(ref_result)}
    payload = sanitize_for_json(payload)
    return JSONResponse(content=jsonable_encoder(payload))


# -------------------------------------------------------
# /spatial-fingerprint — main product endpoint
# -------------------------------------------------------

@app.post("/spatial-fingerprint")
async def spatial_fingerprint(
    main_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
    max_events: int = 200,
):
    """
    WAV only. Returns normalized Spatial Fingerprint events for main + optional reference.
    Adds LUFS + CREST + LOW_END under track/features and reference/features.
    """
    try:
        def _require_wav(upload: UploadFile) -> str:
            filename = upload.filename or ""
            ext = os.path.splitext(filename)[1].lower()
            if ext != ".wav":
                raise HTTPException(
                    status_code=400,
                    detail="Spatial Fingerprint currently supports WAV only.",
                )
            return filename

        main_name = _require_wav(main_file)

        ref_name = None
        if ref_file is not None and (ref_file.filename or "") != "":
            ref_name = _require_wav(ref_file)

        settings = dict(DEFAULT_FP_SETTINGS)
        settings["max_events"] = int(os.getenv("FP_MAX_EVENTS", "200"))
        settings["max_duration_sec"] = float(os.getenv("FP_MAX_DURATION_SEC", "300"))

        # Save main to temp
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_main:
            main_path = tmp_main.name
            tmp_main.write(await main_file.read())

        # Save ref to temp (optional)
        ref_path = None
        if ref_name:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_ref:
                ref_path = tmp_ref.name
                tmp_ref.write(await ref_file.read())

        try:
            def _file_duration_sec(path: str) -> float:
                inf = sf.info(path)
                return float(inf.frames / inf.samplerate) if inf.samplerate else 0.0

            main_duration_sec = _file_duration_sec(main_path)
            main_trimmed = main_duration_sec > MAX_ANALYZE_SECONDS
            main_analyzed_sec = min(main_duration_sec, MAX_ANALYZE_SECONDS)
            print(f"[spatial-fingerprint] main: file_duration_sec={main_duration_sec:.2f}, capped_sec={MAX_ANALYZE_SECONDS}, trimmed={main_trimmed}")

            if ref_path:
                ref_duration_sec = _file_duration_sec(ref_path)
                ref_trimmed = ref_duration_sec > MAX_ANALYZE_SECONDS
                ref_analyzed_sec = min(ref_duration_sec, MAX_ANALYZE_SECONDS)
                print(f"[spatial-fingerprint] ref: file_duration_sec={ref_duration_sec:.2f}, capped_sec={MAX_ANALYZE_SECONDS}, trimmed={ref_trimmed}")

            print(f"[spatial-fingerprint] memory-friendly: sr={ANALYSIS_SR}, duration_cap_sec={MAX_ANALYZE_SECONDS}")

            # Compute fingerprints
            main_fp = compute_spatial_fingerprint(
                main_path,
                filename=main_name,
                settings=settings,
            )

            ref_fp = None
            if ref_path:
                ref_fp = compute_spatial_fingerprint(
                    ref_path,
                    filename=ref_name,
                    settings=settings,
                )

            # Compute LUFS + CREST + LOW_END
            y_main_stereo, sr_main = librosa.load(
                main_path,
                sr=ANALYSIS_SR,
                mono=False,
                duration=MAX_ANALYZE_SECONDS,
                dtype=np.float32,
            )
            y_main_stereo = np.asarray(y_main_stereo, dtype=np.float32)
            y_main_mono = (
                np.mean(y_main_stereo, axis=0)
                if y_main_stereo.ndim > 1
                else y_main_stereo
            )
            main_lufs = compute_lufs(y_main_mono, sr_main)
            main_crest = compute_crest_factor_over_time(y_main_mono, sr_main)
            main_low_end = compute_low_end_over_time(y_main_stereo, sr_main)

            ref_lufs = None
            ref_crest = None
            ref_low_end = None
            if ref_path:
                y_ref_stereo, sr_ref = librosa.load(
                    ref_path,
                    sr=ANALYSIS_SR,
                    mono=False,
                    duration=MAX_ANALYZE_SECONDS,
                    dtype=np.float32,
                )
                y_ref_stereo = np.asarray(y_ref_stereo, dtype=np.float32)
                y_ref_mono = (
                    np.mean(y_ref_stereo, axis=0)
                    if y_ref_stereo.ndim > 1
                    else y_ref_stereo
                )
                ref_lufs = compute_lufs(y_ref_mono, sr_ref)
                ref_crest = compute_crest_factor_over_time(y_ref_mono, sr_ref)
                ref_low_end = compute_low_end_over_time(y_ref_stereo, sr_ref)

            payload = {
                "version": "spatial-fingerprint/v1",
                "settings": settings,
                "track": {
                    **main_fp,
                    "features": {
                        **(main_fp.get("features") or {}),
                        "lufs": main_lufs,
                        "crest": main_crest,
                        "low_end": main_low_end,
                    },
                },
                "reference": None
                if ref_fp is None
                else {
                    **ref_fp,
                    "features": {
                        **(ref_fp.get("features") or {}),
                        "lufs": ref_lufs,
                        "crest": ref_crest,
                        "low_end": ref_low_end,
                    },
                },
            }

            non_finite_paths = []
            payload = sanitize_for_json(payload, non_finite_paths=non_finite_paths)

            if non_finite_paths:
                print(f"[spatial-fingerprint] Found {len(non_finite_paths)} non-finite value(s):")
                for p in non_finite_paths[:10]:
                    print(f"  {p}")

            return JSONResponse(content=jsonable_encoder(payload))

        finally:
            for p in [main_path, ref_path]:
                if p:
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": str(e),
                "traceback": traceback.format_exc(),
            },
        )
