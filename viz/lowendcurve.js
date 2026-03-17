// lowendcurve.js
// =====================
// TrueNorth Low-End Control Viz (MODULE)
// X: time (s) formatted as mm:ss  |  Y: Low-end energy (0-1, normalized)
// Track/Reference toggle + Tab switch
// Hover tooltip: mm:ss + low-end value
// =====================

(function registerLowEnd() {
  window.TrueNorthVizzes = window.TrueNorthVizzes || {};

  window.TrueNorthVizzes.lowend = {
    mount(ctx) {
      // Clean up any spatial-specific elements
      const statsEl = document.getElementById('tnRegionStats');
      if (statsEl?.parentNode) statsEl.parentNode.removeChild(statsEl);
      const legendEl = document.getElementById('tnDominantLegend');
      if (legendEl?.parentNode) legendEl.parentNode.removeChild(legendEl);
      const lowEndLegendEl = document.getElementById('tnLowEndLegend');
      if (lowEndLegendEl?.parentNode) lowEndLegendEl.parentNode.removeChild(lowEndLegendEl);
      
      const data = ctx?.data || {};

      // ---------- helpers ----------
      function formatTimeMMSS(seconds) {
        if (!Number.isFinite(seconds)) return "00:00";
        const s = Math.max(0, Math.floor(seconds));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return `${mm}:${ss}`;
      }

      function fmt(n, k = 3) {
        if (!Number.isFinite(n)) return "—";
        return Number(n).toFixed(k);
      }

      // API shape: features.low_end.points = [{time, sub, bass, lowmid, low_end_total, low_width}, ...]
      // Extract with metadata: bands_hz, labels
      function extractLowEndData(obj) {
        if (!obj) return { points: [], bands_hz: null, labels: [] };
        
        // Try primary path: features.low_end
        const lowEndData = obj?.features?.low_end || obj?.low_end;
        if (!lowEndData) return { points: [], bands_hz: null, labels: [] };
        
        const pts = lowEndData.points;
        if (!Array.isArray(pts) || pts.length === 0) {
          return { points: [], bands_hz: lowEndData.bands_hz || null, labels: lowEndData.labels || [] };
        }
        
        // Map points to normalized structure
        const mapped = pts
          .map((p) => ({
            t_s: Number(p.time ?? p.t_s ?? p.t ?? 0),
            sub: Number(p.sub ?? 0),
            bass: Number(p.bass ?? 0),
            lowmid: Number(p.lowmid ?? 0),
            low_end_total: Number(p.low_end_total ?? p.low_end ?? 0),
            low_width: Number(p.low_width ?? 0),
          }))
          .filter((d) => Number.isFinite(d.t_s) && Number.isFinite(d.sub) && Number.isFinite(d.bass));
        
        return {
          points: mapped.sort((a, b) => a.t_s - b.t_s),
          bands_hz: lowEndData.bands_hz || { sub: [20, 60], bass: [60, 120], lowmid: [120, 250] },
          labels: lowEndData.labels || ["sub", "bass", "lowmid"],
        };
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
      let trackData = { points: [], bands_hz: null, labels: [] };
      let refData = { points: [], bands_hz: null, labels: [] };
      
      // Band visibility toggles
      let bandVisibility = { sub: true, bass: true, lowmid: true };

      const trackObj = data?.track ?? null;
      const refObj = data?.reference ?? null;

      const trackName =
        trackObj?.meta?.filename ?? trackObj?.filename ?? trackObj?.name ?? "—";

      const refName =
        refObj?.meta?.filename ?? refObj?.filename ?? refObj?.name ?? "—";

      // Extract data with new structure
      trackData = extractLowEndData(trackObj);
      refData = extractLowEndData(refObj);
      
      // Determine available bands from data
      const availableBands = trackData.labels.length > 0 ? trackData.labels : refData.labels.length > 0 ? refData.labels : ["sub", "bass", "lowmid"];
      
      // Initialize visibility based on available bands
      bandVisibility = { sub: true, bass: true, lowmid: availableBands.includes("lowmid") };

      // Debug: log data structure if no data found
      if (trackData.points.length === 0 && refData.points.length === 0) {
        console.warn("Low-end viz: No data found. Track object keys:", trackObj ? Object.keys(trackObj) : "null");
        console.warn("Low-end viz: Track features keys:", trackObj?.features ? Object.keys(trackObj.features) : "no features");
        if (trackObj?.features?.low_end) {
          console.warn("Low-end viz: low_end structure:", trackObj.features.low_end);
        }
      }

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
      const allTimes = [
        ...trackData.points.map(d => d.t_s),
        ...refData.points.map(d => d.t_s)
      ];
      const fullTMin = allTimes.length > 0 ? d3.min(allTimes) : 0;
      const fullTMax = allTimes.length > 0 ? d3.max(allTimes) : 1;

      // Compute y-domain from all band values (sub, bass, lowmid, low_end_total) across both tracks
      const allValues = [
        ...trackData.points.map(d => d.sub),
        ...trackData.points.map(d => d.bass),
        ...trackData.points.map(d => d.lowmid),
        ...trackData.points.map(d => d.low_end_total),
        ...refData.points.map(d => d.sub),
        ...refData.points.map(d => d.bass),
        ...refData.points.map(d => d.lowmid),
        ...refData.points.map(d => d.low_end_total),
      ].filter(v => Number.isFinite(v));
      
      const vMin = allValues.length > 0 ? d3.min(allValues) : 0;
      const vMax = allValues.length > 0 ? d3.max(allValues) : 1;

      // Set domains (never recompute on toggle)
      const pad = 0.05; // 5% padding
      const vRange = vMax - vMin || 1;
      y.domain([Math.max(0, vMin - pad * vRange), Math.min(1, vMax + pad * vRange)]);

      // Set initial x domain (full range)
      x.domain([fullTMin, fullTMax]);

      // axes groups
      const gx = g.append("g").attr("transform", `translate(0,${innerH})`);
      const gy = g.append("g");

      // grid lines (dense - matching crest square sizing)
      const grid = g.insert("g", ":first-child").attr("class", "xy-grid");
      grid.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(16).tickSize(-innerH).tickFormat(""));
      grid.append("g")
        .call(d3.axisLeft(y).ticks(12).tickSize(-innerW).tickFormat(""));
      grid.selectAll(".domain").remove();
      grid.selectAll(".tick line")
          .attr("stroke", "rgba(255,255,255,0.10)")
          .attr("stroke-opacity", 1)
          .attr("stroke-width", 1);

      // axes with time formatting
      gx.call(d3.axisBottom(x).ticks(7).tickFormat(d => formatTimeMMSS(d)));
      gy.call(d3.axisLeft(y).ticks(6));

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
        .text("Low-End Energy");

      // Multi-series paths for each band
      const bandColors = {
        sub: "rgba(59,130,246,0.95)",      // Blue
        bass: "rgba(34,197,94,0.95)",      // Green
        lowmid: "rgba(249,115,22,0.95)",   // Orange
      };

      // ---------- Low End legend (Sub Bass / Low Mid) ----------
      const chartColumn = document.getElementById("chartColumn");
      const svgElForLegend = document.querySelector(ctx.svgSelector);
      let lowEndLegend = null;
      let onLegendResize = null;

      function ensureLowEndLegend() {
        if (!chartColumn || !svgElForLegend) return;
        if (lowEndLegend?.parentNode) return;

        const styleId = "tnLowEndLegendStyle";
        if (!document.getElementById(styleId)) {
          const style = document.createElement("style");
          style.id = styleId;
          style.textContent = `
            #tnLowEndLegend{
              position:absolute;
              pointer-events:none;
              font-family: Inter, system-ui, sans-serif;
              color: rgba(0,0,0,0.45);
            }
            #tnLowEndLegend .lbl{
              font-size:9px;
              letter-spacing:0.02em;
              color: rgba(0,0,0,0.38);
              margin-bottom:2px;
              font-weight:600;
              text-transform: uppercase;
              white-space: nowrap;
            }
            #tnLowEndLegend .items{
              display:flex;
              flex-direction: column;
              gap:4px;
              font-size:10px;
              font-weight:600;
              color: rgba(0,0,0,0.45);
            }
            #tnLowEndLegend .item{
              display:flex;
              align-items:center;
              gap:6px;
              white-space: nowrap;
            }
            #tnLowEndLegend .dot{
              width:6px;height:6px;border-radius:999px;display:inline-block;
            }
          `;
          document.head.appendChild(style);
        }

        lowEndLegend = document.createElement("div");
        lowEndLegend.id = "tnLowEndLegend";
        lowEndLegend.innerHTML = `
          <div class="lbl">BANDS</div>
          <div class="items">
            <div class="item"><span class="dot" style="background:${bandColors.sub}"></span><span>Sub</span></div>
            <div class="item"><span class="dot" style="background:${bandColors.bass}"></span><span>Bass</span></div>
            <div class="item"><span class="dot" style="background:${bandColors.lowmid}"></span><span>Lowmid</span></div>
          </div>
        `;
        chartColumn.appendChild(lowEndLegend);
      }

      function positionLowEndLegend() {
        if (!chartColumn || !svgElForLegend || !lowEndLegend) return;

        const containerRect = chartColumn.getBoundingClientRect();
        const svgRect = svgElForLegend.getBoundingClientRect();

        const svgLeftInContainer = svgRect.left - containerRect.left;
        const svgTopInContainer = svgRect.top - containerRect.top;
        const svgRightInContainer = svgRect.right - containerRect.left;

        const legendRect = lowEndLegend.getBoundingClientRect();
        const pad = 6;

        // Put legend in the RIGHT MARGIN band (outside plotted grid).
        const plotRight = svgLeftInContainer + margin.left + innerW;
        let left = plotRight + 10;
        let top = svgTopInContainer + margin.top + 6;

        // Clamp inside SVG frame
        const maxLeft = svgRightInContainer - legendRect.width - pad;
        if (left > maxLeft) left = maxLeft;

        // If right margin too tight, fall back to TOP MARGIN (still not on grid)
        if (left < plotRight + 4) {
          const plotTop = svgTopInContainer + margin.top;
          top = Math.max(svgTopInContainer + 2, plotTop - legendRect.height - 2);
          left = Math.min(svgRightInContainer - legendRect.width - pad, plotRight + innerW - legendRect.width - 6);
          left = Math.max(svgLeftInContainer + pad, left);
        }

        lowEndLegend.style.left = `${left}px`;
        lowEndLegend.style.top = `${top}px`;
      }

      ensureLowEndLegend();
      requestAnimationFrame(() => positionLowEndLegend());
      onLegendResize = () => requestAnimationFrame(() => positionLowEndLegend());
      window.addEventListener("resize", onLegendResize);
      
      const bandPaths = {};
      availableBands.forEach(band => {
        bandPaths[band] = g
          .append("path")
          .attr("fill", "none")
          .attr("stroke", bandColors[band] || "rgba(100,100,100,0.95)")
          .attr("stroke-width", 3.0)
          .attr("class", `band-path band-${band}`)
          .style("display", bandVisibility[band] ? null : "none");
      });

      // Optional: horizontal guide line at y=0.5
      const guideLine = g
        .append("line")
        .attr("stroke", "rgba(15,23,42,0.20)")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(0.5))
        .attr("y2", y(0.5))
        .attr("opacity", 0.6);

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

      const hoverDot = g.append("circle").attr("r", 4.5).attr("opacity", 0);

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

      // ---------- data processing functions ----------
      function downsample(curve, maxPoints) {
        if (!curve || !curve.length || curve.length <= maxPoints) {
          return curve;
        }
        
        const step = curve.length / maxPoints;
        const result = [];
        
        for (let i = 0; i < maxPoints; i++) {
          const idx = Math.round(i * step);
          if (idx < curve.length) {
            result.push(curve[idx]);
          }
        }
        
        // Always include first and last points
        if (result.length > 0 && result[0] !== curve[0]) {
          result[0] = curve[0];
        }
        if (result.length > 0 && result[result.length - 1] !== curve[curve.length - 1]) {
          result[result.length - 1] = curve[curve.length - 1];
        }
        
        return result;
      }

      function smoothEMA(curve, alpha) {
        if (!curve || !curve.length) return curve;
        
        const smoothed = [];
        const prevValues = {
          sub: curve[0]?.sub ?? 0,
          bass: curve[0]?.bass ?? 0,
          lowmid: curve[0]?.lowmid ?? 0,
        };
        
        for (let i = 0; i < curve.length; i++) {
          const d = curve[i];
          const smoothedSub = i === 0 ? d.sub : alpha * d.sub + (1 - alpha) * prevValues.sub;
          const smoothedBass = i === 0 ? d.bass : alpha * d.bass + (1 - alpha) * prevValues.bass;
          const smoothedLowmid = i === 0 ? d.lowmid : alpha * d.lowmid + (1 - alpha) * prevValues.lowmid;
          
          smoothed.push({
            t_s: d.t_s,
            sub: smoothedSub,
            bass: smoothedBass,
            lowmid: smoothedLowmid,
            low_end_total: d.low_end_total,
            low_width: d.low_width,
          });
          
          prevValues.sub = smoothedSub;
          prevValues.bass = smoothedBass;
          prevValues.lowmid = smoothedLowmid;
        }
        
        return smoothed;
      }

      // ---------- render function (updates series only, NOT scales) ----------
      function render(dataObj) {
        g.selectAll(".tn-msg").remove();

        if (!dataObj || !dataObj.points || !dataObj.points.length) {
          // Hide all paths
          availableBands.forEach(band => {
            if (bandPaths[band]) bandPaths[band].attr("d", null);
          });
          hoverDot.attr("opacity", 0);
          crosshair.attr("opacity", 0);
          
          // Check if features exists but low_end is missing
          const hasFeatures = trackObj?.features || refObj?.features;
          const hasLowEnd = trackObj?.features?.low_end || refObj?.features?.low_end;
          const featuresKeys = trackObj?.features ? Object.keys(trackObj.features) : [];
          
          if (hasFeatures && !hasLowEnd && featuresKeys.includes("lufs")) {
            drawMessage("Low-end data not available. Please re-analyze your audio files with the updated backend (restart API server if needed).");
          } else {
            drawMessage("No low-end data found. Check: features.low_end.points");
          }
          updateStatsPanel(null);
          return;
        }

        // Process data: downsample then smooth
        const MAX_POINTS = 1200;
        const SMOOTH_ALPHA = 0.15;
        
        let processedCurve = downsample(dataObj.points, MAX_POINTS);
        processedCurve = smoothEMA(processedCurve, SMOOTH_ALPHA);

        // Update grid lines with current x domain
        grid.selectAll("g").remove();
        grid.append("g")
          .attr("transform", `translate(0,${innerH})`)
          .call(d3.axisBottom(x).ticks(16).tickSize(-innerH).tickFormat(""));
        grid.append("g")
          .call(d3.axisLeft(y).ticks(12).tickSize(-innerW).tickFormat(""));
        grid.selectAll(".domain").remove();
        grid.selectAll(".tick line")
          .attr("stroke", "rgba(15,23,42,0.20)")
          .attr("stroke-opacity", 0.35)
          .attr("stroke-width", 1.1);

        // Update axes (domains already set, just redraw)
        gx.call(d3.axisBottom(x).ticks(7).tickFormat(d => formatTimeMMSS(d)));
        gy.call(d3.axisLeft(y).ticks(6));

        // Update guide line position (y=0.5)
        guideLine
          .attr("y1", y(0.5))
          .attr("y2", y(0.5));

        // Store processed curve for hover
        if (mode === "ref") {
          processedRefCurve = processedCurve;
        } else {
          processedTrackCurve = processedCurve;
        }

        // Render each band series with width-mapped thickness
        availableBands.forEach(band => {
          if (!bandPaths[band]) return;
          
          const line = d3
            .line()
            .x((d) => x(d.t_s))
            .y((d) => y(d[band]))
            .curve(d3.curveMonotoneX);
          
          // Map low_width to stroke-width: 1 + (width * 4) = range 1-5px
          // Use average width for the path (per-segment would require path segments)
          const avgWidth = processedCurve.length > 0
            ? processedCurve.reduce((sum, d) => sum + d.low_width, 0) / processedCurve.length
            : 0;
          const strokeWidth = 1 + (avgWidth * 4);
          
          bandPaths[band]
            .datum(processedCurve)
            .attr("d", line)
            .attr("stroke-width", strokeWidth)
            .style("display", bandVisibility[band] ? null : "none");
        });
        
        // Update stats panel
        updateStatsPanel(dataObj.points, mode === "ref" ? refData.points : trackData.points);
      }

      // ---------- nearest point (binary search) ----------
      function nearestPoint(curve, t) {
        if (!curve || !curve.length) return null;
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
        if (!d) return;
        
        // Build band values string for visible bands
        const bandValues = [];
        if (bandVisibility.sub && d.sub !== undefined) {
          bandValues.push(`Sub: ${fmt(d.sub, 3)}`);
        }
        if (bandVisibility.bass && d.bass !== undefined) {
          bandValues.push(`Bass: ${fmt(d.bass, 3)}`);
        }
        if (bandVisibility.lowmid && d.lowmid !== undefined) {
          bandValues.push(`LowMid: ${fmt(d.lowmid, 3)}`);
        }
        
        tooltip
          .style("opacity", 1)
          .html(
            `
            <div style="font-weight:700; margin-bottom:6px;">${label}</div>
            <div><b>time</b>: ${formatTimeMMSS(d.t_s)}</div>
            ${bandValues.length > 0 ? `<div>${bandValues.join(" | ")}</div>` : ""}
            <div><b>width</b>: ${fmt(d.low_width, 3)}</div>
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

      // Store processed curves for hover
      let processedTrackCurve = [];
      let processedRefCurve = [];

      // ---------- hover interaction ----------
      overlay
        .on("mousemove", function (event) {
          const currentData = mode === "ref" ? refData : trackData;
          const processedCurve = mode === "ref" ? processedRefCurve : processedTrackCurve;
          if (!processedCurve || !processedCurve.length) return;

          const [mx, my] = d3.pointer(event, this);
          const t = x.invert(mx);
          const d = nearestPoint(processedCurve, t);

          if (!d) return;

          // Update crosshair (vertical line)
          crosshair
            .attr("x1", mx)
            .attr("x2", mx)
            .attr("opacity", 1);

          // Update dot - position on first visible band
          let dotY = innerH;
          if (bandVisibility.sub && d.sub !== undefined) {
            dotY = y(d.sub);
          } else if (bandVisibility.bass && d.bass !== undefined) {
            dotY = y(d.bass);
          } else if (bandVisibility.lowmid && d.lowmid !== undefined) {
            dotY = y(d.lowmid);
          }

          hoverDot
            .attr("cx", x(d.t_s))
            .attr("cy", dotY)
            .attr("fill", "rgba(47,174,130,0.95)")
            .attr("stroke", "rgba(255,255,255,0.9)")
            .attr("stroke-width", 1.5)
            .attr("opacity", 1);

          // Store hover dot's time value for zoom focal point
          hoverDotTime = d.t_s;

          showTip(event, d, mode === "ref" ? "Reference" : "Track");
        })
        .on("mouseleave", hideTip);

      // ---------- toggle buttons UI ----------
      // Renders band toggle buttons into the sidebar stats panel container
      function createToggleButtons() {
        const toggleContainer = document.getElementById("tnLowEndToggles");
        if (!toggleContainer) return null;

        toggleContainer.innerHTML = "";

        function rgbForBand(band) {
          const c = bandColors[band] || "";
          const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
          if (m) return `${m[1]},${m[2]},${m[3]}`;
          // fallback teal-ish
          return "47,174,130";
        }

        // Keep the original button design; only change the active tint color per band.
        function applyBtnStyle(btn, band) {
          const rgb = rgbForBand(band);
          const isOn = !!bandVisibility[band];
          btn.style.background = isOn ? `rgba(${rgb},0.15)` : "rgba(255,255,255,0.7)";
        }
        
        availableBands.forEach(band => {
          const btn = document.createElement("button");
          btn.textContent = band.charAt(0).toUpperCase() + band.slice(1);
          btn.className = bandVisibility[band] ? "active" : "";
          btn.style.cssText = `
            padding: 6px 12px;
            font-size: 12px;
            border: 1px solid rgba(15,23,42,0.2);
            border-radius: 6px;
            cursor: pointer;
          `;
          applyBtnStyle(btn, band);
          
          btn.onclick = () => {
            bandVisibility[band] = !bandVisibility[band];
            btn.classList.toggle("active", bandVisibility[band]);
            applyBtnStyle(btn, band);
            
            // Update path visibility
            if (bandPaths[band]) {
              bandPaths[band].style("display", bandVisibility[band] ? null : "none");
            }
            if (bandSegmentGroups?.[band]) {
              bandSegmentGroups[band].style("display", bandVisibility[band] ? null : "none");
            }
          };
          
          toggleContainer.appendChild(btn);
        });

        return toggleContainer;
      }

      // ---------- stats panel ----------
      function updateStatsPanel(points, refPoints = null) {
        const wrapId = ctx?.wrapId || "wrap";
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;

        let statsEl = document.getElementById("tnLowEndStats");
        if (!statsEl) {
          const style = document.createElement("style");
          style.textContent = `
            #tnLowEndStats {
              width: 100%;
              box-sizing: border-box;
              border: 1px solid rgba(15,23,42,0.12);
              border-radius: 10px;
              background: rgba(255,255,255,0.95);
              padding: 12px 14px;
              font-size: 12px;
              line-height: 1.5;
              backdrop-filter: blur(3px);
              -webkit-backdrop-filter: blur(3px);
              box-shadow: 0 4px 12px rgba(15,23,42,0.08);
            }
            #tnLowEndStats .title {
              font-weight: 700;
              margin-bottom: 8px;
              color: rgba(15,23,42,0.85);
            }
            #tnLowEndStats .row {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              padding: 6px 0;
              border-bottom: 1px solid rgba(15,23,42,0.08);
            }
            #tnLowEndStats .row:last-child {
              border-bottom: none;
            }
            #tnLowEndStats .k {
              color: rgba(15,23,42,0.65);
            }
            #tnLowEndStats .v {
              text-align: right;
              font-variant-numeric: tabular-nums;
              font-weight: 600;
              color: rgba(15,23,42,0.85);
            }
            #tnLowEndStats .tn-lowend-toggles {
              margin-top: 8px;
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
            }
          `;
          document.head.appendChild(style);
          this.__tn_lowend_styleEl = style;

          statsEl = document.createElement("div");
          statsEl.id = "tnLowEndStats";
          // Prefer attaching to the right-hand sidebar if it exists,
          // otherwise fall back to the main wrap container.
          const sidebar = document.getElementById("sidebar");
          if (sidebar) {
            sidebar.appendChild(statsEl);
          } else {
            wrap.appendChild(statsEl);
          }
        }

        if (!points || !points.length) {
          statsEl.innerHTML = `
            <div class="title">Low-End Stats</div>
            <div class="row"><span class="k">No data</span><span class="v">—</span></div>
            <div id="tnLowEndToggles" class="tn-lowend-toggles"></div>
          `;
          return;
        }

        // Compute stats
        const subValues = points.map(d => d.sub).filter(v => Number.isFinite(v));
        const bassValues = points.map(d => d.bass).filter(v => Number.isFinite(v));
        
        const subMedian = subValues.length > 0 
          ? subValues.sort((a, b) => a - b)[Math.floor(subValues.length / 2)]
          : 0;
        const bassMedian = bassValues.length > 0
          ? bassValues.sort((a, b) => a - b)[Math.floor(bassValues.length / 2)]
          : 0;
        const balance = bassMedian > 1e-9 ? subMedian / bassMedian : 0;
        
        // Top 3 hotspots (simplified: just show time ranges)
        const combinedEnergy = points.map((d, i) => ({
          idx: i,
          t: d.t_s,
          energy: d.sub + d.bass,
          width: d.low_width,
        }));
        
        // Pick top "peaks" by energy, then sort by time so values appear in chronological order.
        const boomyCandidates = [];
        const seenTimes = new Set();
        const sortedByEnergy = [...combinedEnergy].sort((a, b) => b.energy - a.energy);
        for (const d of sortedByEnergy) {
          const mmss = formatTimeMMSS(d.t);
          if (mmss === "00:00") continue;
          if (seenTimes.has(mmss)) continue;
          seenTimes.add(mmss);
          boomyCandidates.push({ t: d.t, mmss });
          if (boomyCandidates.length >= 3) break;
        }
        const boomyHotspots = boomyCandidates.sort((a, b) => a.t - b.t).map(d => d.mmss);
        
        const label = mode === "ref" ? "Reference" : "Track";

        statsEl.innerHTML = `
          <div class="title">Low-End Stats — ${label}</div>
          <div class="row"><span class="k" title="Median energy share: Sub (20–60 Hz)">Sub Median</span><span class="v">${fmt(subMedian, 3)}</span></div>
          <div class="row"><span class="k" title="Median energy share: Bass (60–120 Hz)">Bass Median</span><span class="v">${fmt(bassMedian, 3)}</span></div>
          <div class="row"><span class="k" title="Sub ÷ Bass energy ratio">Sub/Bass Balance</span><span class="v">${fmt(balance, 3)}</span></div>
          <div class="row"><span class="k" title="Local low-end energy peaks (time)">Low End Peaks</span><span class="v">${boomyHotspots.length ? boomyHotspots.join(", ") : "—"}</span></div>
          <div id="tnLowEndToggles" class="tn-lowend-toggles"></div>
        `;

        // Render / re-render toggle buttons inside the sidebar
        createToggleButtons();
      }

      // ---------- track toggle handling ----------
      function updateSeries() {
        // Get current mode from global state or button state
        const trackBtn = document.getElementById(ctx.btnTrackId);
        const refBtn = document.getElementById(ctx.btnRefId);
        const trackIsActive = trackBtn?.classList.contains("active") || window.TrueNorthVizMode === "track";
        mode = trackIsActive ? "track" : "ref";

        const dataObj = mode === "ref" ? refData : trackData;
        render.call(this, dataObj);
        setTitle();
      }

      // Wire button clicks
      const btnTrack = document.getElementById(ctx.btnTrackId);
      const btnRef = document.getElementById(ctx.btnRefId);

      if (btnTrack)
        btnTrack.onclick = () => {
          mode = "track";
          updateSeries.call(this);
        };
      if (btnRef)
        btnRef.onclick = () => {
          mode = "ref";
          updateSeries.call(this);
        };

      // Store cleanup refs
      this.__tn_lowend_state = {
        interval: null,
      };
      this.__tn_lowend_state.styleEl = this.__tn_lowend_styleEl;
      this.__tn_lowend_state.legendEl = lowEndLegend;
      this.__tn_lowend_state.onLegendResize = onLegendResize;

      // Listen for Tab key changes (via window.TrueNorthVizMode)
      // Check mode periodically or on focus (simple approach)
      let lastMode = window.TrueNorthVizMode || "track";
      const modeCheckInterval = setInterval(() => {
        const currentMode = window.TrueNorthVizMode || "track";
        if (currentMode !== lastMode) {
          lastMode = currentMode;
          updateSeries.call(this);
        }
      }, 100);
      this.__tn_lowend_state.interval = modeCheckInterval;

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
            // Use the hover dot's actual time value (grid point)
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
            
            // Calculate focal time using CURRENT domain (before zoom)
            focalTime = x.invert(focalX);
          }
          
          // Calculate new range based on zoom scale
          const newRange = fullRange / t.k;
          
          // Additional check: if range exceeds full range, clamp to full range
          if (newRange >= fullRange) {
            x.domain([fullMin, fullMax]);
            updateSeries.call(this);
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
          updateSeries.call(this);
        });

      // Prevent browser zoom on wheel events
      overlay.on("wheel.zoom", function(event) {
        event.preventDefault();
        event.stopPropagation();
      });

      // Apply zoom to overlay
      overlay.call(zoom);
      
      // Store zoom reference for cleanup
      this.__tn_lowend_state.zoom = zoom;

      // Initial render
      setTitle();
      updateSeries.call(this);
    },

    unmount() {
      const state = this.__tn_lowend_state;
      if (state) {
        if (state.interval) clearInterval(state.interval);
        if (state.styleEl?.parentNode) state.styleEl.parentNode.removeChild(state.styleEl);
        if (state.onLegendResize) window.removeEventListener("resize", state.onLegendResize);
      }

      // Remove toggle buttons
      const toggles = document.getElementById("tnLowEndToggles");
      if (toggles?.parentNode) toggles.parentNode.removeChild(toggles);

      // Remove stats panel
      const statsEl = document.getElementById("tnLowEndStats");
      if (statsEl?.parentNode) statsEl.parentNode.removeChild(statsEl);

      // Remove low-end legend
      const legendEl = document.getElementById("tnLowEndLegend");
      if (legendEl?.parentNode) legendEl.parentNode.removeChild(legendEl);

      this.__tn_lowend_state = null;
    }
  };
})();
