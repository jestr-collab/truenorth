// vizShell.js
// Central controller for vizzes + track/ref mode + Tab behavior

(function () {
  window.TrueNorthVizzes = window.TrueNorthVizzes || {};
})();

async function loadScriptOnce(src) {
  const already = [...document.scripts].some(s => (s.src || "").includes(src));
  if (already) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

function setActiveButton(activeId, allIds) {
  allIds.forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle("active", id === activeId);
    b.setAttribute("aria-pressed", id === activeId ? "true" : "false");
  });
}

function forceRemountCurrentViz() {
  if (window.TrueNorthViz?.setData && window.TrueNorthViz?.getData) {
    window.TrueNorthViz.setData(window.TrueNorthViz.getData());
  }
}

// Global flag for Spatial overlay mode (Track + Reference at once)
window.TrueNorthOverlayEnabled = false;

(async function main() {
  try {
    // 1) Load viz modules
    await loadScriptOnce("./app.js");
    await loadScriptOnce("./loudnesscurve.js");
    await loadScriptOnce("./crestcurve.js");
    await loadScriptOnce("./lowendcurve.js");

    // 2) Load bridge
    await loadScriptOnce("./tnBridge.js");

    // 3) Validate
    const reg = window.TrueNorthVizzes || {};
    if (!reg.spatial?.mount || !reg.loudness?.mount || !reg.crest?.mount || !reg.lowend?.mount) {
      console.error("Registry:", reg);
      throw new Error("Missing viz registration (spatial, loudness, crest, or lowend missing).");
    }
    if (!window.TrueNorthViz?.setData || !window.TrueNorthViz?.setViz || !window.TrueNorthViz?.getData) {
      throw new Error("tnBridge.js not loaded (window.TrueNorthViz missing).");
    }

    // Track which viz is currently active (so we only remount when needed)
    let currentViz = "spatial";

    // 4) Load data from localStorage or show error
    const errorMessageEl = document.getElementById("errorMessage");
    const vizUIEl = document.getElementById("vizUI");
    let dataLoaded = false;
    
    try {
      const storedData = localStorage.getItem("tn:lastResult");
      
      if (storedData) {
        let data;
        try {
          data = JSON.parse(storedData);
        } catch (parseErr) {
          throw parseErr;
        }
        
        try {
          window.TrueNorthViz.setData(data);
          dataLoaded = true;
          
          // Show viz UI, hide error message
          if (errorMessageEl) errorMessageEl.style.display = "none";
          if (vizUIEl) vizUIEl.style.display = "block";
        } catch (setDataErr) {
          throw setDataErr;
        }
      } else {
        // No data found - show error message, hide viz UI
        if (errorMessageEl) errorMessageEl.style.display = "block";
        if (vizUIEl) vizUIEl.style.display = "none";
        console.warn("No analysis data found in localStorage");
        // Don't throw - just show the error message
      }
    } catch (err) {
      // Error parsing localStorage data
      console.error("Failed to load data from localStorage:", err);
      if (errorMessageEl) errorMessageEl.style.display = "block";
      if (vizUIEl) vizUIEl.style.display = "none";
    }

    // Only wire buttons if we have data loaded
    if (!dataLoaded) {
      // Exit early if no data - buttons won't work anyway
      return;
    }

    // ---------------------------
    // Track / Reference buttons
    // ---------------------------
    const trackRefBtns = ["btnTrack", "btnRef"];
    const trackBtn = document.getElementById("btnTrack");
    const refBtn = document.getElementById("btnRef");
    const overlayBtn = document.getElementById("btnOverlay");

    // default mode
    window.TrueNorthVizMode = "track";
    setActiveButton("btnTrack", trackRefBtns);

    // IMPORTANT: Do NOT force-remount here for spatial/loudness.
    // Those vizzes manage their own internal mode + redraw on click.
    // Only crest (mount-only) needs forceRemount.
    trackBtn?.addEventListener("click", () => {
      setActiveButton("btnTrack", trackRefBtns);
      window.TrueNorthVizMode = "track";

      if (currentViz === "crest") forceRemountCurrentViz();
    });

    refBtn?.addEventListener("click", () => {
      setActiveButton("btnRef", trackRefBtns);
      window.TrueNorthVizMode = "reference";

      if (currentViz === "crest") forceRemountCurrentViz();
    });

    // ---------------------------
    // Overlay toggle (Spatial only)
    // ---------------------------
    function syncOverlayVisibility() {
      if (!overlayBtn) return;
      const show = currentViz === "spatial";
      overlayBtn.style.display = show ? "inline-flex" : "none";
      if (!show) {
        window.TrueNorthOverlayEnabled = false;
        overlayBtn.classList.remove("active");
        overlayBtn.setAttribute("aria-pressed", "false");
      }
    }

    if (overlayBtn) {
      overlayBtn.addEventListener("click", () => {
        if (currentViz !== "spatial") return;
        window.TrueNorthOverlayEnabled = !window.TrueNorthOverlayEnabled;
        overlayBtn.classList.toggle("active", window.TrueNorthOverlayEnabled);
        overlayBtn.setAttribute("aria-pressed", window.TrueNorthOverlayEnabled ? "true" : "false");
        forceRemountCurrentViz();
      });
    }

    // ---------------------------
    // + notes: appear after 30s, then expand/collapse mini notepad (Track | Reference, bottom-right under graph)
    // ---------------------------
    const notesWrap = document.getElementById("notesWrap");
    const btnNotesToggle = document.getElementById("btnNotesToggle");
    const notesPanel = document.getElementById("notesPanel");
    const notesTrack = document.getElementById("notesTrack");
    const notesRef = document.getElementById("notesRef");
    const NOTES_TRACK_KEY = "tn:notesTrack";
    const NOTES_REF_KEY = "tn:notesRef";
    const NOTES_DELAY_MS = 30000; // 30 seconds before notes UI appears
    if (btnNotesToggle && notesPanel && notesTrack && notesRef) {
      try {
        const savedTrack = localStorage.getItem(NOTES_TRACK_KEY);
        if (savedTrack) notesTrack.value = savedTrack;
        const savedRef = localStorage.getItem(NOTES_REF_KEY);
        if (savedRef) notesRef.value = savedRef;
      } catch (_) {}
      btnNotesToggle.addEventListener("click", () => {
        const open = notesPanel.hidden;
        notesPanel.hidden = !open;
        btnNotesToggle.setAttribute("aria-expanded", String(!open));
        btnNotesToggle.textContent = open ? "− notes" : "+ notes";
        if (open) notesTrack.focus();
      });
      notesTrack.addEventListener("input", () => {
        try { localStorage.setItem(NOTES_TRACK_KEY, notesTrack.value); } catch (_) {}
      });
      notesRef.addEventListener("input", () => {
        try { localStorage.setItem(NOTES_REF_KEY, notesRef.value); } catch (_) {}
      });
      if (notesWrap) {
        setTimeout(() => {
          notesWrap.classList.remove("notes-delayed");
          notesWrap.setAttribute("aria-hidden", "false");
        }, NOTES_DELAY_MS);
      }
    }

    // ---------------------------
    // Tab key toggles Track/Ref by CLICKING buttons
    // ---------------------------
    if (!window.__TN_TAB_HANDLER_INSTALLED__) {
      window.__TN_TAB_HANDLER_INSTALLED__ = true;

      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Tab") return;

          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.repeat) return;

          const trackIsActive = document.getElementById("btnTrack")?.classList.contains("active");

          if (trackIsActive) {
            refBtn?.click();
          } else {
            trackBtn?.click();
          }
        },
        true // capture phase
      );
    }

    // ---------------------------
    // Documentation rendering function
    // ---------------------------
    function renderDocumentation(vizType) {
      const tabDocsEl = document.getElementById("tabDocs");
      if (!tabDocsEl) return;

      const docs = {
        spatial: {
          title: "Spatial Fingerprint",
          bullets: [
            "X (Stereo Field): left ↔ right balance per event",
            "Y (Presence): how forward/noticeable the event is",
            "Color: frequency emphasis (L/M/H)",
            "Select a region to see counts and averages"
          ],
          anchor: "spatial-fingerprint"
        },
        loudness: {
          title: "Loudness",
          bullets: [
            "Integrated LUFS: overall perceived loudness",
            "Short-term changes show dynamics over time",
            "Compare Track vs Reference to match level"
          ],
          anchor: "loudness-analysis"
        },
        crest: {
          title: "Crest",
          bullets: [
            "Crest factor reflects punch vs compression",
            "Higher crest = more transient impact",
            "Compare curves to see if mix is overly squashed"
          ],
          anchor: "crest-factor"
        },
        lowend: {
          title: "Low End",
          bullets: [
            "Shows low-frequency energy over time",
            "Helps spot boomy sections or weak bass",
            "Compare Track vs Reference for bass balance"
          ],
          anchor: "low-end-analysis"
        }
      };

      const doc = docs[vizType] || docs.spatial;
      const collapseByDefault = vizType === "spatial";

      tabDocsEl.innerHTML = `
        <div class="docs-header">
          <h3>${doc.title}</h3>
          <button type="button" class="docs-help-toggle" aria-label="Toggle help" aria-expanded="${collapseByDefault ? "false" : "true"}">?</button>
        </div>
        <div class="docs-body" ${collapseByDefault ? "hidden" : ""}>
          <ul>
            ${doc.bullets.map(bullet => `<li>${bullet}</li>`).join('')}
          </ul>
        </div>
        <div style="margin-top: 12px; line-height: 1.4;">
          <a href="docs.html#${doc.anchor}" target="_blank" rel="noopener noreferrer" style="color: #2D8B7A; text-decoration: none; font-size: 12px; letter-spacing: -0.01em; transition: color 0.2s ease; display: inline-block;" onmouseover="this.style.color='#256F62'" onmouseout="this.style.color='#2D8B7A'">See further documentation</a>
        </div>
      `;

      const toggle = tabDocsEl.querySelector(".docs-help-toggle");
      const body = tabDocsEl.querySelector(".docs-body");
      if (toggle && body) {
        toggle.addEventListener("click", () => {
          const hidden = body.hasAttribute("hidden");
          if (hidden) {
            body.removeAttribute("hidden");
          } else {
            body.setAttribute("hidden", "");
          }
          toggle.setAttribute("aria-expanded", hidden ? "true" : "false");
        });
      }
      
      // Realign Region Stats after docs update (if spatial is active)
      if (vizType === "spatial") {
        setTimeout(() => {
          alignRegionStatsWithGraph();
        }, 10);
      }
    }

    // ---------------------------
    // Function to align entire sidebar top with graph top
    // ---------------------------
    function alignSidebarWithGraph() {
      const sidebar = document.getElementById("sidebar");
      const chart = document.getElementById("chart");
      const mainLayout = document.getElementById("mainLayout");
      
      if (!sidebar || !chart || !mainLayout) return;

      // Get absolute positions
      const chartRect = chart.getBoundingClientRect();
      const mainLayoutRect = mainLayout.getBoundingClientRect();
      
      // Calculate where the graph top is relative to mainLayout top
      const graphTopOffset = chartRect.top - mainLayoutRect.top;
      
      // Set sidebar margin-top to align its top with graph top
      // Since sidebar has padding-top: 20px, we need to account for that
      const sidebarPadding = 20;
      sidebar.style.marginTop = `${graphTopOffset - sidebarPadding}px`;
    }

    // ---------------------------
    // Function to align Region Stats top with graph top (kept for backwards compatibility)
    // ---------------------------
    function alignRegionStatsWithGraph() {
      // This function is no longer needed since we align the entire sidebar
      // But keeping it to avoid breaking any existing calls
      alignSidebarWithGraph();
    }

    // ---------------------------
    // Function to show/hide Region Stats based on active tab
    // ---------------------------
    function updateRegionStatsVisibility(vizType) {
      const regionStatsWrap = document.getElementById("regionStatsWrap");
      if (regionStatsWrap) {
        // Show Region Stats only for spatial tab
        if (vizType === "spatial") {
          regionStatsWrap.style.display = "block";
          // Align with graph after showing
          setTimeout(() => {
            alignRegionStatsWithGraph();
          }, 50);
        } else {
          regionStatsWrap.style.display = "none";
        }
      }

      // Low-end stats panel: only show when Low-End viz is active
      const lowEndStats = document.getElementById("tnLowEndStats");
      if (lowEndStats) {
        lowEndStats.style.display = vizType === "lowend" ? "block" : "none";
      }
    }

    // ---------------------------
    // Viz switching buttons
    // ---------------------------
    const allVizBtns = ["btnVizSpatial", "btnVizLoudness", "btnVizCrest", "btnVizLowEnd"];

    document.getElementById("btnVizSpatial")?.addEventListener("click", () => {
      currentViz = "spatial";
      setActiveButton("btnVizSpatial", allVizBtns);
      window.TrueNorthViz.setViz("spatial");
      renderDocumentation("spatial");
      updateRegionStatsVisibility("spatial");
      if (typeof syncOverlayVisibility === "function") syncOverlayVisibility();
    });

    document.getElementById("btnVizLoudness")?.addEventListener("click", () => {
      currentViz = "loudness";
      setActiveButton("btnVizLoudness", allVizBtns);
      window.TrueNorthViz.setViz("loudness");
      renderDocumentation("loudness");
      updateRegionStatsVisibility("loudness");
      if (typeof syncOverlayVisibility === "function") syncOverlayVisibility();
    });

    document.getElementById("btnVizCrest")?.addEventListener("click", () => {
      currentViz = "crest";
      setActiveButton("btnVizCrest", allVizBtns);
      window.TrueNorthViz.setViz("crest");
      renderDocumentation("crest");
      updateRegionStatsVisibility("crest");
      if (typeof syncOverlayVisibility === "function") syncOverlayVisibility();
    });

    document.getElementById("btnVizLowEnd")?.addEventListener("click", () => {
      currentViz = "lowend";
      setActiveButton("btnVizLowEnd", allVizBtns);
      window.TrueNorthViz.setViz("lowend");
      renderDocumentation("lowend");
      updateRegionStatsVisibility("lowend");
      if (typeof syncOverlayVisibility === "function") syncOverlayVisibility();
    });

    // Default viz button state
    setActiveButton("btnVizSpatial", allVizBtns);
    currentViz = "spatial";
    renderDocumentation("spatial");
    updateRegionStatsVisibility("spatial");
    if (typeof syncOverlayVisibility === "function") syncOverlayVisibility();

    // ---------------------------
    // Delta Summary (Track vs Reference)
    // ---------------------------
    function renderDeltaSummary(data) {
      const wrap = document.getElementById("deltaSummaryWrap");
      const linesEl = document.getElementById("deltaSummaryLines");
      if (!wrap || !linesEl) return;

      const track = data?.track ?? null;
      const ref = data?.reference ?? null;
      const na = "—";

      function std(arr) {
        if (!arr || arr.length < 2) return NaN;
        const n = arr.length;
        const mean = arr.reduce((a, b) => a + b, 0) / n;
        const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
        return Math.sqrt(variance);
      }

      // Low-End: sub/bass ratio delta (raw ratio)
      let lowEndDelta = na;
      if (track?.features?.low_end?.points && ref?.features?.low_end?.points) {
        const trackPts = track.features.low_end.points;
        const refPts = ref.features.low_end.points;
        const mean = (arr, key) => {
          const vals = arr.map((p) => Number(p[key])).filter((n) => Number.isFinite(n));
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
        };
        const subT = mean(trackPts, "sub"), bassT = mean(trackPts, "bass");
        const subR = mean(refPts, "sub"), bassR = mean(refPts, "bass");
        const ratioT = bassT > 0 ? subT / bassT : NaN;
        const ratioR = bassR > 0 ? subR / bassR : NaN;
        if (Number.isFinite(ratioT) && Number.isFinite(ratioR)) {
          const d = ratioT - ratioR;
          lowEndDelta = (d >= 0 ? "+" : "") + d.toFixed(2);
        }
      }

      // LUFS: integrated delta in dB
      let lufsDelta = na;
      if (track?.features?.lufs?.integrated != null && ref?.features?.lufs?.integrated != null) {
        const t = Number(track.features.lufs.integrated);
        const r = Number(ref.features.lufs.integrated);
        if (Number.isFinite(t) && Number.isFinite(r)) {
          const d = t - r;
          lufsDelta = (d >= 0 ? "+" : "") + d.toFixed(1) + " dB";
        }
      }

      // Crest: std(crest_db) delta in dB
      let crestDelta = na;
      if (track?.features?.crest?.points && ref?.features?.crest?.points) {
        const toNum = (arr) => arr.map((p) => Number(p.crest_db)).filter((n) => Number.isFinite(n));
        const trackCrest = toNum(track.features.crest.points);
        const refCrest = toNum(ref.features.crest.points);
        if (trackCrest.length >= 2 && refCrest.length >= 2) {
          const d = std(trackCrest) - std(refCrest);
          crestDelta = (d >= 0 ? "+" : "") + d.toFixed(1) + " dB";
        }
      }

      const rows = [
        { label: "Loudness (LUFS)", value: lufsDelta, viz: "loudness", btnId: "btnVizLoudness" },
        { label: "Dynamics (Crest)", value: crestDelta, viz: "crest", btnId: "btnVizCrest" },
        { label: "Low-End", value: lowEndDelta, viz: "lowend", btnId: "btnVizLowEnd" },
      ];

      linesEl.innerHTML = rows
        .map((r) => {
          const raw = r.value;
          let cls = "delta-value";
          if (raw === na || raw == null) {
            cls += " na";
          } else {
            const num = parseFloat(String(raw));
            if (Number.isFinite(num) && num < 0) {
              cls += " neg";
            }
          }
          const display = raw == null ? na : raw;
          return `
            <div class="delta-summary-line" data-viz="${r.viz}" data-btn-id="${r.btnId}" role="button" tabindex="0">
              <span class="delta-label">${r.label}</span>
              <span class="${cls}">${display}</span>
            </div>
          `;
        })
        .join("");

      linesEl.querySelectorAll(".delta-summary-line").forEach((el) => {
        el.addEventListener("click", () => {
          const viz = el.getAttribute("data-viz");
          const btnId = el.getAttribute("data-btn-id");
          if (!viz || !btnId) return;
          currentViz = viz;
          setActiveButton(btnId, allVizBtns);
          window.TrueNorthViz.setViz(viz);
          renderDocumentation(viz);
          updateRegionStatsVisibility(viz);
        });
      });
    }
    renderDeltaSummary(window.TrueNorthViz.getData());

    // Ensure the time scrubber and viz start at 0% (00:00) on first load
    const initialScrub = document.getElementById("timeScrub");
    if (initialScrub) {
      initialScrub.value = "0";
      // Trigger the same logic spatial uses on manual scrub
      initialScrub.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // ---------------------------
    // One-time auto-scrub of time bar on first load
    // ---------------------------
    let autoScrubStarted = false;

    function startAutoScrubOnce() {
      if (autoScrubStarted) return;
      autoScrubStarted = true;

      const scrub = document.getElementById("timeScrub");
      if (!scrub) return;

      // If user physically interacts, cancel the animation
      let userInteracted = false;
      const cancelEvents = ["mousedown", "touchstart", "keydown"];
      const cancelHandler = () => {
        userInteracted = true;
        cancelEvents.forEach(evt =>
          scrub.removeEventListener(evt, cancelHandler)
        );
      };
      cancelEvents.forEach(evt =>
        scrub.addEventListener(evt, cancelHandler, { once: true })
      );

      // Animate from 0 -> 100 over 3 seconds
      const durationMs = 3000;
      const startTime = performance.now();

      // Start at 0 so we see the full sweep
      scrub.value = "0";
      scrub.dispatchEvent(new Event("input", { bubbles: true }));

      function step(now) {
        if (userInteracted) return;
        const t = Math.min(1, (now - startTime) / durationMs);
        const value = 0 + (100 - 0) * t;
        scrub.value = String(value);
        scrub.dispatchEvent(new Event("input", { bubbles: true }));

        if (t < 1 && !userInteracted) {
          requestAnimationFrame(step);
        }
      }

      requestAnimationFrame(step);
    }
    
    // Align entire sidebar with graph on initial load and window resize
    window.addEventListener("resize", () => {
      alignSidebarWithGraph();
    });
    
    // Also align after a short delay to ensure DOM is ready
    setTimeout(() => {
      alignSidebarWithGraph();
    }, 200);
    
    // Align when chart is rendered (after data loads)
    setTimeout(() => {
      alignSidebarWithGraph();
      // Start auto-scrub once, after layout & viz are ready
      startAutoScrubOnce();
    }, 500);

    // ---------------------------
    // Upload button wiring
    // ---------------------------
    const btnUpload = document.getElementById("btnUpload");
    const mainFileInput = document.getElementById("mainFile");
    const refFileInput = document.getElementById("refFile");

    if (btnUpload && typeof window.TrueNorthUploadHandler !== 'undefined') {
      const uploadHandler = new TrueNorthUploadHandler({
        apiBaseUrl: typeof window.getApiBaseUrl === "function" ? window.getApiBaseUrl() : "http://localhost:8000",
        endpoint: "/spatial-fingerprint",
        onLoading: (loading) => {
          const statusEl = document.getElementById("uploadStatus");
          const btnUpload = document.getElementById("btnUpload");
          if (statusEl) {
            statusEl.className = loading ? "status loading" : "status";
            statusEl.textContent = loading ? "Analyzing audio..." : "";
          }
          if (btnUpload) {
            btnUpload.disabled = loading;
            btnUpload.textContent = loading ? "Analyzing..." : "Analyze";
          }
        },
        onSuccess: (data) => {
          const statusEl = document.getElementById("uploadStatus");
          if (statusEl) {
            statusEl.className = "status";
            statusEl.textContent = "Analysis complete!";
            setTimeout(() => {
              statusEl.textContent = "";
            }, 3000);
          }
          // Set data in viz system
          if (window.TrueNorthViz?.setData) {
            window.TrueNorthViz.setData(data);
          }
          if (typeof renderDeltaSummary === "function" && window.TrueNorthViz?.getData) {
            renderDeltaSummary(window.TrueNorthViz.getData());
          }
        },
        onError: (err) => {
          const statusEl = document.getElementById("uploadStatus");
          if (statusEl) {
            statusEl.className = "status error";
            statusEl.textContent = `Error: ${err.message || String(err)}`;
          }
          console.error("Upload error:", err);
        }
      });

      btnUpload.addEventListener("click", async () => {
        const mainFile = mainFileInput?.files?.[0];
        if (!mainFile) {
          alert("Please select a main track file");
          return;
        }

        try {
          const refFile = refFileInput?.files?.[0] || null;
          await uploadHandler.uploadAndAnalyze(mainFile, refFile);
        } catch (err) {
          // Error already handled by onError callback
        }
      });
    }

  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
})();
