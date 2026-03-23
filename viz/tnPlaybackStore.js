// tnPlaybackStore.js
// Persists main + reference File/Blob in IndexedDB so viz.html can play back
// without re-uploading (localStorage cannot hold raw audio).

(function () {
  const DB_NAME = "tn-playback";
  const DB_VERSION = 1;
  const STORE = "blobs";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  window.TrueNorthPlaybackStore = {
    /**
     * @param {Blob} trackBlob
     * @param {Blob} refBlob
     */
    async save(trackBlob, refBlob) {
      if (!trackBlob || !refBlob) return;
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const s = tx.objectStore(STORE);
        s.put(trackBlob, "track");
        s.put(refBlob, "reference");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    },

    /** @returns {Promise<{ track?: Blob, reference?: Blob }>} */
    async load() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const s = tx.objectStore(STORE);
        let track;
        let reference;
        let pending = 2;
        function finish() {
          if (--pending !== 0) return;
          db.close();
          resolve({ track, reference });
        }
        const r1 = s.get("track");
        r1.onsuccess = () => {
          track = r1.result;
          finish();
        };
        r1.onerror = () => reject(r1.error);
        const r2 = s.get("reference");
        r2.onsuccess = () => {
          reference = r2.result;
          finish();
        };
        r2.onerror = () => reject(r2.error);
      });
    },

    async clear() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const s = tx.objectStore(STORE);
        s.delete("track");
        s.delete("reference");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();
