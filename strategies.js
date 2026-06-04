/**
 * Strategy Backtester & Chart Analyzer - Strategy Definitions & Custom Script Runner
 * Pure ES6 JavaScript. Includes pre-defined professional templates and a secure custom JS code compiler.
 * Fully localized to Russian. Supports Smart Money Concepts (SMC).
 */

const globStrategies = typeof window !== 'undefined' ? window : self;
globStrategies.StrategyRegistry = (function () {
  
  // ==========================================
  // ПРЕДУСТАНОВЛЕННЫЕ ШАБЛОНЫ СТРАТЕГИЙ
  // ==========================================
  
  const strategies = {
    // 1. Стратегия пересечения EMA
    ema_crossover: {
      id: 'ema_crossover',
      name: 'Пересечение EMA',
      description: 'Классический трендовый шаблон. Покупает (LONG), когда быстрая экспоненциальная скользящая средняя (EMA) пересекает медленную снизу вверх, и продает (SHORT/выходит), когда пересекает сверху вниз.',
      parameters: [
        { name: 'fastPeriod', label: 'Период быстрой EMA', type: 'number', default: 9, min: 2, max: 100 },
        { name: 'slowPeriod', label: 'Период медленной EMA', type: 'number', default: 21, min: 5, max: 300 }
      ],
      indicators: [
        { name: 'emaFast', type: 'EMA', period: 9 },
        { name: 'emaSlow', type: 'EMA', period: 21 }
      ],
      init: function() {
        return { prevTrend: 0 }; 
      },
      onCandle: function (candles, index, indicators, state, position) {
        const emaFast = indicators.emaFast[index];
        const emaSlow = indicators.emaSlow[index];
        
        if (emaFast === null || emaSlow === null) return 'HOLD';
        
        const currentTrend = emaFast > emaSlow ? 1 : -1;
        const trendChanged = state.prevTrend !== 0 && state.prevTrend !== currentTrend;
        state.prevTrend = currentTrend;
        
        if (trendChanged) {
          return currentTrend === 1 ? 'BUY' : 'SELL';
        }
        
        return 'HOLD';
      }
    },
    
    // 2. Возврат к среднему по RSI
    rsi_reversion: {
      id: 'rsi_reversion',
      name: 'Возврат к среднему по RSI',
      description: 'Контртрендовая стратегия на зонах перекупленности и перепроданности. Покупает (LONG) при выходе RSI из зоны перепроданности снизу вверх (выше 30) и продает (SHORT) при выходе из зоны перекупленности сверху вниз (ниже 70).',
      parameters: [
        { name: 'rsiPeriod', label: 'Период RSI', type: 'number', default: 14, min: 2, max: 50 },
        { name: 'oversold', label: 'Уровень перепроданности', type: 'number', default: 30, min: 5, max: 50 },
        { name: 'overbought', label: 'Уровень перекупленности', type: 'number', default: 70, min: 50, max: 95 }
      ],
      indicators: [
        { name: 'rsi', type: 'RSI', period: 14 }
      ],
      init: function() {
        return { wasOversold: false, wasOverbought: false };
      },
      onCandle: function (candles, index, indicators, state, position) {
        const rsiVal = indicators.rsi[index];
        const prevRsiVal = indicators.rsi[index - 1];
        
        if (rsiVal === null || prevRsiVal === null) return 'HOLD';
        
        const oversold = (this.activeParams && this.activeParams.oversold) || 30; 
        const overbought = (this.activeParams && this.activeParams.overbought) || 70;
        
        if (prevRsiVal < oversold && rsiVal >= oversold) {
          return 'BUY';
        }
        
        if (prevRsiVal > overbought && rsiVal <= overbought) {
          return 'SELL';
        }
        
        return 'HOLD';
      }
    },
    
    // 3. Возврат к каналу полос Боллинджера
    bb_reversion: {
      id: 'bb_reversion',
      name: 'Полосы Боллинджера (BB)',
      description: 'Покупает (LONG) при снижении цены ниже нижней полосы Боллинджера и возврате внутрь канала. Открывает SHORT при пробитии верхней полосы и возврате. Фиксирует прибыль на средней линии SMA.',
      parameters: [
        { name: 'bbPeriod', label: 'Период Bollinger (BB)', type: 'number', default: 20, min: 5, max: 100 },
        { name: 'stdDev', label: 'Мультипликатор отклонения', type: 'number', default: 2, min: 1, max: 5 }
      ],
      indicators: [
        { name: 'bb', type: 'BB', period: 20, stdDev: 2 }
      ],
      init: function() {
        return {};
      },
      onCandle: function (candles, index, indicators, state, position) {
        const bb = indicators.bb[index];
        const prevBb = indicators.bb[index - 1];
        const close = candles[index].close;
        const prevClose = candles[index - 1].close;
        
        if (!bb || !prevBb) return 'HOLD';
        
        if (!position) {
          if (prevClose < prevBb.lower && close >= bb.lower) {
            return 'BUY';
          }
          if (prevClose > prevBb.upper && close <= bb.upper) {
            return 'SELL';
          }
        } else {
          if (position.type === 'LONG' && close >= bb.middle) {
            return 'EXIT';
          }
          if (position.type === 'SHORT' && close <= bb.middle) {
            return 'EXIT';
          }
        }
        
        return 'HOLD';
      }
    },
    
    // 4. Пересечение линий MACD
    macd_crossover: {
      id: 'macd_crossover',
      name: 'Пересечение MACD',
      description: 'Покупает (LONG), когда линия MACD пересекает сигнальную линию снизу вверх ниже нулевого уровня (сигнал на разворот вверх). Открывает SHORT, когда MACD пересекает сигнальную линию сверху вниз выше нулевой отметки.',
      parameters: [
        { name: 'fastPeriod', label: 'Быстрый период EMA', type: 'number', default: 12, min: 5, max: 50 },
        { name: 'slowPeriod', label: 'Медленный период EMA', type: 'number', default: 26, min: 10, max: 100 },
        { name: 'signalPeriod', label: 'Период сигнальной линии', type: 'number', default: 9, min: 2, max: 30 }
      ],
      indicators: [
        { name: 'macd', type: 'MACD', fast: 12, slow: 26, signal: 9 }
      ],
      init: function() {
        return {};
      },
      onCandle: function (candles, index, indicators, state, position) {
        const macd = indicators.macd[index];
        const prevMacd = indicators.macd[index - 1];
        
        if (!macd || !prevMacd) return 'HOLD';
        
        const macdCrossedUp = prevMacd.macd < prevMacd.signal && macd.macd >= macd.signal;
        const macdCrossedDown = prevMacd.macd > prevMacd.signal && macd.macd <= macd.signal;
        
        if (macdCrossedUp && macd.macd < 0) {
          return 'BUY';
        }
        if (macdCrossedDown && macd.macd > 0) {
          return 'SELL';
        }
        
        return 'HOLD';
      }
    },

    // 5. Концепция Smart Money (SMC / ICT)
    smc_ict: {
      id: 'smc_ict',
      name: 'Концепция Smart Money (SMC/ICT)',
      description: 'Торговый робот Smart Money. Находит рыночные структуры (свинги), сломы тренда (CHoCH), подтверждения (BOS) и расставляет лимитные заявки на вход на Квазимодо-уровнях (QML) для торговли вместе с крупным капиталом.',
      parameters: [
        { name: 'fractalPeriod', label: 'Сила свингов (период фрактала)', type: 'number', default: 2, min: 2, max: 10 },
        { name: 'entryMode', label: 'Режим входа (1: CHoCH, 2: Квазимодо QML)', type: 'number', default: 2, min: 1, max: 2 }
      ],
      indicators: [
        { name: 'smc', type: 'SMC', period: 2 }
      ],
      init: function() {
        return {
          activeQML: null, // Хранит активный уровень Quasimodo { type, level, stop, target }
          entrySL: 0,
          entryTP: 0
        };
      },
      onCandle: function (candles, index, indicators, state, position) {
        const smc = indicators.smc[index];
        if (!smc) return 'HOLD';
        
        const mode = (this.activeParams && this.activeParams.entryMode) || 2;
        
        // 1. Проверяем новые сигналы структуры для регистрации QML уровней
        if (smc.qml) {
          state.activeQML = smc.qml;
        }
        
        if (position) {
          // Если мы уже в сделке, сбрасываем локальные параметры входа
          state.entrySL = 0;
          state.entryTP = 0;
          
          // Выходим при противоположном CHoCH
          if (position.type === 'LONG' && smc.choch && smc.choch.type === 'BEARISH') return 'EXIT';
          if (position.type === 'SHORT' && smc.choch && smc.choch.type === 'BULLISH') return 'EXIT';
          return 'HOLD';
        }
        
        // 2. РЕЖИМ 1: Вход по рынку сразу при возникновении CHoCH
        if (mode === 1) {
          if (smc.choch) {
            if (smc.choch.type === 'BULLISH') return 'BUY';
            if (smc.choch.type === 'BEARISH') return 'SELL';
          }
          return 'HOLD';
        }
        
        // 3. РЕЖИМ 2: Вход от Квазимодо-уровня (QML Лимит)
        if (state.activeQML) {
          const c = candles[index];
          const q = state.activeQML;
          
          // Проверяем инвалидацию паттерна (если цена ушла за стоп без активации ордера)
          if (q.type === 'BULLISH' && c.low < q.stop) {
            state.activeQML = null;
            return 'HOLD';
          }
          if (q.type === 'BEARISH' && c.high > q.stop) {
            state.activeQML = null;
            return 'HOLD';
          }
          
          // Проверяем активацию QML лимитного ордера касанием уровня
          if (q.type === 'BULLISH') {
            if (c.low <= q.level && c.high >= q.level) {
              // Активировано! Задаем точные стоп-лосс и тейк-профит в state для бэктестера
              state.entrySL = q.stop;
              state.entryTP = q.target;
              
              // Удаляем уровень, ордер исполнен
              state.activeQML = null;
              return 'BUY';
            }
          } else {
            if (c.high >= q.level && c.low <= q.level) {
              // Активировано!
              state.entrySL = q.stop;
              state.entryTP = q.target;
              
              state.activeQML = null;
              return 'SELL';
            }
          }
        }
        
        return 'HOLD';
      }
    }
  };

  // ==========================================
  // КОМПИЛЯТОР КАСТОМНОЙ СТРАТЕГИИ
  // ==========================================

  function compileCustomStrategy(codeString) {
    // Безопасная регулярная песочница (Regex sandbox) для предотвращения XSS и DoS зависаний
    const noComments = codeString
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');

    const blockedPatterns = [
      { regex: /\bwindow\b/i, name: 'window' },
      { regex: /\bdocument\b/i, name: 'document' },
      { regex: /\bcookie\b/i, name: 'cookie' },
      { regex: /\blocalStorage\b/i, name: 'localStorage' },
      { regex: /\bsessionStorage\b/i, name: 'sessionStorage' },
      { regex: /\bindexedDB\b/i, name: 'indexedDB' },
      { regex: /\bfetch\b/i, name: 'fetch' },
      { regex: /\bXMLHttpRequest\b/i, name: 'XMLHttpRequest' },
      { regex: /\bWebSocket\b/i, name: 'WebSocket' },
      { regex: /\beval\b/i, name: 'eval' },
      { regex: /\bFunction\b/i, name: 'Function' },
      { regex: /\bimport\b/i, name: 'import' },
      { regex: /\btop\b/i, name: 'top' },
      { regex: /\bparent\b/i, name: 'parent' },
      { regex: /\bopener\b/i, name: 'opener' },
      { regex: /\blocation\b/i, name: 'location' },
      { regex: /\bhistory\b/i, name: 'history' },
      // Защита от бесконечных циклов зависания вкладки (DoS)
      { regex: /\bwhile\s*\(\s*(true|1)\s*\)/i, name: 'while(true) бесконечный цикл' },
      { regex: /\bfor\s*\(\s*;\s*;\s*\)/i, name: 'for(;;) бесконечный цикл' },
      { regex: /\bdo\s*\{[\s\S]*?\}\s*while\s*\(\s*(true|1)\s*\)/i, name: 'do-while(true) бесконечный цикл' }
    ];

    for (const item of blockedPatterns) {
      if (item.regex.test(noComments)) {
        throw new Error(`[БЕЗОПАСНОСТЬ] Обнаружен запрещенный системный вызов или бесконечный цикл: "${item.name}". Выполнение кастомного кода заблокировано.`);
      }
    }

    try {
      const indicators = [];
      const lines = codeString.split('\n');
      
      lines.forEach(line => {
        const match = line.match(/\/\/\s*INDICATOR:\s*(\w+)\s*=\s*(\w+)\s*\(\s*([0-9.,\s]+)\s*\)/i);
        if (match) {
          const name = match[1];
          const type = match[2].toUpperCase();
          const params = match[3].split(',').map(p => parseFloat(p.trim()));
          
          if (type === 'SMA' || type === 'EMA' || type === 'RSI' || type === 'ATR') {
            indicators.push({ name, type, period: params[0] });
          } else if (type === 'BB') {
            indicators.push({ name, type, period: params[0], stdDev: params[1] || 2 });
          } else if (type === 'MACD') {
            indicators.push({ name, type, fast: params[0], slow: params[1] || 26, signal: params[2] || 9 });
          } else if (type === 'SMC') {
            indicators.push({ name, type, period: params[0] || 2 });
          }
        }
      });
      
      if (indicators.length === 0) {
        indicators.push({ name: 'emaFast', type: 'EMA', period: 9 });
        indicators.push({ name: 'emaSlow', type: 'EMA', period: 21 });
        indicators.push({ name: 'rsi', type: 'RSI', period: 14 });
      }
      
      const userBody = `
        try {
          const i = index;
          const c = candles[i];
          const prev = candles[i - 1];
          
          ${codeString}
          
        } catch(e) {
          console.error("Ошибка исполнения стратегии: " + e.message);
          return 'HOLD';
        }
        return 'HOLD';
      `;
      
      const compiledFunction = new Function('candles', 'index', 'indicators', 'state', 'position', userBody);
      
      return {
        id: 'custom_user_strategy',
        name: 'Пользовательская стратегия',
        description: 'Ваша скомпилированная JavaScript стратегия.',
        indicators: indicators,
        init: function() {
          return {};
        },
        onCandle: function (candles, index, indicators, state, position) {
          return compiledFunction(candles, index, indicators, state, position);
        }
      };
    } catch (err) {
      throw new Error("Ошибка компиляции: " + err.message);
    }
  }

  return {
    get: function (id) {
      return strategies[id] || null;
    },
    list: function () {
      return Object.values(strategies);
    },
    compileCustom: compileCustomStrategy
  };
})();
