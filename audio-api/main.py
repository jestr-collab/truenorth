from typing import Optional, Any
import os
import tempfile
import traceback
import math
import json
import time

import librosa
import numpy as np
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

# CORS: Live Server origins + optional env (e.g. CORS_ORIGINS=https://myapp.com,https://app.example.com)
_cors_origins = [
    "http://127.0.0.1:5501",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://localhost:5500",
]
_env_origins = os.environ.get("CORS_ORIGINS") or os.environ.get("CORS_ORIGIN")
if _env_origins:
    for o in _env_origins.replace(",", " ").split():
        o = o.strip()
        if o and o not in _cors_origins:
            _cors_origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "ok", "message": "audio-api Phase 1 skeleton running"}


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------- core helper: run analyzers on ONE file ----------

# Cap analyzed duration (seconds) to limit memory on constrained hosts (e.g. Render 512MB).
# Set MAX_ANALYZE_SECONDS in Render env vars if you need a different limit (default 300 = 5 min).
MAX_ANALYZE_SECONDS = int(os.environ.get("MAX_ANALYZE_SECONDS", "300"))
ANALYSIS_SR = 22050  # Downsample for analysis to save memory


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

    # Save to a temp path
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp_path = tmp.name
        content = await upload_file.read()
        tmp.write(content)

    try:
        # Load audio downsampled to ANALYSIS_SR (memory-safe), mono=False for stereo width
        try:
            y, sr = librosa.load(tmp_path, sr=ANALYSIS_SR, mono=False)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Could not read audio file: {e}",
            )

        y = np.asarray(y, dtype=np.float32)

        # mono mixdown for mono-based features (float32)
        if y.ndim == 1:
            y_mono = y
        else:
            y_mono = np.mean(y, axis=0).astype(np.float32)

        full_duration = librosa.get_duration(y=y_mono, sr=sr)
        max_samples = int(sr * MAX_ANALYZE_SECONDS)
        analysis_trimmed = False
        analyzed_duration_sec = float(full_duration)

        if y_mono.size > max_samples:
            analysis_trimmed = True
            analyzed_duration_sec = float(max_samples / sr)
            n = max_samples
            y_mono = y_mono[:n]
            if y.ndim == 1:
                y = y[:n]
            else:
                y = y[:, :n].copy()

        # Run existing analyzers on (possibly trimmed) buffers
        lufs = compute_lufs(y_mono, sr)
        crest = compute_crest_factor_over_time(y_mono, sr)
        transients = compute_transient_density(y_mono, sr)
        brightness = compute_brightness_over_time(y_mono, sr)
        low_end = compute_low_end_over_time(y, sr)  # Pass stereo y for width computation
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
            "duration_sec": float(full_duration),
            "analysis_trimmed": analysis_trimmed,
            "analyzed_duration_sec": analyzed_duration_sec,
            "features": features,
        }
    finally:
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
    main_result = await run_all_analyzers(main_file)

    ref_result = None
    if ref_file is not None:
        ref_result = await run_all_analyzers(ref_file)

    payload = {"main": main_result, "reference": ref_result}
    payload = sanitize_for_json(payload)
    return JSONResponse(content=jsonable_encoder(payload))


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


# ---------- Spatial Fingerprint endpoint ----------

def sanitize_for_json(payload: Any, path: str = "", non_finite_paths: list = None) -> Any:
    """
    Recursively replace non-finite floats (NaN, Inf, -Inf) with None.
    Tracks first 10 non-finite paths encountered.
    """
    if non_finite_paths is None:
        non_finite_paths = []
    
    if isinstance(payload, dict):
        return {k: sanitize_for_json(v, f"{path}.{k}" if path else k, non_finite_paths) for k, v in payload.items()}
    elif isinstance(payload, list):
        return [sanitize_for_json(item, f"{path}[{i}]" if path else f"[{i}]", non_finite_paths) for i, item in enumerate(payload)]
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


@app.post("/spatial-fingerprint")
async def spatial_fingerprint(
    main_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
    max_events: int = 200,
):
    """
    WAV-only. Returns normalized 'Spatial Fingerprint' events for main + optional reference.
    Adds LUFS + CREST under track/features and reference/features.
    """
    try:
        # WAV-only enforcement
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
            # --- compute fingerprint(s) ---
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

            # --- compute LUFS + CREST + LOW_END ---
            # Load stereo for low_end (needs width), then create mono for lufs/crest
            y_main_stereo, sr_main = librosa.load(main_path, sr=None, mono=False)
            y_main_stereo = np.asarray(y_main_stereo, dtype=float)
            y_main_mono = np.mean(y_main_stereo, axis=0) if y_main_stereo.ndim > 1 else y_main_stereo
            
            main_lufs = compute_lufs(y_main_mono, sr_main)
            main_crest = compute_crest_factor_over_time(y_main_mono, sr_main)
            main_low_end = compute_low_end_over_time(y_main_stereo, sr_main)

            ref_lufs = None
            ref_crest = None
            ref_low_end = None
            if ref_path:
                y_ref_stereo, sr_ref = librosa.load(ref_path, sr=None, mono=False)
                y_ref_stereo = np.asarray(y_ref_stereo, dtype=float)
                y_ref_mono = np.mean(y_ref_stereo, axis=0) if y_ref_stereo.ndim > 1 else y_ref_stereo
                
                ref_lufs = compute_lufs(y_ref_mono, sr_ref)
                ref_crest = compute_crest_factor_over_time(y_ref_mono, sr_ref)
                ref_low_end = compute_low_end_over_time(y_ref_stereo, sr_ref)

            # --- attach features inside "features" without breaking existing keys ---
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
            
            # Sanitize non-finite floats before JSON encoding
            non_finite_paths = []
            payload = sanitize_for_json(payload, non_finite_paths=non_finite_paths)
            
            # Debug: print first 10 non-finite paths encountered
            if non_finite_paths:
                print(f"[spatial-fingerprint] Found {len(non_finite_paths)} non-finite value(s):")
                for path in non_finite_paths[:10]:
                    print(f"  {path}")
            
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
