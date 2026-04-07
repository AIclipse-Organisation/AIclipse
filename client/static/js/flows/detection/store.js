(function initPendingDetectionStore() {
  if (window.AIclipsePendingDetectionStore) return;

  const DB_NAME = "aiclipse-pending-detection";
  const STORE_NAME = "pending";
  const RECORD_ID = "current";

  function hasIndexedDb() {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed")), {
        once: true,
      });
    });
  }

  function openDb() {
    if (!hasIndexedDb()) {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.addEventListener(
        "upgradeneeded",
        () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        },
        { once: true },
      );
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("Failed to open IndexedDB")), {
        once: true,
      });
    });
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = await operation(store);
      await new Promise((resolve, reject) => {
        tx.addEventListener("complete", () => resolve(), { once: true });
        tx.addEventListener("error", () => reject(tx.error || new Error("IndexedDB transaction failed")), {
          once: true,
        });
        tx.addEventListener("abort", () => reject(tx.error || new Error("IndexedDB transaction aborted")), {
          once: true,
        });
      });
      return result;
    } finally {
      db.close();
    }
  }

  async function save(payload) {
    if (!hasIndexedDb()) return false;

    const file = payload && payload.file instanceof Blob ? payload.file : null;
    const detectionResponse =
      payload && typeof payload.detectionResponse === "object" ? payload.detectionResponse : null;

    if (!file || !detectionResponse) {
      throw new Error("Pending detection store requires file and detectionResponse");
    }

    await withStore("readwrite", async (store) => {
      store.put({
        id: RECORD_ID,
        file,
        detectionResponse,
        savedAt: Date.now(),
      });
    });

    return true;
  }

  async function load() {
    if (!hasIndexedDb()) return null;
    return withStore("readonly", async (store) => {
      const record = await requestToPromise(store.get(RECORD_ID));
      return record && typeof record === "object" ? record : null;
    });
  }

  async function clear() {
    if (!hasIndexedDb()) return false;
    await withStore("readwrite", async (store) => {
      store.delete(RECORD_ID);
    });
    return true;
  }

  window.AIclipsePendingDetectionStore = {
    clear,
    hasIndexedDb,
    load,
    save,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      hasIndexedDb,
    };
  }
})();
