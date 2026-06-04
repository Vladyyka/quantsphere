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
        strategy.activeParams = riskParams;
        
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
      const { candles, strategyId, targetMetric, baseRisk, combos } = data;
      const activeStrategy = self.StrategyRegistry.get(strategyId);
      if (!activeStrategy) throw new Error("Стратегия не найдена: " + strategyId);

      if (!combos || combos.length === 0) {
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
        tempStrategy.activeParams = combo;
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
