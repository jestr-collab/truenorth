// vizLoader.js
// Standalone script loader for TrueNorth visualization system
// Production-ready: no UI wiring, no sample data, no prototype concerns
// Use this in Loveable/React instead of vizShell.js

/**
 * Loads D3 and all viz modules, returns promise when ready.
 * Can be called from React useEffect or any async context.
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.d3Url - D3 CDN URL (default: d3@7 from jsdelivr)
 * @param {string} options.basePath - Base path for viz scripts (default: "./")
 * @returns {Promise<void>} Resolves when all scripts loaded and API ready
 * 
 * @example
 * // In React component:
 * useEffect(() => {
 *   loadTrueNorthViz().then(() => {
 *     window.TrueNorthViz.setData(data);
 *     window.TrueNorthViz.setViz("spatial");
 *   });
 * }, [data]);
 */
async function loadTrueNorthViz(options = {}) {
  const {
    d3Url = "https://cdn.jsdelivr.net/npm/d3@7",
    basePath = "./"
  } = options;

  // Check if already loaded
  if (window.TrueNorthViz && window.TrueNorthVizzes) {
    const reg = window.TrueNorthVizzes || {};
    if (reg.spatial?.mount && reg.loudness?.mount && reg.crest?.mount && reg.lowend?.mount) {
      return Promise.resolve(); // Already loaded
    }
  }

  // Helper: load script once
  async function loadScriptOnce(src) {
    const already = [...document.scripts].some(s => {
      const url = s.src || "";
      return url.includes(src) || url.includes(src.split("/").pop());
    });
    if (already) return;

    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(s);
    });
  }

  try {
    // 1) Load D3 (if not already loaded)
    if (typeof d3 === "undefined") {
      await loadScriptOnce(d3Url);
    }

    // 2) Initialize registry
    window.TrueNorthVizzes = window.TrueNorthVizzes || {};

    // 3) Load viz modules (in order)
    await loadScriptOnce(`${basePath}app.js`);
    await loadScriptOnce(`${basePath}loudnesscurve.js`);
    await loadScriptOnce(`${basePath}crestcurve.js`);
    await loadScriptOnce(`${basePath}lowendcurve.js`);

    // 4) Load bridge (must be last)
    await loadScriptOnce(`${basePath}tnBridge.js`);

    // 5) Validate API is ready
    const reg = window.TrueNorthVizzes || {};
    if (!reg.spatial?.mount || !reg.loudness?.mount || !reg.crest?.mount || !reg.lowend?.mount) {
      throw new Error("Viz modules failed to register (spatial, loudness, crest, or lowend missing).");
    }
    if (!window.TrueNorthViz?.setData || !window.TrueNorthViz?.setViz) {
      throw new Error("TrueNorthViz API not available (tnBridge.js failed to load).");
    }

    return Promise.resolve();
  } catch (err) {
    console.error("TrueNorth Viz Loader Error:", err);
    throw err;
  }
}

// Export for module systems (if needed)
if (typeof module !== "undefined" && module.exports) {
  module.exports = loadTrueNorthViz;
}

// Also expose globally for script tag usage
window.loadTrueNorthViz = loadTrueNorthViz;
