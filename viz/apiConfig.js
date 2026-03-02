/**
 * Single source of truth for API base URL. No request targets Render during local dev
 * unless explicitly set via ?api= or localStorage TN_API_BASE_URL.
 */
(function () {
  function getApiBaseUrl() {
    if (typeof window === "undefined") return "http://localhost:8000";

    // 1) Query param ?api=<encoded URL> (e.g. ?api=https%3A%2F%2Fexample.com)
    var params = new URLSearchParams(window.location.search);
    var apiParam = params.get("api");
    if (apiParam && apiParam.trim()) {
      try {
        var decoded = decodeURIComponent(apiParam.trim());
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          window.__TN_API_BASE_URL__ = decoded.replace(/\/+$/, "");
          if (!window.__TN_API_BASE_URL_LOGGED__) {
            console.log("TrueNorth API base (from ?api=):", window.__TN_API_BASE_URL__);
            window.__TN_API_BASE_URL_LOGGED__ = true;
          }
          return window.__TN_API_BASE_URL__;
        }
      } catch (e) {
        console.warn("Invalid ?api= value, ignoring:", apiParam);
      }
    }

    // 2) localStorage TN_API_BASE_URL
    try {
      var stored = localStorage.getItem("TN_API_BASE_URL");
      if (stored && stored.trim()) {
        var url = stored.trim().replace(/\/+$/, "");
        if (url.startsWith("http://") || url.startsWith("https://")) {
          window.__TN_API_BASE_URL__ = url;
          if (!window.__TN_API_BASE_URL_LOGGED__) {
            console.log("TrueNorth API base (from localStorage):", window.__TN_API_BASE_URL__);
            window.__TN_API_BASE_URL_LOGGED__ = true;
          }
          return window.__TN_API_BASE_URL__;
        }
      }
    } catch (e) {
      // ignore
    }

    // 2b) window.TN_API_BASE_URL if set (e.g. by another script)
    if (typeof window.TN_API_BASE_URL === "string" && window.TN_API_BASE_URL.trim()) {
      var winUrl = window.TN_API_BASE_URL.trim().replace(/\/+$/, "");
      if (winUrl.startsWith("http://") || winUrl.startsWith("https://")) {
        window.__TN_API_BASE_URL__ = winUrl;
        if (!window.__TN_API_BASE_URL_LOGGED__) {
          console.log("TrueNorth API base (from window.TN_API_BASE_URL):", window.__TN_API_BASE_URL__);
          window.__TN_API_BASE_URL_LOGGED__ = true;
        }
        return window.__TN_API_BASE_URL__;
      }
    }

    // 3) Default: localhost for local dev
    window.__TN_API_BASE_URL__ = "http://localhost:8000";
    if (!window.__TN_API_BASE_URL_LOGGED__) {
      console.log("TrueNorth API base (default):", window.__TN_API_BASE_URL__);
      window.__TN_API_BASE_URL_LOGGED__ = true;
    }
    return window.__TN_API_BASE_URL__;
  }

  window.getApiBaseUrl = getApiBaseUrl;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { getApiBaseUrl: getApiBaseUrl };
  }
})();
