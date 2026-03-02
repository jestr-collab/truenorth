# TrueNorth / Mix Affinity

Audio analysis API and viz: spatial fingerprint, loudness, crest factor, low-end.

## How to run locally

1. **Start the FastAPI backend**
   ```bash
   cd audio-api
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Open the viz in Live Server**
   - Serve the `viz` folder (e.g. VS Code Live Server on port 5500 or 5501).
   - Open `http://127.0.0.1:5500/viz/index.html` or `http://127.0.0.1:5501/viz/index.html` (adjust if your server root is the repo root: `http://127.0.0.1:5500/index.html` from the `viz` directory).

3. **Set API endpoint (optional)**
   - On the upload page, use the "API Endpoint" field: leave default `http://localhost:8000` for local, or set `https://truenorth.onrender.com` (or your Render URL) and click **Save** to use the remote API.

## How to verify

- **Network:** When you click **Analyze**, a single `POST` request should appear (DevTools → Network → Fetch/XHR) to `{API_BASE_URL}/spatial-fingerprint` (e.g. `http://localhost:8000/spatial-fingerprint`) with `main_file` (and optionally `ref_file`) as multipart form data.
- **Console:** You should see logs: `uploadAndAnalyze fired`, `fetch() about to be called`, `fetch() returned` (with status and content-type), and `JSON parse success` on success.
- **Success:** HTTP 200 and valid JSON → result is stored in localStorage and the app redirects to `viz.html`; the viz should render.
- **Failure:** On CORS error, 502/504, or non-JSON response, the app must **not** redirect; it should show an error in the upload status area and log the cause in the console.

## Test the API with curl

Health:
```bash
curl -s http://localhost:8000/health
# {"status":"ok"}
```

Spatial fingerprint (WAV files):
```bash
curl -X POST http://localhost:8000/spatial-fingerprint \
  -F "main_file=@/path/to/main.wav" \
  -F "ref_file=@/path/to/ref.wav"
```

Reference file is optional; omit the `-F "ref_file=..."` line to send only the main track.
