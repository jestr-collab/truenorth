// uploadHandler.js
// Handles file uploads and API calls to FastAPI backend
// MVP implementation - Loveable will replace this with better UI/UX

/**
 * Upload handler for TrueNorth Audio analysis
 * Handles file uploads, API calls, loading states, and error handling
 */
class TrueNorthUploadHandler {
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl || "http://localhost:8000";
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

      // Add max_events parameter for spatial-fingerprint
      if (this.endpoint === "/spatial-fingerprint") {
        formData.append("max_events", "250");
      }

      const url = `${this.apiBaseUrl}${this.endpoint}`;

      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          body: formData,
        });
      } catch (fetchError) {
        throw fetchError;
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetail = errorJson.detail || errorText;
        } catch {
          errorDetail = errorText || `HTTP ${response.status}`;
        }
        
        throw new Error(errorDetail);
      }

      const data = await response.json();
      
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
