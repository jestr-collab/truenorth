// uploadHandler.js
// Handles file uploads and API calls to FastAPI backend
// MVP implementation - Loveable will replace this with better UI/UX

/**
 * Upload handler for TrueNorth Audio analysis
 * Handles file uploads, API calls, loading states, and error handling
 */
class TrueNorthUploadHandler {
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl != null ? options.apiBaseUrl : (typeof window !== "undefined" && window.getApiBaseUrl ? window.getApiBaseUrl() : "http://localhost:8000");
    this.endpoint = options.endpoint || "/spatial-fingerprint"; // or "/analyze"
    this.onLoading = options.onLoading || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || ((err) => console.error("Upload error:", err));
  }

  /**
   * Upload files and call API
   * @param {File} mainFile - Main track file (required)
   * @param {File|null} refFile - Reference file (optional)
   * @returns {Promise<Object>} Analysis result JSON
   */
  async uploadAndAnalyze(mainFile, refFile = null) {
    console.log("uploadAndAnalyze fired", { apiBaseUrl: this.apiBaseUrl, endpoint: this.endpoint });
    if (!mainFile) {
      throw new Error("Main file is required");
    }

    // Validate file type
    const ext = (mainFile.name || "").split(".").pop()?.toLowerCase();
    if (ext !== "wav" && this.endpoint === "/spatial-fingerprint") {
      throw new Error("Spatial Fingerprint endpoint requires WAV files");
    }

    this.onLoading(true);

    try {
      const formData = new FormData();
      formData.append("main_file", mainFile);
      if (refFile) {
        formData.append("ref_file", refFile);
      }

      // Add max_events parameter for spatial-fingerprint (matches backend default 200)
      if (this.endpoint === "/spatial-fingerprint") {
        formData.append("max_events", "200");
      }

      const base = (this.apiBaseUrl || "").replace(/\/+$/, "");
      const path = (this.endpoint || "").startsWith("/") ? this.endpoint : "/" + this.endpoint;
      const url = base + path;
      console.log("Uploading to:", url);
      console.log("fetch() about to be called", { url, method: "POST" });

      const abortController = new AbortController();
      const timeoutId = setTimeout(function () {
        abortController.abort();
      }, 90000);

      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });
        clearTimeout(timeoutId);
        var contentType = response.headers.get("content-type") || "";
        var isJson = contentType.indexOf("application/json") !== -1;
        console.log("fetch() returned", { status: response.status, ok: response.ok, url: url, contentType: contentType, willParseAsJson: isJson });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError && fetchError.name === "AbortError") {
          var timeoutErr = new Error("Request timed out after 90 seconds");
          this.onError(timeoutErr);
          throw timeoutErr;
        }
        throw fetchError;
      }

      var text = await response.text();

      if (!response.ok) {
        var errorDetail;
        try {
          var errorJson = JSON.parse(text);
          errorDetail = errorJson.detail || text || "HTTP " + response.status;
        } catch (e) {
          errorDetail = text || "HTTP " + response.status;
        }
        if (typeof errorDetail !== "string") errorDetail = JSON.stringify(errorDetail);
        var preview = errorDetail.length > 200 ? errorDetail.slice(0, 200) + "…" : errorDetail;
        throw new Error("Server error (" + response.status + "): " + preview);
      }

      var data;
      if (contentType.indexOf("application/json") === -1) {
        console.warn("JSON parse skipped: content-type is not application/json", { contentType: contentType, textPreview: text.slice(0, 200) });
        throw new Error("Server returned non-JSON (status " + response.status + "): " + (text.length > 200 ? text.slice(0, 200) + "…" : text));
      }
      try {
        data = JSON.parse(text);
        console.log("JSON parse success");
      } catch (parseErr) {
        console.error("JSON parse failure", parseErr);
        throw new Error("Invalid JSON in response: " + (parseErr && parseErr.message ? parseErr.message : String(parseErr)));
      }
      
      this.onLoading(false);
      this.onSuccess(data);
      return data;
    } catch (err) {
      this.onLoading(false);
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError(error);
      throw error;
    }
  }

  /**
   * Convenience method: upload and automatically set viz data
   * @param {File} mainFile - Main track file
   * @param {File|null} refFile - Reference file
   * @returns {Promise<Object>} Analysis result
   */
  async uploadAndSetViz(mainFile, refFile = null) {
    const data = await this.uploadAndAnalyze(mainFile, refFile);
    
    // Automatically set data in viz system if available
    if (window.TrueNorthViz?.setData) {
      window.TrueNorthViz.setData(data);
    }
    
    return data;
  }
}

// Export for module systems
if (typeof module !== "undefined" && module.exports) {
  module.exports = TrueNorthUploadHandler;
}

// Expose globally
window.TrueNorthUploadHandler = TrueNorthUploadHandler;
