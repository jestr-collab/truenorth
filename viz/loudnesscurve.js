// loudnesscurve.js
// =====================
// TrueNorth Loudness Curve Viz (MODULE)
// X: time (s)  |  Y: LUFS
// Track/Reference toggle + Tab switch
// Hover tooltip: mm:ss + LUFS
// =====================

(function registerLoudness() {
  window.TrueNorthVizzes = window.TrueNorthVizzes || {};

  window.TrueNorthVizzes.loudness = {
    mount(ctx) {
      // Clean up any spatial-specific elements
      const statsEl = document.getElementById('tnRegionStats');
      if (statsEl?.parentNode) statsEl.parentNode.removeChild(statsEl);
      const legendEl = document.getElementById('tnDominantLegend');
      if (legendEl?.parentNode) legendEl.parentNode.removeChild(legendEl);
      
      const data = ctx?.data || {};

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

      // API shape: features.lufs.short_term.points = [{time, lufs}, ...]
      // Exclude null/undefined lufs (RMS-gated frames) so they are not plotted as 0
      function extractLoudnessCurve(obj) {
        const pts = obj?.features?.lufs?.short_term?.points;
        if (!Array.isArray(pts)) return [];
        return pts
          .map((p) => ({ t_s: Number(p.time), lufs: p.lufs }))
          .filter((d) => Number.isFinite(d.t_s) && d.lufs != null && Number.isFinite(d.lufs))
          .map((d) => ({ t_s: d.t_s, lufs: Number(d.lufs) }))
          .sort((a, b) => a.t_s - b.t_s);
      }

      // ---------- DOM ----------
      const svg = d3.select(ctx.svgSelector);
      const tooltip = d3.select(ctx.tooltipSelector);

      const W = 960,
        H = 540;
      const margin = { top: 20, right: 20, bottom: 44, left: 56 };
      const innerW = W - margin.left - margin.right;
      const innerH = H - margin.top - margin.bottom;

      svg.attr("width", W).attr("height", H);
      svg.selectAll("*").remove();

      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      // ---------- state ----------
      let mode = "track"; // "track" | "ref"
      let trackCurve = [];
      let refCurve = [];

      const trackObj = data?.track ?? null;
      const refObj = data?.reference ?? null;

      const trackName =
        trackObj?.meta?.filename ?? trackObj?.filename ?? trackObj?.name ?? "—";

      const refName =
        refObj?.meta?.filename ?? refObj?.filename ?? refObj?.name ?? "—";

      trackCurve = extractLoudnessCurve(trackObj);
      refCurve = extractLoudnessCurve(refObj);

      // ---------- title ----------
      // Truncate long filenames to prevent interference with time bar when switching back to Spatial
      function truncateLabel(label, maxLen = 40) {
        if (typeof label !== "string") return label;
        if (label.length <= maxLen) return label;
        const keep = maxLen - 3; // account for "..."
        const front = Math.ceil(keep * 0.6);
        const back = keep - front;
        return label.slice(0, front) + "..." + label.slice(-back);
      }
      
      function setTitle() {
        const el = document.getElementById(ctx.titleId);
        if (!el) return;
        const raw = mode === "ref" ? `Reference: ${refName}` : `Track: ${trackName}`;
        el.textContent = truncateLabel(raw, 40); // Keep truncated to prevent expansion
      }

      // ---------- scales (CRITICAL: compute domains once from both tracks) ----------
      const x = d3.scaleLinear().range([0, innerW]);
      const y = d3.scaleLinear().range([innerH, 0]);

      // Compute time domain from union of both tracks
      const allTimes = [...trackCurve.map(d => d.t_s), ...refCurve.map(d => d.t_s)];
      const fullTMin = allTimes.length > 0 ? d3.min(allTimes) : 0;
      const fullTMax = allTimes.length > 0 ? d3.max(allTimes) : 1;

      // Compute y-domain ONCE from both arrays combined (scale locking for A/B comparison)
      const allLufs = [...trackCurve.map(d => d.lufs), ...refCurve.map(d => d.lufs)];
      const vMin = allLufs.length > 0 ? d3.min(allLufs) : -60;
      const vMax = allLufs.length > 0 ? d3.max(allLufs) : 0;

      // Set domains (never recompute on toggle)
      const pad = 1.5;
      const vRange = vMax - vMin || 1;
      y.domain([vMin - pad, vMax + pad]);

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

      // labels
      g.append("text")
        .attr("class", "label")
        .attr("x", innerW / 2)
        .attr("y", innerH + 34)
        .attr("text-anchor", "middle")
        .text("Time");

      g.append("text")
        .attr("class", "label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -44)
        .attr("text-anchor", "middle")
        .text("LUFS");

      // line path
      const path = g
        .append("path")
        .attr("fill", "none")
        .attr("stroke-width", 2.5)
        .attr("stroke", "rgba(0,128,128,0.95)");

      // area fill below line (matching low end style)
      const area = d3
        .area()
        .x((d) => x(d.t_s))
        .y0(innerH)
        .y1((d) => y(d.lufs))
        .curve(d3.curveMonotoneX);

      const areaPath = g
        .append("path")
        .attr("fill", "rgba(0,128,128,0.15)")
        .attr("stroke", "none");

      // hover elements: crosshair, dot
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

      const hoverDot = g.append("circle").attr("r", 4.2).attr("opacity", 0);

      const overlay = g
        .append("rect")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "transparent")
        .style("pointer-events", "all");

      function drawMessage(msg) {
        g.selectAll(".tn-msg").remove();
        g.append("text")
          .attr("class", "tn-msg")
          .attr("x", 10)
          .attr("y", 20)
          .attr("fill", "rgba(15,23,42,0.65)")
          .style("font-family", "Inter, system-ui, sans-serif")
          .style("font-size", "13px")
          .text(msg);
      }

      function render(curve) {
        g.selectAll(".tn-msg").remove();

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

        if (!curve || !curve.length) {
          path.attr("d", null);
          areaPath.attr("d", null);
          hoverDot.attr("opacity", 0);
          crosshair.attr("opacity", 0);
          drawMessage("No loudness curve found (features.lufs.short_term.points missing).");
          // Use fixed domains even when no data
          gx.call(d3.axisBottom(x).ticks(7).tickFormat(d => formatTimeMMSS(d)));
          gy.call(d3.axisLeft(y).ticks(6));
          return;
        }

        gx.call(d3.axisBottom(x).ticks(7).tickFormat(d => formatTimeMMSS(d)));
        gy.call(d3.axisLeft(y).ticks(6));

        // Filter curve to visible x domain range
        const [xMin, xMax] = x.domain();
        const visibleCurve = curve.filter(d => d.t_s >= xMin && d.t_s <= xMax);

        const line = d3
          .line()
          .x((d) => x(d.t_s))
          .y((d) => y(d.lufs))
          .curve(d3.curveMonotoneX);

        path.attr("d", line(visibleCurve));
        areaPath.attr("d", area(visibleCurve));
      }

      // nearest point
      function nearestPoint(curve, t) {
        let lo = 0,
          hi = curve.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (curve[mid].t_s < t) lo = mid + 1;
          else hi = mid;
        }
        const i = lo;
        const a = curve[Math.max(0, i - 1)];
        const b = curve[Math.min(curve.length - 1, i)];
        if (!a) return b;
        if (!b) return a;
        return Math.abs(a.t_s - t) <= Math.abs(b.t_s - t) ? a : b;
      }

      function showTip(ev, d, label) {
        tooltip
          .style("opacity", 1)
          .html(
            `
            <div style="font-weight:700; margin-bottom:6px;">${label}</div>
            <div><b>time</b>: ${formatTimeMMSS(d.t_s)}</div>
            <div><b>LUFS</b>: ${fmt(d.lufs, 1)}</div>
          `
          );

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
        hoverDot.attr("opacity", 0);
        crosshair.attr("opacity", 0);
        // Clear hover dot time when mouse leaves
        hoverDotTime = null;
      }

      // hover interaction
      overlay
        .on("mousemove", function (event) {
          const curve = mode === "ref" ? refCurve : trackCurve;
          if (!curve.length) return;

          // Filter to visible x domain range for hover
          const [xMin, xMax] = x.domain();
          const visibleCurve = curve.filter(d => d.t_s >= xMin && d.t_s <= xMax);
          if (!visibleCurve.length) return;

          const [mx, my] = d3.pointer(event, this);
          const t = x.invert(mx);
          const d = nearestPoint(visibleCurve, t);

          // Update crosshair (vertical line)
          crosshair
            .attr("x1", mx)
            .attr("x2", mx)
            .attr("opacity", 1);

          // Update dot
          hoverDot
            .attr("cx", x(d.t_s))
            .attr("cy", y(d.lufs))
            .attr("fill", "rgba(0,128,128,0.95)")
            .attr("stroke", "rgba(0,128,128,0.95)")
            .attr("stroke-width", 1.2)
            .attr("opacity", 1);

          hoverDotTime = d.t_s;
          showTip(event, d, mode === "ref" ? "Reference" : "Track");
        })
        .on("mouseleave", hideTip);

      // controls
      const btnTrack = document.getElementById(ctx.btnTrackId);
      const btnRef = document.getElementById(ctx.btnRefId);

      if (btnTrack)
        btnTrack.onclick = () => {
          mode = "track";
          setTitle();
          render(trackCurve);
        };
      if (btnRef)
        btnRef.onclick = () => {
          mode = "ref";
          setTitle();
          render(refCurve);
        };

      // store cleanup ref
      this.__tn_loud_state = {};

      // Hide time scrubber (using pinch-to-zoom instead)
      const timeRow = document.getElementById(ctx.timeRowId);
      if (timeRow) timeRow.style.display = "none";

      // Set up D3 zoom behavior (supports trackpad pinch gestures)
      // Track current mouse position and hover dot time for focal point zooming
      let currentMouseX = innerW / 2; // Default to center
      let hoverDotTime = null; // Track the hover dot's time value (the actual grid point)
      
      // Update mouse position on mousemove
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
            const curve = mode === "ref" ? refCurve : trackCurve;
            render(curve);
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

          // Redraw with new domain
          const curve = mode === "ref" ? refCurve : trackCurve;
          render(curve);
        });

      // Prevent browser zoom on wheel events
      overlay.on("wheel.zoom", function(event) {
        event.preventDefault();
        event.stopPropagation();
      });

      // Apply zoom to overlay (which covers the chart area)
      overlay.call(zoom);
      
      // Store zoom reference for cleanup
      this.__tn_loud_state.zoom = zoom;

      setTitle();
      render(trackCurve);
    },

    unmount() {
      this.__tn_loud_state = null;

      // show scrubber again for other vizzes
      // (spatial uses it)
      // safe even if missing
      // NOTE: only do this if your spatial expects it visible
      // const timeRow = document.getElementById(ctx.timeRowId); // ctx not available here
    }
  };
})();
