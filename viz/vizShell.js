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

window.TrueNorthTransport = window.TrueNorthTransport || {
  currentTimeSec: 0,
  durationSec: 0,
  playing: false,
};

(async function main() {
  if (window.__TN_VIZ_SHELL_INITIALIZED__) {
    return;
  }
  window.__TN_VIZ_SHELL_INITIALIZED__ = true;
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

    // default mode
    window.TrueNorthVizMode = "track";
    setActiveButton("btnTrack", trackRefBtns);

    // Track/Ref listeners wired after switchTrackRefMode() is defined (see transport section below).

    // ---------------------------
    // Bottom transport + browser-only audio playback
    // ---------------------------
    const playBtn = document.getElementById("btnPlayPause");
    const playIcon = document.getElementById("transportPlayIcon");
    const modeTag = document.getElementById("transportModeTag");
    const scrubEl = document.getElementById("timeScrub");
    const timeNowEl = document.getElementById("timeLabel");
    const timeTotalEl = document.getElementById("timeTotal");
    const transport = {
      trackUrl: null,
      refUrl: null,
      trackAudio: null,
      refAudio: null,
      activeAudio: null,
      /** Bumped on every track/ref switch so stale play() callbacks cannot resume the wrong file */
      playbackEpoch: 0,
    };

    function formatMMSS(seconds) {
      if (!Number.isFinite(seconds)) return "00:00";
      const s = Math.max(0, Math.floor(seconds));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      return `${mm}:${ss}`;
    }

    function updateTransportUI() {
      const current = Number(window.TrueNorthTransport.currentTimeSec || 0);
      const duration = Number(window.TrueNorthTransport.durationSec || 0);
      if (timeNowEl) timeNowEl.textContent = formatMMSS(current);
      if (timeTotalEl) timeTotalEl.textContent = formatMMSS(duration);
      if (scrubEl) {
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        scrubEl.value = String(Math.max(0, Math.min(100, pct)));
      }
      if (playIcon) playIcon.textContent = window.TrueNorthTransport.playing ? "⏸" : "▶";
      if (modeTag) modeTag.textContent = window.TrueNorthVizMode === "reference" ? "REF" : "TRACK";
      window.dispatchEvent(new CustomEvent("tn:transport-time", { detail: { ...window.TrueNorthTransport } }));
    }

    function pauseActiveAudio() {
      transport.trackAudio?.pause();
      transport.refAudio?.pause();
      window.TrueNorthTransport.playing = false;
      updateTransportUI();
    }

    function setTransportDisabled(disabled, tooltipText) {
      if (!playBtn) return;
      playBtn.disabled = disabled;
      playBtn.title = tooltipText || "";
    }

    function syncActiveAudioFromMode() {
      transport.activeAudio = window.TrueNorthVizMode === "reference" ? transport.refAudio : transport.trackAudio;
      const hasAudio = !!transport.activeAudio;
      if (!hasAudio) {
        window.TrueNorthTransport.playing = false;
      }
      if (!hasAudio) {
        setTransportDisabled(true, "Run Analyze on the upload page to enable playback");
      } else {
        setTransportDisabled(false, "");
      }
      updateTransportUI();
    }

    function switchTrackRefMode(mode) {
      if (mode !== "track" && mode !== "reference") return;
      const wasPlaying = !!window.TrueNorthTransport.playing;
      const sameTime = Number(window.TrueNorthTransport.currentTimeSec || 0);

      transport.playbackEpoch += 1;
      const epoch = transport.playbackEpoch;

      pauseActiveAudio();

      if (window.TrueNorthViz && typeof window.TrueNorthViz.setMode === "function") {
        window.TrueNorthViz.setMode(mode);
      } else {
        window.TrueNorthVizMode = mode;
        setActiveButton(mode === "track" ? "btnTrack" : "btnRef", trackRefBtns);
        if (currentViz === "crest") forceRemountCurrentViz();
      }
      syncActiveAudioFromMode();
      if (transport.activeAudio) {
        transport.activeAudio.currentTime = sameTime;
      }
      if (wasPlaying && transport.activeAudio && !playBtn?.disabled) {
        const el = transport.activeAudio;
        el.play().then(() => {
          if (epoch !== transport.playbackEpoch) return;
          if (transport.activeAudio !== el) return;
          window.TrueNorthTransport.playing = true;
          updateTransportUI();
        }).catch(() => {});
      }
    }

    window.__TN_switchTrackRefMode = switchTrackRefMode;

    if (!window.__TN_TAB_HANDLER_INSTALLED__) {
      window.__TN_TAB_HANDLER_INSTALLED__ = true;
      function tnTabTargetIsTextLike(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.isContentEditable) return true;
        if (typeof el.closest === "function" && el.closest("[contenteditable='true']")) return true;
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "textarea") return true;
        if (tag === "select") return true;
        if (tag === "input") {
          const type = (el.type || "").toLowerCase();
          if (
            type === "button" ||
            type === "submit" ||
            type === "reset" ||
            type === "checkbox" ||
            type === "radio" ||
            type === "range" ||
            type === "file" ||
            type === "color" ||
            type === "hidden"
          ) {
            return false;
          }
          return true;
        }
        return false;
      }
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Tab" && e.code !== "Tab") return;
          if (e.repeat) return;
          if (tnTabTargetIsTextLike(e.target)) return;
          if (typeof window.__TN_switchTrackRefMode !== "function") return;
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          const showingTrack = window.TrueNorthVizMode !== "reference";
          window.__TN_switchTrackRefMode(showingTrack ? "reference" : "track");
        },
        { capture: true, passive: false }
      );
    }

    trackBtn?.addEventListener("click", () => switchTrackRefMode("track"));
    refBtn?.addEventListener("click", () => switchTrackRefMode("reference"));

    function bindAudioEvents(audioEl) {
      if (!audioEl) return;
      audioEl.addEventListener("loadedmetadata", () => {
        if (audioEl === transport.activeAudio) {
          window.TrueNorthTransport.durationSec = Number(audioEl.duration || 0);
          updateTransportUI();
        }
      });
      audioEl.addEventListener("timeupdate", () => {
        if (audioEl !== transport.activeAudio) return;
        window.TrueNorthTransport.currentTimeSec = Number(audioEl.currentTime || 0);
        window.TrueNorthTransport.durationSec = Number(audioEl.duration || window.TrueNorthTransport.durationSec || 0);
        updateTransportUI();
      });
      audioEl.addEventListener("ended", () => {
        if (audioEl !== transport.activeAudio) return;
        window.TrueNorthTransport.playing = false;
        updateTransportUI();
      });
    }

    function attachPlaybackFromStoredBlobs(trackBlob, refBlob) {
      if (!trackBlob || !refBlob) return;
      transport.trackAudio?.pause();
      transport.refAudio?.pause();
      window.TrueNorthTransport.playing = false;
      if (transport.trackUrl) URL.revokeObjectURL(transport.trackUrl);
      if (transport.refUrl) URL.revokeObjectURL(transport.refUrl);
      transport.trackUrl = URL.createObjectURL(trackBlob);
      transport.refUrl = URL.createObjectURL(refBlob);
      transport.trackAudio = new Audio(transport.trackUrl);
      transport.refAudio = new Audio(transport.refUrl);
      transport.trackAudio.preload = "auto";
      transport.refAudio.preload = "auto";
      bindAudioEvents(transport.trackAudio);
      bindAudioEvents(transport.refAudio);
      syncActiveAudioFromMode();
    }

    (async function hydratePlaybackFromUploadPage() {
      try {
        const store = window.TrueNorthPlaybackStore;
        if (!store?.load) return;
        const { track, reference } = await store.load();
        if (track && reference) {
          if (transport.trackAudio && transport.refAudio) return;
          attachPlaybackFromStoredBlobs(track, reference);
        }
      } catch (e) {
        console.warn("Could not load stored playback audio:", e);
      }
    })();

    if (playBtn) {
      playBtn.addEventListener("click", async () => {
        if (playBtn.disabled || !transport.activeAudio) return;
        if (window.TrueNorthTransport.playing) {
          pauseActiveAudio();
          return;
        }
        transport.playbackEpoch += 1;
        const epoch = transport.playbackEpoch;
        const el = transport.activeAudio;
        try {
          await el.play();
          if (epoch !== transport.playbackEpoch || transport.activeAudio !== el) {
            el.pause();
            return;
          }
          window.TrueNorthTransport.playing = true;
          updateTransportUI();
        } catch (_) {
          setTransportDisabled(true, "Run Analyze on the upload page to enable playback");
        }
      });
    }

    if (scrubEl) {
      scrubEl.addEventListener("input", () => {
        const duration = Number(window.TrueNorthTransport.durationSec || 0);
        const pct = Number(scrubEl.value || 0) / 100;
        const nextSec = duration > 0 ? pct * duration : 0;
        window.TrueNorthTransport.currentTimeSec = nextSec;
        if (transport.activeAudio && Number.isFinite(nextSec)) {
          transport.activeAudio.currentTime = nextSec;
        }
        updateTransportUI();
      });
    }

    window.addEventListener("tn:transport-seek-request", (ev) => {
      const sec = Number(ev?.detail?.seconds);
      if (!Number.isFinite(sec)) return;
      window.TrueNorthTransport.currentTimeSec = Math.max(0, sec);
      if (transport.activeAudio) {
        transport.activeAudio.currentTime = window.TrueNorthTransport.currentTimeSec;
      }
      updateTransportUI();
    });

    document.addEventListener("keydown", async (e) => {
      if (e.code !== "Space") return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      if (playBtn?.disabled || !transport.activeAudio) return;
      if (window.TrueNorthTransport.playing) {
        pauseActiveAudio();
      } else {
        transport.playbackEpoch += 1;
        const epoch = transport.playbackEpoch;
        const el = transport.activeAudio;
        try {
          await el.play();
          if (epoch !== transport.playbackEpoch || transport.activeAudio !== el) {
            el.pause();
            return;
          }
          window.TrueNorthTransport.playing = true;
          updateTransportUI();
        } catch (_) {}
      }
    });

    // ---------------------------
    // + notes: show immediately, then expand/collapse mini notepad (Track | Reference, bottom-right under graph)
    // ---------------------------
    const notesWrap = document.getElementById("notesWrap");
    const btnNotesToggle = document.getElementById("btnNotesToggle");
    const notesPanel = document.getElementById("notesPanel");
    const notesTrack = document.getElementById("notesTrack");
    const notesRef = document.getElementById("notesRef");
    const NOTES_TRACK_KEY = "tn:notesTrack";
    const NOTES_REF_KEY = "tn:notesRef";
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
        notesWrap.classList.remove("notes-delayed");
        notesWrap.setAttribute("aria-hidden", "false");
      }
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
    });

    document.getElementById("btnVizLoudness")?.addEventListener("click", () => {
      currentViz = "loudness";
      setActiveButton("btnVizLoudness", allVizBtns);
      window.TrueNorthViz.setViz("loudness");
      renderDocumentation("loudness");
      updateRegionStatsVisibility("loudness");
    });

    document.getElementById("btnVizCrest")?.addEventListener("click", () => {
      currentViz = "crest";
      setActiveButton("btnVizCrest", allVizBtns);
      window.TrueNorthViz.setViz("crest");
      renderDocumentation("crest");
      updateRegionStatsVisibility("crest");
    });

    document.getElementById("btnVizLowEnd")?.addEventListener("click", () => {
      currentViz = "lowend";
      setActiveButton("btnVizLowEnd", allVizBtns);
      window.TrueNorthViz.setViz("lowend");
      renderDocumentation("lowend");
      updateRegionStatsVisibility("lowend");
    });

    // Default viz button state
    setActiveButton("btnVizSpatial", allVizBtns);
    currentViz = "spatial";
    renderDocumentation("spatial");
    updateRegionStatsVisibility("spatial");

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

    // Transport starts at 00:00; playback enables when IndexedDB has blobs from upload page
    if (scrubEl) {
      scrubEl.value = "0";
      scrubEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    syncActiveAudioFromMode();
    
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
        onSuccess: async (data) => {
          const pf = uploadHandler._playbackFilesToStore;
          if (pf?.track && pf?.ref && window.TrueNorthPlaybackStore?.save) {
            try {
              await window.TrueNorthPlaybackStore.save(pf.track, pf.ref);
            } catch (e) {
              console.warn("Could not persist audio for playback:", e);
            }
          }
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

        const refFile = refFileInput?.files?.[0] || null;
        uploadHandler._playbackFilesToStore =
          mainFile && refFile ? { track: mainFile, ref: refFile } : null;
        try {
          await uploadHandler.uploadAndAnalyze(mainFile, refFile);
          if (mainFile && refFile) {
            attachPlaybackFromStoredBlobs(mainFile, refFile);
          }
        } catch (err) {
          // Error already handled by onError callback
        } finally {
          delete uploadHandler._playbackFilesToStore;
        }
      });
    }

  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
})();
