/**
 * Strategy Backtester & Chart Analyzer - Mathematical & Backtesting Engine
 * Pure ES6 JavaScript. High-speed, browser-compatible calculations.
 * Supports technical indicators and Smart Money Concepts (SMC/ICT) market structure.
 */

const globEngine = typeof window !== 'undefined' ? window : self;
globEngine.BacktestEngine = (function () {
  
  // ==========================================
  // TECHNICAL INDICATORS LIBRARY
  // ==========================================
  
  function sanitizePeriod(p, defaultVal = 14) {
    const num = Math.floor(Number(p));
    return (isNaN(num) || num < 1) ? defaultVal : num;
  }

  function calculateSMA(values, period) {
    period = sanitizePeriod(period, 9);
    const sma = new Array(values.length).fill(null);
    if (values.length < period) return sma;
    
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    sma[period - 1] = sum / period;
    
    for (let i = period; i < values.length; i++) {
      sum = sum - values[i - period] + values[i];
      sma[i] = sum / period;
    }
    return sma;
  }

  function calculateEMA(values, period) {
    period = sanitizePeriod(period, 14);
    const ema = new Array(values.length).fill(null);
    if (values.length < period) return ema;
    
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    let prevEma = sum / period;
    ema[period - 1] = prevEma;
    
    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      const currentEma = values[i] * k + prevEma * (1 - k);
      ema[i] = currentEma;
      prevEma = currentEma;
    }
    return ema;
  }

  function calculateRSI(values, period) {
    period = sanitizePeriod(period, 14);
    const rsi = new Array(values.length).fill(null);
    if (values.length <= period) return rsi;
    
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    
    if (avgLoss === 0) {
      rsi[period] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[period] = 100 - (100 / (1 + rs));
    }
    
    for (let i = period + 1; i < values.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
      
      if (avgLoss === 0) {
        rsi[i] = 100;
      } else {
        const rs = avgGain / avgLoss;
        rsi[i] = 100 - (100 / (1 + rs));
      }
    }
    return rsi;
  }

  function calculateBollingerBands(values, period, stdDevMult = 2) {
    period = sanitizePeriod(period, 20);
    const bands = new Array(values.length).fill(null);
    if (values.length < period) return bands;
    
    const sma = calculateSMA(values, period);
    
    for (let i = period - 1; i < values.length; i++) {
      const avg = sma[i];
      let varianceSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        varianceSum += Math.pow(values[j] - avg, 2);
      }
      const stdDev = Math.sqrt(varianceSum / period);
      
      bands[i] = {
        middle: avg,
        upper: avg + stdDevMult * stdDev,
        lower: avg - stdDevMult * stdDev
      };
    }
    return bands;
  }

  function calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    fastPeriod = sanitizePeriod(fastPeriod, 12);
    slowPeriod = sanitizePeriod(slowPeriod, 26);
    signalPeriod = sanitizePeriod(signalPeriod, 9);
    
    const macdResult = new Array(values.length).fill(null);
    if (values.length < slowPeriod) return macdResult;
    
    const fastEma = calculateEMA(values, fastPeriod);
    const slowEma = calculateEMA(values, slowPeriod);
    
    const macdLines = [];
    for (let i = 0; i < values.length; i++) {
      if (fastEma[i] === null || slowEma[i] === null) {
        macdLines.push(null);
      } else {
        macdLines.push(fastEma[i] - slowEma[i]);
      }
    }
    
    const validStartIdx = macdLines.findIndex(x => x !== null);
    const validMacdValues = macdLines.slice(validStartIdx);
    
    const signalEmaValid = calculateEMA(validMacdValues, signalPeriod);
    const signalEma = new Array(validStartIdx).fill(null).concat(signalEmaValid);
    
    for (let i = 0; i < values.length; i++) {
      if (macdLines[i] === null || signalEma[i] === null) {
        macdResult[i] = null;
      } else {
        macdResult[i] = {
          macd: macdLines[i],
          signal: signalEma[i],
          hist: macdLines[i] - signalEma[i]
        };
      }
    }
    
    return macdResult;
  }

  function calculateATR(candles, period) {
    period = sanitizePeriod(period, 14);
    const atr = new Array(candles.length).fill(null);
    if (candles.length <= period) return atr;
    
    const trueRanges = [candles[0].high - candles[0].low];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prevC = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevC.close),
        Math.abs(c.low - prevC.close)
      );
      trueRanges.push(tr);
    }
    
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += trueRanges[i];
    }
    let prevAtr = sum / period;
    atr[period - 1] = prevAtr;
    
    for (let i = period; i < candles.length; i++) {
      const currentAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
      atr[i] = currentAtr;
      prevAtr = currentAtr;
    }
    return atr;
  }

  function calculateADX(candles, period = 14) {
    period = sanitizePeriod(period, 14);
    const adx = new Array(candles.length).fill(null);
    if (candles.length <= period * 2) return adx;

    const tr = new Array(candles.length).fill(0);
    const plusDM = new Array(candles.length).fill(0);
    const minusDM = new Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      const upMove = c.high - prev.high;
      const downMove = prev.low - c.low;

      tr[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );

      plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
      minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    }

    let smoothTR = 0;
    let smoothPlusDM = 0;
    let smoothMinusDM = 0;

    for (let i = 1; i <= period; i++) {
      smoothTR += tr[i];
      smoothPlusDM += plusDM[i];
      smoothMinusDM += minusDM[i];
    }

    const dx = new Array(candles.length).fill(null);

    let plusDI = smoothTR > 0 ? (100 * smoothPlusDM / smoothTR) : 0;
    let minusDI = smoothTR > 0 ? (100 * smoothMinusDM / smoothTR) : 0;
    dx[period] = (plusDI + minusDI === 0) ? 0 : (100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI));

    for (let i = period + 1; i < candles.length; i++) {
      smoothTR = smoothTR - (smoothTR / period) + tr[i];
      smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
      smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

      plusDI = smoothTR > 0 ? (100 * smoothPlusDM / smoothTR) : 0;
      minusDI = smoothTR > 0 ? (100 * smoothMinusDM / smoothTR) : 0;
      dx[i] = (plusDI + minusDI === 0) ? 0 : (100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI));
    }

    let dxSum = 0;
    for (let i = period; i < period * 2; i++) {
      dxSum += dx[i];
    }
    let prevAdx = dxSum / period;
    adx[period * 2 - 1] = prevAdx;

    for (let i = period * 2; i < candles.length; i++) {
      const currentAdx = (prevAdx * (period - 1) + dx[i]) / period;
      adx[i] = currentAdx;
      prevAdx = currentAdx;
    }

    return adx;
  }

  // ==========================================
  // SMART MONEY CONCEPTS (SMC) ENGINE
  // ==========================================
  
  /**
   * Calculates Swings, BOS, CHoCH, and QML levels dynamically.
   * Real-time tracking without lookahead bias.
   * @param {Array<Object>} candles 
   * @param {number} strength Period window on left/right (default: 2)
   * @returns {Array<Object>} SMC values per candle
   */
  function calculateSMC(candles, strength = 2) {
    strength = sanitizePeriod(strength, 2);
    const smc = new Array(candles.length);
    
    // Confirmed Swings arrays (historical index and price level)
    let swingHighs = []; // [{ index, price }]
    let swingLows = [];  // [{ index, price }]
    
    let currentTrend = 'BULLISH'; // BULLISH or BEARISH
    let lastSwingHigh = null;     // Last confirmed swing high { index, price }
    let lastSwingLow = null;      // Last confirmed swing low { index, price }
    
    // Track preceding swings for Quasimodo setups
    let prevSwingHigh = null;     
    let prevSwingLow = null;
    
    for (let i = 0; i < candles.length; i++) {
      smc[i] = {
        swingHigh: null,
        swingLow: null,
        trend: currentTrend,
        bos: null,
        choch: null,
        qml: null
      };
      
      if (i < strength * 2) continue;
      
      // 1. CHECK IF i - strength IS A SWING HIGH
      const targetIdxSH = i - strength;
      const targetHigh = candles[targetIdxSH].high;
      let isSH = true;
      for (let j = targetIdxSH - strength; j <= targetIdxSH + strength; j++) {
        if (j !== targetIdxSH && candles[j].high >= targetHigh) {
          isSH = false;
          break;
        }
      }
      
      if (isSH) {
        // Confirmed Swing High
        prevSwingHigh = lastSwingHigh;
        lastSwingHigh = { index: targetIdxSH, price: targetHigh };
        swingHighs.push(lastSwingHigh);
        smc[i].swingHigh = targetHigh;
      }
      
      // 2. CHECK IF i - strength IS A SWING LOW
      const targetIdxSL = i - strength;
      const targetLow = candles[targetIdxSL].low;
      let isSL = true;
      for (let j = targetIdxSL - strength; j <= targetIdxSL + strength; j++) {
        if (j !== targetIdxSL && candles[j].low <= targetLow) {
          isSL = false;
          break;
        }
      }
      
      if (isSL) {
        // Confirmed Swing Low
        prevSwingLow = lastSwingLow;
        lastSwingLow = { index: targetIdxSL, price: targetLow };
        swingLows.push(lastSwingLow);
        smc[i].swingLow = targetLow;
      }
      
      // 3. DETECT BOS & CHOCH (Breakouts by Candle Close)
      const close = candles[i].close;
      
      // A. Bullish Breakout
      if (lastSwingHigh && close > lastSwingHigh.price) {
        if (currentTrend === 'BULLISH') {
          // BOS (Break of Structure) - Continuation
          smc[i].bos = { type: 'BULLISH', level: lastSwingHigh.price };
        } else {
          // CHoCH (Change of Character) - Reversal
          currentTrend = 'BULLISH';
          smc[i].choch = { type: 'BULLISH', level: lastSwingHigh.price };
          
          // Register Bullish Quasimodo level (L -> H -> LL -> HH)
          // If we had a recent Lower Low (LL) before breaking the high, 
          // the level is at the previous swing low (L)
          if (prevSwingLow && lastSwingLow && lastSwingLow.price < prevSwingLow.price) {
            smc[i].qml = {
              type: 'BULLISH',
              level: prevSwingLow.price, // Quasimodo Entry Level (L)
              stop: lastSwingLow.price,    // Stop Loss at LL
              target: candles[i].high      // Take Profit at HH
            };
          }
        }
        // Invalidate swing high since it was broken
        lastSwingHigh = null;
      }
      
      // B. Bearish Breakout
      else if (lastSwingLow && close < lastSwingLow.price) {
        if (currentTrend === 'BEARISH') {
          // BOS - Continuation
          smc[i].bos = { type: 'BEARISH', level: lastSwingLow.price };
        } else {
          // CHoCH - Reversal
          currentTrend = 'BEARISH';
          smc[i].choch = { type: 'BEARISH', level: lastSwingLow.price };
          
          // Register Bearish Quasimodo level (H -> L -> HH -> LL)
          // If we had a Higher High (HH) before breaking the low,
          // the level is at the previous swing high (H)
          if (prevSwingHigh && lastSwingHigh && lastSwingHigh.price > prevSwingHigh.price) {
            smc[i].qml = {
              type: 'BEARISH',
              level: prevSwingHigh.price, // Quasimodo Entry Level (H)
              stop: lastSwingHigh.price,   // Stop Loss at HH
              target: candles[i].low       // Take Profit at LL
            };
          }
        }
        // Invalidate swing low since it was broken
        lastSwingLow = null;
      }
      
      smc[i].trend = currentTrend;
    }
    
    return smc;
  }

  // ==========================================
  // BACKTESTING SIMULATION ENGINE
  // ==========================================

  function runBacktest(candles, strategy, params) {
    if (!candles || !Array.isArray(candles) || candles.length < 50) {
      throw new Error("Недостаточно исторических котировок для запуска симуляции бэктеста. Необходимо как минимум 50 свечей!");
    }
    
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c || isNaN(c.open) || isNaN(c.high) || isNaN(c.low) || isNaN(c.close)) {
        throw new Error(`В историческом датасете на свече #${i} обнаружены некорректные или пустые значения цены!`);
      }
    }

    const initialBalance = params.initialBalance || 10000;
    const leverage = params.leverage || 1;
    const feeRate = (params.feePercent || 0.05) / 100;
    const slippageRate = (params.slippagePercent || 0.02) / 100;
    
    const fixedStopLoss = (params.stopLossPercent || 0) / 100;
    const fixedTakeProfit = (params.takeProfitPercent || 0) / 100;
    
    let balance = initialBalance;
    let equity = initialBalance;
    
    const trades = [];
    let currentPosition = null; 
    const equityCurve = [];
    
    const closes = candles.map(c => c.close);
    const indicators = {};
    if (strategy.indicators) {
      strategy.indicators.forEach(ind => {
        if (ind.type === 'SMA') {
          indicators[ind.name] = calculateSMA(closes, ind.period);
        } else if (ind.type === 'EMA') {
          indicators[ind.name] = calculateEMA(closes, ind.period);
        } else if (ind.type === 'RSI') {
          indicators[ind.name] = calculateRSI(closes, ind.period);
        } else if (ind.type === 'BB') {
          indicators[ind.name] = calculateBollingerBands(closes, ind.period, ind.stdDev || 2);
        } else if (ind.type === 'MACD') {
          indicators[ind.name] = calculateMACD(closes, ind.fast || 12, ind.slow || 26, ind.signal || 9);
        } else if (ind.type === 'ATR') {
          indicators[ind.name] = calculateATR(candles, ind.period);
        } else if (ind.type === 'SMC') {
          indicators[ind.name] = calculateSMC(candles, ind.period || 2);
        }
      });
    }
    
    // Always compute ATR & ADX/EMA-50 for dynamic sizing & regimes
    const atrValues = calculateATR(candles, 14);
    const adxRegime = calculateADX(candles, 14);
    const emaRegime = calculateEMA(closes, 50);
    const marketRegimes = [];
    
    for (let j = 0; j < candles.length; j++) {
      let regime = 'RANGING';
      const adxVal = adxRegime[j];
      const emaVal = emaRegime[j];
      if (adxVal !== null && emaVal !== null) {
        if (adxVal > 22) {
          regime = candles[j].close > emaVal ? 'BULLISH_TREND' : 'BEARISH_TREND';
        }
      }
      marketRegimes.push(regime);
    }
    
    const strategyState = strategy.init ? strategy.init() : {};
    
    let startIdx = 1;
    if (strategy.indicators) {
      strategy.indicators.forEach(ind => {
        const period = ind.period || ind.slow || 26;
        if (period > startIdx) startIdx = period;
      });
    }
    startIdx = Math.min(startIdx + 10, candles.length - 1);
    if (startIdx >= candles.length) startIdx = 1; 
    
    const dailyReturns = [];
    let lastDayBalance = initialBalance;
    
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      
      if (currentPosition) {
        const priceDiff = c.close - currentPosition.entryPrice;
        let pnl = 0;
        if (currentPosition.type === 'LONG') {
          pnl = priceDiff * currentPosition.size;
        } else {
          pnl = -priceDiff * currentPosition.size;
        }
        equity = balance + pnl;
      } else {
        equity = balance;
      }
      
      equityCurve.push({
        time: c.time,
        value: equity,
        balance: balance
      });
      
      const candleReturn = (equity - lastDayBalance) / lastDayBalance;
      dailyReturns.push(candleReturn);
      lastDayBalance = equity;
      
      if (i < startIdx) continue;
      
      // Update Trailing Stop Loss
      if (currentPosition && params.trailingSL === true) {
        const atrVal = atrValues[i] || (c.high - c.low);
        const dist = Math.max(currentPosition.entryPrice * 0.001, fixedStopLoss > 0 ? (currentPosition.entryPrice * fixedStopLoss) : (atrVal * 2));
        if (currentPosition.type === 'LONG') {
          const newSL = c.close - dist;
          if (currentPosition.slPrice === 0 || newSL > currentPosition.slPrice) {
            currentPosition.slPrice = newSL;
          }
        } else {
          const newSL = c.close + dist;
          if (currentPosition.slPrice === 0 || newSL < currentPosition.slPrice) {
            currentPosition.slPrice = newSL;
          }
        }
      }
      
      // Проверка выходов из сделки (Stop Loss, Take Profit, Ликвидация)
      if (currentPosition) {
        let exitTriggered = false;
        let exitPrice = c.close;
        let exitReason = 'STRATEGY';
        
        if (currentPosition.slPrice > 0) {
          if (currentPosition.type === 'LONG' && c.low <= currentPosition.slPrice) {
            exitTriggered = true;
            exitPrice = currentPosition.slPrice;
            exitReason = 'STOP_LOSS';
          } else if (currentPosition.type === 'SHORT' && c.high >= currentPosition.slPrice) {
            exitTriggered = true;
            exitPrice = currentPosition.slPrice;
            exitReason = 'STOP_LOSS';
          }
        }
        
        if (!exitTriggered && currentPosition.tpPrice > 0) {
          if (currentPosition.type === 'LONG' && c.high >= currentPosition.tpPrice) {
            exitTriggered = true;
            exitPrice = currentPosition.tpPrice;
            exitReason = 'TAKE_PROFIT';
          } else if (currentPosition.type === 'SHORT' && c.low <= currentPosition.tpPrice) {
            exitTriggered = true;
            exitPrice = currentPosition.tpPrice;
            exitReason = 'TAKE_PROFIT';
          }
        }
        
        if (!exitTriggered && leverage > 1) {
          const maintenanceMargin = 0.01; 
          if (currentPosition.type === 'LONG') {
            const liqPrice = currentPosition.entryPrice * (1 - (1 / leverage) + maintenanceMargin);
            if (c.low <= liqPrice) {
              exitTriggered = true;
              exitPrice = liqPrice;
              exitReason = 'LIQUIDATION';
            }
          } else {
            const liqPrice = currentPosition.entryPrice * (1 + (1 / leverage) - maintenanceMargin);
            if (c.high >= liqPrice) {
              exitTriggered = true;
              exitPrice = liqPrice;
              exitReason = 'LIQUIDATION';
            }
          }
        }
        
        if (!exitTriggered) {
          const strategySignal = strategy.onCandle(candles, i, indicators, strategyState, currentPosition);
          
          if (params.pyramiding === true && 
              ((currentPosition.type === 'LONG' && strategySignal === 'BUY') ||
               (currentPosition.type === 'SHORT' && strategySignal === 'SELL'))) {
            // Pyramiding scale-in!
            currentPosition.pyramidingCount = currentPosition.pyramidingCount || 1;
            if (currentPosition.pyramidingCount < 3) {
              const extraSize = (balance * 0.3 * leverage) / c.close;
              const slip = currentPosition.type === 'LONG' ? slippageRate : -slippageRate;
              const extraEntryPrice = c.close * (1 + slip);
              const totalSize = currentPosition.size + extraSize;
              
              currentPosition.entryPrice = (currentPosition.entryPrice * currentPosition.size + extraEntryPrice * extraSize) / totalSize;
              currentPosition.size = totalSize;
              currentPosition.entryFee += extraSize * extraEntryPrice * feeRate;
              currentPosition.pyramidingCount++;
            }
          } else if (
            (currentPosition.type === 'LONG' && strategySignal === 'SELL') ||
            (currentPosition.type === 'SHORT' && strategySignal === 'BUY') ||
            strategySignal === 'EXIT'
          ) {
            exitTriggered = true;
            exitPrice = currentPosition.type === 'LONG' ? c.close * (1 - slippageRate) : c.close * (1 + slippageRate);
            exitReason = 'STRATEGY';
          }
        }
        
        if (exitTriggered) {
          const exitFee = exitPrice * currentPosition.size * feeRate;
          const grossPnl = currentPosition.type === 'LONG' 
            ? (exitPrice - currentPosition.entryPrice) * currentPosition.size
            : (currentPosition.entryPrice - exitPrice) * currentPosition.size;
          
          const netPnl = grossPnl - (currentPosition.entryFee + exitFee);
          balance += netPnl;
          equity = balance;
          
          trades.push({
            id: trades.length + 1,
            type: currentPosition.type,
            entryTime: currentPosition.entryTime,
            exitTime: c.time,
            entryPrice: currentPosition.entryPrice,
            exitPrice: exitPrice,
            fees: currentPosition.entryFee + exitFee,
            grossPnl: grossPnl,
            pnl: netPnl,
            pnlPercent: (netPnl / currentPosition.investedBalance) * 100,
            exitReason: exitReason,
            balance: balance,
            entryIndex: currentPosition.entryIndex,
            exitIndex: i
          });
          
          currentPosition = null;
        }
      }
      
      // Поиск входов в сделку
      else {
        const strategySignal = strategy.onCandle(candles, i, indicators, strategyState, null);
        
        if (strategySignal === 'BUY' || strategySignal === 'SELL') {
          const type = strategySignal === 'BUY' ? 'LONG' : 'SHORT';
          const entryPrice = type === 'LONG' ? c.close * (1 + slippageRate) : c.close * (1 - slippageRate);
          
          let size = 0;
          let entryFee = 0;
          let allocatedBalance = balance * 0.95;
          
          let slPrice = 0;
          let tpPrice = 0;
          
          // ATR Risk Sizing Model
          if (params.positionSizing === 'risk_atr') {
            const atrVal = atrValues[i] || (c.high - c.low);
            const riskPercent = params.riskPercent || 2;
            const riskAmount = balance * (riskPercent / 100);
            const stopLossDistance = Math.max(entryPrice * 0.001, atrVal * 2);
            
            slPrice = type === 'LONG' ? entryPrice - stopLossDistance : entryPrice + stopLossDistance;
            tpPrice = type === 'LONG' ? entryPrice + stopLossDistance * 2 : entryPrice - stopLossDistance * 2;
            
            size = riskAmount / stopLossDistance;
            const maxSize = (balance * 0.95 * leverage) / entryPrice;
            if (size > maxSize) size = maxSize;
            
            allocatedBalance = (size * entryPrice) / leverage;
            entryFee = size * entryPrice * feeRate;
          } else {
            // Fixed Sizing
            const positionValue = allocatedBalance * leverage;
            size = positionValue / entryPrice;
            entryFee = positionValue * feeRate;
            
            if (strategyState.entrySL > 0) {
              slPrice = strategyState.entrySL;
            } else if (fixedStopLoss > 0) {
              slPrice = type === 'LONG' ? entryPrice * (1 - fixedStopLoss) : entryPrice * (1 + fixedStopLoss);
            }
            
            if (strategyState.entryTP > 0) {
              tpPrice = strategyState.entryTP;
            } else if (fixedTakeProfit > 0) {
              tpPrice = type === 'LONG' ? entryPrice * (1 + fixedTakeProfit) : entryPrice * (1 - fixedTakeProfit);
            }
          }
          
          if (strategyState.dynamicSL && indicators.atr && indicators.atr[i]) {
            const atrVal = indicators.atr[i];
            slPrice = type === 'LONG' ? entryPrice - (atrVal * 2) : entryPrice + (atrVal * 2);
            tpPrice = type === 'LONG' ? entryPrice + (atrVal * 4) : entryPrice - (atrVal * 4);
          }
          
          currentPosition = {
            type: type,
            entryPrice: entryPrice,
            size: size,
            entryFee: entryFee,
            entryIndex: i,
            entryTime: c.time,
            slPrice: slPrice,
            tpPrice: tpPrice,
            investedBalance: allocatedBalance,
            pyramidingCount: 1
          };
        }
      }
    }
    
    if (currentPosition) {
      const finalCandle = candles[candles.length - 1];
      const exitPrice = finalCandle.close;
      const exitFee = exitPrice * currentPosition.size * feeRate;
      const grossPnl = currentPosition.type === 'LONG' 
        ? (exitPrice - currentPosition.entryPrice) * currentPosition.size
        : (currentPosition.entryPrice - exitPrice) * currentPosition.size;
      const netPnl = grossPnl - (currentPosition.entryFee + exitFee);
      balance += netPnl;
      equity = balance;
      
      trades.push({
        id: trades.length + 1,
        type: currentPosition.type,
        entryTime: currentPosition.entryTime,
        exitTime: finalCandle.time,
        entryPrice: currentPosition.entryPrice,
        exitPrice: exitPrice,
        fees: currentPosition.entryFee + exitFee,
        grossPnl: grossPnl,
        pnl: netPnl,
        pnlPercent: (netPnl / currentPosition.investedBalance) * 100,
        exitReason: 'FORCE_CLOSE',
        balance: balance,
        entryIndex: currentPosition.entryIndex,
        exitIndex: candles.length - 1
      });
    }

    // ==========================================
    // РАСЧЕТ РЕЗУЛЬТИРУЮЩЕЙ СТАТИСТИКИ
    // ==========================================
    
    let totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winningTradesCount = wins.length;
    const losingTradesCount = losses.length;
    let winRate = totalTrades > 0 ? (winningTradesCount / totalTrades) * 100 : 0;
    
    const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
    let profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    const avgWin = winningTradesCount > 0 ? grossProfit / winningTradesCount : 0;
    const avgLoss = losingTradesCount > 0 ? grossLoss / losingTradesCount : 0;
    let profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    let maxDrawdown = 0;
    let peak = initialBalance;
    equityCurve.forEach(p => {
      if (p.value > peak) peak = p.value;
      const dd = ((peak - p.value) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    });
    
    let sharpeRatio = 0;
    let sortinoRatio = 0;
    
    const validReturns = dailyReturns.filter(r => !isNaN(r) && isFinite(r));
    if (validReturns.length > 5) {
      const avgReturn = validReturns.reduce((acc, r) => acc + r, 0) / validReturns.length;
      const variance = validReturns.reduce((acc, r) => acc + Math.pow(r - avgReturn, 2), 0) / validReturns.length;
      const stdDev = Math.sqrt(variance);
      
      const negativeReturns = validReturns.filter(r => r < 0);
      const downsideVariance = negativeReturns.reduce((acc, r) => acc + Math.pow(r, 2), 0) / validReturns.length;
      const downsideStdDev = Math.sqrt(downsideVariance);
      
      const annualizer = Math.sqrt(252); 
      
      if (stdDev > 0) sharpeRatio = (avgReturn / stdDev) * annualizer;
      if (downsideStdDev > 0) sortinoRatio = (avgReturn / downsideStdDev) * annualizer;
    }
    
    const regimeStats = {
      BULLISH_TREND: { count: 0, pnl: 0, wins: 0, total: 0, pct: 0 },
      BEARISH_TREND: { count: 0, pnl: 0, wins: 0, total: 0, pct: 0 },
      RANGING: { count: 0, pnl: 0, wins: 0, total: 0, pct: 0 }
    };

    trades.forEach(t => {
      const entryIdx = t.entryIndex !== undefined ? t.entryIndex : 0;
      const regime = marketRegimes[entryIdx] || 'RANGING';
      t.entryRegime = regime;
      
      if (regimeStats[regime]) {
        regimeStats[regime].total++;
        regimeStats[regime].pnl += t.pnl;
        if (t.pnl > 0) {
          regimeStats[regime].wins++;
        }
      }
    });

    let bullishCount = 0, bearishCount = 0, rangingCount = 0;
    marketRegimes.forEach(r => {
      if (r === 'BULLISH_TREND') bullishCount++;
      else if (r === 'BEARISH_TREND') bearishCount++;
      else rangingCount++;
    });
    
    if (marketRegimes.length > 0) {
      regimeStats.BULLISH_TREND.pct = (bullishCount / marketRegimes.length) * 100;
      regimeStats.BEARISH_TREND.pct = (bearishCount / marketRegimes.length) * 100;
      regimeStats.RANGING.pct = (rangingCount / marketRegimes.length) * 100;
    }

    let expectedValue = totalTrades > 0 ? trades.reduce((acc, t) => acc + t.pnl, 0) / totalTrades : 0;

    // Симуляция Монте-Карло (1000 итераций)
    function runMonteCarlo(tradesList, initBal, iterations = 1000) {
      if (!tradesList || tradesList.length === 0) {
        return { probabilityOfRuin: 0, medianMaxDrawdown: 0, worstDrawdown: 0 };
      }
      
      const ruinThreshold = initBal * 0.1; // Порог разорения: 10% от стартового баланса
      let ruinCount = 0;
      const dds = [];
      
      for (let iter = 0; iter < iterations; iter++) {
        let simBalance = initBal;
        let peak = initBal;
        let simMaxDD = 0;
        let hitRuin = false;
        
        for (let t = 0; t < tradesList.length; t++) {
          const randIndex = Math.floor(Math.random() * tradesList.length);
          const randTrade = tradesList[randIndex];
          simBalance += randTrade.pnl;
          
          if (simBalance <= ruinThreshold) {
            hitRuin = true;
          }
          if (simBalance > peak) peak = simBalance;
          const dd = ((peak - simBalance) / peak) * 100;
          if (dd > simMaxDD) simMaxDD = dd;
        }
        
        if (hitRuin) ruinCount++;
        dds.push(simMaxDD);
      }
      
      dds.sort((a, b) => a - b);
      const medianMaxDrawdown = dds[Math.floor(iterations / 2)];
      const worstDrawdown = dds[dds.length - 1];
      const probabilityOfRuin = (ruinCount / iterations) * 100;
      
      return {
        probabilityOfRuin: isNaN(probabilityOfRuin) ? 0 : probabilityOfRuin,
        medianMaxDrawdown: isNaN(medianMaxDrawdown) ? 0 : medianMaxDrawdown,
        worstDrawdown: isNaN(worstDrawdown) ? 0 : worstDrawdown
      };
    }

    const monteCarlo = runMonteCarlo(trades, initialBalance);

    // Paranoid mathematical validation to block NaN/Infinity from propagating to app.js
    if (isNaN(totalReturn) || !isFinite(totalReturn)) totalReturn = 0;
    if (isNaN(winRate) || !isFinite(winRate)) winRate = 0;
    if (isNaN(profitFactor) || !isFinite(profitFactor)) profitFactor = profitFactor > 0 ? 999 : 0;
    if (isNaN(profitLossRatio) || !isFinite(profitLossRatio)) profitLossRatio = 0;
    if (isNaN(maxDrawdown) || !isFinite(maxDrawdown) || maxDrawdown < 0) maxDrawdown = 0;
    if (maxDrawdown > 100) maxDrawdown = 100;
    if (isNaN(sharpeRatio) || !isFinite(sharpeRatio)) sharpeRatio = 0;
    if (isNaN(sortinoRatio) || !isFinite(sortinoRatio)) sortinoRatio = 0;
    if (isNaN(expectedValue) || !isFinite(expectedValue)) expectedValue = 0;

    return {
      initialBalance: initialBalance,
      finalBalance: balance,
      totalReturn: totalReturn,
      totalTrades: totalTrades,
      winRate: winRate,
      winningTrades: winningTradesCount,
      losingTrades: losingTradesCount,
      grossProfit: grossProfit,
      grossLoss: grossLoss,
      profitFactor: profitFactor,
      profitLossRatio: profitLossRatio,
      maxDrawdown: maxDrawdown,
      sharpeRatio: sharpeRatio,
      sortinoRatio: sortinoRatio,
      expectedValue: expectedValue,
      monteCarlo: monteCarlo,
      trades: trades,
      equityCurve: equityCurve,
      indicators: indicators,
      marketRegimes: marketRegimes,
      regimeStats: regimeStats
    };
  }

  return {
    runBacktest: runBacktest,
    SMA: calculateSMA,
    EMA: calculateEMA,
    RSI: calculateRSI,
    BB: calculateBollingerBands,
    MACD: calculateMACD,
    ATR: calculateATR,
    SMC: calculateSMC
  };
})();
