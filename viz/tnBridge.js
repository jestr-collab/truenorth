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
    if (prev && registry?.[prev]?.unmount) {
      try {
        registry[prev].unmount();
      } catch (e) {
        console.warn("Error during unmount:", prev, e);
      }
    }
  }

  function mountViz(name) {
    const reg = window.TrueNorthVizzes || {};
    const mod = reg?.[name];

    if (!mod?.mount) {
      console.error("Viz not registered:", name, reg);
      return;
    }

    unmountCurrentIfPossible(reg);
    __currentViz = name;

    clearSvgAndTooltip();

    try {
      mod.mount({ data: __data, ...mountIds });
    } catch (e) {
      console.error("Error mounting viz:", name, e);
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

    // Spatial / loudness / low-end listen and redraw (Tab key uses setMode instead of synthetic clicks)
    window.dispatchEvent(new CustomEvent("tn:viz-mode", { detail: { mode } }));
  };
})();
