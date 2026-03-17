// crestcurve.js
(function () {
  const NAME = "crest";

  function getMode(ctx) {
    // 1) explicit global override (easy debug)
    if (window.TrueNorthVizMode === "reference") return "reference";
    if (window.TrueNorthVizMode === "track") return "track";

    // 2) try reading button pressed state (if you use it)
    const btnTrack = document.getElementById(ctx?.btnTrackId || "btnTrack");
    const btnRef = document.getElementById(ctx?.btnRefId || "btnRef");

    const isPressed = (el) => {
      if (!el) return false;
      const ap = el.getAttribute("aria-pressed");
      if (ap === "true") return true;
      // common patterns:
      if (el.classList?.contains("active")) return true;
      if (el.dataset?.active === "true") return true;
      return false;
    };

    if (isPressed(btnRef) && !isPressed(btnTrack)) return "reference";
    if (isPressed(btnTrack) && !isPressed(btnRef)) return "track";

    // 3) if both/none are marked, default to track
    return "track";
  }

  function extractPoints(data, mode) {
    // depending on endpoint shape:
    // spatial-fingerprint endpoint uses { track: {...}, reference: {...} }
    const root = mode === "reference" ? data?.reference : data?.track;

    const crest = root?.features?.crest;
    if (!crest) return [];

    const pts =
      crest?.curve?.points ||
      crest?.points ||
      (Array.isArray(crest) ? crest : null);

    if (!Array.isArray(pts)) return [];

    return pts
      .map(d => {
        const t = +(d.time ?? d.t ?? d.time_s ?? d.t_s ?? 0);
        const crestRaw = d.crest_db ?? d.crest ?? d.value;
        const crest = crestRaw != null && Number.isFinite(Number(crestRaw)) ? Number(crestRaw) : NaN;
        return {
          t,
          crest,
          peak_pos_db: d.peak_pos_db !== undefined && d.peak_pos_db != null ? +(d.peak_pos_db) : null,
          peak_neg_db: d.peak_neg_db !== undefined && d.peak_neg_db != null ? +(d.peak_neg_db) : null,
          rms_db: d.rms_db !== undefined ? +(d.rms_db) : null,
        };
      })
      .filter(d => Number.isFinite(d.t) && Number.isFinite(d.crest));
  }

  function mount(ctx) {
    // Clean up any spatial-specific elements
    const statsEl = document.getElementById('tnRegionStats');
    if (statsEl?.parentNode) statsEl.parentNode.removeChild(statsEl);
    const legendEl = document.getElementById('tnDominantLegend');
    if (legendEl?.parentNode) legendEl.parentNode.removeChild(legendEl);
    
    const data = ctx?.data;

    const svgSelector = ctx?.svgSelector || "#chart";
    const svgEl = document.querySelector(svgSelector);
    if (!svgEl) {
      console.error("crestcurve: SVG element not found:", svgSelector);
      return;
    }

    const mode = getMode(ctx);

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const W = +svg.attr("width") || 960;
    const H = +svg.attr("height") || 540;
    const margin = { top: 20, right: 20, bottom: 44, left: 56 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // ---------- helpers ----------
    function formatTimeMMSS(seconds) {
      if (!Number.isFinite(seconds)) return "00:00";
      const s = Math.max(0, Math.floor(seconds));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      return `${mm}:${ss}`;
    }

    function fmt(n, k = 1) {
      if (!Number.isFinite(n)) return "—";
      return Number(n).toFixed(k);
    }

    // Extract points for BOTH track and reference to compute fixed domains
    const trackPts = extractPoints(data, "track");
    const refPts = extractPoints(data, "reference");
    const pts = mode === "reference" ? refPts : trackPts;

    // label what we’re showing (helps debugging)
    g.append("text")
      .attr("x", 0)
      .attr("y", -6)
      .text(`Crest Factor (dB) over time — ${mode === "reference" ? "Reference" : "Track"}`);

    // Compute domains from BOTH track and reference combined (scale locking for A/B comparison)
    const allTimes = [...trackPts.map(d => d.t), ...refPts.map(d => d.t)];
    const allCrests = [...trackPts.map(d => d.crest), ...refPts.map(d => d.crest)];
    
    // Also compute positive and negative peak domains for transient shape visualization
    const allPeaksPos = [
      ...trackPts.filter(d => d.peak_pos_db !== null).map(d => d.peak_pos_db),
      ...refPts.filter(d => d.peak_pos_db !== null).map(d => d.peak_pos_db)
    ];
    const allPeaksNeg = [
      ...trackPts.filter(d => d.peak_neg_db !== null).map(d => d.peak_neg_db),
      ...refPts.filter(d => d.peak_neg_db !== null).map(d => d.peak_neg_db)
    ];
    
    const fullTMin = allTimes.length > 0 ? d3.min(allTimes) : 0;
    const fullTMax = allTimes.length > 0 ? d3.max(allTimes) : 1;
    const cMin = allCrests.length > 0 ? d3.min(allCrests) : 0;
    const cMax = allCrests.length > 0 ? d3.max(allCrests) : 1;
    
    // Domain for peak visualization (positive peaks go up, negative peaks go down)
    // peak_neg_db values are magnitudes (positive), but we want to show them below zero
    const peakMax = allPeaksPos.length > 0 ? d3.max(allPeaksPos) : 0;
    const peakNegMax = allPeaksNeg.length > 0 ? d3.max(allPeaksNeg) : 0;
    const peakMin = -peakNegMax; // Negative peaks extend below zero

    // Set fixed domains (never recompute on toggle)
    const pad = 0.05;
    const cRange = cMax - cMin || 1;

    const x = d3.scaleLinear().range([0, innerW]);
    const y = d3.scaleLinear()
      .domain([cMin - pad * cRange, cMax + pad * cRange])
      .nice()
      .range([innerH, 0]);
    
    // Separate scale for peak visualization (transient shape - positive and negative peaks)
    // Only create if we have peak data, otherwise use crest scale as fallback
    const yTransient = (allPeaksPos.length > 0 || allPeaksNeg.length > 0) ? d3.scaleLinear()
      .domain([peakMin - pad * (peakMax - peakMin), peakMax + pad * (peakMax - peakMin)])
      .nice()
      .range([innerH, 0]) : null;

    // Set initial x domain (full range)
    x.domain([fullTMin, fullTMax]);

    // grid lines - double density (like Low End): 12 ticks for grid, 6 for axis
    const grid = g.insert("g", ":first-child").attr("class", "xy-grid");
    
    // Get tick values: 12 for grid (includes midpoints), 6 for axis labels
    const xTicks = x.ticks(16);
    const yTicks = y.ticks(12); // Double density - includes ticks between axis marks
    
    // Draw vertical grid lines
    grid.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .selectAll("line")
      .data(xTicks)
      .enter()
      .append("line")
      .attr("x1", d => x(d))
      .attr("x2", d => x(d))
      .attr("y1", 0)
      .attr("y2", -innerH)
      .attr("stroke", "rgba(255,255,255,0.10)")
      .attr("stroke-opacity", 1)
      .attr("stroke-width", 1);
    
    // Draw horizontal grid lines
    grid.append("g")
      .selectAll("line")
      .data(yTicks)
      .enter()
      .append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", d => y(d))
      .attr("y2", d => y(d))
      .attr("stroke", "rgba(255,255,255,0.10)")
      .attr("stroke-opacity", 1)
      .attr("stroke-width", 1);

    // axes groups
    const gx = g.append("g").attr("transform", `translate(0,${innerH})`);
    const gy = g.append("g");

    // Function to redraw with current x domain
    function redraw() {
      // Update grid lines with current x domain - double density (like Low End)
      grid.selectAll("g").remove();
      
      // Get tick values: 12 for grid (includes midpoints), 6 for axis labels
      const xTicks = x.ticks(16);
      const yTicks = y.ticks(12); // Double density - includes ticks between axis marks
      
      // Draw vertical grid lines
      grid.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .selectAll("line")
        .data(xTicks)
        .enter()
        .append("line")
        .attr("x1", d => x(d))
        .attr("x2", d => x(d))
        .attr("y1", 0)
        .attr("y2", -innerH)
        .attr("stroke", "rgba(15,23,42,0.20)")
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 1.1);
      
      // Draw horizontal grid lines
      grid.append("g")
        .selectAll("line")
        .data(yTicks)
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", d => y(d))
        .attr("y2", d => y(d))
        .attr("stroke", "rgba(15,23,42,0.20)")
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 1.1);

      if (!pts.length) {
        g.selectAll(".crest-path").remove();
        g.append("text")
          .attr("x", 0)
          .attr("y", 20)
          .text(`No crest data found for ${mode} at ${mode === "reference" ? "data.reference.features.crest" : "data.track.features.crest"}`);
        // Still draw axes with fixed domains
        gx.call(d3.axisBottom(x).ticks(8).tickFormat(d => formatTimeMMSS(d)));
        gy.call(d3.axisLeft(y).ticks(6));
        return;
      }

      // Filter points to visible x domain range
      const [xMin, xMax] = x.domain();
      const visiblePts = pts.filter(d => d.t >= xMin && d.t <= xMax);

      // Draw axes with time formatting
      gx.call(d3.axisBottom(x).ticks(8).tickFormat(d => formatTimeMMSS(d)));
      gy.call(d3.axisLeft(y).ticks(6));

      const line = d3.line()
        .x(d => x(d.t))
        .y(d => y(d.crest));

      // Remove old path and create new one (pointer-events: none so overlay receives wheel/zoom)
      g.selectAll(".crest-path").remove();
      g.append("path")
        .attr("class", "crest-path")
        .datum(visiblePts)
        .attr("fill", "none")
        .attr("stroke", "rgba(0,128,128,0.7)")
        .attr("stroke-width", 2.5)
        .style("pointer-events", "none")
        .attr("d", line);
    }

    if (!pts.length) {
      redraw();
      return;
    }

    // Initial draw
    redraw();

    // ---------- hover elements: crosshair, dots (both track and reference) ----------
    const crosshair = g
      .append("line")
      .attr("stroke", "rgba(15,23,42,0.35)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("x1", 0)
      .attr("x2", 0)
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("opacity", 0);

    const overlay = g
      .append("rect")
      .attr("width", innerW)
      .attr("height", innerH)
      .attr("fill", "transparent")
      .style("pointer-events", "all");

    // ---------- tooltip ----------
    const tooltip = d3.select(ctx?.tooltipSelector || "#tooltip");

    // Track current mouse position and hover dot time for focal point zooming
    let currentMouseX = innerW / 2;   // Default to center
    let hoverDotTime = null;          // Track the hover dot's time value (actual time)

    function showTip(ev, d, label) {
      if (!d) return;
      tooltip
        .style("opacity", 1)
        .html(`
          <div style="font-weight:700; margin-bottom:6px;">${label}</div>
          <div><b>time</b>: ${formatTimeMMSS(d.t)}</div>
          <div><b>Crest</b>: ${d.crest !== null && d.crest !== undefined && Number.isFinite(d.crest) ? fmt(d.crest, 1) : '—'} dB</div>
        `);

      const pad = 12;
      const rect = tooltip.node().getBoundingClientRect();
      let xx = ev.clientX + pad;
      let yy = ev.clientY + pad;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (xx + rect.width + pad > vw) xx = ev.clientX - rect.width - pad;
      if (yy + rect.height + pad > vh) yy = ev.clientY - rect.height - pad;

      xx = Math.max(pad, Math.min(vw - rect.width - pad, xx));
      yy = Math.max(pad, Math.min(vh - rect.height - pad, yy));

      tooltip.style("left", `${xx}px`).style("top", `${yy}px`);
    }

    function hideTip() {
      tooltip.style("opacity", 0);
      crosshair.attr("opacity", 0);
      hoverDotTime = null; // safe now
    }

    // ---------- interpolate value at exact time (for precise alignment) ----------
    function interpolateAtTime(curve, t) {
      if (!curve || !curve.length) return null;
      
      // Binary search to find surrounding points
      let lo = 0,
        hi = curve.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (curve[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      
      const i = lo;
      const a = curve[Math.max(0, i - 1)];
      const b = curve[Math.min(curve.length - 1, i)];
      
      // If exact match or only one point available
      if (!a) return { t, crest: b.crest, peak_pos_db: b.peak_pos_db, peak_neg_db: b.peak_neg_db, rms_db: b.rms_db };
      if (!b) return { t, crest: a.crest, peak_pos_db: a.peak_pos_db, peak_neg_db: a.peak_neg_db, rms_db: a.rms_db };
      if (a.t === b.t) return { t, crest: a.crest, peak_pos_db: a.peak_pos_db, peak_neg_db: a.peak_neg_db, rms_db: a.rms_db };
      
      // Linear interpolation between the two points
      const tRange = b.t - a.t;
      if (tRange === 0 || !Number.isFinite(tRange)) return { t, crest: a.crest, peak_pos_db: a.peak_pos_db, peak_neg_db: a.peak_neg_db, rms_db: a.rms_db };
      
      const tFactor = (t - a.t) / tRange;
      
      // Ensure tFactor is between 0 and 1 for valid interpolation
      const clampedFactor = Math.max(0, Math.min(1, tFactor));
      
      const interpolate = (valA, valB) => {
        if (valA === null || valB === null || valA === undefined || valB === undefined) {
          // If one is null, return the other (or null if both are null)
          return valA !== null && valA !== undefined ? valA : (valB !== null && valB !== undefined ? valB : null);
        }
        if (!Number.isFinite(valA) || !Number.isFinite(valB)) {
          return Number.isFinite(valA) ? valA : (Number.isFinite(valB) ? valB : null);
        }
        return valA + (valB - valA) * clampedFactor;
      };
      
      return {
        t,
        crest: interpolate(a.crest, b.crest),
        peak_pos_db: interpolate(a.peak_pos_db, b.peak_pos_db),
        peak_neg_db: interpolate(a.peak_neg_db, b.peak_neg_db),
        rms_db: interpolate(a.rms_db, b.rms_db)
      };
    }

    // ---------- hover interaction ----------
    overlay
      .on("mousemove", function (event) {
        const [xMin, xMax] = x.domain();
        const visiblePts = pts.filter(d => d.t >= xMin && d.t <= xMax);
        if (!visiblePts.length) return;

        const [mx] = d3.pointer(event, this);
        currentMouseX = mx;               // keep in sync for zoom fallback
        const t = x.invert(mx);

        const d = interpolateAtTime(visiblePts, t);
        if (!d) return;

        // Crosshair at exact mouse x (no hover dots on Crest)
        crosshair
          .attr("x1", mx)
          .attr("x2", mx)
          .attr("opacity", 1);

        hoverDotTime = d.t;

        showTip(event, d, mode === "reference" ? "Reference" : "Track");
      })
      .on("mouseleave", hideTip);

    // Hide time scrubber (using pinch-to-zoom instead)
    const timeRow = document.getElementById(ctx?.timeRowId || "timeRow");
    if (timeRow) timeRow.style.display = "none";

    // Set up D3 zoom behavior (supports trackpad pinch gestures)
    // currentMouseX and hoverDotTime are already declared above with tooltip
    
    // Update mouse position on mousemove (for zoom fallback)
    overlay.on("mousemove.zoom-track", function(event) {
      const [mx] = d3.pointer(event, this);
      currentMouseX = mx;
    });
    
    const zoom = d3.zoom()
      .scaleExtent([0.5, 20]) // Allow zoom from 0.5x to 20x
      .filter(function(event) {
        // Prevent browser page zoom on wheel events
        if (event.type === 'wheel') {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        // Allow other events (like touch for mobile)
        return !event.ctrlKey && !event.button;
      })
      .on("zoom", (event) => {
        const t = event.transform;
        const [fullMin, fullMax] = [fullTMin, fullTMax];
        const fullRange = fullMax - fullMin;
        
        // Get current domain BEFORE applying zoom (for focal point calculation)
        const [currentMin, currentMax] = x.domain();

        // Use hover dot's time value as focal point if available (locks to grid point)
        // Otherwise fall back to mouse position
        let focalTime;
        if (hoverDotTime !== null && hoverDotTime >= currentMin && hoverDotTime <= currentMax) {
          focalTime = hoverDotTime;
        } else {
          // Fallback: Get mouse position from source event if available
          let focalX = currentMouseX;
          if (event.sourceEvent) {
            const [mx] = d3.pointer(event.sourceEvent, overlay.node());
            if (mx >= 0 && mx <= innerW) {
              focalX = mx;
            }
          }
          
          focalTime = x.invert(focalX);
        }
        
        // Calculate new range based on zoom scale
        const newRange = fullRange / t.k;
        
        // Additional check: if range exceeds full range, clamp to full range
        if (newRange >= fullRange) {
          x.domain([fullMin, fullMax]);
          redraw();
          return;
        }
        
        // Calculate new domain centered on focal point
        const halfRange = newRange / 2;
        let newMin = focalTime - halfRange;
        let newMax = focalTime + halfRange;
        
        // Clamp to data bounds - ensure we never go before 00:00 or after end
        if (newMin < fullMin) {
          newMin = fullMin;
          newMax = Math.min(fullMax, newMin + newRange);
        }
        if (newMax > fullMax) {
          newMax = fullMax;
          newMin = Math.max(fullMin, newMax - newRange);
        }
        
        x.domain([newMin, newMax]);
        redraw();
      });

    // Apply zoom to overlay first
    overlay.call(zoom);

    // Prevent browser zoom on wheel events (after zoom is applied)
    overlay.on("wheel.zoom", function(event) {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  window.TrueNorthVizzes = window.TrueNorthVizzes || {};
  window.TrueNorthVizzes[NAME] = {
    mount,
    unmount() {
      // Crest is mount-only and doesn't add listeners or persistent DOM.
      // This method exists for API consistency with other vizzes.
    }
  };
})();
