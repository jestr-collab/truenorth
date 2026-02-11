// tnBridge.js
(function () {
  window.TrueNorthViz = window.TrueNorthViz || {};

  let __data = null;
  let __currentViz = "spatial";

  const mountIds = {
    svgSelector: "#chart",
    tooltipSelector: "#tooltip",
    btnTrackId: "btnTrack",
    btnRefId: "btnRef",
    titleId: "title",
    timeRowId: "timeRow",
    wrapId: "wrap",
    timeLabelId: "timeLabel",
    timeScrubId: "timeScrub",
  };

  function clearSvgAndTooltip() {
    d3.select(mountIds.svgSelector).selectAll("*").remove();
    d3.select(mountIds.tooltipSelector).style("opacity", 0);
  }

  function unmountCurrentIfPossible(registry) {
    const prev = __currentViz;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:unmountCurrentIfPossible:entry',message:'Unmounting current viz',data:{prevViz:prev,hasUnmount:!!(prev && registry?.[prev]?.unmount)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (prev && registry?.[prev]?.unmount) {
      try {
        registry[prev].unmount();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:unmountCurrentIfPossible:success',message:'Unmount successful',data:{prevViz:prev},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      } catch (e) {
        console.warn("Error during unmount:", prev, e);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:unmountCurrentIfPossible:error',message:'Unmount error',data:{prevViz:prev,error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      }
    }
  }

  function mountViz(name) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:mountViz:entry',message:'Mounting viz',data:{vizName:name,prevViz:__currentViz},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    const reg = window.TrueNorthVizzes || {};
    const mod = reg?.[name];

    if (!mod?.mount) {
      console.error("Viz not registered:", name, reg);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:mountViz:notRegistered',message:'Viz not registered',data:{vizName:name,availableVizzes:Object.keys(reg)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      return;
    }

    unmountCurrentIfPossible(reg);
    __currentViz = name;

    clearSvgAndTooltip();

    try {
      // IMPORTANT: every viz gets the same ctx object
      mod.mount({ data: __data, ...mountIds });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:mountViz:success',message:'Mount successful',data:{vizName:name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    } catch (e) {
      console.error("Error mounting viz:", name, e);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/eb07f81d-6c3f-4bc4-8cad-9d6f15e42302',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tnBridge.js:mountViz:error',message:'Mount error',data:{vizName:name,error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    }
  }

  function normalizeData(data) {
    if (!data || typeof data !== "object") return data;
    
    // If data has "main" key, convert to "track" for consistency
    if (data.main !== undefined && data.track === undefined) {
      return {
        track: data.main,
        reference: data.reference || null,
        ...Object.keys(data).reduce((acc, key) => {
          if (key !== "main" && key !== "reference") {
            acc[key] = data[key];
          }
          return acc;
        }, {})
      };
    }
    
    return data;
  }

  function setActiveButton(activeId, allIds) {
    allIds.forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle("active", id === activeId);
      b.setAttribute("aria-pressed", id === activeId ? "true" : "false");
    });
  }

  window.TrueNorthViz.setData = function (newData) {
    __data = normalizeData(newData);
    mountViz(__currentViz);
  };

  window.TrueNorthViz.setViz = function (name) {
    __currentViz = name;
    if (__data) mountViz(name);
  };

  window.TrueNorthViz.getData = function () {
    return __data;
  };

  window.TrueNorthViz.setMode = function (mode) {
    if (mode !== "track" && mode !== "reference") {
      console.warn("setMode: mode must be 'track' or 'reference', got:", mode);
      return;
    }

    // Update global mode state
    window.TrueNorthVizMode = mode;

    // Update button active states
    const trackRefBtns = [mountIds.btnTrackId, mountIds.btnRefId];
    const activeId = mode === "track" ? mountIds.btnTrackId : mountIds.btnRefId;
    setActiveButton(activeId, trackRefBtns);

    // For crest (mount-only), trigger remount
    if (__currentViz === "crest" && __data) {
      mountViz(__currentViz);
    }
    // For spatial/loudness, they handle mode internally via button clicks
    // The buttons are already updated above, so they'll work on next interaction
  };
})();
