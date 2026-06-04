/**
 * QuantSphere - IndexedDB Data Provider (db-provider.js)
 * Implements client-side database caching for high-performance retrieval of
 * large candlestick datasets, drawings, and workspace state.
 * Prevents localStorage 5MB quota exhaustion.
 */

window.DbProvider = (function () {
  const DB_NAME = "QuantSphereDB";
  const DB_VERSION = 1;
  let db = null;

  /**
   * Initialize the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  function init() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn("IndexedDB is not supported in this browser. Caching will be disabled.");
        resolve(null);
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB open error:", event.target.error);
        resolve(null); // Resolve with null to fallback gracefully without crashing
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        console.log("IndexedDB initialized successfully.");
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        
        // Store candles keyed by "symbol_interval"
        if (!database.objectStoreNames.contains("candles")) {
          database.createObjectStore("candles", { keyPath: "key" });
        }
        
        // Store drawings keyed by "symbol"
        if (!database.objectStoreNames.contains("drawings")) {
          database.createObjectStore("drawings", { keyPath: "symbol" });
        }
        
        // Store workspaces keyed by workspace name/id (e.g., "default")
        if (!database.objectStoreNames.contains("workspace")) {
          database.createObjectStore("workspace", { keyPath: "key" });
        }
      };
    });
  }

  /**
   * Helper function to perform DB transactions safely
   */
  function getStore(storeName, mode) {
    if (!db) return null;
    try {
      const transaction = db.transaction(storeName, mode);
      return transaction.objectStore(storeName);
    } catch (e) {
      console.error(`Failed to get object store ${storeName}:`, e);
      return null;
    }
  }

  // ==========================================
  // CANDLE CACHING INTERFACE
  // ==========================================

  /**
   * Save candles to cache
   * @param {string} symbol e.g., "BTCUSDT"
   * @param {string} interval e.g., "1h"
   * @param {Array<Object>} candles
   */
  function saveCandles(symbol, interval, candles) {
    return new Promise((resolve) => {
      const store = getStore("candles", "readwrite");
      if (!store) {
        resolve(false);
        return;
      }

      const key = `${symbol.toUpperCase()}_${interval}`;
      const record = {
        key: key,
        symbol: symbol.toUpperCase(),
        interval: interval,
        lastUpdated: Date.now(),
        candles: candles
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        console.error("Failed to cache candles in IndexedDB:", e.target.error);
        resolve(false);
      };
    });
  }

  /**
   * Retrieve candles from cache
   * @param {string} symbol 
   * @param {string} interval 
   * @returns {Promise<Array<Object>|null>}
   */
  function getCandles(symbol, interval) {
    return new Promise((resolve) => {
      const store = getStore("candles", "readonly");
      if (!store) {
        resolve(null);
        return;
      }

      const key = `${symbol.toUpperCase()}_${interval}`;
      const request = store.get(key);

      request.onsuccess = (e) => {
        const result = e.target.result;
        if (result && result.candles) {
          resolve(result.candles);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  /**
   * Clear cached candles
   */
  function clearCandlesCache() {
    return new Promise((resolve) => {
      const store = getStore("candles", "readwrite");
      if (!store) {
        resolve(false);
        return;
      }
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }

  // ==========================================
  // DRAWINGS CACHING INTERFACE
  // ==========================================

  /**
   * Save drawings for a specific symbol
   * @param {string} symbol 
   * @param {Array} drawings 
   */
  function saveDrawings(symbol, drawings) {
    return new Promise((resolve) => {
      const store = getStore("drawings", "readwrite");
      if (!store) {
        resolve(false);
        return;
      }

      const record = {
        symbol: symbol.toUpperCase(),
        drawings: drawings,
        lastUpdated: Date.now()
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        console.error("Failed to save drawings in IndexedDB:", e.target.error);
        resolve(false);
      };
    });
  }

  /**
   * Retrieve drawings for a specific symbol
   * @param {string} symbol 
   * @returns {Promise<Array|null>}
   */
  function getDrawings(symbol) {
    return new Promise((resolve) => {
      const store = getStore("drawings", "readonly");
      if (!store) {
        resolve(null);
        return;
      }

      const request = store.get(symbol.toUpperCase());
      request.onsuccess = (e) => {
        const result = e.target.result;
        if (result && result.drawings) {
          resolve(result.drawings);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  /**
   * Retrieve all drawings from the database as a symbol map
   * @returns {Promise<Object>} Map of symbol -> drawings array
   */
  function getAllDrawings() {
    return new Promise((resolve) => {
      const store = getStore("drawings", "readonly");
      if (!store) {
        resolve({});
        return;
      }
      const drawingsMap = {};
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          drawingsMap[cursor.key] = cursor.value.drawings;
          cursor.continue();
        } else {
          resolve(drawingsMap);
        }
      };
      request.onerror = () => resolve({});
    });
  }

  /**
   * Save a map of symbols and drawings into the database
   * @param {Object} drawingsMap Map of symbol -> drawings array
   * @returns {Promise<boolean>}
   */
  function saveAllDrawings(drawingsMap) {
    return new Promise((resolve) => {
      const store = getStore("drawings", "readwrite");
      if (!store) {
        resolve(false);
        return;
      }
      
      let count = 0;
      const keys = Object.keys(drawingsMap);
      if (keys.length === 0) {
        resolve(true);
        return;
      }

      keys.forEach(symbol => {
        const record = {
          symbol: symbol.toUpperCase(),
          drawings: drawingsMap[symbol],
          lastUpdated: Date.now()
        };
        const request = store.put(record);
        request.onsuccess = () => {
          count++;
          if (count === keys.length) {
            resolve(true);
          }
        };
        request.onerror = () => {
          console.error(`Failed to save drawings for ${symbol} in bulk operation`);
          count++;
          if (count === keys.length) {
            resolve(false);
          }
        };
      });
    });
  }

  // ==========================================
  // WORKSPACE CACHING INTERFACE
  // ==========================================

  /**
   * Save workspace settings
   * @param {string} key e.g., "default"
   * @param {Object} data 
   */
  function saveWorkspace(key, data) {
    return new Promise((resolve) => {
      const store = getStore("workspace", "readwrite");
      if (!store) {
        resolve(false);
        return;
      }

      const record = {
        key: key,
        data: data,
        lastUpdated: Date.now()
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        console.error("Failed to save workspace state in IndexedDB:", e.target.error);
        resolve(false);
      };
    });
  }

  /**
   * Retrieve workspace settings
   * @param {string} key 
   * @returns {Promise<Object|null>}
   */
  function getWorkspace(key) {
    return new Promise((resolve) => {
      const store = getStore("workspace", "readonly");
      if (!store) {
        resolve(null);
        return;
      }

      const request = store.get(key);
      request.onsuccess = (e) => {
        const result = e.target.result;
        if (result && result.data) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  return {
    init: init,
    saveCandles: saveCandles,
    getCandles: getCandles,
    clearCandlesCache: clearCandlesCache,
    saveDrawings: saveDrawings,
    getDrawings: getDrawings,
    getAllDrawings: getAllDrawings,
    saveAllDrawings: saveAllDrawings,
    saveWorkspace: saveWorkspace,
    getWorkspace: getWorkspace
  };
})();
