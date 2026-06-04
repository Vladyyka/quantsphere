/**
 * Strategy Backtester & Chart Analyzer - Historical Data Provider
 * Pure ES6 JavaScript. Handles Binance API fetching, custom CSV parsing, and high-quality mock data generation.
 */

window.DataProvider = (function () {
  
  // ==========================================
  // BINANCE PUBLIC API INTEGRATION
  // ==========================================
  
  function getIntervalSeconds(interval) {
    const num = parseInt(interval, 10);
    if (isNaN(num)) return 3600;
    const unit = interval.replace(String(num), "");
    switch (unit) {
      case "m": return num * 60;
      case "h": return num * 3600;
      case "d": return num * 86400;
      case "w": return num * 604800;
      case "M": return num * 2592000;
      default: return 3600;
    }
  }

  /**
   * Fetch historical candlestick data from Binance API
   * @param {string} symbol e.g., "BTCUSDT", "ETHUSDT"
   * @param {string} interval "1m", "5m", "15m", "1h", "4h", "1d"
   * @param {number} limit Max 1000 candles
   * @returns {Promise<Array<Object>>} Parsed candles list
   */
  async function fetchBinanceKlines(symbol = "BTCUSDT", interval = "1h", limit = 1000) {
    const upperSymbol = symbol.toUpperCase().replace("/", "").replace("-", "");
    
    // Try to load from IndexedDB cache first
    try {
      if (window.DbProvider) {
        const cached = await window.DbProvider.getCandles(upperSymbol, interval);
        if (cached && cached.length > 0) {
          const lastCandleTime = cached[cached.length - 1].time;
          const intervalSec = getIntervalSeconds(interval);
          const nowSec = Math.floor(Date.now() / 1000);
          // If the cache is fresh (less than 1 interval elapsed since last candle time), return it!
          if (nowSec - lastCandleTime < intervalSec) {
            console.log(`Using fresh cached candles from IndexedDB for ${upperSymbol} (${interval})`);
            return cached;
          }
          console.log(`Cached candles for ${upperSymbol} (${interval}) are outdated. Fetching from API...`);
        }
      }
    } catch (cacheErr) {
      console.warn("Failed to check IndexedDB cache:", cacheErr);
    }

    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${upperSymbol}&interval=${interval}&limit=${limit}`;
      
      let rawData;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Binance API error: Status ${response.status}`);
        }
        rawData = await response.json();
      } catch (fetchErr) {
        console.warn("Binance API fetch failed, checking cache for fallback:", fetchErr);
        if (window.DbProvider) {
          const cached = await window.DbProvider.getCandles(upperSymbol, interval);
          if (cached && cached.length > 0) {
            console.log(`Using cached candles as offline/error fallback for ${upperSymbol} (${interval})`);
            return cached;
          }
        }
        throw fetchErr;
      }
      
      if (!Array.isArray(rawData)) {
        throw new Error(rawData.msg || "Неверный формат ответа от Binance API. Убедитесь, что тикер указан верно.");
      }
      
      // Parse Binance array structure to clean objects
      const parsedCandles = rawData.map(item => {
        return {
          time: Math.floor(item[0] / 1000), // Convert ms to seconds (for TradingView lightweight charts)
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5])
        };
      });

      // Save to cache async
      if (window.DbProvider && parsedCandles.length > 0) {
        window.DbProvider.saveCandles(upperSymbol, interval, parsedCandles).catch(err => {
          console.error("Failed to write candles to IndexedDB cache:", err);
        });
      }
      
      return parsedCandles;
    } catch (err) {
      console.error("Failed to fetch Binance data:", err);
      throw new Error(`Failed to load crypto data for ${symbol}: ${err.message}`);
    }
  }

  // ==========================================
  // ROBUST LOCAL CSV FILE PARSER
  // ==========================================

  /**
   * Parse a CSV string containing historical price data
   * Supports standard formats exported from MT4, MT5, TradingView, Yahoo Finance
   * @param {string} csvText Raw CSV text
   * @returns {Array<Object>} Parsed candles
   */
  function parseCSV(csvText) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      throw new Error("CSV file must contain a header row and at least one data row.");
    }
    
    // Detect delimiter (comma or semicolon)
    const headerLine = lines[0];
    const delimiter = headerLine.includes(';') ? ';' : ',';
    const headers = headerLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    // Find column indexes
    let idxDate = headers.findIndex(h => h.includes('date') || h.includes('time') || h === 'ts' || h === 'timestamp');
    let idxOpen = headers.findIndex(h => h === 'open' || h === 'o');
    let idxHigh = headers.findIndex(h => h === 'high' || h === 'h');
    let idxLow = headers.findIndex(h => h === 'low' || h === 'l');
    let idxClose = headers.findIndex(h => h === 'close' || h === 'c');
    let idxVolume = headers.findIndex(h => h.includes('vol') || h === 'v');
    
    // Fallback indexes if headers aren't detected correctly
    if (idxOpen === -1) idxOpen = 1;
    if (idxHigh === -1) idxHigh = 2;
    if (idxLow === -1) idxLow = 3;
    if (idxClose === -1) idxClose = 4;
    if (idxVolume === -1) idxVolume = 5;
    if (idxDate === -1) idxDate = 0;
    
    const parsedCandles = [];
    
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter).map(c => c.trim().replace(/"/g, ''));
      if (cells.length < 5) continue; // Skip malformed rows
      
      const rawDate = cells[idxDate];
      if (!rawDate) continue; // Skip malformed or empty rows to prevent TypeError crash
      
      let timeVal = 0;
      
      // Parse date to UNIX timestamp (seconds)
      const parsedDate = Date.parse(rawDate);
      if (!isNaN(parsedDate)) {
        timeVal = Math.floor(parsedDate / 1000);
      } else {
        // Fallback for custom formats: e.g., "2026.05.28" or "28.05.2026"
        // Let's replace dots/slashes and try parsing
        const cleanedDate = rawDate.replace(/\./g, '/');
        const parsedCleaned = Date.parse(cleanedDate);
        if (!isNaN(parsedCleaned)) {
          timeVal = Math.floor(parsedCleaned / 1000);
        } else {
          // If still fails, assign a running increment timestamp
          timeVal = Math.floor(Date.now() / 1000) - (lines.length - i) * 3600;
        }
      }
      
      const open = parseFloat(cells[idxOpen]);
      const high = parseFloat(cells[idxHigh]);
      const low = parseFloat(cells[idxLow]);
      const close = parseFloat(cells[idxClose]);
      const volume = idxVolume < cells.length ? parseFloat(cells[idxVolume]) || 0 : 0;
      
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        continue; // Skip lines with missing price values
      }
      
      parsedCandles.push({
        time: timeVal,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: volume
      });
    }
    
    // Sort candles chronologically by timestamp
    parsedCandles.sort((a, b) => a.time - b.time);
    
    // Ensure timestamps are unique. If duplicates, add a few seconds to maintain sequence
    for (let i = 1; i < parsedCandles.length; i++) {
      if (parsedCandles[i].time <= parsedCandles[i - 1].time) {
        parsedCandles[i].time = parsedCandles[i - 1].time + 60; // Offset by 1 min
      }
    }
    
    return parsedCandles;
  }

  // ==========================================
  // PREMIUM PRELOADED DATA GENERATORS
  // ==========================================
  
  /**
   * Generates extremely realistic financial candles using Geometric Brownian Motion with drift
   * @param {string} assetType "STOCK" | "FOREX" | "GOLD"
   * @param {number} numCandles Number of candles to generate
   * @returns {Array<Object>} Candles list
   */
  function generateHighQualityMockData(assetType = "STOCK", numCandles = 500) {
    let price = 100;
    let volatility = 0.015; // 1.5% volatility per candle
    let drift = 0.0001;     // Slight upward drift
    let volumeBase = 100000;
    
    if (assetType === "FOREX") {
      price = 1.1250;
      volatility = 0.002;
      drift = -0.00002; // Downward pressure
      volumeBase = 50000;
    } else if (assetType === "GOLD") {
      price = 2350;
      volatility = 0.008;
      drift = 0.0003;
      volumeBase = 20000;
    }
    
    const candles = [];
    let currentTime = Math.floor(Date.now() / 1000) - numCandles * 86400; // Start historical days ago
    
    for (let i = 0; i < numCandles; i++) {
      const open = price;
      
      // Calculate realistic random walk
      const change = price * (drift + volatility * (Math.random() - 0.5));
      let close = price + change;
      
      // Ensure prices are positive and respect Forex decimal scales
      if (close <= 0) close = 0.01;
      
      // Create high and low relative to open/close
      const range = price * volatility * Math.random();
      const high = Math.max(open, close) + (range * 0.4);
      const low = Math.max(0.0001, Math.min(open, close) - (range * 0.4));
      
      const volume = Math.floor(volumeBase * (0.5 + Math.random() * 1.5));
      
      // Keep price updated
      price = close;
      
      // Next day timestamp (ignoring weekends for simple mock simplicity)
      currentTime += 86400;
      
      // Round to readable currency units
      const decimals = assetType === "FOREX" ? 5 : assetType === "GOLD" ? 2 : 2;
      
      candles.push({
        time: currentTime,
        open: parseFloat(open.toFixed(decimals)),
        high: parseFloat(high.toFixed(decimals)),
        low: parseFloat(low.toFixed(decimals)),
        close: parseFloat(close.toFixed(decimals)),
        volume: volume
      });
    }
    
    return candles;
  }

  return {
    fetchBinanceData: fetchBinanceKlines,
    parseCSV: parseCSV,
    generateMockData: generateHighQualityMockData
  };
})();
