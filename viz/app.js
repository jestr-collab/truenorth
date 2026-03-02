// app.js
// =====================
// TrueNorth Spatial Fingerprint Viz (MODULE)
// Works with vizShell.js: registers window.TrueNorthVizzes.spatial
// =====================

(function registerSpatial() {
  window.TrueNorthVizzes = window.TrueNorthVizzes || {};

  window.TrueNorthVizzes.spatial = {
    mount(ctx) {
      // ctx: { data, svgSelector, tooltipSelector, btnTrackId, btnRefId, titleId, timeRowId }
      const data = ctx?.data || {};

      // Remove other-viz legends so only Spatial's Frequency Emphasis shows
      const lowEndLegendEl = document.getElementById("tnLowEndLegend");
      if (lowEndLegendEl?.parentNode) lowEndLegendEl.parentNode.removeChild(lowEndLegendEl);

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

      // Safely truncate long labels (e.g., very long .wav filenames) with ellipsis.
      // Use a fairly aggressive default to avoid colliding with the time bar UI.
      function truncateLabel(label, maxLen = 40) {
        if (typeof label !== "string") return label;
        if (label.length <= maxLen) return label;
        const keep = maxLen - 3; // account for "..."
        const front = Math.ceil(keep * 0.6);
        const back = keep - front;
        return label.slice(0, front) + "..." + label.slice(-back);
      }

      function computeRange(eventsAll, duration_s) {
        const arr = (eventsAll || []).filter(d => Number.isFinite(Number(d?.t_s)));
        
        // Always start at 0, use duration_s if available, otherwise use max event time
        const tMin = 0;
        const tMax = (duration_s && Number.isFinite(Number(duration_s))) 
          ? Number(duration_s) 
          : (arr.length > 0 ? d3.max(arr, d => Number(d.t_s)) : 0);
        
        return { tMin, tMax };
      }

      // ---------- DOM ----------
      const svg = d3.select(ctx.svgSelector);
      const tooltip = d3.select(ctx.tooltipSelector);

      // hard-lock size
      const W = 960, H = 540;
      const margin = { top: 20, right: 20, bottom: 44, left: 56 };
      const innerW = W - margin.left - margin.right;
      const innerH = H - margin.top - margin.bottom;

      svg.attr("width", W).attr("height", H);
      svg.selectAll("*").remove(); // clear for remount

      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      // ---------- State ----------
      let mode = "track"; // "track" | "ref"
      let timePct = 100;

      let trackEventsAll = [];
      let refEventsAll = [];

      let trackName = "—";
      let refName = "—";

      let trackTMin = 0, trackTMax = 0;
      let refTMin = 0, refTMax = 0;

      // active selection stats
      let activeEvents = [];
      let activeTotal = 0;
      let selectionPx = null;

      // keep cleanup references
      const state = {
        onResize: null,
        onSvgClick: null,
        statsEl: null,
        legendEl: null,
        styleEl: null,
        positionLegend: null,
      };
      this.__tn_spatial_state = state;

      // ---------- Parse JSON (from ctx.data) ----------
      // Accept both shapes: data.track.fingerprint.events OR data.track.fingerprint.fingerprint.events, etc.
      const trackObj = data?.track ?? null;
      const refObj = data?.reference ?? null;

      trackEventsAll =
        trackObj?.fingerprint?.events ??
        trackObj?.fingerprint?.fingerprint?.events ??
        trackObj?.events ??
        [];

      refEventsAll =
        refObj?.fingerprint?.events ??
        refObj?.fingerprint?.fingerprint?.events ??
        refObj?.events ??
        [];
      
      trackName =
        trackObj?.meta?.filename ??
        trackObj?.filename ??
        trackObj?.name ??
        trackName;

      refName =
        refObj?.meta?.filename ??
        refObj?.filename ??
        refObj?.name ??
        refName;

      // Get duration from track data (duration_s field)
      const trackDuration = trackObj?.duration_s ?? trackObj?.meta?.duration_s ?? null;
      const refDuration = refObj?.duration_s ?? refObj?.meta?.duration_s ?? null;

      ({ tMin: trackTMin, tMax: trackTMax } = computeRange(trackEventsAll, trackDuration));
      ({ tMin: refTMin, tMax: refTMax } = computeRange(refEventsAll, refDuration));

      // ---------- scales + axes ----------
      // x-axis: domain [-1, 1] maps to range [0, innerW]
      // -1 = left side, 0 = center, 1 = right side
      const x = d3.scaleLinear().domain([-1, 1]).range([0, innerW]);
      const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);

      // xPlot maps angle to x-coordinate
      // Angle convention: negative = left, positive = right, 0 = center
      // No negation needed since angle already has correct sign from ILD calculation
      const xPlot = (d) => x(Number(d?.angle ?? 0));
      const yPlot = (d) => y(Number(d?.presence ?? 0));

      // gridlines (dense - matching crest square sizing)
      const grid = g.insert("g", ":first-child").attr("class", "xy-grid");
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

      // axes
      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(7));
      g.append("g")
        .call(d3.axisLeft(y).ticks(6));

      // labels
      g.append("text")
        .attr("class", "label")
        .attr("x", innerW / 2)
        .attr("y", innerH + 34)
        .attr("text-anchor", "middle")
        .text("Stereo Field");

      g.append("text")
        .attr("class", "label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -44)
        .attr("text-anchor", "middle")
        .text("Presence");

      // defs + glow filter
      const defs = svg.append("defs");
      defs.append("filter")
        .attr("id", "blurGlow")
        .attr("filterUnits", "userSpaceOnUse")
        .attr("x", -200).attr("y", -200)
        .attr("width", W + 400).attr("height", H + 400)
        .append("feGaussianBlur")
        .attr("in", "SourceGraphic")
        .attr("stdDeviation", 10);

      // ---------- color system ----------
      const bandColor = (band) => {
        if (band === "low") return "#2563eb";
        if (band === "mid") return "#16a34a";
        return "#f97316";
      };

      const LOW_COLOR  = "#3B82F6";
      const MID_COLOR  = "#22C55E";
      const HIGH_COLOR = "#F59E0B";

      const mix01 = (a, b, t) => d3.interpolateLab(a, b)(t);

      function energyMixColor(d) {
        const be = d?.band_energy || {};
        const l = Number(be.low ?? 0);
        const m = Number(be.mid ?? 0);
        const h = Number(be.high ?? 0);

        const s = l + m + h;
        if (!Number.isFinite(s) || s <= 1e-9) return MID_COLOR;

        const wl = l / s, wm = m / s, wh = h / s;

        const lmDen = wl + wm;
        const tLM = lmDen <= 1e-9 ? 0 : (wm / lmDen);
        const cLM = mix01(LOW_COLOR, MID_COLOR, tLM);

        return mix01(cLM, HIGH_COLOR, wh);
      }

      function dominantBand(d) {
        const be = d?.band_energy || {};
        const low = Number(be.low ?? -1);
        const mid = Number(be.mid ?? -1);
        const high = Number(be.high ?? -1);

        const max = Math.max(low, mid, high);
        if (max === low) return "low";
        if (max === mid) return "mid";
        if (max === high) return "high";
        return d?.band ?? "mid";
      }

      const DOMINANCE_THRESHOLD = 0.75;

      function smartFillColor(d) {
        const be = d?.band_energy || {};
        const low = Number(be.low ?? 0);
        const mid = Number(be.mid ?? 0);
        const high = Number(be.high ?? 0);
        const max = Math.max(low, mid, high);

        return (max >= DOMINANCE_THRESHOLD)
          ? bandColor(dominantBand(d))
          : energyMixColor(d);
      }

      const thickness = d3.scaleLinear().domain([0, 1]).range([0.6, 5.0]);

      // glow tuning
      const WET_GLOW_THRESHOLD = 0.70;
      const GLOW_OPACITY_MIN = 0.00;
      const GLOW_OPACITY_MAX = 0.80;

      // ---------- layers ----------
      const layerRefGlow   = g.append("g").attr("data-layer", "reference-glow").style("pointer-events", "none");
      const layerRefBase   = g.append("g").attr("data-layer", "reference-base");
      const layerTrackGlow = g.append("g").attr("data-layer", "track-glow").style("pointer-events", "none");
      const layerTrackBase = g.append("g").attr("data-layer", "track-base");

      // ---------- tooltip ----------
      function showTip(ev, d, label) {
        const be = d?.band_energy || {};
        tooltip
          .style("opacity", 1)
          .html(`
            <div style="font-weight:700; margin-bottom:6px;">${label}</div>
            <div><b>time</b>: ${formatTimeMMSS(Number(d?.t_s))}</div>
            <div><b>band</b>: ${d?.band ?? "—"}</div>
            <div><b>angle</b>: ${fmt(Number(d?.angle ?? 0), 3)}</div>
            <div><b>presence</b>: ${fmt(Number(d?.presence ?? 0), 3)}</div>
            <div><b>wetness</b>: ${fmt(Number(d?.wetness ?? 0), 3)}</div>
            <div style="margin-top:6px; opacity:0.9;">
              <div><b>band energy</b></div>
              <div>low: ${fmt(Number(be.low ?? 0), 3)} &nbsp; mid: ${fmt(Number(be.mid ?? 0), 3)} &nbsp; high: ${fmt(Number(be.high ?? 0), 3)}</div>
            </div>
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
      }

      // ---------- region stats UI (mounted once per mount) ----------
      function ensureRegionStatsPanel() {
        const chart = document.querySelector(ctx.svgSelector);
        const titleWrap = document.getElementById(ctx.titleId)?.parentElement;
        const regionStatsWrap = document.getElementById("regionStatsWrap");
        
        if (!chart || !regionStatsWrap) return;

        // Remove existing Region Stats if it exists (prevent duplicates)
        const existingStats = document.getElementById("tnRegionStats");
        if (existingStats && existingStats.parentNode) {
          existingStats.parentNode.removeChild(existingStats);
        }

        // add styles once per mount (remove in unmount)
        const style = document.createElement("style");
        style.textContent = `
          #tnRegionStats{
            width:100%;
            max-width:100%;
            border:1px solid var(--line);
            border-radius:10px;
            background: rgba(255,255,255,0.95);
            padding: 12px 14px;
            font-size:12px;
            line-height:1.45;
            overflow-x: hidden;
            overflow-y: visible;
            box-sizing: border-box;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          #tnRegionStats .title{ font-weight:800; margin-bottom:8px; font-size:13px; word-wrap: break-word; overflow-wrap: break-word; }
          #tnRegionStats .row{ 
            display:flex; 
            justify-content:space-between; 
            gap:8px; 
            padding:6px 0; 
            border-bottom:1px solid rgba(0,0,0,0.08);
            min-width: 0;
            flex-wrap: nowrap;
          }
          #tnRegionStats .row:last-child{ border-bottom:none; }
          #tnRegionStats .k{ 
            color:#444; 
            opacity:0.9; 
            flex-shrink: 1;
            min-width: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          #tnRegionStats .v{ 
            text-align:right; 
            font-variant-numeric: tabular-nums; 
            flex-shrink: 0;
            white-space: nowrap;
          }
          #tnRegionStats .muted{ color:#777; word-wrap: break-word; overflow-wrap: break-word; }

          #tnDominantLegend{
            position:absolute;
            padding:0;
            background: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
            pointer-events:none;
            white-space: normal;
          }
          #tnDominantLegend .tnLegendLabel{
            font-size:9px;
            letter-spacing:0.02em;
            color: rgba(0,0,0,0.38);
            margin-bottom:2px;
            font-weight:600;
            text-transform: uppercase;
          }
          #tnDominantLegend .tnLegendRow{
            display:flex;
            flex-direction: column;
            align-items:flex-start;
            gap:4px;
            font-size:10px;
            color: rgba(0,0,0,0.45);
            font-weight:600;
          }
          #tnDominantLegend .tnLegendItem{
            display:flex;
            align-items:center;
            gap:6px;
          }
          #tnDominantLegend .tnDot{
            width:6px;height:6px;border-radius:999px;display:inline-block;transform: translateY(0px);
          }
          #tnDominantLegend .tnDotL{ background:#2563eb; }
          #tnDominantLegend .tnDotM{ background:#16a34a; }
          #tnDominantLegend .tnDotH{ background:#f97316; }
          #tnDominantLegend .tnLegendTxt{ margin-right:0; font-variant-numeric: tabular-nums; }
        `;
        document.head.appendChild(style);
        state.styleEl = style;

        const statsEl = document.createElement("div");
        statsEl.id = "tnRegionStats";
        statsEl.innerHTML = `
          <div class="title">Region Stats</div>
          <div class="muted">Click + drag to select.</div>
        `;
        regionStatsWrap.appendChild(statsEl);
        state.statsEl = statsEl;

        const legendEl = document.createElement("div");
        legendEl.id = "tnDominantLegend";
        legendEl.innerHTML = `
          <div class="tnLegendLabel">Frequency Emphasis</div>
          <div class="tnLegendRow">
            <div class="tnLegendItem"><span class="tnDot tnDotL"></span><span class="tnLegendTxt">Low</span></div>
            <div class="tnLegendItem"><span class="tnDot tnDotM"></span><span class="tnLegendTxt">Medium</span></div>
            <div class="tnLegendItem"><span class="tnDot tnDotH"></span><span class="tnLegendTxt">High</span></div>
          </div>
        `;
        // Append to chartColumn so it can sit in the true whitespace to the right of the SVG
        const chartColumn = document.getElementById("chartColumn");
        if (chartColumn) {
          chartColumn.appendChild(legendEl);
        } else if (titleWrap) {
          // Fallback
          titleWrap.appendChild(legendEl);
        }
        state.legendEl = legendEl;

        // Position function is now simplified - just position the legend (stats are in normal flow)
        const position = () => {
          // Place legend ONLY in empty space (margins), never on the grid.
          if (!state.legendEl) return;

          const vizContainerEl = document.getElementById("chartColumn");
          const svgEl = document.querySelector(ctx.svgSelector);
          if (!vizContainerEl || !svgEl) return;

          const containerRect = vizContainerEl.getBoundingClientRect();
          const svgRect = svgEl.getBoundingClientRect();

          // Ensure absolute positioning within chartColumn
          state.legendEl.style.position = "absolute";
          state.legendEl.style.whiteSpace = "normal";

          const pad = 6;
          const svgLeftInContainer = (svgRect.left - containerRect.left);
          const svgTopInContainer = (svgRect.top - containerRect.top);
          const svgRightInContainer = (svgRect.right - containerRect.left);

          // Measure legend
          const legendRect = state.legendEl.getBoundingClientRect();

          // Primary: place in the SVG's RIGHT MARGIN band (outside the plotted grid).
          // Grid ends at plotRight = margin.left + innerW. Anything to the right of that is not on-grid.
          const plotRight = svgLeftInContainer + margin.left + innerW;
          const svgRight = svgRightInContainer;

          // Start just outside the plot area
          let left = plotRight + 10;
          let top = svgTopInContainer + margin.top + 6;

          // Clamp inside the SVG frame (right margin area)
          const maxLeft = svgRight - legendRect.width - pad;
          if (left > maxLeft) left = maxLeft;

          // If right margin is still too tight, fall back to TOP MARGIN (still not on grid)
          // and shrink slightly so it fits.
          const plotTop = svgTopInContainer + margin.top;
          if (left < plotRight + 4) {
            state.legendEl.style.transformOrigin = "top right";
            state.legendEl.style.transform = "scale(0.9)";
            const shrunkRect = state.legendEl.getBoundingClientRect();
            const maxLeft2 = svgRight - shrunkRect.width - pad;
            left = Math.max(svgLeftInContainer + pad, Math.min(maxLeft2, plotRight + innerW - shrunkRect.width - 6));
            top = Math.max(svgTopInContainer + 2, plotTop - shrunkRect.height - 2);
          } else {
            state.legendEl.style.transform = "";
          }

          state.legendEl.style.left = `${left}px`;
          state.legendEl.style.top = `${top}px`;
        };

        // Position after mount/layout and on resize only (avoid jitter during auto-scrub redraws)
        const positionAfterLayout = () => {
          requestAnimationFrame(() => position());
        };

        state.positionLegend = positionAfterLayout;

        positionAfterLayout();
        state.onResize = positionAfterLayout;
        window.addEventListener("resize", state.onResize);
      }

      function fmtPct1(v) {
        return `${(Number.isFinite(v) ? v : 0).toFixed(1)}%`;
      }
      function fmt2(v) {
        return Number.isFinite(v) ? v.toFixed(2) : "—";
      }

      function computeRegionStats(selected, totalCount) {
        const n = selected.length;
        const rel = totalCount > 0 ? (n / totalCount) * 100 : 0;

        let low = 0, mid = 0, high = 0;
        let sumPresence = 0;
        let sumAngle = 0;
        let sumWet = 0;

        for (const d of selected) {
          const b = dominantBand(d) ?? d.band ?? "mid";
          if (b === "low") low++;
          else if (b === "mid") mid++;
          else high++;

          const pres = Number(d.presence ?? 0);
          const ang = Number(d.angle ?? 0);
          const wet = Number(d.wetness ?? 0);

          sumPresence += pres;
          sumAngle += ang;
          sumWet += wet;
        }

        const denom = n || 1;

        return {
          eventCount: n,
          relativeDensityPct: rel,
          bandMixPct: {
            low: (low / denom) * 100,
            mid: (mid / denom) * 100,
            high: (high / denom) * 100,
          },
          meanPresence: n ? (sumPresence / n) : 0,
          stereoBias: n ? (sumAngle / n) : 0,
          meanWetness: n ? (sumWet / n) : 0,
        };
      }

      function renderRegionStatsPanel(stats) {
        const statsEl = state.statsEl;
        if (!statsEl) return;

        if (!selectionPx) {
          statsEl.innerHTML = `
            <div class="title">Region Stats</div>
            <div class="muted">Click + drag to select.</div>
          `;
          return;
        }

        if (!stats || stats.eventCount === 0) {
          statsEl.innerHTML = `
            <div class="title">Region Stats</div>
            <div class="muted">No points in this region.</div>
          `;
          return;
        }

        const mix = stats.bandMixPct;
        const mixStr = `L ${fmtPct1(mix.low)} · M ${fmtPct1(mix.mid)} · H ${fmtPct1(mix.high)}`;

        statsEl.innerHTML = `
          <div class="title">Region Stats</div>
          <div class="row"><div class="k" title="Total detected spatial events">Artifact Count</div><div class="v">${stats.eventCount}</div></div>
          <div class="row"><div class="k" title="% of time with active spatial events">Relative Density</div><div class="v">${fmtPct1(stats.relativeDensityPct)}</div></div>
          <div class="row"><div class="k" title="Event distribution: Low · Mid · High">Frequency Mix</div><div class="v">${mixStr}</div></div>
          <div class="row"><div class="k" title="Avg perceived forwardness">Mean Presence</div><div class="v">${fmt2(stats.meanPresence)}</div></div>
          <div class="row"><div class="k" title="Avg left ↔ right balance">Stereo Bias</div><div class="v">${fmt2(stats.stereoBias)}</div></div>
          <div class="row"><div class="k" title="avg ambience">Mean Wetness</div><div class="v">${fmt2(stats.meanWetness)}</div></div>
        `;
      }

      function updateStatsFromSelection() {
        if (!selectionPx) {
          renderRegionStatsPanel(null);
          return;
        }

        const [[x0p, y0p], [x1p, y1p]] = selectionPx;
        const xMinPx = Math.min(x0p, x1p);
        const xMaxPx = Math.max(x0p, x1p);
        const yMinPx = Math.min(y0p, y1p);
        const yMaxPx = Math.max(y0p, y1p);

        const EPS = 3;

        const selected = (activeEvents || []).filter(d => {
          const px = xPlot(d);
          const py = yPlot(d);
          return (
            px >= (xMinPx - EPS) && px <= (xMaxPx + EPS) &&
            py >= (yMinPx - EPS) && py <= (yMaxPx + EPS)
          );
        });

        const stats = computeRegionStats(selected, activeTotal);
        renderRegionStatsPanel(stats);
      }

      // ---------- brush ----------
      const brushLayer = g.append("g").attr("class", "brush");
      brushLayer.lower();

      const brush = d3.brush()
        .extent([[0, 0], [innerW, innerH]])
        .filter((event) => {
          const t = event?.target;
          const tag = t?.tagName?.toLowerCase?.() || "";
          return tag !== "circle";
        })
        .on("brush", (event) => {
          selectionPx = event.selection;
          updateStatsFromSelection();
        })
        .on("end", (event) => {
          if (event.selection) selectionPx = event.selection;
          updateStatsFromSelection();
        });

      brushLayer.call(brush);

      // background click clears selection
      state.onSvgClick = (event) => {
        const tag = event?.target?.tagName?.toLowerCase?.() || "";
        if (tag === "svg") {
          selectionPx = null;
          brushLayer.call(brush.move, null);
          updateStatsFromSelection();
        }
      };
      svg.on("click", state.onSvgClick);

      // ---------- render functions ----------
      function pointAttrs(sel) {
        return sel
          .attr("cx", d => xPlot(d))
          .attr("cy", d => yPlot(d))
          .attr("fill", d => smartFillColor(d))
          .attr("stroke", d => bandColor(dominantBand(d)))
          .attr("stroke-width", 1.35);
      }

      function renderBase(layer, events, opts) {
        const { opacity, label, interactive } = opts;

        const sel = layer.selectAll("circle").data(
          events,
          d => d.id ?? `${d.t_s}-${d.band}-${-d.angle}-${d.presence}`
        );

        const enter = sel.enter().append("circle");

        pointAttrs(enter.merge(sel))
          .attr("r", 2.4)
          .attr("fill-opacity", opacity)
          .style("cursor", interactive ? "crosshair" : "default")
          .on("mousemove", function(event, d) {
            if (!interactive) return;
            showTip(event, d, label);
          })
          .on("mouseleave", function() {
            if (!interactive) return;
            hideTip();
          });

        sel.exit().remove();
      }

      function renderGlow(layer, events) {
        const glowOpacity = (w) => {
          const ww = Number(w ?? 0);
          const t = (ww - WET_GLOW_THRESHOLD) / (1 - WET_GLOW_THRESHOLD);
          const u = Math.max(0, Math.min(1, t));
          return GLOW_OPACITY_MIN + u * (GLOW_OPACITY_MAX - GLOW_OPACITY_MIN);
        };

        const sel = layer.selectAll("circle").data(
          events,
          d => d.id ?? `${d.t_s}-${d.band}-${d.angle}-${d.presence}`
        );

        const enter = sel.enter().append("circle").attr("filter", "url(#blurGlow)");

        enter.merge(sel)
          .attr("cx", d => xPlot(d))
          .attr("cy", d => yPlot(d))
          .attr("fill", d => smartFillColor(d))
          .attr("r", d => {
            const p = Math.max(0, Math.min(1, Number(d?.presence ?? 0)));
            return (2.2 + thickness(Number(d?.wetness ?? 0)) * 1.2) * (0.35 + 0.65 * p);
          })
          .attr("fill-opacity", d => glowOpacity(d?.wetness))
          .attr("stroke", "none");

        sel.exit().remove();
      }

      // ---------- time / mode ----------
      function getActiveRange() {
        return (mode === "ref")
          ? { tMin: refTMin, tMax: refTMax }
          : { tMin: trackTMin, tMax: trackTMax };
      }

      function currentTimeThreshold() {
        const { tMin, tMax } = getActiveRange();
        if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin) return tMax;

        const p = Math.max(0, Math.min(100, Number(timePct))) / 100;
        return tMin + p * (tMax - tMin);
      }

      function filteredAccum(eventsAll, tThreshold) {
        const filtered = (eventsAll || []).filter(d => Number(d?.t_s ?? 0) <= tThreshold);
        
        return filtered;
      }

      function updateTitle() {
        const el = document.getElementById(ctx.titleId);
        if (!el) return;
        const raw = mode === "ref" ? `Reference: ${refName}` : `Track: ${trackName}`;
        el.textContent = truncateLabel(raw, 40); // Aggressive truncation to prevent interference with time bar
      }

      function updateTimeLabel(seconds) {
        const timeLabelId = ctx?.timeLabelId || "timeLabel";
        const el = document.getElementById(timeLabelId);
        if (!el) return;
        el.textContent = formatTimeMMSS(seconds);
      }

      function redraw() {
        const tThreshold = currentTimeThreshold();
        updateTimeLabel(tThreshold);

        const showTrack = (mode === "track");

        layerTrackGlow.style("display", showTrack ? null : "none");
        layerTrackBase.style("display", showTrack ? null : "none");
        layerRefGlow.style("display", showTrack ? "none" : null);
        layerRefBase.style("display", showTrack ? "none" : null);

        const btnTrack = document.getElementById(ctx.btnTrackId);
        const btnRef = document.getElementById(ctx.btnRefId);
        if (btnTrack) btnTrack.classList.toggle("active", mode === "track");
        if (btnRef) btnRef.classList.toggle("active", mode === "ref");

        if (showTrack) {
          const events = filteredAccum(trackEventsAll, tThreshold);
          const glowEvents = events.filter(d => Number(d?.wetness ?? 0) >= WET_GLOW_THRESHOLD);

          activeEvents = events;
          activeTotal = events.length;
          if (selectionPx) updateStatsFromSelection();

          renderGlow(layerTrackGlow, glowEvents);
          renderBase(layerTrackBase, events, { opacity: 0.90, label: "Track", interactive: true });
        } else {
          const events = filteredAccum(refEventsAll, tThreshold);
          const MIN_PRESENCE_FOR_GLOW = 0.08;

          const glowEvents = events.filter(d =>
            Number(d?.wetness ?? 0) >= WET_GLOW_THRESHOLD &&
            Number(d?.presence ?? 0) >= MIN_PRESENCE_FOR_GLOW
          );

          activeEvents = events;
          activeTotal = events.length;
          if (selectionPx) updateStatsFromSelection();

          renderGlow(layerRefGlow, glowEvents);
          renderBase(layerRefBase, events, { opacity: 0.90, label: "Reference", interactive: true });
        }

        hideTip();
        updateTitle();
        
        // Legend positioning is handled on mount/resize only (prevents load-time jumping)
      }

      // ---------- wire controls ----------
      // time row should be visible for spatial, positioned at top left next to title
      const timeRow = document.getElementById(ctx.timeRowId);
      if (timeRow) {
        timeRow.style.display = "flex";
        timeRow.className = "timeTop"; // Change class to position at top
      }

      const timeScrubId = ctx?.timeScrubId || "timeScrub";
      const scrub = document.getElementById(timeScrubId);
      if (scrub) {
        scrub.value = String(timePct);
        scrub.oninput = (e) => {
          timePct = Number(e.target.value);
          redraw();
        };
      }

      const btnTrack = document.getElementById(ctx.btnTrackId);
      const btnRef = document.getElementById(ctx.btnRefId);
      if (btnTrack) btnTrack.onclick = () => { mode = "track"; redraw(); };
      if (btnRef) btnRef.onclick = () => { mode = "ref"; redraw(); };

      // mount region stats UI
      ensureRegionStatsPanel();

      // Re-apply truncation immediately on mount to fix title if other features expanded it
      updateTitle();

      // first render
      redraw();
    },

    unmount() {
      const state = this.__tn_spatial_state;

      if (state?.onResize) {
        window.removeEventListener("resize", state.onResize);
      }

      if (state?.statsEl?.parentNode) {
        state.statsEl.parentNode.removeChild(state.statsEl);
      } else {
        const statsEl = document.getElementById('tnRegionStats');
        if (statsEl?.parentNode) statsEl.parentNode.removeChild(statsEl);
      }

      if (state?.legendEl?.parentNode) {
        state.legendEl.parentNode.removeChild(state.legendEl);
      } else {
        const legendEl = document.getElementById('tnDominantLegend');
        if (legendEl?.parentNode) legendEl.parentNode.removeChild(legendEl);
      }

      if (state?.styleEl?.parentNode) {
        state.styleEl.parentNode.removeChild(state.styleEl);
      } else {
        const styles = document.head.querySelectorAll('style');
        for (let i = styles.length - 1; i >= 0; i--) {
          const style = styles[i];
          if (style.textContent && style.textContent.includes('#tnRegionStats')) {
            style.parentNode.removeChild(style);
            break;
          }
        }
      }

      this.__tn_spatial_state = null;
    }
  };
})();
