# TrueNorth Audio - Loveable Integration Guide

This guide explains how to integrate the TrueNorth visualization system into a Loveable/React application.

## Architecture Overview

The TrueNorth viz system is **framework-agnostic** and designed for easy integration:

- **Core System**: `tnBridge.js` + viz modules (`app.js`, `loudnesscurve.js`, `crestcurve.js`)
- **Loader**: `vizLoader.js` - Standalone script loader (use this in React)
- **Prototype Shell**: `vizShell.js` - Demo/prototype UI (ignore for production)

### Separation of Concerns

| Component | Owned By | Purpose |
|-----------|----------|---------|
| File Upload UI | **Loveable** | React components for file selection |
| API Calls | **Loveable** | Fetch to FastAPI backend |
| User Auth | **Loveable** | Stripe, database, sessions |
| Visualization Core | **TrueNorth** | D3 rendering, viz logic |
| Button UI | **Loveable** | Track/Ref toggle, viz switcher |

## Quick Start

### 1. Load the Viz System

In your React component, load the viz scripts using `vizLoader.js`:

```jsx
import { useEffect, useRef } from 'react';

function TrueNorthViz({ data, viz = "spatial", mode = "track" }) {
  const containerRef = useRef(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    // Load scripts once
    if (!loadedRef.current && window.loadTrueNorthViz) {
      loadedRef.current = true;
      window.loadTrueNorthViz({ basePath: "/path/to/viz/" })
        .then(() => {
          // System is ready
          if (data) {
            window.TrueNorthViz.setData(data);
            window.TrueNorthViz.setViz(viz);
            window.TrueNorthViz.setMode(mode);
          }
        })
        .catch(err => console.error("Failed to load viz system:", err));
    } else if (loadedRef.current && data) {
      // Update when data changes
      window.TrueNorthViz.setData(data);
      window.TrueNorthViz.setViz(viz);
      window.TrueNorthViz.setMode(mode);
    }
  }, [data, viz, mode]);

  return (
    <div ref={containerRef}>
      {/* Required DOM elements for viz system */}
      <svg id="chart" width="960" height="540"></svg>
      <div id="tooltip"></div>
      
      {/* Your Loveable UI controls */}
      <div>
        <button onClick={() => window.TrueNorthViz?.setMode("track")}>Track</button>
        <button onClick={() => window.TrueNorthViz?.setMode("reference")}>Reference</button>
      </div>
    </div>
  );
}
```

### 2. Handle File Uploads

Loveable owns the upload UI. Here's a simple example:

```jsx
function UploadPage() {
  const [mainFile, setMainFile] = useState(null);
  const [refFile, setRefFile] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!mainFile) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("main_file", mainFile);
      if (refFile) {
        formData.append("ref_file", refFile);
      }

      const response = await fetch("http://your-api.com/spatial-fingerprint", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setAnalysisData(data);
      
      // Update viz system
      if (window.TrueNorthViz) {
        window.TrueNorthViz.setData(data);
      }
    } catch (err) {
      console.error(err);
      // Show error to user
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        accept=".wav" 
        onChange={(e) => setMainFile(e.target.files[0])} 
      />
      <input 
        type="file" 
        accept=".wav" 
        onChange={(e) => setRefFile(e.target.files[0])} 
      />
      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Analyzing..." : "Analyze"}
      </button>

      {analysisData && <TrueNorthViz data={analysisData} />}
    </div>
  );
}
```

## API Reference

### `window.loadTrueNorthViz(options)`

Loads all viz scripts and returns a promise when ready.

**Options:**
- `d3Url` (string): D3 CDN URL (default: `"https://cdn.jsdelivr.net/npm/d3@7"`)
- `basePath` (string): Base path for viz scripts (default: `"./"`)

**Returns:** `Promise<void>`

**Example:**
```javascript
await window.loadTrueNorthViz({ basePath: "/static/viz/" });
```

### `window.TrueNorthViz.setData(data)`

Sets the analysis data and remounts the current visualization.

**Parameters:**
- `data` (Object): Analysis result from backend
  - Shape: `{ track: {...}, reference: {...} }` or `{ main: {...}, reference: {...} }`
  - The system automatically normalizes `main` → `track`

**Example:**
```javascript
window.TrueNorthViz.setData({
  track: { features: {...}, fingerprint: {...} },
  reference: { features: {...}, fingerprint: {...} }
});
```

### `window.TrueNorthViz.setViz(name)`

Switches to a different visualization.

**Parameters:**
- `name` (string): One of `"spatial"`, `"loudness"`, or `"crest"`

**Example:**
```javascript
window.TrueNorthViz.setViz("loudness");
```

### `window.TrueNorthViz.setMode(mode)`

Switches between Track and Reference mode.

**Parameters:**
- `mode` (string): Either `"track"` or `"reference"`

**Example:**
```javascript
window.TrueNorthViz.setMode("reference");
```

### `window.TrueNorthViz.getData()`

Returns the current analysis data.

**Returns:** `Object | null`

## Required DOM Elements

The viz system needs these elements in your React component:

```html
<!-- SVG container for visualization -->
<svg id="chart" width="960" height="540"></svg>

<!-- Tooltip container (positioned fixed) -->
<div id="tooltip"></div>

<!-- Optional: Title element -->
<div id="title">Track: —</div>

<!-- Optional: Time scrubber (for spatial viz) -->
<div id="timeRow">
  <input id="timeScrub" type="range" min="0" max="100" value="100" />
  <div id="timeLabel">00:00</div>
</div>
```

**Note:** You can customize these IDs by passing a custom context to the mount function, but the default IDs work out of the box.

## Backend API Contract

### `/spatial-fingerprint` (Recommended)

**Method:** `POST`  
**Content-Type:** `multipart/form-data`

**Parameters:**
- `main_file` (File, required): WAV file
- `ref_file` (File, optional): WAV file
- `max_events` (int, optional): Default 250

**Response:**
```json
{
  "version": "spatial-fingerprint/v1",
  "track": {
    "filename": "track.wav",
    "fingerprint": { "events": [...] },
    "features": {
      "lufs": {...},
      "crest": {...}
    }
  },
  "reference": { ... } // or null
}
```

### `/analyze` (Alternative)

**Method:** `POST`  
**Content-Type:** `multipart/form-data`

**Parameters:**
- `main_file` (File, required): WAV/FLAC/OGG file
- `ref_file` (File, optional): WAV/FLAC/OGG file

**Response:**
```json
{
  "main": {
    "filename": "track.wav",
    "features": {
      "lufs": {...},
      "crest": {...}
    }
  },
  "reference": { ... } // or null
}
```

**Note:** The viz system automatically normalizes `main` → `track` when using `/analyze`.

## Complete Example

Here's a complete Loveable page component:

```jsx
import { useState, useEffect, useRef } from 'react';

export default function AnalysisPage() {
  const [mainFile, setMainFile] = useState(null);
  const [refFile, setRefFile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentViz, setCurrentViz] = useState("spatial");
  const [mode, setMode] = useState("track");
  const loadedRef = useRef(false);

  // Load viz system once
  useEffect(() => {
    if (!loadedRef.current && window.loadTrueNorthViz) {
      loadedRef.current = true;
      window.loadTrueNorthViz({ basePath: "/static/viz/" })
        .catch(err => console.error("Viz load error:", err));
    }
  }, []);

  // Update viz when data/mode changes
  useEffect(() => {
    if (data && window.TrueNorthViz) {
      window.TrueNorthViz.setData(data);
      window.TrueNorthViz.setViz(currentViz);
      window.TrueNorthViz.setMode(mode);
    }
  }, [data, currentViz, mode]);

  const handleUpload = async () => {
    if (!mainFile) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("main_file", mainFile);
      if (refFile) formData.append("ref_file", refFile);

      const res = await fetch("/api/spatial-fingerprint", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const result = await res.json();
      setData(result);
    } catch (err) {
      console.error(err);
      // Show error UI
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Upload UI (Loveable owns this) */}
      <div>
        <input 
          type="file" 
          accept=".wav" 
          onChange={(e) => setMainFile(e.target.files[0])} 
        />
        <input 
          type="file" 
          accept=".wav" 
          onChange={(e) => setRefFile(e.target.files[0])} 
        />
        <button onClick={handleUpload} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {/* Viz Controls (Loveable owns this) */}
      {data && (
        <div>
          <button onClick={() => setCurrentViz("spatial")}>Spatial</button>
          <button onClick={() => setCurrentViz("loudness")}>Loudness</button>
          <button onClick={() => setCurrentViz("crest")}>Crest</button>
          <button onClick={() => setMode("track")}>Track</button>
          <button onClick={() => setMode("reference")}>Reference</button>
        </div>
      )}

      {/* Viz Container */}
      <div>
        <svg id="chart" width="960" height="540"></svg>
        <div id="tooltip"></div>
        <div id="title">Track: —</div>
        <div id="timeRow">
          <input id="timeScrub" type="range" min="0" max="100" value="100" />
          <div id="timeLabel">00:00</div>
        </div>
      </div>
    </div>
  );
}
```

## What Loveable Owns

- ✅ File upload UI (drag-drop, progress bars, etc.)
- ✅ API calls (with auth, error handling, retries)
- ✅ User authentication (Stripe, sessions, database)
- ✅ Button UI (Track/Ref toggle, viz switcher)
- ✅ Layout and styling
- ✅ Routing and navigation
- ✅ Loading states and error messages

## What TrueNorth Owns

- ✅ D3 visualization rendering
- ✅ Visualization logic (spatial fingerprint, loudness curves, etc.)
- ✅ Data normalization (`main` → `track`)
- ✅ Mount/unmount lifecycle
- ✅ Internal state management

## Troubleshooting

### Scripts not loading
- Ensure `vizLoader.js` is accessible at the specified `basePath`
- Check browser console for 404 errors
- Verify D3 is loaded (either via CDN or your own bundle)

### Data not displaying
- Verify data shape matches expected format
- Check that `window.TrueNorthViz.setData()` is called after scripts load
- Ensure required DOM elements exist (`#chart`, `#tooltip`)

### Buttons not working
- Loveable owns all button UI - wire them to `window.TrueNorthViz.setViz()` and `setMode()`
- Don't use `vizShell.js` in production (it's prototype-only)

## Next Steps

1. Copy `viz/` folder to your Loveable static assets
2. Create React component using examples above
3. Build your upload UI in Loveable
4. Wire API calls to your FastAPI backend
5. Add auth, Stripe, database as needed

The viz system is now ready for production! 🚀
