/**
 * QuantSphere Web Worker for background backtesting and grid parameter optimization.
 * Prevents main thread UI blocking and enables smooth rendering.
 */

// Load math engine and strategy registry
importScripts('engine.js', 'strategies.js');

self.onmessage = function (e) {
  const { type, data } = e.data;

  try {
    if (type === 'RUN_BACKTEST') {
      const { candles, strategyId, userCode, riskParams } = data;
      
      let strategy;
      if (strategyId === 'custom') {
        strategy = self.StrategyRegistry.compileCustom(userCode);
      } else {
        const rawStrategy = self.StrategyRegistry.get(strategyId);
        if (!rawStrategy) throw new Error("Стратегия не найдена: " + strategyId);
        
        // Clone strategy
        strategy = { ...rawStrategy };
        
        // Dynamic overrides for pre-defined templates
        const overridenIndicators = [];
        if (strategyId === 'ema_crossover') {
          overridenIndicators.push({ name: 'emaFast', type: 'EMA', period: riskParams.fastPeriod || 9 });
          overridenIndicators.push({ name: 'emaSlow', type: 'EMA', period: riskParams.slowPeriod || 21 });
          strategy.indicators = overridenIndicators;
        } else if (strategyId === 'rsi_reversion') {
          overridenIndicators.push({ name: 'rsi', type: 'RSI', period: riskParams.rsiPeriod || 14 });
          strategy.indicators = overridenIndicators;
          strategy.onCandle = function (candles, index, indicators, state) {
            const rVal = indicators.rsi[index];
            const prevRVal = indicators.rsi[index - 1];
            if (rVal === null || prevRVal === null) return 'HOLD';
            if (prevRVal < riskParams.oversold && rVal >= riskParams.oversold) return 'BUY';
            if (prevRVal > riskParams.overbought && rVal <= riskParams.overbought) return 'SELL';
            return 'HOLD';
          };
        } else if (strategyId === 'bb_reversion') {
          overridenIndicators.push({ name: 'bb', type: 'BB', period: riskParams.bbPeriod || 20, stdDev: riskParams.stdDev || 2 });
          strategy.indicators = overridenIndicators;
        } else if (strategyId === 'macd_crossover') {
          overridenIndicators.push({ name: 'macd', type: 'MACD', fast: riskParams.fastPeriod || 12, slow: riskParams.slowPeriod || 26, signal: riskParams.signalPeriod || 9 });
          strategy.indicators = overridenIndicators;
        } else if (strategyId === 'smc_ict') {
          overridenIndicators.push({ name: 'smc', type: 'SMC', period: riskParams.fractalPeriod || 2 });
          strategy.indicators = overridenIndicators;
        }
      }

      const results = self.BacktestEngine.runBacktest(candles, strategy, riskParams);
      self.postMessage({ type: 'BACKTEST_SUCCESS', result: results });
    }
    
    else if (type === 'RUN_OPTIMIZATION') {
      const { candles, strategyId, targetMetric, baseRisk } = data;
      const activeStrategy = self.StrategyRegistry.get(strategyId);
      if (!activeStrategy) throw new Error("Стратегия не найдена: " + strategyId);

      const combos = [];
      if (strategyId === 'ema_crossover') {
        const fasts = [5, 7, 9, 11, 13];
        const slows = [15, 21, 25, 30, 35];
        fasts.forEach(f => {
          slows.forEach(s => {
            if (f < s) combos.push({ fastPeriod: f, slowPeriod: s });
          });
        });
      } else if (strategyId === 'rsi_reversion') {
        const periods = [10, 12, 14, 16];
        const oversolds = [20, 25, 30, 35];
        const overboughts = [65, 70, 75, 80];
        periods.forEach(p => {
          oversolds.forEach(os => {
            overboughts.forEach(ob => {
              combos.push({ rsiPeriod: p, oversold: os, overbought: ob });
            });
          });
        });
      } else if (strategyId === 'bb_reversion') {
        const periods = [14, 18, 20, 24];
        const stds = [1.5, 1.8, 2.0, 2.2];
        periods.forEach(p => {
          stds.forEach(s => {
            combos.push({ bbPeriod: p, stdDev: s });
          });
        });
      } else if (strategyId === 'macd_crossover') {
        const fasts = [8, 10, 12, 14];
        const slows = [20, 24, 26, 30];
        fasts.forEach(f => {
          slows.forEach(s => {
            if (f < s) combos.push({ fastPeriod: f, slowPeriod: s, signalPeriod: 9 });
          });
        });
      } else if (strategyId === 'smc_ict') {
        const periods = [2, 3, 4, 5];
        periods.forEach(p => {
          combos.push({ fractalPeriod: p });
        });
      }

      if (combos.length === 0) {
        throw new Error("Нет доступных параметров для оптимизации.");
      }

      const results = [];
      const totalCombos = combos.length;

      combos.forEach((combo, idx) => {
        // Report progress back periodically
        if (idx % Math.ceil(totalCombos / 10) === 0 || idx === totalCombos - 1) {
          self.postMessage({
            type: 'OPTIMIZATION_PROGRESS',
            progress: Math.round(((idx + 1) / totalCombos) * 100)
          });
        }

        const tempStrategy = { ...activeStrategy };
        const overridenIndicators = [];

        if (strategyId === 'ema_crossover') {
          overridenIndicators.push({ name: 'emaFast', type: 'EMA', period: combo.fastPeriod });
          overridenIndicators.push({ name: 'emaSlow', type: 'EMA', period: combo.slowPeriod });
          tempStrategy.indicators = overridenIndicators;
        } else if (strategyId === 'rsi_reversion') {
          overridenIndicators.push({ name: 'rsi', type: 'RSI', period: combo.rsiPeriod });
          tempStrategy.indicators = overridenIndicators;
          tempStrategy.onCandle = function (candles, index, indicators, state) {
            const rVal = indicators.rsi[index];
            const prevRVal = indicators.rsi[index - 1];
            if (rVal === null || prevRVal === null) return 'HOLD';
            if (prevRVal < combo.oversold && rVal >= combo.oversold) return 'BUY';
            if (prevRVal > combo.overbought && rVal <= combo.overbought) return 'SELL';
            return 'HOLD';
          };
        } else if (strategyId === 'bb_reversion') {
          overridenIndicators.push({ name: 'bb', type: 'BB', period: combo.bbPeriod, stdDev: combo.stdDev });
          tempStrategy.indicators = overridenIndicators;
        } else if (strategyId === 'macd_crossover') {
          overridenIndicators.push({ name: 'macd', type: 'MACD', fast: combo.fastPeriod, slow: combo.slowPeriod, signal: combo.signalPeriod });
          tempStrategy.indicators = overridenIndicators;
        } else if (strategyId === 'smc_ict') {
          overridenIndicators.push({ name: 'smc', type: 'SMC', period: combo.fractalPeriod });
          tempStrategy.indicators = overridenIndicators;
        }

        const runRes = self.BacktestEngine.runBacktest(candles, tempStrategy, baseRisk);
        results.push({ combo, runRes });
      });

      results.sort((a, b) => b.runRes[targetMetric] - a.runRes[targetMetric]);
      self.postMessage({ type: 'OPTIMIZATION_SUCCESS', results });
    }
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err.message });
  }
};
