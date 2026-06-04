/**
 * Strategy Backtester & Chart Analyzer - Main UI & Chart Orchestrator
 * Pure ES6 JavaScript. Interacts with the DOM, manages TradingView Lightweight Charts,
 * handles input state syncs, and connects the data provider with the backtesting engine.
 * Fully localized to Russian. Supports Smart Money Concepts (SMC).
 */

(function () {
  // ==========================================
  // УПРАВЛЕНИЕ СОСТОЯНИЕМ (STATE)
  // ==========================================
  let activeCandles = [];       
  let currentFetchId = 0;
  let uploadedCSVCandles = null; 
  let lastBacktestResult = null; 
  let isBacktestRunning = false; // Mutex guard for parallel calculation avoidance
  
  // Переменные Live-режима
  let liveSocket = null;
  let lastLiveTradeCount = 0; 
  let liveStartTime = 0; 
  
  // Экземпляры графиков
  let priceChart = null;
  let indicatorChart = null;
  let equityChart = null;
  
  // Экземпляры серий
  let candleSeries = null;
  let volumeSeries = null;
  let priceIndicatorSeriesList = []; 
  let subchartSeriesList = [];       
  let equitySeries = null;           
  
  // ==========================================
  // ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    // Восстановление темы из localStorage
    const savedTheme = localStorage.getItem('qs-theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
      const themeIcon = document.getElementById('theme-toggle-icon');
      if (themeIcon) {
        themeIcon.textContent = 'dark_mode';
      }
    }

    initUIEventListeners();
    syncSliderLabels();
    renderStrategyParams('ema_crossover');
    initCharts();
    
    // Initialize DB and load workspace
    if (window.DbProvider) {
      window.DbProvider.init().then(async () => {
        console.log("IndexedDB QuantSphereDB initialized.");
        try {
          const state = await window.DbProvider.getWorkspace('default');
          if (state) {
            console.log("Restoring saved workspace from IndexedDB...");
            applyWorkspaceState(state);
          }
        } catch (e) {
          console.warn("Failed to restore workspace from IndexedDB:", e);
        }
        
        // Setup input change event listeners to auto-save workspace
        setupWorkspaceAutoSaveListeners();
        
        loadFreshPriceChart();
      }).catch(e => {
        console.error("IndexedDB initialization failed:", e);
        loadFreshPriceChart();
      });
    } else {
      setTimeout(() => {
        loadFreshPriceChart();
      }, 500);
    }
  });

  // ==========================================
  // НАСТРОЙКА И ОТРИСОВКА ГРАФИКОВ
  // ==========================================
  function getChartColors(isLight) {
    return {
      background: isLight ? '#ffffff' : '#08090d',
      textColor: isLight ? '#131722' : '#94a1b2',
      gridColor: isLight ? '#f0f3fa' : 'rgba(255, 255, 255, 0.16)',
      watermarkColor: isLight ? 'rgba(19, 23, 34, 0.04)' : 'rgba(255, 255, 255, 0.03)',
      crosshairColor: isLight ? 'rgba(99, 102, 241, 0.4)' : 'rgba(127, 90, 240, 0.4)',
      borderColor: isLight ? '#e0e3eb' : 'rgba(255, 255, 255, 0.08)',
    };
  }

  function updateChartsTheme() {
    const isLight = document.body.classList.contains('light-theme');
    const colors = getChartColors(isLight);
    
    const themeOpts = {
      layout: {
        background: { type: 'solid', color: colors.background },
        textColor: colors.textColor,
      },
      grid: {
        vertLines: { color: colors.gridColor, visible: true },
        horzLines: { color: colors.gridColor, visible: true },
      },
      rightPriceScale: {
        borderColor: colors.borderColor,
      },
      timeScale: {
        borderColor: colors.borderColor,
      },
      crosshair: {
        vertLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: isLight ? '#edf0f5' : '#1a1f2c',
        },
        horzLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: isLight ? '#edf0f5' : '#1a1f2c',
        }
      }
    };
    
    if (priceChart) {
      priceChart.applyOptions({
        ...themeOpts,
        watermark: { color: colors.watermarkColor }
      });
    }
    
    if (indicatorChart) {
      indicatorChart.applyOptions({
        ...themeOpts,
        watermark: { color: colors.watermarkColor }
      });
    }
    
    if (equityChart) {
      equityChart.applyOptions({
        ...themeOpts,
        watermark: { color: colors.watermarkColor }
      });
    }

    if (candleSeries) {
      candleSeries.applyOptions({
        upColor: isLight ? '#059669' : '#10b981',
        downColor: isLight ? '#dc2626' : '#ef4444',
        borderUpColor: isLight ? '#047857' : '#10b981',
        borderDownColor: isLight ? '#b91c1c' : '#ef4444',
        wickUpColor: isLight ? '#047857' : '#10b981',
        wickDownColor: isLight ? '#b91c1c' : '#ef4444',
      });
    }

    if (volumeSeries && activeCandles.length) {
      const volumeData = activeCandles.map(c => {
        return {
          time: c.time,
          value: c.volume,
          color: c.close >= c.open 
            ? (isLight ? 'rgba(5, 150, 105, 0.24)' : 'rgba(16, 185, 129, 0.16)') 
            : (isLight ? 'rgba(220, 38, 38, 0.24)' : 'rgba(239, 68, 68, 0.16)')
        };
      });
      volumeSeries.setData(volumeData);
    }
  }

  function initCharts() {
    const mainChartContainer = document.getElementById('candle-chart-container');
    const subchartContainer = document.getElementById('indicator-subchart-container');
    const equityChartContainer = document.getElementById('equity-chart-container');
    
    // Absolute null check to prevent Blocker crashes if DOM elements are renamed/removed
    if (!mainChartContainer || !subchartContainer || !equityChartContainer) {
      console.error("Критическая ошибка: Один или несколько контейнеров графиков отсутствуют в DOM.");
      return;
    }
    
    const isLight = document.body.classList.contains('light-theme');
    const colors = getChartColors(isLight);
    
    const chartTheme = {
      layout: {
        background: { type: 'solid', color: colors.background },
        textColor: colors.textColor,
        fontSize: 12,
        fontFamily: "'Outfit', sans-serif",
      },
      grid: {
        vertLines: { color: colors.gridColor, visible: true },
        horzLines: { color: colors.gridColor, visible: true },
      },
      crosshair: {
        mode: 0, 
        vertLine: {
          color: colors.crosshairColor,
          width: 1,
          style: 1, 
          labelBackgroundColor: isLight ? '#edf0f5' : '#1a1f2c',
        },
        horzLine: {
          color: colors.crosshairColor,
          width: 1,
          style: 1,
          labelBackgroundColor: isLight ? '#edf0f5' : '#1a1f2c',
        },
      },
      timeScale: {
        borderColor: colors.borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: colors.borderColor,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      }
    };

    priceChart = LightweightCharts.createChart(mainChartContainer, {
      ...chartTheme,
      watermark: {
        visible: true,
        fontSize: 16,
        horzAlign: 'center',
        vertAlign: 'center',
        color: colors.watermarkColor,
        text: 'Ядро QuantSphere',
      }
    });

    candleSeries = priceChart.addCandlestickSeries({
      upColor: isLight ? '#059669' : '#10b981',
      downColor: isLight ? '#dc2626' : '#ef4444',
      borderUpColor: isLight ? '#047857' : '#10b981',
      borderDownColor: isLight ? '#b91c1c' : '#ef4444',
      wickUpColor: isLight ? '#047857' : '#10b981',
      wickDownColor: isLight ? '#b91c1c' : '#ef4444',
    });

    priceChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      updateViewportCulling();
    });

    const trendColor = isLight ? 'rgba(79, 70, 229, 0.65)' : 'rgba(99, 102, 241, 0.65)';
    previewSeries = priceChart.addLineSeries({
      color: trendColor,
      lineWidth: 1.5,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: ''
    });

    volumeSeries = priceChart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', 
    });
    priceChart.priceScale('').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }, 
    });

    indicatorChart = LightweightCharts.createChart(subchartContainer, {
      ...chartTheme,
      timeScale: {
        ...chartTheme.timeScale,
        visible: false, 
      }
    });

    equityChart = LightweightCharts.createChart(equityChartContainer, {
      ...chartTheme,
      watermark: {
        visible: true,
        fontSize: 14,
        horzAlign: 'center',
        vertAlign: 'center',
        color: colors.watermarkColor,
        text: 'Кривая изменения доходности',
      }
    });

    equitySeries = equityChart.addLineSeries({
      color: '#7f5af0',
      lineWidth: 2.5,
      shadowColor: 'rgba(127, 90, 240, 0.2)',
      priceFormat: { type: 'price', precision: 2 },
    });

    // Автоматический ресайз графиков через ResizeObserver
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        
        if (entry.target === mainChartContainer && priceChart) {
          priceChart.resize(width, height);
        } else if (entry.target === subchartContainer && indicatorChart) {
          indicatorChart.resize(width, height);
        } else if (entry.target === equityChartContainer && equityChart) {
          equityChart.resize(width, height);
        }
      }
    });

    if (mainChartContainer) resizeObserver.observe(mainChartContainer);
    if (subchartContainer) resizeObserver.observe(subchartContainer);
    if (equityChartContainer) resizeObserver.observe(equityChartContainer);

    let isSyncing = false;
    
    priceChart.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (isSyncing || !range || !range.from || !range.to || subchartSeriesList.length === 0) return;
      isSyncing = true;
      indicatorChart.timeScale().setVisibleRange(range);
      isSyncing = false;
    });

    indicatorChart.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (isSyncing || !range || !range.from || !range.to || subchartSeriesList.length === 0) return;
      isSyncing = true;
      priceChart.timeScale().setVisibleRange(range);
      isSyncing = false;
    });

    setupTooltipSubscription();
    
    // Premium drawing tools click subscription and initialization
    priceChart.subscribeClick(param => handleChartClick(param));
    initDrawingTools();
  }

  function setupTooltipSubscription() {
    priceChart.subscribeCrosshairMove(param => {
      if (param && param.point !== undefined) {
        window.lastCrosshairPoint = param.point;
      }
      if (param && param.time !== undefined) {
        window.lastCrosshairTime = param.time;
      }

      if (!param || !param.time || param.point === undefined || !activeCandles.length) {
        const lastC = activeCandles[activeCandles.length - 1];
        if (lastC) updatePriceLegend(lastC);
      } else {
        const priceData = param.seriesData ? param.seriesData.get(candleSeries) : null;
        if (priceData) {
          updatePriceLegend({
            open: priceData.open !== undefined && priceData.open !== null ? priceData.open : 0,
            high: priceData.high !== undefined && priceData.high !== null ? priceData.high : 0,
            low: priceData.low !== undefined && priceData.low !== null ? priceData.low : 0,
            close: priceData.close !== undefined && priceData.close !== null ? priceData.close : 0
          });
        }
        
        if (subchartSeriesList.length > 0) {
          const subSeries = subchartSeriesList[0];
          const indicatorData = param.seriesData ? param.seriesData.get(subSeries) : null;
          if (indicatorData) {
            const val = (indicatorData.value !== undefined && indicatorData.value !== null) 
              ? indicatorData.value 
              : ((indicatorData.close !== undefined && indicatorData.close !== null) ? indicatorData.close : 0);
            document.getElementById('legend-indicator-val').textContent = typeof val === 'number' ? val.toFixed(2) : '0.00';
          }
        }
      }

      // Анимация нанесения трендовой линии в реальном времени (Троттлинг через requestAnimationFrame)
      if (activeTool === 'trend' && firstClick) {
        if (param && param.point && param.time) {
          const hoveredPrice = candleSeries.coordinateToPrice(param.point.y);
          const hoveredTime = param.time;
          
          if (hoveredPrice !== null && hoveredTime) {
            // Предотвращаем падения из-за дублирующихся временных меток в одной точке (сохраняем инстанс серии)
            if (timesAreEqual(firstClick.time, hoveredTime)) {
              return;
            }
            
            const t1 = getSortableTime(firstClick.time);
            const t2 = getSortableTime(hoveredTime);
            const dataArray = t1 <= t2 
              ? [
                  { time: firstClick.time, value: firstClick.price },
                  { time: hoveredTime, value: hoveredPrice }
                ]
              : [
                  { time: hoveredTime, value: hoveredPrice },
                  { time: firstClick.time, value: firstClick.price }
                ];
            
            if (window.previewFrameId) {
              cancelAnimationFrame(window.previewFrameId);
            }
            window.previewFrameId = requestAnimationFrame(() => {
              if (activeTool === 'trend' && firstClick && previewSeries) {
                try { previewSeries.setData(dataArray); } catch(e){}
              }
            });
          }
        }
      }
    });

    equityChart.subscribeCrosshairMove(param => {
      if (!param || !param.time || param.point === undefined || !lastBacktestResult) {
        if (lastBacktestResult) {
          const ec = lastBacktestResult.equityCurve;
          const lastVal = (ec && ec.length > 0 && ec[ec.length - 1] && ec[ec.length - 1].value !== undefined && ec[ec.length - 1].value !== null) 
            ? ec[ec.length - 1].value 
            : 0;
          document.getElementById('legend-equity-val').textContent = `$${lastVal.toLocaleString('ru-RU', {minimumFractionDigits: 2})}`;
        }
        return;
      }
      const data = param.seriesData ? param.seriesData.get(equitySeries) : null;
      if (data) {
        const val = (data.value !== undefined && data.value !== null) ? data.value : 0;
        document.getElementById('legend-equity-val').textContent = `$${val.toLocaleString('ru-RU', {minimumFractionDigits: 2})}`;
      }
    });
  }

  function updatePriceLegend(c) {
    document.getElementById('legend-open').textContent = c.open.toLocaleString('ru-RU');
    document.getElementById('legend-high').textContent = c.high.toLocaleString('ru-RU');
    document.getElementById('legend-low').textContent = c.low.toLocaleString('ru-RU');
    document.getElementById('legend-close').textContent = c.close.toLocaleString('ru-RU');
  }

  // ==========================================
  // UI ИНТЕРФЕЙС И СОБЫТИЯ
  // ==========================================
  function initUIEventListeners() {
    const dataSelector = document.getElementById('data-source-type');
    dataSelector.addEventListener('change', (e) => {
      const type = e.target.value;
      document.getElementById('crypto-selectors').style.display = type === 'crypto' ? 'block' : 'none';
      document.getElementById('crypto-timeframe-group').style.display = type === 'crypto' ? 'block' : 'none';
      document.getElementById('demo-selectors').style.display = type === 'demo' ? 'block' : 'none';
      document.getElementById('csv-selectors').style.display = type === 'csv' ? 'block' : 'none';
      
      // Reset portfolio mode if switching away from crypto
      if (type !== 'crypto') {
        const pfMode = document.getElementById('param-portfolio-mode');
        if (pfMode) {
          pfMode.checked = false;
          pfMode.dispatchEvent(new Event('change'));
        }
      }

      if (type !== 'csv' || uploadedCSVCandles) {
        loadFreshPriceChart();
      }
    });

    const cryptoSymbolSelector = document.getElementById('crypto-symbol');
    cryptoSymbolSelector.addEventListener('change', () => {
      loadFreshPriceChart();
    });

    const cryptoTimeframeSelector = document.getElementById('crypto-timeframe');
    cryptoTimeframeSelector.addEventListener('change', () => {
      loadFreshPriceChart();
    });

    const demoAssetSelector = document.getElementById('demo-asset');
    demoAssetSelector.addEventListener('change', () => {
      loadFreshPriceChart();
    });

    const strategySelector = document.getElementById('strategy-select');
    const editorTabBtn = document.getElementById('btn-editor-tab');
    
    strategySelector.addEventListener('change', (e) => {
      const id = e.target.value;
      if (id === 'custom') {
        document.getElementById('dynamic-strategy-params').innerHTML = `
          <div style="background: rgba(127, 90, 240, 0.05); padding: 12px; border-radius: var(--radius-sm); border: 1px dashed var(--accent-color); font-size: 12px; color: var(--text-secondary); line-height: 1.4; display: flex; flex-direction: column; gap: 8px;">
            <div>
              <strong style="color: var(--text-main); display: flex; align-items: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 16px; color: var(--accent-color);">code</span>
                Кастомный код активен
              </strong>
              Вы можете редактировать и программировать логику торгового робота на JavaScript в специальной вкладке редактора.
            </div>
            <button type="button" id="btn-sidebar-go-to-editor" class="btn-primary" style="width: 100%; font-size: 12px; padding: 8px 10px; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s ease;">
              <span class="material-symbols-outlined" style="font-size: 16px;">arrow_forward</span>
              Открыть редактор кода
            </button>
          </div>
        `;
        
        const btnGo = document.getElementById('btn-sidebar-go-to-editor');
        if (btnGo) {
          btnGo.addEventListener('click', () => {
            switchTab('tab-editor');
          });
        }
      } else {
        renderStrategyParams(id);
      }
      clearBacktestVisualization();
    });

    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    const fileInput = document.getElementById('csv-file-input');
    const fileUploadLabel = document.getElementById('file-upload-label');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      fileUploadLabel.textContent = `Файл: ${file.name.substring(0, 15)}...`;
      
      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const parsed = DataProvider.parseCSV(evt.target.result);
          uploadedCSVCandles = parsed;
          showToast(`CSV-файл разобран: загружено ${parsed.length} свечей!`, 'success');
          loadFreshPriceChart();
        } catch(err) {
          showToast(err.message, 'error');
          fileUploadLabel.textContent = "Ошибка. Попробуйте еще.";
        }
      };
      reader.readAsText(file);
    });

    const btnRun = document.getElementById('btn-run-backtest');
    btnRun.addEventListener('click', () => {
      runBacktestPipeline();
    });

    const btnReset = document.getElementById('btn-reset-defaults');
    btnReset.addEventListener('click', () => {
      const dataSelector = document.getElementById('data-source-type');
      dataSelector.value = 'crypto';
      dataSelector.dispatchEvent(new Event('change'));

      document.getElementById('crypto-symbol').value = 'BTCUSDT';
      document.getElementById('crypto-timeframe').value = '1h';
      document.getElementById('demo-asset').value = 'STOCK';
      document.getElementById('csv-file-input').value = '';
      document.getElementById('file-upload-label').innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">upload_file</span>
        Выбрать CSV файл
      `;
      uploadedCSVCandles = null;

      const strategySelector = document.getElementById('strategy-select');
      strategySelector.value = 'ema_crossover';
      strategySelector.dispatchEvent(new Event('change'));

      document.getElementById('param-init-balance').value = 10000;
      
      const leverage = document.getElementById('param-leverage');
      leverage.value = 1;
      document.getElementById('val-leverage').textContent = '1x';
      
      const fee = document.getElementById('param-fee');
      fee.value = 0.05;
      document.getElementById('val-fee').textContent = '0.05%';
      
      const slippage = document.getElementById('param-slippage');
      slippage.value = 0.02;
      document.getElementById('val-slippage').textContent = '0.02%';
      
      document.getElementById('param-stop-loss').value = 2.0;
      document.getElementById('param-take-profit').value = 6.0;

      // Reset advanced risk parameters
      document.getElementById('param-trailing-sl').checked = false;
      document.getElementById('param-position-sizing').value = 'fixed';
      document.getElementById('param-position-sizing').dispatchEvent(new Event('change'));
      document.getElementById('param-pyramiding').checked = false;

      showToast("Настройки успешно сброшены к исходным значениям!", "success");
      loadFreshPriceChart();
    });

    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-theme');
        const themeIcon = document.getElementById('theme-toggle-icon');
        if (themeIcon) {
          themeIcon.textContent = isLight ? 'dark_mode' : 'light_mode';
        }
        localStorage.setItem('qs-theme', isLight ? 'light' : 'dark');
        
        updateChartsTheme();
        showToast(isLight ? "Светлая тема включена!" : "Темная тема включена!", "success");
      });
    }

    // ==========================================
    // PREMIUM 8 FEATURES EVENTS INITIALIZATION
    // ==========================================

    // 1. Portfolio Mode toggle
    const pfMode = document.getElementById('param-portfolio-mode');
    pfMode.addEventListener('change', (e) => {
      const active = e.target.checked;
      document.getElementById('portfolio-assets-group').style.display = active ? 'flex' : 'none';
      document.getElementById('crypto-symbol').disabled = active;
      showToast(active ? "Портфельный режим активен! Выберите активы." : "Возврат к одиночному активу.", "info");
    });

    // 2. Risk Sizing Selector toggle
    const sizeSelector = document.getElementById('param-position-sizing');
    sizeSelector.addEventListener('change', (e) => {
      const isAtr = e.target.value === 'risk_atr';
      document.getElementById('risk-atr-group').style.display = isAtr ? 'flex' : 'none';
    });

    // 3. Grid Optimizer button click
    const btnOpt = document.getElementById('btn-run-optimization');
    btnOpt.addEventListener('click', () => {
      runGridOptimization();
    });

    // 4. Visual Strategy Builder mode toggle
    const btnCode = document.getElementById('btn-mode-code');
    const btnNoCode = document.getElementById('btn-mode-nocode');
    const btnAI = document.getElementById('btn-mode-ai');
    const editorTitle = document.getElementById('editor-mode-title');
    const textarea = document.getElementById('custom-strategy-code');
    const nocodeContainer = document.getElementById('nocode-builder-container');
    const aiContainer = document.getElementById('ai-generator-container');

    // Восстановление Gemini API Key и модели из localStorage
    const geminiKeyInput = document.getElementById('ai-gemini-key');
    if (geminiKeyInput) {
      geminiKeyInput.value = localStorage.getItem('qs-gemini-key') || '';
      geminiKeyInput.addEventListener('change', (e) => {
        localStorage.setItem('qs-gemini-key', e.target.value);
      });
    }

    const geminiModelSelect = document.getElementById('ai-model-select');
    if (geminiModelSelect) {
      geminiModelSelect.value = localStorage.getItem('qs-gemini-model') || 'gemini-3.5-flash';
      geminiModelSelect.addEventListener('change', (e) => {
        localStorage.setItem('qs-gemini-model', e.target.value);
      });
    }

    btnCode.addEventListener('click', () => {
      btnCode.classList.add('active');
      btnNoCode.classList.remove('active');
      btnAI.classList.remove('active');
      editorTitle.textContent = "strategy.js (Режим: Код)";
      textarea.style.display = 'block';
      nocodeContainer.style.display = 'none';
      aiContainer.style.display = 'none';
    });

    btnNoCode.addEventListener('click', () => {
      btnNoCode.classList.add('active');
      btnCode.classList.remove('active');
      btnAI.classList.remove('active');
      editorTitle.textContent = "strategy.js (Режим: No-Code)";
      textarea.style.display = 'none';
      nocodeContainer.style.display = 'flex';
      aiContainer.style.display = 'none';
    });

    btnAI.addEventListener('click', () => {
      btnAI.classList.add('active');
      btnCode.classList.remove('active');
      btnNoCode.classList.remove('active');
      editorTitle.textContent = "strategy.js (Режим: ИИ-Генератор)";
      textarea.style.display = 'none';
      nocodeContainer.style.display = 'none';
      aiContainer.style.display = 'flex';
    });

    // Обработчик отправки промпта в Google Gemini
    const btnGenerateAI = document.getElementById('btn-generate-ai-strategy');
    btnGenerateAI.addEventListener('click', async () => {
      const apiKey = document.getElementById('ai-gemini-key').value.trim();
      const prompt = document.getElementById('ai-prompt-input').value.trim();
      
      if (!apiKey) {
        showToast("Пожалуйста, укажите ваш Google Gemini API Key!", "error");
        return;
      }
      if (!prompt) {
        showToast("Пожалуйста, введите текстовое описание стратегии!", "error");
        return;
      }
      
      btnGenerateAI.disabled = true;
      btnGenerateAI.innerHTML = `<span class="spinner"></span> Генерирую код...`;
      
      try {
        const model = document.getElementById('ai-model-select')?.value || 'gemini-3.5-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Ты — ИИ-генератор торговых стратегий для платформы QuantSphere. Твоя задача — проанализировать описание пользователя и сгенерировать JSON-ответ, содержащий как JS-код стратегии, так и оптимальные конфигурационные параметры.

ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ JSON. Не оборачивай ответ в markdown-блоки типа \`\`\`json ... \`\`\`, не пиши никакого пояснительного текста. Только чистый валидный JSON!

Формат JSON:
{
  "code": "/* здесь весь JS код стратегии */",
  "configs": {
    "initialBalance": 10000,
    "leverage": 1,
    "fee": 0.05,
    "slippage": 0.02,
    "stopLoss": 1.5,
    "takeProfit": 3.0,
    "trailingSL": false,
    "positionSizing": "fixed_pct",
    "riskPercent": 2,
    "pyramiding": false,
    "symbol": "BTCUSDT",
    "timeframe": "15m"
  }
}

Поля в "configs" являются необязательными, генерируй только те, о которых просил пользователь или которые логичны для стратегии.
Параметры configs:
- initialBalance: число (начальный баланс, например 10000)
- leverage: число (кредитное плечо, например 1 или 5)
- fee: число (комиссия в %, например 0.05)
- slippage: число (проскальзывание в %, например 0.02)
- stopLoss: число (стоп-лосс в %, например 1.5. 0 если не нужен)
- takeProfit: число (тейк-профит в %, например 3.0. 0 если не нужен)
- trailingSL: boolean (скользящий стоп-лосс)
- positionSizing: строка ("fixed_qty", "fixed_usd", "fixed_pct")
- riskPercent: число (риск на сделку в %, например 2)
- pyramiding: boolean (доливка позиций)
- symbol: строка (один из поддерживаемых: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, ADAUSDT, XRPUSDT, DOTUSDT, DOGEUSDT, LTCUSDT)
- timeframe: строка (один из поддерживаемых: 1m, 5m, 15m, 1h, 4h, 1d)

Правила генерации JS-кода (свойство "code"):
Код выполняется в цикле по каждой свече. На каждой итерации тебе доступны:
- 'i' или 'index': индекс текущей свечи.
- 'c' или 'candles[i]': текущая свеча (close, open, high, low, volume, time).
- 'prev' или 'candles[i-1]': предыдущая свеча.
- 'position': текущая открытая позиция, если она есть (position.type равен 'LONG' или 'SHORT', position.entryPrice, position.slPrice, position.tpPrice).
- 'state': пустой объект состояния для сохранения переменных между свечами.
- 'indicators': объект с массивами рассчитанных индикаторов. Доступ по имени: indicators.emaFast[i], indicators.rsi[i], indicators.bb[i].upper, indicators.macd[i].macd.

В самом верху JS-кода ОБЯЗАТЕЛЬНО должны быть комментарии с объявлением используемых индикаторов. Формат строго такой:
// INDICATOR: [имя] = [тип]([параметры])
Поддерживаемые типы:
- SMA(period)
- EMA(period)
- RSI(period)
- BB(period, stddev)
- MACD(fast, slow, signal)
- ATR(period)
- SMC(strength)

Примеры объявлений:
// INDICATOR: emaFast = EMA(10)
// INDICATOR: rsi = RSI(14)

Твой код должен возвращать строковый сигнал: 'BUY', 'SELL', 'EXIT' или 'HOLD'.
Не оборачивай код во внешние функции или классы, пиши только тело логики.

Вот описание стратегии от пользователя:
"${prompt}"`
                  }
                ]
              }
            ]
          })
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || `Ошибка API: ${response.status}`);
        }
        
        const data = await response.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!rawText) {
          throw new Error("ИИ вернул пустой ответ. Попробуйте перефразировать промпт.");
        }
        
        // Попытка распарсить как JSON
        let parsed;
        try {
          let cleanText = rawText.replace(/```json/g, '').replace(/```js/g, '').replace(/```javascript/g, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleanText);
        } catch (jsonErr) {
          console.warn("Ответ ИИ не является чистым JSON, пробуем извлечь...", jsonErr);
          // Поиск фигурных скобок на случай лишнего текста от модели
          const firstBrace = rawText.indexOf('{');
          const lastBrace = rawText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            try {
              parsed = JSON.parse(rawText.substring(firstBrace, lastBrace + 1));
            } catch(e2) {
              parsed = { code: rawText }; // Fallback к чистому тексту как коду
            }
          } else {
            parsed = { code: rawText };
          }
        }
        
        if (!parsed.code) {
          parsed = { code: parsed.code || rawText };
        }
        
        // Очищаем markdown-разметку кода, если она осталась внутри code
        let code = parsed.code.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '').trim();
        textarea.value = code;
        
        // Настройка UI параметров из configs
        let appliedConfigsCount = 0;
        if (parsed.configs) {
          const cfg = parsed.configs;
          
          if (cfg.initialBalance !== undefined) {
            const el = document.getElementById('param-init-balance');
            if (el) { el.value = cfg.initialBalance; appliedConfigsCount++; }
          }
          if (cfg.leverage !== undefined) {
            const el = document.getElementById('param-leverage');
            if (el) { el.value = cfg.leverage; appliedConfigsCount++; }
          }
          if (cfg.fee !== undefined) {
            const el = document.getElementById('param-fee');
            if (el) { el.value = cfg.fee; appliedConfigsCount++; }
          }
          if (cfg.slippage !== undefined) {
            const el = document.getElementById('param-slippage');
            if (el) { el.value = cfg.slippage; appliedConfigsCount++; }
          }
          if (cfg.stopLoss !== undefined) {
            const el = document.getElementById('param-stop-loss');
            if (el) { el.value = cfg.stopLoss; appliedConfigsCount++; }
          }
          if (cfg.takeProfit !== undefined) {
            const el = document.getElementById('param-take-profit');
            if (el) { el.value = cfg.takeProfit; appliedConfigsCount++; }
          }
          if (cfg.trailingSL !== undefined) {
            const el = document.getElementById('param-trailing-sl');
            if (el) { el.checked = !!cfg.trailingSL; appliedConfigsCount++; }
          }
          if (cfg.positionSizing !== undefined) {
            const el = document.getElementById('param-position-sizing');
            if (el) {
              let val = cfg.positionSizing;
              if (val === 'fixed_pct' || val === 'fixed') {
                val = 'fixed';
              } else if (val === 'risk_atr' || val === 'dynamic' || val === 'risk') {
                val = 'risk_atr';
              }
              el.value = val;
              el.dispatchEvent(new Event('change'));
              appliedConfigsCount++;
            }
          }
          if (cfg.riskPercent !== undefined) {
            const el = document.getElementById('param-risk-percent');
            if (el) { el.value = cfg.riskPercent; appliedConfigsCount++; }
          }
          if (cfg.pyramiding !== undefined) {
            const el = document.getElementById('param-pyramiding');
            if (el) { el.checked = !!cfg.pyramiding; appliedConfigsCount++; }
          }
          if (cfg.symbol !== undefined) {
            const el = document.getElementById('crypto-symbol');
            if (el) {
              const opt = Array.from(el.options).find(o => o.value.toUpperCase() === cfg.symbol.toUpperCase());
              if (opt) { el.value = opt.value; appliedConfigsCount++; }
            }
          }
          if (cfg.timeframe !== undefined) {
            const el = document.getElementById('crypto-timeframe');
            if (el) {
              const opt = Array.from(el.options).find(o => o.value.toLowerCase() === cfg.timeframe.toLowerCase());
              if (opt) { el.value = opt.value; appliedConfigsCount++; }
            }
          }
        }
        
        if (appliedConfigsCount > 0) {
          showToast(`ИИ сгенерировал стратегию и автоматически настроил ${appliedConfigsCount} параметров!`, "success");
        } else {
          showToast("ИИ успешно сгенерировал торговую стратегию!", "success");
        }
        
        btnCode.click(); // Переключаемся на вкладку Код для отображения результата
        
      } catch(e) {
        console.error(e);
        showToast(`Не удалось сгенерировать стратегию: ${e.message}`, "error");
      } finally {
        btnGenerateAI.disabled = false;
        btnGenerateAI.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px;">smart_toy</span> 🤖 Сгенерировать ИИ-стратегию`;
      }
    });

    // Dynamic No-Code value selector show/hide
    const buyInd2 = document.getElementById('nc-buy-ind2');
    buyInd2.addEventListener('change', (e) => {
      document.getElementById('nc-buy-val').style.display = e.target.value === 'value' ? 'block' : 'none';
    });

    const exitInd2 = document.getElementById('nc-exit-ind2');
    exitInd2.addEventListener('change', (e) => {
      document.getElementById('nc-exit-val').style.display = e.target.value === 'value' ? 'block' : 'none';
    });

    // Visual Strategy Builder Compile button
    document.getElementById('btn-save-nocode').addEventListener('click', () => {
      compileNoCode();
      btnCode.click(); // switch back to code tab to show generated code
    });

    // 5. Live Mode toggle
    const liveBtn = document.getElementById('live-toggle-btn');
    liveBtn.addEventListener('click', () => {
      toggleLiveTrading();
    });

    // 6. Report Modal Close
    document.getElementById('btn-close-report').addEventListener('click', () => {
      document.getElementById('report-modal').style.display = 'none';
    });

    // 7. PDF Export Print
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      window.print();
    });

    // Экспорт Workspace
    const btnExportWorkspace = document.getElementById('btn-export-workspace');
    if (btnExportWorkspace) {
      btnExportWorkspace.addEventListener('click', async () => {
        try {
          const workspaceState = getWorkspaceState();
          
          // Fetch all drawings from DB
          let allDrawingsMap = {};
          if (window.DbProvider) {
            allDrawingsMap = await window.DbProvider.getAllDrawings();
          } else {
            // Fallback for current active symbol drawings from memory
            const currentSymbol = getActiveSymbol();
            allDrawingsMap[currentSymbol] = getSavedDrawings(currentSymbol);
          }
          
          const exportData = {
            ...workspaceState,
            drawings: allDrawingsMap,
            timestamp: Date.now(),
            version: '6.0.0'
          };
          
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `quantsphere_workspace_${getActiveSymbol()}_${new Date().toISOString().slice(0,10)}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          
          showToast("Конфигурация рабочего пространства успешно экспортирована!", "success");
        } catch (err) {
          console.error("Workspace export failed:", err);
          showToast(`Ошибка экспорта: ${err.message}`, "error");
        }
      });
    }

    // Импорт Workspace
    const btnImportWorkspace = document.getElementById('btn-import-workspace');
    const fileImportInput = document.getElementById('workspace-import-file');
    if (btnImportWorkspace && fileImportInput) {
      btnImportWorkspace.addEventListener('click', () => {
        fileImportInput.click();
      });
      
      fileImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            if (!data || typeof data !== 'object') {
              throw new Error("Неверный формат JSON-файла");
            }
            
            // Restore workspace state to DOM and localStorage
            applyWorkspaceState(data);
            
            // Save drawings to DB
            if (data.drawings && typeof data.drawings === 'object') {
              if (window.DbProvider) {
                await window.DbProvider.saveAllDrawings(data.drawings);
                // Refresh in-memory cache for drawings
                Object.keys(data.drawings).forEach(sym => {
                  inMemoryDrawings[sym.toUpperCase()] = data.drawings[sym];
                });
              } else {
                // Fallback to localStorage for active symbol
                const currentSymbol = getActiveSymbol();
                if (data.drawings[currentSymbol]) {
                  localStorage.setItem(`qs-drawings-${currentSymbol}`, JSON.stringify(data.drawings[currentSymbol]));
                }
              }
            }
            
            // Auto save loaded state into default workspace in IndexedDB
            saveWorkspaceAuto();
            
            // Trigger drawings reload and chart refresh
            const currentSymbol = getActiveSymbol();
            await initDrawingsForSymbol(currentSymbol);
            loadSavedDrawings();
            
            showToast("Рабочее пространство успешно восстановлено!", "success");
          } catch (err) {
            console.error("Workspace import failed:", err);
            showToast(`Ошибка импорта: ${err.message}`, "error");
          } finally {
            fileImportInput.value = ''; // Reset file input
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function switchTab(tabId) {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');
    
    tabBtns.forEach(btn => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    panels.forEach(panel => {
      if (panel.id === tabId) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    setTimeout(() => {
      if (tabId === 'tab-chart') {
        priceChart.resize(
          document.getElementById('candle-chart-container').clientWidth,
          document.getElementById('candle-chart-container').clientHeight
        );
        indicatorChart.resize(
          document.getElementById('indicator-subchart-container').clientWidth,
          document.getElementById('indicator-subchart-container').clientHeight
        );
      } else if (tabId === 'tab-equity') {
        equityChart.resize(
          document.getElementById('equity-chart-container').clientWidth,
          document.getElementById('equity-chart-container').clientHeight
        );
      }
    }, 50);
  }

  function syncSliderLabels() {
    const leverage = document.getElementById('param-leverage');
    const leverageVal = document.getElementById('val-leverage');
    leverage.addEventListener('input', (e) => {
      leverageVal.textContent = `${e.target.value}x`;
    });

    const fee = document.getElementById('param-fee');
    const feeVal = document.getElementById('val-fee');
    fee.addEventListener('input', (e) => {
      feeVal.textContent = `${e.target.value}%`;
    });

    const slippage = document.getElementById('param-slippage');
    const slippageVal = document.getElementById('val-slippage');
    slippage.addEventListener('input', (e) => {
      slippageVal.textContent = `${e.target.value}%`;
    });
  }

  function renderStrategyParams(strategyId) {
    const container = document.getElementById('dynamic-strategy-params');
    container.innerHTML = '';
    
    const strategy = StrategyRegistry.get(strategyId);
    if (!strategy || !strategy.parameters) return;
    
    strategy.parameters.forEach(param => {
      const fg = document.createElement('div');
      fg.className = 'form-group';
      
      const label = document.createElement('label');
      label.textContent = param.label;
      label.setAttribute('for', `strategy-param-${param.name}`);
      
      const input = document.createElement('input');
      input.type = 'number';
      input.id = `strategy-param-${param.name}`;
      input.value = param.default;
      input.min = param.min || 1;
      input.max = param.max || 1000;
      
      fg.appendChild(label);
      fg.appendChild(input);
      container.appendChild(fg);
    });
  }

  // ==========================================
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ЗАГРУЗКИ И ОЧИСТКИ ГРАФИКОВ
  // ==========================================
  
  function resetMetricsToEmpty() {
    document.getElementById('metric-final-equity').textContent = '--';
    const elReturn = document.getElementById('metric-total-return');
    elReturn.textContent = '0.00%';
    elReturn.className = 'metric-value';
    
    const returnTrend = document.getElementById('metric-return-trend');
    returnTrend.textContent = '--';
    returnTrend.className = 'metric-trend';
    
    document.getElementById('metric-win-rate').textContent = '0.00%';
    document.getElementById('metric-win-trend').textContent = '--';
    
    document.getElementById('metric-sharpe').textContent = '0.00';
    const sharpeTrend = document.getElementById('metric-sharpe-trend');
    sharpeTrend.textContent = '--';
    sharpeTrend.className = 'metric-trend';
    
    const elDrawdown = document.getElementById('metric-drawdown');
    elDrawdown.textContent = '0.00%';
    elDrawdown.className = 'metric-value';
    document.getElementById('metric-drawdown-trend').textContent = '--';
    
    const elPf = document.getElementById('metric-profit-factor');
    elPf.textContent = '0.00';
    elPf.className = 'metric-value';
    
    const pfTrend = document.getElementById('metric-pf-trend');
    pfTrend.textContent = '--';
    pfTrend.className = 'metric-trend';
    
    document.getElementById('lbl-trade-count').textContent = '0';
  }

  function resetTradesTableToEmpty() {
    const tbody = document.getElementById('trades-table-body');
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state" style="text-align: center; padding: 40px;">
          <span class="material-symbols-outlined empty-icon">analytics</span>
          <p>Тесты еще не запускались. Нажмите кнопку "Запустить бэктест" для начала работы.</p>
        </td>
      </tr>
    `;
  }

  function clearBacktestVisualization() {
    priceIndicatorSeriesList.forEach(s => priceChart.removeSeries(s));
    priceIndicatorSeriesList = [];
    
    subchartSeriesList.forEach(s => indicatorChart.removeSeries(s));
    subchartSeriesList = [];
    
    allCleanMarkers = [];
    candleSeries.setMarkers([]);
    equitySeries.setData([]);
    resetMetricsToEmpty();
    resetTradesTableToEmpty();
  }

  async function loadFreshPriceChart() {
    currentFetchId++;
    const fetchId = currentFetchId;

    // Безопасное закрытие и сброс Live WebSocket при смене инструмента/таймфрейма
    if (liveSocket) {
      try { liveSocket.close(); } catch(e){}
      liveSocket = null;
      
      const liveBtn = document.getElementById('live-toggle-btn');
      const liveIcon = document.getElementById('live-toggle-icon');
      if (liveBtn && liveIcon) {
        liveBtn.style.background = '';
        liveBtn.style.borderColor = '';
        liveBtn.style.color = '';
        liveBtn.style.boxShadow = '';
        liveIcon.style.color = '';
        liveIcon.textContent = 'sensors';
      }
      showToast("Переключение инструмента. Live-режим отключен.", "info");
    }

    const btnRun = document.getElementById('btn-run-backtest');
    btnRun.disabled = true;
    btnRun.style.opacity = '0.6';
    btnRun.style.cursor = 'not-allowed';
    
    const sourceType = document.getElementById('data-source-type').value;
    let assetName = 'BTCUSDT';
    
    if (sourceType === 'crypto') {
      assetName = document.getElementById('crypto-symbol').value;
    } else if (sourceType === 'demo') {
      const assetClass = document.getElementById('demo-asset').value;
      assetName = assetClass === 'STOCK' ? 'SPY' : assetClass === 'FOREX' ? 'EURUSD' : 'XAUUSD';
    } else {
      assetName = 'СВОЙ_CSV';
    }
    
    const overlay = document.getElementById('chart-loading-overlay');
    const overlayText = document.getElementById('chart-loading-text');
    if (overlay) overlay.classList.add('active');
    if (overlayText) overlayText.textContent = `Загрузка котировок ${assetName}...`;
    
    try {
      let candles = [];
      
      if (sourceType === 'crypto') {
        const symbol = document.getElementById('crypto-symbol').value;
        const timeframe = document.getElementById('crypto-timeframe').value;
        candles = await DataProvider.fetchBinanceData(symbol, timeframe, 1000);
      } else if (sourceType === 'demo') {
        const assetClass = document.getElementById('demo-asset').value;
        candles = DataProvider.generateMockData(assetClass, 600);
      } else {
        if (!uploadedCSVCandles) return;
        candles = uploadedCSVCandles;
      }
      
      if (fetchId !== currentFetchId) return; // Отсекаем race conditions асинхронного ответа
      
      activeCandles = candles;
      document.getElementById('legend-symbol-name').textContent = assetName;
      
      candleSeries.setData(candles);
      
      const isLight = document.body.classList.contains('light-theme');
      const volumeData = candles.map(c => {
        return {
          time: c.time,
          value: c.volume,
          color: c.close >= c.open 
            ? (isLight ? 'rgba(5, 150, 105, 0.24)' : 'rgba(16, 185, 129, 0.16)') 
            : (isLight ? 'rgba(220, 38, 38, 0.24)' : 'rgba(239, 68, 68, 0.16)')
        };
      });
      volumeSeries.setData(volumeData);
      
      clearBacktestVisualization();
      await initDrawingsForSymbol(assetName);
      loadSavedDrawings();
      
      // Сброс и подгонка масштаба для предотвращения белого экрана
      if (priceChart) priceChart.timeScale().fitContent();
      if (indicatorChart) indicatorChart.timeScale().fitContent();
      
      setTimeout(() => {
        if (priceChart) {
          const mainContainer = document.getElementById('candle-chart-container');
          if (mainContainer) {
            priceChart.resize(mainContainer.clientWidth, mainContainer.clientHeight);
          }
          priceChart.timeScale().fitContent();
        }
        if (indicatorChart) {
          const subContainer = document.getElementById('indicator-subchart-container');
          if (subContainer) {
            indicatorChart.resize(subContainer.clientWidth, subContainer.clientHeight);
          }
          indicatorChart.timeScale().fitContent();
        }
      }, 100);
      
      showToast(`График ${assetName} успешно загружен!`, 'success');
    } catch(err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      if (overlay) overlay.classList.remove('active');
      btnRun.disabled = false;
      btnRun.style.opacity = '';
      btnRun.style.cursor = '';
    }
  }

  // ==========================================
  // РАБОЧИЙ ТРУБОПРОВОД РАСЧЕТА БЭКТЕСТА (PIPELINE)
  // ==========================================
  async function runBacktestPipeline() {
    if (isBacktestRunning) {
      showToast("Расчет бэктеста уже запущен! Пожалуйста, подождите.", "warning");
      return;
    }
    isBacktestRunning = true;

    const btnRun = document.getElementById('btn-run-backtest');
    btnRun.disabled = true;
    btnRun.classList.add('loading');
    btnRun.innerHTML = `<span class="spinner"></span> Идет расчет...`;
    
    const startTime = performance.now();
    
    try {
      // Strict parameter validation to defend the math engine from NaN injections
      const initBalVal = parseFloat(document.getElementById('param-init-balance').value);
      if (isNaN(initBalVal) || initBalVal <= 0) {
        throw new Error("Начальный баланс должен быть положительным числом!");
      }
      
      const leverageVal = parseInt(document.getElementById('param-leverage').value);
      if (isNaN(leverageVal) || leverageVal < 1 || leverageVal > 125) {
        throw new Error("Кредитное плечо должно быть в диапазоне от 1x до 125x!");
      }
      
      const feeVal = parseFloat(document.getElementById('param-fee').value);
      if (isNaN(feeVal) || feeVal < 0 || feeVal > 10) {
        throw new Error("Комиссия должна быть от 0% до 10%!");
      }
      
      const slippageVal = parseFloat(document.getElementById('param-slippage').value);
      if (isNaN(slippageVal) || slippageVal < 0 || slippageVal > 10) {
        throw new Error("Проскальзывание должно быть от 0% до 10%!");
      }

      const slPercent = parseFloat(document.getElementById('param-stop-loss').value);
      if (isNaN(slPercent) || slPercent < 0) {
        throw new Error("Стоп-лосс должен быть неотрицательным числом!");
      }

      const tpPercent = parseFloat(document.getElementById('param-take-profit').value);
      if (isNaN(tpPercent) || tpPercent < 0) {
        throw new Error("Тейк-профит должен быть неотрицательным числом!");
      }

      const riskPercentVal = parseFloat(document.getElementById('param-risk-percent').value);
      if (isNaN(riskPercentVal) || riskPercentVal <= 0 || riskPercentVal > 100) {
        throw new Error("Процент риска на сделку должен быть от 0.1% до 100%!");
      }

      const sourceType = document.getElementById('data-source-type').value;
      let candles = [];
      let assetName = 'BTCUSDT';
      
      if (sourceType === 'crypto') {
        const symbol = document.getElementById('crypto-symbol').value;
        const timeframe = document.getElementById('crypto-timeframe').value;
        assetName = symbol;
        showToast(`Загрузка свечей по API для ${symbol}...`, 'success');
        
        const fetchId = ++currentFetchId;
        candles = await DataProvider.fetchBinanceData(symbol, timeframe, 1000);
        if (fetchId !== currentFetchId) {
          throw new Error("Запрос отменен: были изменены настройки инструмента.");
        }
      } else if (sourceType === 'demo') {
        const assetClass = document.getElementById('demo-asset').value;
        assetName = assetClass === 'STOCK' ? 'SPY' : assetClass === 'FOREX' ? 'EURUSD' : 'XAUUSD';
        candles = DataProvider.generateMockData(assetClass, 600);
      } else {
        if (!uploadedCSVCandles) {
          throw new Error("Пожалуйста, сначала загрузите корректный исторический CSV-файл!");
        }
        assetName = 'СВОЙ_CSV';
        candles = uploadedCSVCandles;
      }
      
      if (!candles || candles.length < 50) {
        throw new Error("Недостаточно свечей для запуска теста. Необходимо минимум 50 свечей.");
      }
      
      activeCandles = candles;
      document.getElementById('legend-symbol-name').textContent = assetName;

      const strategyId = document.getElementById('strategy-select').value;
      const strategy = getActivatedStrategy(strategyId);

      const riskParams = {
        initialBalance: parseFloat(document.getElementById('param-init-balance').value) || 10000,
        leverage: parseInt(document.getElementById('param-leverage').value) || 1,
        feePercent: parseFloat(document.getElementById('param-fee').value) || 0.05,
        slippagePercent: parseFloat(document.getElementById('param-slippage').value) || 0.02,
        stopLossPercent: parseFloat(document.getElementById('param-stop-loss').value) || 0,
        takeProfitPercent: parseFloat(document.getElementById('param-take-profit').value) || 0,
        trailingSL: document.getElementById('param-trailing-sl').checked,
        positionSizing: document.getElementById('param-position-sizing').value,
        riskPercent: parseFloat(document.getElementById('param-risk-percent').value) || 2,
        pyramiding: document.getElementById('param-pyramiding').checked
      };

      // Check Portfolio Mode
      if (document.getElementById('param-portfolio-mode').checked) {
        await runPortfolioBacktestPipeline(strategy, riskParams);
        const elapsed = Math.round(performance.now() - startTime);
        btnRun.classList.remove('loading');
        btnRun.innerHTML = `<span class="material-symbols-outlined">play_circle</span> Запустить бэктест`;
        
        // Show Report Modal for portfolio result
        showReportModal(lastBacktestResult);
        return;
      }

      const userCode = strategyId === 'custom' ? document.getElementById('custom-strategy-code').value : '';
      const results = await new Promise((resolve, reject) => {
        const worker = new Worker('backtest-worker.js');
        worker.postMessage({
          type: 'RUN_BACKTEST',
          data: {
            candles,
            strategyId,
            userCode,
            riskParams
          }
        });
        worker.onmessage = function (e) {
          const { type, result, message } = e.data;
          if (type === 'BACKTEST_SUCCESS') {
            resolve(result);
          } else if (type === 'ERROR') {
            reject(new Error(message));
          }
          worker.terminate();
        };
        worker.onerror = function (err) {
          reject(err);
          worker.terminate();
        };
      });

      lastBacktestResult = results;

      renderBacktestCharts(candles, results, strategy);
      updatePerformanceMetrics(results);
      populateTradesTable(results.trades);
      updateMarketRegimeUI(results);
      
      const elapsed = Math.round(performance.now() - startTime);
      showToast(`Бэктест выполнен за ${elapsed}мс! Рассчитано сделок: ${results.trades.length}.`, 'success');
      
      // Pop open report card conclusion modal
      showReportModal(results);
      
    } catch(err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      isBacktestRunning = false;
      btnRun.disabled = false;
      btnRun.classList.remove('loading');
      btnRun.innerHTML = `<span class="material-symbols-outlined">play_circle</span> Запустить бэктест`;
    }
  }

  // ==========================================
  // СЛОЖНЫЙ ОТРИСОВЩИК ГРАФИЧЕСКИХ СЛОЕВ
  // ==========================================
  function renderBacktestCharts(candles, results, strategyIdOrObject) {
    let visibleRangePrice = null;
    let visibleRangeInd = null;
    if (liveSocket) {
      if (priceChart) visibleRangePrice = priceChart.timeScale().getVisibleRange();
      if (indicatorChart) visibleRangeInd = indicatorChart.timeScale().getVisibleRange();
    }

    priceIndicatorSeriesList.forEach(s => priceChart.removeSeries(s));
    priceIndicatorSeriesList = [];
    
    subchartSeriesList.forEach(s => indicatorChart.removeSeries(s));
    subchartSeriesList = [];

    candleSeries.setData(candles);
    const isLight = document.body.classList.contains('light-theme');
    
    const volumeData = candles.map(c => {
      return {
        time: c.time,
        value: c.volume,
        color: c.close >= c.open 
          ? (isLight ? 'rgba(5, 150, 105, 0.24)' : 'rgba(16, 185, 129, 0.16)') 
          : (isLight ? 'rgba(220, 38, 38, 0.24)' : 'rgba(239, 68, 68, 0.16)')
      };
    });
    volumeSeries.setData(volumeData);

    const inds = results.indicators;
    
    let strategy = null;
    if (strategyIdOrObject) {
      if (typeof strategyIdOrObject === 'string') {
        strategy = getActivatedStrategy(strategyIdOrObject);
      } else {
        strategy = strategyIdOrObject;
      }
    }

    let renderedSubchart = false;
    document.getElementById('legend-indicator-val').textContent = '0.00';

    if (strategy && strategy.indicators) {
      strategy.indicators.forEach(ind => {
        const key = ind.name;
        const dataArr = inds[key];
        if (!dataArr) return;

        if (ind.type === 'EMA' || ind.type === 'SMA') {
          const isFast = key.toLowerCase().includes('fast') || (ind.period && ind.period < 15);
          const color = isFast ? '#7f5af0' : '#2cb67d';
          const thick = isFast ? 1.5 : 2;
          
          const lineSeries = priceChart.addLineSeries({
            color: color,
            lineWidth: thick,
            title: key.toUpperCase(),
          });
          
          const lineData = candles.map((c, i) => {
            return { time: c.time, value: dataArr[i] };
          }).filter(d => d.value !== null && d.value !== undefined);
          
          lineSeries.setData(lineData);
          priceIndicatorSeriesList.push(lineSeries);
        }
        
        else if (ind.type === 'BB') {
          const lineMiddle = priceChart.addLineSeries({ 
            color: isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(255,255,255,0.15)', 
            lineWidth: 1, 
            lineStyle: 2 
          });
          const lineUpper = priceChart.addLineSeries({ 
            color: isLight ? 'rgba(99, 102, 241, 0.5)' : 'rgba(0, 210, 255, 0.3)', 
            lineWidth: 1 
          });
          const lineLower = priceChart.addLineSeries({ 
            color: isLight ? 'rgba(99, 102, 241, 0.5)' : 'rgba(0, 210, 255, 0.3)', 
            lineWidth: 1 
          });
          
          const dataM = [];
          const dataU = [];
          const dataL = [];
          
          candles.forEach((c, i) => {
            const val = dataArr[i];
            if (val) {
              dataM.push({ time: c.time, value: val.middle });
              dataU.push({ time: c.time, value: val.upper });
              dataL.push({ time: c.time, value: val.lower });
            }
          });
          
          lineMiddle.setData(dataM);
          lineUpper.setData(dataU);
          lineLower.setData(dataL);
          
          priceIndicatorSeriesList.push(lineMiddle, lineUpper, lineLower);
        }
        
        else if (ind.type === 'RSI') {
          renderedSubchart = true;
          document.getElementById('subchart-indicator-title').textContent = `RSI (${ind.period || 14})`;
          
          const rsiLine = indicatorChart.addLineSeries({
            color: '#00d2ff',
            lineWidth: 1.5,
            title: 'RSI'
          });
          
          const rsiData = candles.map((c, i) => {
            return { time: c.time, value: dataArr[i] };
          }).filter(d => d.value !== null && d.value !== undefined);
          
          rsiLine.setData(rsiData);
          subchartSeriesList.push(rsiLine);
          
          indicatorChart.priceScale('right').applyOptions({
            mode: 0,
            scaleMargins: { top: 0.1, bottom: 0.1 }
          });
        }
        
        else if (ind.type === 'MACD') {
          renderedSubchart = true;
          document.getElementById('subchart-indicator-title').textContent = `MACD (${ind.fast || 12}, ${ind.slow || 26}, ${ind.signal || 9})`;
          
          const macdLine = indicatorChart.addLineSeries({ color: '#2ec4b6', lineWidth: 1.2, title: 'MACD' });
          const signalLine = indicatorChart.addLineSeries({ color: '#ff9f1c', lineWidth: 1.2, title: 'SIGNAL' });
          const histBars = indicatorChart.addHistogramSeries({
            color: '#ef4444',
            priceFormat: { type: 'price', precision: 4 }
          });
          
          const dMacd = [];
          const dSignal = [];
          const dHist = [];
          
          candles.forEach((c, i) => {
            const val = dataArr[i];
            if (val) {
              dMacd.push({ time: c.time, value: val.macd });
              dSignal.push({ time: c.time, value: val.signal });
              dHist.push({
                time: c.time,
                value: val.hist,
                color: val.hist >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
              });
            }
          });
          
          macdLine.setData(dMacd);
          signalLine.setData(dSignal);
          histBars.setData(dHist);
          
          subchartSeriesList.push(macdLine, signalLine, histBars);
        }
        
        else if (ind.type === 'ATR') {
          renderedSubchart = true;
          document.getElementById('subchart-indicator-title').textContent = `ATR (${ind.period || 14})`;
          
          const atrLine = indicatorChart.addLineSeries({ color: '#ff9f1c', lineWidth: 1.5 });
          const atrData = candles.map((c, i) => {
            return { time: c.time, value: dataArr[i] };
          }).filter(d => d.value !== null && d.value !== undefined);
          
          atrLine.setData(atrData);
          subchartSeriesList.push(atrLine);
        }
      });
    }

    if (!renderedSubchart) {
      document.getElementById('subchart-indicator-title').textContent = 'Нет под-графика';
    }

    // 5. Отрисовываем флажки совершенных сделок И структуры Smart Money (BOS/CHoCH)
    const markers = [];
    
    // А. Сделки
    results.trades.forEach(t => {
      if (t.asset && t.asset !== getActiveSymbol()) return;
      if (t.type === 'LONG') {
        markers.push({
          time: t.entryTime,
          position: 'belowBar',
          color: isLight ? '#059669' : '#10b981',
          shape: 'arrowUp',
          text: `Вход Long @ ${t.entryPrice.toLocaleString('ru-RU')}`
        });
        markers.push({
          time: t.exitTime,
          position: 'aboveBar',
          color: t.pnl >= 0 ? (isLight ? '#059669' : '#10b981') : (isLight ? '#dc2626' : '#ef4444'),
          shape: 'arrowDown',
          text: `Выход @ ${t.exitPrice.toLocaleString('ru-RU')}`
        });
      } else {
        markers.push({
          time: t.entryTime,
          position: 'aboveBar',
          color: isLight ? '#dc2626' : '#ef4444',
          shape: 'arrowDown',
          text: `Вход Short @ ${t.entryPrice.toLocaleString('ru-RU')}`
        });
        markers.push({
          time: t.exitTime,
          position: 'belowBar',
          color: t.pnl >= 0 ? (isLight ? '#059669' : '#10b981') : (isLight ? '#dc2626' : '#ef4444'),
          shape: 'arrowUp',
          text: `Покрытие @ ${t.exitPrice.toLocaleString('ru-RU')}`
        });
      }
    });
    
    // Б. Структура SMC (BOS и CHoCH)
    if (results.indicators.smc) {
      results.indicators.smc.forEach((s, idx) => {
        if (!s) return;
        const time = candles[idx].time;
        
        if (s.bos) {
          markers.push({
            time: time,
            position: s.bos.type === 'BULLISH' ? 'aboveBar' : 'belowBar',
            color: isLight ? '#0284c7' : '#00d2ff',
            shape: 'circle',
            text: `BOS (${s.bos.level.toLocaleString('ru-RU')})`
          });
        }
        if (s.choch) {
          markers.push({
            time: time,
            position: s.choch.type === 'BULLISH' ? 'aboveBar' : 'belowBar',
            color: isLight ? '#d97706' : '#ff9f1c',
            shape: 'square',
            text: `CHoCH (${s.choch.level.toLocaleString('ru-RU')})`
          });
        }
      });
    }
    
    // Group markers by unique timestamps to strictly comply with Lightweight Charts standard
    const markersByTime = {};
    markers.forEach(m => {
      if (!m.time) return;
      if (!markersByTime[m.time]) {
        markersByTime[m.time] = [];
      }
      markersByTime[m.time].push(m);
    });

    const cleanMarkers = [];
    Object.keys(markersByTime).forEach(timeStr => {
      const time = parseInt(timeStr);
      const group = markersByTime[timeStr];
      if (group.length === 1) {
        cleanMarkers.push(group[0]);
      } else {
        // Merge texts for overlapping events on the same candle
        const uniqueTexts = Array.from(new Set(group.map(m => m.text).filter(Boolean)));
        const combinedText = uniqueTexts.join(' | ');
        
        // Prioritize trade entry/exit markers over structural markers for shape/color representation
        const tradeMarker = group.find(m => m.shape === 'arrowUp' || m.shape === 'arrowDown');
        const bestMarker = tradeMarker || group[0];
        
        cleanMarkers.push({
          time: time,
          position: bestMarker.position,
          color: bestMarker.color,
          shape: bestMarker.shape,
          text: combinedText
        });
      }
    });

    cleanMarkers.sort((a, b) => a.time - b.time);
    allCleanMarkers = cleanMarkers;
    updateViewportCulling();

    const equityData = results.equityCurve.map(p => {
      return { time: p.time, value: p.value };
    });
    equitySeries.setData(equityData);
    
    // Подгоняем масштаб графиков после бэктеста
    setTimeout(() => {
      // Предотвращаем сброс скролла и прыжки во время активного LIVE-подключения
      if (!liveSocket) {
        if (priceChart) priceChart.timeScale().fitContent();
        if (indicatorChart) indicatorChart.timeScale().fitContent();
      } else {
        // Restore visible range to avoid scroll snap/jump in live mode
        if (priceChart && visibleRangePrice) {
          priceChart.timeScale().setVisibleRange(visibleRangePrice);
        }
        if (indicatorChart && visibleRangeInd) {
          indicatorChart.timeScale().setVisibleRange(visibleRangeInd);
        }
      }
      if (equityChart) {
        const eqContainer = document.getElementById('equity-chart-container');
        if (eqContainer) {
          equityChart.resize(eqContainer.clientWidth, eqContainer.clientHeight);
        }
        equityChart.timeScale().fitContent();
      }
    }, 50);
  }

  // ==========================================
  // ЗАПОЛНЕНИЕ СТАТИСТИКИ
  // ==========================================
  function updatePerformanceMetrics(res) {
    const elEquity = document.getElementById('metric-final-equity');
    elEquity.textContent = `$${res.finalBalance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const elReturn = document.getElementById('metric-total-return');
    elReturn.textContent = `${res.totalReturn >= 0 ? '+' : ''}${res.totalReturn.toFixed(2)}%`;
    elReturn.className = `metric-value ${res.totalReturn >= 0 ? 'positive' : 'negative'}`;
    
    const returnTrend = document.getElementById('metric-return-trend');
    returnTrend.textContent = res.totalReturn >= 0 ? 'trending_up' : 'trending_down';
    returnTrend.className = `metric-trend ${res.totalReturn >= 0 ? 'up' : 'down'} material-symbols-outlined`;

    const elWin = document.getElementById('metric-win-rate');
    elWin.textContent = `${res.winRate.toFixed(1)}%`;
    
    const winTrend = document.getElementById('metric-win-trend');
    winTrend.textContent = `${res.winningTrades} приб. / ${res.losingTrades} убыт.`;
    winTrend.className = 'metric-trend';

    const elSharpe = document.getElementById('metric-sharpe');
    elSharpe.textContent = res.sharpeRatio.toFixed(2);
    
    const sharpeTrend = document.getElementById('metric-sharpe-trend');
    sharpeTrend.textContent = res.sharpeRatio > 1.5 ? 'ОТЛИЧНЫЙ' : res.sharpeRatio > 1 ? 'ХОРОШИЙ' : res.sharpeRatio > 0 ? 'УМЕРЕННЫЙ' : 'ВЫСОКИЙ РИСК';
    sharpeTrend.className = `metric-trend ${res.sharpeRatio > 1 ? 'up' : 'down'}`;

    const elDrawdown = document.getElementById('metric-drawdown');
    elDrawdown.textContent = `-${res.maxDrawdown.toFixed(2)}%`;
    elDrawdown.className = 'metric-value negative';

    const elPf = document.getElementById('metric-profit-factor');
    elPf.textContent = res.profitFactor >= 999 ? '∞' : res.profitFactor.toFixed(2);
    elPf.className = `metric-value ${res.profitFactor >= 1.0 ? 'positive' : 'negative'}`;
    
    const pfTrend = document.getElementById('metric-pf-trend');
    pfTrend.textContent = res.profitFactor >= 1.5 ? 'ВЫСОКОДОХОДНЫЙ' : res.profitFactor >= 1.0 ? 'ПРИБЫЛЬНЫЙ' : 'УБЫТОЧНЫЙ';
    pfTrend.className = `metric-trend ${res.profitFactor >= 1.0 ? 'up' : 'down'}`;

    document.getElementById('lbl-trade-count').textContent = res.trades.length;
  }

  function populateTradesTable(trades) {
    const tbody = document.getElementById('trades-table-body');
    tbody.innerHTML = '';
    
    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="empty-state" style="text-align: center; padding: 40px;">
            <span class="material-symbols-outlined empty-icon">sentiment_dissatisfied</span>
            <p>Стратегия совершила 0 сделок. Попробуйте изменить периоды индикаторов или условия входа.</p>
          </td>
        </tr>
      `;
      return;
    }

    trades.forEach(t => {
      const row = document.createElement('tr');
      row.className = t.pnl >= 0 ? 'row-profit' : 'row-loss';
      
      const fmtTime = (ts) => {
        const d = new Date(ts * 1000);
        return d.toLocaleString('ru-RU', { hour12: false });
      };
      
      row.innerHTML = `
        <td>${t.id}</td>
        <td><span class="badge ${t.type.toLowerCase()}">${t.type === 'LONG' ? 'LONG' : 'SHORT'}</span></td>
        <td>${fmtTime(t.entryTime)}</td>
        <td>${fmtTime(t.exitTime)}</td>
        <td>${t.entryPrice.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 5})}</td>
        <td>${t.exitPrice.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 5})}</td>
        <td>$${t.fees.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="${t.pnl >= 0 ? 'profit' : 'loss'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="${t.pnl >= 0 ? 'profit' : 'loss'}">${t.pnl >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%</td>
        <td><span style="font-size: 11px; font-weight:600; color: var(--text-secondary);">${translateReason(t.exitReason)}</span></td>
        <td>$${t.balance.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      `;
      
      tbody.appendChild(row);
    });

    const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
    filterBtns.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', (e) => {
        filterTradesTable(newBtn.dataset.filter);
      });
    });
  }

  function translateReason(reason) {
    const dict = {
      'STOP_LOSS': 'СТОП ЛОСС',
      'TAKE_PROFIT': 'ТЕЙК ПРОФИТ',
      'LIQUIDATION': 'ЛИКВИДАЦИЯ',
      'STRATEGY': 'СИГНАЛ ВЫХОДА',
      'FORCE_CLOSE': 'ЗАКР. В КОНЦЕ'
    };
    return dict[reason] || reason;
  }

  function filterTradesTable(filterType) {
    const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
    filterBtns.forEach(btn => {
      if (btn.dataset.filter === filterType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const rows = document.querySelectorAll('#trades-table-body tr');
    rows.forEach(row => {
      if (row.cells.length < 5) return;
      const isProfit = row.classList.contains('row-profit');
      
      if (filterType === 'all') {
        row.style.display = '';
      } else if (filterType === 'wins') {
        row.style.display = isProfit ? '' : 'none';
      } else {
        row.style.display = !isProfit ? '' : 'none';
      }
    });
  }

  // ==========================================
  // ЭКСПОРТ И ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ==========================================
  window.exportTradesCSV = function() {
    if (!lastBacktestResult || !lastBacktestResult.trades.length) {
      showToast("Нет сделок для экспорта!", "error");
      return;
    }
    
    let csv = "ID,Type,Entry Time,Exit Time,Entry Price,Exit Price,Fees,PnL ($),PnL (%),Exit Reason,Running Balance\n";
    
    lastBacktestResult.trades.forEach(t => {
      csv += `${t.id},${t.type},"${new Date(t.entryTime*1000).toISOString()}","${new Date(t.exitTime*1000).toISOString()}",${t.entryPrice},${t.exitPrice},${t.fees},${t.pnl},${t.pnlPercent},${t.exitReason},${t.balance}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `quantsphere_report_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("Отчет о сделках успешно экспортирован в CSV!", "success");
  };

  window.loadEditorTemplate = function() {
    const editor = document.getElementById('custom-strategy-code');
    editor.value = `// Объявление индикаторов для предварительного расчета
// Формат: // INDICATOR: [имя] = [Тип]([Параметры])
// Поддерживаемые типы: SMA(period), EMA(period), RSI(period), BB(period, stddev), MACD(fast, slow, signal), ATR(period), SMC(period)

// INDICATOR: emaFast = EMA(9)
// INDICATOR: emaSlow = EMA(21)
// INDICATOR: rsi = RSI(14)

// Инициализация состояния (выполняется один раз при старте)
if (!state.initialized) {
  state.initialized = true;
  state.lastSignal = 'HOLD';
}

// ----------------------------------------------------
// Логика итерации по свечам:
// Вычисляется для каждой свечи по порядку от i = start.
// 'c' - текущая свеча, 'prev' - предыдущая свеча.
// Доступны массивы: 'indicators.emaFast', 'indicators.rsi' и т.д.
// Объект 'position' содержит данные о текущей сделке (если есть)
// ----------------------------------------------------

const currentRsi = indicators.rsi[i];
const fastEMA = indicators.emaFast[i];
const slowEMA = indicators.emaSlow[i];

if (currentRsi === null || fastEMA === null || slowEMA === null) {
  return 'HOLD';
}

// 1. Условие входа: Быстрая EMA пересекает Медленную EMA снизу вверх
const isBullishCross = fastEMA > slowEMA;

if (!position) {
  // Если позиции нет, входим в Long если RSI < 60 и тренд восходящий
  if (isBullishCross && currentRsi < 60) {
    return 'BUY'; // Открыть LONG (покупка)
  }
} else {
  // Условие выхода: если в LONG сделке, выходим при развороте тренда вниз
  if (position.type === 'LONG' && !isBullishCross) {
    return 'EXIT'; // Закрыть сделку
  }
}
return 'HOLD';`;

    showToast("Предустановленный шаблон кода загружен!", "success");
  };

  // No-Code Visual Strategy Builder compiler logic
  function compileNoCode() {
    const buyInd1 = document.getElementById('nc-buy-ind1').value;
    const buyOp = document.getElementById('nc-buy-op').value;
    const buyInd2 = document.getElementById('nc-buy-ind2').value;
    const buyVal = parseFloat(document.getElementById('nc-buy-val').value) || 0;

    const exitInd1 = document.getElementById('nc-exit-ind1').value;
    const exitOp = document.getElementById('nc-exit-op').value;
    const exitInd2 = document.getElementById('nc-exit-ind2').value;
    const exitVal = parseFloat(document.getElementById('nc-exit-val').value) || 0;

    let code = `// Объявление индикаторов для No-Code
// INDICATOR: emaFast = EMA(9)
// INDICATOR: emaSlow = EMA(21)
// INDICATOR: rsi = RSI(14)

if (!state.initialized) {
  state.initialized = true;
}

const c = candles[i];
const prev = candles[i - 1];

// ----------------- ВЫЧИСЛЕНИЕ УСЛОВИЙ BUY -----------------\n`;

    const buildConditionCode = (ind1, op, ind2, val2, prefix) => {
      let lines = ``;
      if (ind1 === 'close') {
        lines += `const prev_${prefix}1 = prev.close;\n`;
        lines += `const curr_${prefix}1 = c.close;\n`;
      } else {
        lines += `const prev_${prefix}1 = indicators.${ind1}[i - 1];\n`;
        lines += `const curr_${prefix}1 = indicators.${ind1}[i];\n`;
      }

      if (ind2 === 'value') {
        lines += `const prev_${prefix}2 = ${val2};\n`;
        lines += `const curr_${prefix}2 = ${val2};\n`;
      } else if (ind2 === 'close') {
        lines += `const prev_${prefix}2 = prev.close;\n`;
        lines += `const curr_${prefix}2 = c.close;\n`;
      } else {
        lines += `const prev_${prefix}2 = indicators.${ind2}[i - 1];\n`;
        lines += `const curr_${prefix}2 = indicators.${ind2}[i];\n`;
      }

      lines += `if (prev_${prefix}1 === null || curr_${prefix}1 === null || prev_${prefix}2 === null || curr_${prefix}2 === null) return 'HOLD';\n`;

      if (op === 'gt') {
        lines += `const trigger_${prefix} = curr_${prefix}1 > curr_${prefix}2;\n`;
      } else if (op === 'lt') {
        lines += `const trigger_${prefix} = curr_${prefix}1 < curr_${prefix}2;\n`;
      } else if (op === 'cross_above') {
        lines += `const trigger_${prefix} = prev_${prefix}1 < prev_${prefix}2 && curr_${prefix}1 >= curr_${prefix}2;\n`;
      } else if (op === 'cross_below') {
        lines += `const trigger_${prefix} = prev_${prefix}1 > prev_${prefix}2 && curr_${prefix}1 <= curr_${prefix}2;\n`;
      }

      return lines;
    };

    code += buildConditionCode(buyInd1, buyOp, buyInd2, buyVal, 'buy');
    code += `\n// ----------------- ВЫЧИСЛЕНИЕ УСЛОВИЙ EXIT -----------------\n`;
    code += buildConditionCode(exitInd1, exitOp, exitInd2, exitVal, 'exit');

    code += `\n// ИСПОЛНЕНИЕ СИГНАЛОВ
if (!position) {
  if (trigger_buy) return 'BUY';
} else {
  if (trigger_exit) return 'EXIT';
}

return 'HOLD';`;

    document.getElementById('custom-strategy-code').value = code;
    showToast("Код No-Code стратегии успешно сгенерирован и перенесен!", "success");

    const strategySelector = document.getElementById('strategy-select');
    if (strategySelector) {
      strategySelector.value = 'custom';
      strategySelector.dispatchEvent(new Event('change'));
    }
  }

  // 5. Live Paper Trading (WebSocket Binance Stream)
  function toggleLiveTrading() {
    const liveBtn = document.getElementById('live-toggle-btn');
    const liveIcon = document.getElementById('live-toggle-icon');
    
    if (liveSocket) {
      liveSocket.close();
      liveSocket = null;
      liveBtn.style.background = '';
      liveBtn.style.borderColor = '';
      liveBtn.style.color = '';
      liveBtn.style.boxShadow = '';
      liveIcon.style.color = '';
      liveIcon.textContent = 'sensors';
      
      showToast("Live-режим отключен. Возврат к историческим данным.", "info");
      loadFreshPriceChart();
      return;
    }

    const dataSelector = document.getElementById('data-source-type');
    if (dataSelector.value !== 'crypto') {
      dataSelector.value = 'crypto';
      dataSelector.dispatchEvent(new Event('change'));
    }

    const symbol = getActiveSymbol();
    const cleanSymbol = symbol.toUpperCase().replace("/", "").replace("-", "");
    
    liveBtn.style.background = 'rgba(16, 185, 129, 0.15)';
    liveBtn.style.borderColor = '#10b981';
    liveBtn.style.color = '#10b981';
    liveBtn.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
    liveIcon.style.color = '#10b981';
    liveIcon.textContent = 'sensors';
    
    showToast(`Запуск Live-режима для ${symbol}. Подключение по WebSocket...`, "success");
    
    liveStartTime = Math.floor(Date.now() / 1000);

    // Instantly reset performance metrics for a clean, professional start of the live trading session
    const initBalance = parseFloat(document.getElementById('param-init-balance').value) || 10000;
    updatePerformanceMetrics({
      initialBalance: initBalance,
      finalBalance: initBalance,
      totalReturn: 0,
      totalTrades: 0,
      winRate: 0,
      winningTrades: 0,
      losingTrades: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      trades: []
    });
    populateTradesTable([]);
    updateMarketRegimeUI({
      regimeStats: {
        BULLISH_TREND: { total: 0, pnl: 0, pct: 0 },
        BEARISH_TREND: { total: 0, pnl: 0, pct: 0 },
        RANGING: { total: 0, pnl: 0, pct: 0 }
      }
    });

    const streamUrl = `wss://stream.binance.com:9443/ws/${cleanSymbol.toLowerCase()}@kline_1m`;
    liveSocket = new WebSocket(streamUrl);
    
    lastLiveTradeCount = 0;
    let isFirstLiveTick = true;
    
    liveSocket.onopen = () => {
      showToast(`WebSocket подключен к Binance! Стрим: ${cleanSymbol} 1m`, "success");
      // Подгоняем масштаб один раз при старте соединения
      if (priceChart) priceChart.timeScale().fitContent();
      if (indicatorChart) indicatorChart.timeScale().fitContent();
    };
    
    liveSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const k = data.k;
        if (!k) return;
        
        const liveCandle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v)
        };
        
        // Update the candle series smoothly in real-time (does not reset scale/scroll)
        candleSeries.update(liveCandle);
        
        const isLight = document.body.classList.contains('light-theme');
        volumeSeries.update({
          time: liveCandle.time,
          value: liveCandle.volume,
          color: liveCandle.close >= liveCandle.open 
            ? (isLight ? 'rgba(16, 185, 129, 0.24)' : 'rgba(0, 255, 136, 0.12)') 
            : (isLight ? 'rgba(239, 68, 68, 0.24)' : 'rgba(255, 71, 87, 0.12)')
        });
        
        const candlesToRun = [...activeCandles];
        if (candlesToRun.length > 0 && candlesToRun[candlesToRun.length - 1].time === liveCandle.time) {
          candlesToRun[candlesToRun.length - 1] = liveCandle;
        } else {
          candlesToRun.push(liveCandle);
        }
        
        if (k.x) {
          activeCandles.push(liveCandle);
        }
        
        // Run full backtest and render indicators ONLY on closed bars (k.x === true) or the first live tick
        if (k.x || isFirstLiveTick) {
          isFirstLiveTick = false;
          
          const strategyId = document.getElementById('strategy-select').value;
          const strategy = getActivatedStrategy(strategyId);
          
          if (!strategy) return;
          
          const riskParams = {
            initialBalance: parseFloat(document.getElementById('param-init-balance').value) || 10000,
            leverage: parseInt(document.getElementById('param-leverage').value) || 1,
            feePercent: parseFloat(document.getElementById('param-fee').value) || 0.05,
            slippagePercent: parseFloat(document.getElementById('param-slippage').value) || 0.02,
            stopLossPercent: parseFloat(document.getElementById('param-stop-loss').value) || 0,
            takeProfitPercent: parseFloat(document.getElementById('param-take-profit').value) || 0,
            trailingSL: document.getElementById('param-trailing-sl').checked,
            positionSizing: document.getElementById('param-position-sizing').value,
            riskPercent: parseFloat(document.getElementById('param-risk-percent').value) || 2,
            pyramiding: document.getElementById('param-pyramiding').checked
          };
          
          const results = BacktestEngine.runBacktest(candlesToRun, strategy, riskParams);
          
          // Фильтруем сделки, оставляя только те, которые произошли с момента включения LIVE
          const liveTradesOnly = results.trades.filter(t => t.entryTime >= liveStartTime || t.exitTime >= liveStartTime);
          // Calculate live session metrics dynamically based on liveTradesOnly and selected initial balance
          const initBalance = parseFloat(document.getElementById('param-init-balance').value) || 10000;
          let liveRealizedBalance = initBalance;
          let liveWins = 0;
          let liveLosses = 0;
          let liveGrossProfit = 0;
          let liveGrossLoss = 0;
          
          liveTradesOnly.forEach(t => {
            liveRealizedBalance += t.pnl;
            if (t.pnl > 0) {
              liveWins++;
              liveGrossProfit += t.pnl;
            } else {
              liveLosses++;
              liveGrossLoss += Math.abs(t.pnl);
            }
          });
          
          const liveTotalReturn = ((liveRealizedBalance - initBalance) / initBalance) * 100;
          const liveTotalTrades = liveTradesOnly.length;
          const liveWinRate = liveTotalTrades > 0 ? (liveWins / liveTotalTrades) * 100 : 0;
          const liveProfitFactor = liveGrossLoss > 0 ? liveGrossProfit / liveGrossLoss : liveGrossProfit > 0 ? 999 : 0;
          
          let livePeak = initBalance;
          let liveCurrentBalance = initBalance;
          let liveMaxDD = 0;
          liveTradesOnly.forEach(t => {
            liveCurrentBalance += t.pnl;
            if (liveCurrentBalance > livePeak) livePeak = liveCurrentBalance;
            const dd = ((livePeak - liveCurrentBalance) / livePeak) * 100;
            if (dd > liveMaxDD) liveMaxDD = dd;
          });
          
          let liveSharpe = 0;
          if (liveTotalTrades >= 3) {
            const returns = liveTradesOnly.map(t => t.pnl / initBalance);
            const avgReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;
            const variance = returns.reduce((acc, r) => acc + Math.pow(r - avgReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);
            if (stdDev > 0) liveSharpe = (avgReturn / stdDev) * Math.sqrt(252);
          }

          let liveBullishCount = 0;
          let liveBearishCount = 0;
          let liveRangingCount = 0;
          let liveCandlesCount = 0;
          
          for (let j = 0; j < candlesToRun.length; j++) {
            if (candlesToRun[j].time >= liveStartTime) {
              liveCandlesCount++;
              const r = results.marketRegimes[j] || 'RANGING';
              if (r === 'BULLISH_TREND') liveBullishCount++;
              else if (r === 'BEARISH_TREND') liveBearishCount++;
              else liveRangingCount++;
            }
          }
          
          const liveRegimeStats = {
            BULLISH_TREND: { 
              count: 0, pnl: 0, wins: 0, total: 0, 
              pct: liveCandlesCount > 0 ? (liveBullishCount / liveCandlesCount) * 100 : 0 
            },
            BEARISH_TREND: { 
              count: 0, pnl: 0, wins: 0, total: 0, 
              pct: liveCandlesCount > 0 ? (liveBearishCount / liveCandlesCount) * 100 : 0 
            },
            RANGING: { 
              count: 0, pnl: 0, wins: 0, total: 0, 
              pct: liveCandlesCount > 0 ? (liveRangingCount / liveCandlesCount) * 100 : 0 
            }
          };
          
          liveTradesOnly.forEach(t => {
            const entryIdx = t.entryIndex !== undefined ? t.entryIndex : 0;
            const regime = results.marketRegimes[entryIdx] || 'RANGING';
            t.entryRegime = regime;
            
            if (liveRegimeStats[regime]) {
              liveRegimeStats[regime].total++;
              liveRegimeStats[regime].pnl += t.pnl;
              if (t.pnl > 0) {
                liveRegimeStats[regime].wins++;
              }
            }
          });

          const resultsForUI = {
            ...results,
            trades: liveTradesOnly,
            initialBalance: initBalance,
            finalBalance: liveRealizedBalance,
            totalReturn: liveTotalReturn,
            totalTrades: liveTotalTrades,
            winRate: liveWinRate,
            winningTrades: liveWins,
            losingTrades: liveLosses,
            profitFactor: liveProfitFactor,
            maxDrawdown: liveMaxDD,
            sharpeRatio: liveSharpe,
            regimeStats: liveRegimeStats
          };
          
          renderBacktestCharts(candlesToRun, resultsForUI, strategy);
          updatePerformanceMetrics(resultsForUI);
          populateTradesTable(resultsForUI.trades);
          updateMarketRegimeUI(resultsForUI);
          
          if (lastLiveTradeCount > 0 && liveTradesOnly.length > lastLiveTradeCount) {
            const newTrade = liveTradesOnly[liveTradesOnly.length - 1];
            const isBuy = newTrade.type === 'LONG';
            playSignalSound(isBuy ? 'buy' : 'sell');
            showToast(`LIVE СИГНАЛ: Открыта сделка ${newTrade.type} по цене ${newTrade.entryPrice.toFixed(2)}!`, "success");
          } else if (lastLiveTradeCount > 0 && liveTradesOnly.length < lastLiveTradeCount) {
            playSignalSound('sell');
            showToast("LIVE СИГНАЛ: Сделка успешно закрыта по рынку!", "success");
          }
          
          lastLiveTradeCount = liveTradesOnly.length;
        }
      } catch(e) {
        console.error("Live streaming tick processing error:", e);
      }
    };
    
    liveSocket.onerror = (err) => {
      console.error("WebSocket live error:", err);
      showToast("Ошибка соединения Live WebSocket Binance.", "error");
    };
    
    liveSocket.onclose = () => {
      console.log("WebSocket live connection closed.");
    };
  }

  function playSignalSound(type = 'buy') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'buy') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440.00, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch(e) {
      console.warn("Web Audio blocked or failed:", e);
    }
  }

  // 3. Grid Search Parameter Optimizer
  async function runGridOptimization() {
    const strategyId = document.getElementById('strategy-select').value;
    if (strategyId === 'custom') {
      showToast("Оптимизатор не поддерживает кастомный JS-код.", "error");
      return;
    }

    const btnOpt = document.getElementById('btn-run-optimization');
    btnOpt.disabled = true;
    btnOpt.innerHTML = `<span class="spinner"></span> Оптимизация...`;

    await new Promise(r => setTimeout(r, 15));

    try {
      const activeStrategy = StrategyRegistry.get(strategyId);
      if (!activeStrategy) return;

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
        showToast("Для данной стратегии нет доступных параметров для оптимизации.", "error");
        return;
      }

      const targetMetric = document.getElementById('opt-metric').value;

      const baseRisk = {
        initialBalance: parseFloat(document.getElementById('param-init-balance').value) || 10000,
        leverage: parseInt(document.getElementById('param-leverage').value) || 1,
        feePercent: parseFloat(document.getElementById('param-fee').value) || 0.05,
        slippagePercent: parseFloat(document.getElementById('param-slippage').value) || 0.02,
        stopLossPercent: parseFloat(document.getElementById('param-stop-loss').value) || 0,
        takeProfitPercent: parseFloat(document.getElementById('param-take-profit').value) || 0,
        trailingSL: document.getElementById('param-trailing-sl').checked,
        positionSizing: document.getElementById('param-position-sizing').value,
        riskPercent: parseFloat(document.getElementById('param-risk-percent').value) || 2,
        pyramiding: document.getElementById('param-pyramiding').checked
      };

      const results = await new Promise((resolve, reject) => {
        const worker = new Worker('backtest-worker.js');
        worker.postMessage({
          type: 'RUN_OPTIMIZATION',
          data: {
            candles: activeCandles,
            strategyId,
            targetMetric,
            baseRisk
          }
        });
        worker.onmessage = function (e) {
          const { type, results: resList, progress, message } = e.data;
          if (type === 'OPTIMIZATION_PROGRESS') {
            btnOpt.innerHTML = `<span class="spinner"></span> Оптимизация (${progress}%)...`;
          } else if (type === 'OPTIMIZATION_SUCCESS') {
            resolve(resList);
            worker.terminate();
          } else if (type === 'ERROR') {
            reject(new Error(message));
            worker.terminate();
          }
        };
        worker.onerror = function (err) {
          reject(err);
          worker.terminate();
        };
      });

      const optContainer = document.getElementById('opt-results-container');
      const optList = document.getElementById('opt-results-list');
      optList.innerHTML = '';
      optContainer.style.display = 'flex';

      const top5 = results.slice(0, 5);
      top5.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'opt-row';
        
        let paramStr = Object.keys(item.combo).map(k => `${k}: ${item.combo[k]}`).join(', ');
        let metricVal = targetMetric === 'totalReturn' 
          ? `${item.runRes.totalReturn.toFixed(2)}% PnL`
          : targetMetric === 'sharpeRatio'
          ? `Шарп: ${item.runRes.sharpeRatio.toFixed(2)}`
          : `Винрейт: ${item.runRes.winRate.toFixed(1)}%`;

        row.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <strong style="color: var(--text-main); font-size: 12px;">#${idx+1} [ ${metricVal} ]</strong>
            <span style="color: var(--text-secondary); font-size: 11px;">${paramStr}</span>
          </div>
          <span class="material-symbols-outlined" style="color: var(--accent-color); font-size: 18px;">arrow_forward</span>
        `;

        row.addEventListener('click', () => {
          Object.keys(item.combo).forEach(k => {
            const input = document.getElementById(`strategy-param-${k}`);
            if (input) input.value = item.combo[k];
          });
          showToast(`Параметры #${idx+1} успешно применены!`, "success");
          runBacktestPipeline();
        });

        optList.appendChild(row);
      });

      // РЕНДЕРИНГ HEATMAP
      const heatmapTitle = document.getElementById('opt-heatmap-title');
      const heatmapGrid = document.getElementById('opt-heatmap-grid');
      
      if (heatmapTitle && heatmapGrid) {
        let p1Name, p2Name;
        let p1Label, p2Label;

        if (strategyId === 'ema_crossover') {
          p1Name = 'fastPeriod';
          p2Name = 'slowPeriod';
          p1Label = 'Fast EMA';
          p2Label = 'Slow EMA';
        } else if (strategyId === 'bb_reversion') {
          p1Name = 'bbPeriod';
          p2Name = 'stdDev';
          p1Label = 'BB Period';
          p2Label = 'Std Dev';
        } else if (strategyId === 'macd_crossover') {
          p1Name = 'fastPeriod';
          p2Name = 'slowPeriod';
          p1Label = 'Fast MACD';
          p2Label = 'Slow MACD';
        } else if (strategyId === 'rsi_reversion') {
          p1Name = 'oversold';
          p2Name = 'overbought';
          p1Label = 'Oversold';
          p2Label = 'Overbought';
        } else if (strategyId === 'smc_ict') {
          p1Name = 'fractalPeriod';
          p2Name = null;
          p1Label = 'Fractal Period';
          p2Label = null;
        }

        if (p1Name) {
          const uniqueP1 = Array.from(new Set(results.map(r => r.combo[p1Name]))).sort((a, b) => a - b);
          const uniqueP2 = p2Name ? Array.from(new Set(results.map(r => r.combo[p2Name]))).sort((a, b) => a - b) : [null];

          const gridData = [];
          let minVal = Infinity;
          let maxVal = -Infinity;

          uniqueP2.forEach(yVal => {
            uniqueP1.forEach(xVal => {
              const matches = results.filter(r => {
                const m1 = r.combo[p1Name] === xVal;
                const m2 = p2Name ? r.combo[p2Name] === yVal : true;
                return m1 && m2;
              });

              if (matches.length > 0) {
                // Выбираем лучший результат для этой ячейки
                matches.sort((a, b) => b.runRes[targetMetric] - a.runRes[targetMetric]);
                const bestMatch = matches[0];
                const val = bestMatch.runRes[targetMetric];
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;

                gridData.push({
                  xVal,
                  yVal,
                  bestMatch,
                  val
                });
              }
            });
          });

          // Очищаем сетку тепловой карты
          heatmapGrid.innerHTML = '';
          heatmapGrid.style.display = 'grid';
          heatmapTitle.style.display = 'block';

          // Задаем колонки: первый столбец фиксированный (35px) для меток оси Y, остальные 1fr
          heatmapGrid.style.gridTemplateColumns = `35px repeat(${uniqueP1.length}, 1fr)`;

          // 1. Заголовки колонок (ось X)
          const cornerCell = document.createElement('div');
          cornerCell.className = 'heatmap-label';
          cornerCell.innerHTML = p2Label ? `<span style="font-size: 8px; opacity: 0.6;">Y\\X</span>` : '';
          heatmapGrid.appendChild(cornerCell);

          uniqueP1.forEach(xVal => {
            const headerCell = document.createElement('div');
            headerCell.className = 'heatmap-label';
            headerCell.textContent = xVal;
            heatmapGrid.appendChild(headerCell);
          });

          // 2. Строки данных
          uniqueP2.forEach(yVal => {
            // Метка строки (ось Y)
            const rowHeaderCell = document.createElement('div');
            rowHeaderCell.className = 'heatmap-label';
            rowHeaderCell.textContent = yVal !== null ? yVal : '';
            heatmapGrid.appendChild(rowHeaderCell);

            uniqueP1.forEach(xVal => {
              const item = gridData.find(d => d.xVal === xVal && d.yVal === yVal);
              const cell = document.createElement('div');

              if (item) {
                cell.className = 'heatmap-cell';
                const val = item.val;
                
                let metricText = '';
                if (targetMetric === 'totalReturn') {
                  metricText = `${val.toFixed(2)}% PnL`;
                } else if (targetMetric === 'sharpeRatio') {
                  metricText = `Шарп: ${val.toFixed(2)}`;
                } else {
                  metricText = `Винрейт: ${val.toFixed(1)}%`;
                }

                cell.title = `${p1Label}: ${xVal}${p2Label ? ', ' + p2Label + ': ' + yVal : ''}\nРезультат: ${metricText}\n\nНажмите, чтобы применить эти параметры!`;

                // Рассчитываем цвет ячейки
                let bgStyle = '';
                if (targetMetric === 'totalReturn') {
                  if (val > 0) {
                    const factor = maxVal > 0 ? val / maxVal : 0.5;
                    const alpha = 0.2 + 0.7 * factor;
                    bgStyle = `rgba(16, 185, 129, ${alpha})`;
                  } else if (val < 0) {
                    const factor = minVal < 0 ? val / minVal : 0.5;
                    const alpha = 0.2 + 0.7 * factor;
                    bgStyle = `rgba(239, 68, 68, ${alpha})`;
                  } else {
                    bgStyle = 'rgba(255, 255, 255, 0.08)';
                  }
                } else {
                  const avg = gridData.reduce((sum, d) => sum + d.val, 0) / gridData.length;
                  if (val >= avg) {
                    const factor = (maxVal - avg) > 0 ? (val - avg) / (maxVal - avg) : 0.5;
                    const alpha = 0.2 + 0.7 * factor;
                    bgStyle = `rgba(16, 185, 129, ${alpha})`;
                  } else {
                    const factor = (avg - minVal) > 0 ? (avg - val) / (avg - minVal) : 0.5;
                    const alpha = 0.2 + 0.7 * factor;
                    bgStyle = `rgba(239, 68, 68, ${alpha})`;
                  }
                }

                cell.style.backgroundColor = bgStyle;
                const textVal = targetMetric === 'totalReturn' ? `${val >= 0 ? '+' : ''}${val.toFixed(0)}%` : val.toFixed(1);
                cell.textContent = textVal;

                // Клик по ячейке
                cell.addEventListener('click', () => {
                  Object.keys(item.bestMatch.combo).forEach(key => {
                    const input = document.getElementById(`strategy-param-${key}`);
                    if (input) input.value = item.bestMatch.combo[key];
                  });
                  showToast(`Параметры успешно применены!`, "success");
                  runBacktestPipeline();
                });
              } else {
                cell.className = 'heatmap-cell';
                cell.style.background = 'rgba(255, 255, 255, 0.02)';
                cell.style.cursor = 'not-allowed';
                cell.textContent = '-';
              }

              heatmapGrid.appendChild(cell);
            });
          });

          // Подпись осей и легенда
          const axesInfo = document.createElement('div');
          axesInfo.className = 'heatmap-axis-label';
          axesInfo.innerHTML = `Ось X: <strong>${p1Label}</strong>${p2Label ? ` | Ось Y: <strong>${p2Label}</strong>` : ''}<br><span style="font-size: 8.5px; opacity: 0.7;">🟢 Ярче зеленый = лучше | 🔴 Ярче красный = хуже</span>`;
          heatmapGrid.appendChild(axesInfo);
        }
      }

      showToast(`Оптимизация завершена! Найдено ${results.length} комбинаций.`, "success");

    } catch(err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      btnOpt.disabled = false;
      btnOpt.innerHTML = `<span class="material-symbols-outlined">bolt</span> Запустить оптимизацию`;
    }
  }

  // 4. Market Regime UI Updater
  function updateMarketRegimeUI(res) {
    if (!res || !res.regimeStats) return;
    const stats = res.regimeStats;
    
    document.getElementById('regime-bullish-pct').textContent = `${stats.BULLISH_TREND.pct.toFixed(1)}%`;
    document.getElementById('regime-bearish-pct').textContent = `${stats.BEARISH_TREND.pct.toFixed(1)}%`;
    document.getElementById('regime-ranging-pct').textContent = `${stats.RANGING.pct.toFixed(1)}%`;
    
    const formatPnl = (pnl, count) => {
      const formatted = pnl >= 0 ? `+$${pnl.toLocaleString('ru-RU', {minimumFractionDigits: 2})}` : `-$${Math.abs(pnl).toLocaleString('ru-RU', {minimumFractionDigits: 2})}`;
      return `${formatted} (${count} сдел.)`;
    };
    
    const elBullPnl = document.getElementById('regime-bullish-pnl');
    elBullPnl.textContent = formatPnl(stats.BULLISH_TREND.pnl, stats.BULLISH_TREND.total);
    elBullPnl.style.color = stats.BULLISH_TREND.pnl >= 0 ? 'var(--color-long)' : 'var(--color-short)';
    
    const elBearPnl = document.getElementById('regime-bearish-pnl');
    elBearPnl.textContent = formatPnl(stats.BEARISH_TREND.pnl, stats.BEARISH_TREND.total);
    elBearPnl.style.color = stats.BEARISH_TREND.pnl >= 0 ? 'var(--color-long)' : 'var(--color-short)';
    
    const elRangePnl = document.getElementById('regime-ranging-pnl');
    elRangePnl.textContent = formatPnl(stats.RANGING.pnl, stats.RANGING.total);
    elRangePnl.style.color = stats.RANGING.pnl >= 0 ? 'var(--color-long)' : 'var(--color-short)';
  }

  // 5. Portfolio backtest pipeline
  async function runPortfolioBacktestPipeline(strategy, riskParams) {
    const assetCheckboxes = document.querySelectorAll('.portfolio-asset-cb:checked');
    const assets = Array.from(assetCheckboxes).map(cb => cb.value);
    
    if (assets.length === 0) {
      throw new Error("Пожалуйста, выберите хотя бы один актив для портфельного бэктеста!");
    }

    const timeframe = document.getElementById('crypto-timeframe').value;
    showToast(`Запуск портфельного теста по активам: ${assets.join(', ')}...`, 'success');

    const fetchPromises = assets.map(asset => DataProvider.fetchBinanceData(asset, timeframe, 1000));
    const assetCandlesList = await Promise.all(fetchPromises);
    
    const backtestRuns = assetCandlesList.map((candles, idx) => {
      return {
        asset: assets[idx],
        candles: candles,
        result: BacktestEngine.runBacktest(candles, strategy, riskParams)
      };
    });

    const combinedCurve = [];
    const minLength = Math.min(...backtestRuns.map(run => run.result.equityCurve.length));
    
    for (let i = 0; i < minLength; i++) {
      let mergedVal = 0;
      let mergedBal = 0;
      let timestamp = backtestRuns[0].result.equityCurve[i].time;
      
      backtestRuns.forEach(run => {
        mergedVal += run.result.equityCurve[i].value;
        mergedBal += run.result.equityCurve[i].balance;
      });

      combinedCurve.push({
        time: timestamp,
        value: mergedVal,
        balance: mergedBal
      });
    }

    const combinedTrades = [];
    backtestRuns.forEach(run => {
      run.result.trades.forEach(t => {
        t.asset = run.asset;
        combinedTrades.push(t);
      });
    });
    combinedTrades.sort((a, b) => a.entryTime - b.entryTime);
    combinedTrades.forEach((t, idx) => t.id = idx + 1);

    const initialBalanceSum = backtestRuns.reduce((acc, r) => acc + r.result.initialBalance, 0);
    const finalBalanceSum = backtestRuns.reduce((acc, r) => acc + r.result.finalBalance, 0);
    const totalReturnCombined = ((finalBalanceSum - initialBalanceSum) / initialBalanceSum) * 100;
    
    const winsCount = combinedTrades.filter(t => t.pnl > 0).length;
    const lossesCount = combinedTrades.filter(t => t.pnl <= 0).length;
    const totalTradesCount = combinedTrades.length;
    const winRateCombined = totalTradesCount > 0 ? (winsCount / totalTradesCount) * 100 : 0;

    let maxDdCombined = 0;
    let peak = initialBalanceSum;
    combinedCurve.forEach(p => {
      if (p.value > peak) peak = p.value;
      const dd = ((peak - p.value) / peak) * 100;
      if (dd > maxDdCombined) maxDdCombined = dd;
    });

    const profitFactorCombined = backtestRuns.reduce((acc, r) => acc + r.result.grossProfit, 0) / 
      Math.max(1, Math.abs(backtestRuns.reduce((acc, r) => acc + r.result.grossLoss, 0)));

    const sharpeAvg = backtestRuns.reduce((acc, r) => acc + r.result.sharpeRatio, 0) / backtestRuns.length;

    const mergedResults = {
      initialBalance: initialBalanceSum,
      finalBalance: finalBalanceSum,
      totalReturn: totalReturnCombined,
      totalTrades: totalTradesCount,
      winRate: winRateCombined,
      winningTrades: winsCount,
      losingTrades: lossesCount,
      grossProfit: backtestRuns.reduce((acc, r) => acc + r.result.grossProfit, 0),
      grossLoss: backtestRuns.reduce((acc, r) => acc + r.result.grossLoss, 0),
      profitFactor: profitFactorCombined,
      profitLossRatio: backtestRuns.reduce((acc, r) => acc + r.result.profitLossRatio, 0) / backtestRuns.length,
      maxDrawdown: maxDdCombined,
      sharpeRatio: sharpeAvg,
      sortinoRatio: backtestRuns.reduce((acc, r) => acc + r.result.sortinoRatio, 0) / backtestRuns.length,
      trades: combinedTrades,
      equityCurve: combinedCurve,
      indicators: {},
      marketRegimes: backtestRuns[0].result.marketRegimes,
      regimeStats: backtestRuns[0].result.regimeStats
    };

    lastBacktestResult = mergedResults;

    renderBacktestCharts(backtestRuns[0].candles, mergedResults, strategy);
    updatePerformanceMetrics(mergedResults);
    populateTradesTable(mergedResults.trades);
    overrideTradesTableWithTicker();

    showToast(`Портфельный бэктест выполнен! Всего сделок: ${totalTradesCount}`, 'success');
  }

  function overrideTradesTableWithTicker() {
    const rows = document.querySelectorAll('#trades-table-body tr');
    rows.forEach((row, idx) => {
      if (row.cells.length < 5) return;
      const t = lastBacktestResult.trades[idx];
      if (t && t.asset) {
        const badgeCell = row.cells[1];
        badgeCell.innerHTML = `<span class="badge" style="background: rgba(255,255,255,0.06); color: #fff; margin-right: 4px;">${t.asset}</span>` + badgeCell.innerHTML;
      }
    });
  }

  // 6. Conclusion Smart Modal Popup
  function showReportModal(res) {
    const modal = document.getElementById('report-modal');
    modal.style.display = 'flex';

    document.getElementById('report-sharpe-score').textContent = res.sharpeRatio.toFixed(2);
    document.getElementById('report-drawdown-score').textContent = `-${res.maxDrawdown.toFixed(2)}%`;
    document.getElementById('report-pf-score').textContent = res.profitFactor >= 999 ? '∞' : res.profitFactor.toFixed(2);

    let finalScore = (res.totalReturn * 0.4 + res.sharpeRatio * 30 + (100 - res.maxDrawdown) * 0.3).toFixed(1);
    document.getElementById('report-final-score').textContent = `${finalScore} / 100`;

    let advice = "";
    if (res.totalReturn > 0) {
      advice += `Стратегия демонстрирует положительную доходность (+${res.totalReturn.toFixed(1)}%). `;
    } else {
      advice += "Внимание: стратегия является убыточной на данном отрезке времени. ";
    }

    if (res.sharpeRatio > 1.2) {
      advice += "Высокий коэффициент Шарпа подтверждает высокую стабильность доходности. ";
    } else {
      advice += "Низкая стабильность указывает на высокую тряску баланса. Рекомендуется использовать EMA тренд-фильтры. ";
    }

    if (res.maxDrawdown > 15) {
      advice += `Критический уровень максимальной просадки (${res.maxDrawdown.toFixed(1)}%) подвергает ваш баланс опасности ликвидации. Рекомендуется снизить кредитное плечо до 2x-3x или включить ATR-расчет объемов. `;
    }
    document.getElementById('report-verdict-text').textContent = advice;
  }

  let activeTool = 'cursor';
  let firstClick = null;
  let previewSeries = null;
  let customPriceLines = [];
  let customDrawingsList = [];
  let selectedDrawingId = null;

  const inMemoryDrawings = {};
  let allCleanMarkers = [];
  let isCullingActive = false;

  async function initDrawingsForSymbol(symbol) {
    const upperSymbol = symbol.toUpperCase();
    if (inMemoryDrawings[upperSymbol]) return inMemoryDrawings[upperSymbol];
    if (window.DbProvider) {
      const dbDrawings = await window.DbProvider.getDrawings(upperSymbol);
      if (dbDrawings) {
        inMemoryDrawings[upperSymbol] = dbDrawings;
        return dbDrawings;
      }
    }
    // Fallback/migration from localStorage
    const localData = localStorage.getItem(`qs-drawings-${upperSymbol}`);
    if (localData) {
      try {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed)) {
          inMemoryDrawings[upperSymbol] = parsed;
          if (window.DbProvider) {
            window.DbProvider.saveDrawings(upperSymbol, parsed);
          }
          localStorage.removeItem(`qs-drawings-${upperSymbol}`);
          return parsed;
        }
      } catch (e) {
        console.warn("Error migrating drawings from localStorage:", e);
      }
    }
    inMemoryDrawings[upperSymbol] = [];
    return [];
  }

  function getSavedDrawings(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return inMemoryDrawings[upperSymbol] || [];
  }

  function saveSavedDrawings(symbol, drawings) {
    const upperSymbol = symbol.toUpperCase();
    inMemoryDrawings[upperSymbol] = drawings;
    if (window.DbProvider) {
      window.DbProvider.saveDrawings(upperSymbol, drawings).catch(err => {
        console.error("Failed to save drawings to db:", err);
      });
    } else {
      localStorage.setItem(`qs-drawings-${upperSymbol}`, JSON.stringify(drawings));
    }
    saveWorkspaceAuto();
  }

  // Serialize current workspace state
  function getWorkspaceState() {
    const isLight = document.body.classList.contains('light-theme');
    const geminiKey = document.getElementById('ai-gemini-key')?.value || '';
    const geminiModel = document.getElementById('ai-model-select')?.value || 'gemini-3.5-flash';
    const strategyId = document.getElementById('strategy-select')?.value || 'ema_crossover';
    const customCode = document.getElementById('custom-strategy-code')?.value || '';

    const risk = {
      initialBalance: parseFloat(document.getElementById('param-init-balance')?.value) || 10000,
      leverage: parseInt(document.getElementById('param-leverage')?.value) || 1,
      feePercent: parseFloat(document.getElementById('param-fee')?.value) || 0.05,
      slippagePercent: parseFloat(document.getElementById('param-slippage')?.value) || 0.02,
      stopLossPercent: parseFloat(document.getElementById('param-stop-loss')?.value) || 0,
      takeProfitPercent: parseFloat(document.getElementById('param-take-profit')?.value) || 0,
      trailingSL: document.getElementById('param-trailing-sl')?.checked || false,
      positionSizing: document.getElementById('param-position-sizing')?.value || 'fixed',
      riskPercent: parseFloat(document.getElementById('param-risk-percent')?.value) || 2,
      pyramiding: document.getElementById('param-pyramiding')?.checked || false,
      portfolioMode: document.getElementById('param-portfolio-mode')?.checked || false
    };

    return {
      theme: isLight ? 'light' : 'dark',
      gemini: { key: geminiKey, model: geminiModel },
      strategy: { selected: strategyId, customCode: customCode },
      risk: risk
    };
  }

  // Apply workspace state to DOM
  function applyWorkspaceState(state) {
    if (!state) return;

    // Apply theme
    const isLight = state.theme === 'light';
    if (isLight) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      themeIcon.textContent = isLight ? 'dark_mode' : 'light_mode';
    }
    localStorage.setItem('qs-theme', state.theme || 'dark');

    // Apply Gemini settings
    const geminiKeyInput = document.getElementById('ai-gemini-key');
    if (geminiKeyInput && state.gemini?.key !== undefined) {
      geminiKeyInput.value = state.gemini.key;
      localStorage.setItem('qs-gemini-key', state.gemini.key);
    }
    const geminiModelSelect = document.getElementById('ai-model-select');
    if (geminiModelSelect && state.gemini?.model !== undefined) {
      geminiModelSelect.value = state.gemini.model;
      localStorage.setItem('qs-gemini-model', state.gemini.model);
    }

    // Apply Strategy selection
    const strategySelect = document.getElementById('strategy-select');
    if (strategySelect && state.strategy?.selected) {
      strategySelect.value = state.strategy.selected;
      renderStrategyParams(state.strategy.selected);
    }

    // Apply custom strategy code
    const customCodeArea = document.getElementById('custom-strategy-code');
    if (customCodeArea && state.strategy?.customCode !== undefined) {
      customCodeArea.value = state.strategy.customCode;
    }

    // Apply Risk settings
    if (state.risk) {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      };
      const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = val;
      };

      if (state.risk.initialBalance !== undefined) setVal('param-init-balance', state.risk.initialBalance);
      if (state.risk.leverage !== undefined) setVal('param-leverage', state.risk.leverage);
      if (state.risk.feePercent !== undefined) setVal('param-fee', state.risk.feePercent);
      if (state.risk.slippagePercent !== undefined) setVal('param-slippage', state.risk.slippagePercent);
      if (state.risk.stopLossPercent !== undefined) setVal('param-stop-loss', state.risk.stopLossPercent);
      if (state.risk.takeProfitPercent !== undefined) setVal('param-take-profit', state.risk.takeProfitPercent);
      if (state.risk.trailingSL !== undefined) setChecked('param-trailing-sl', state.risk.trailingSL);
      if (state.risk.positionSizing !== undefined) setVal('param-position-sizing', state.risk.positionSizing);
      if (state.risk.riskPercent !== undefined) setVal('param-risk-percent', state.risk.riskPercent);
      if (state.risk.pyramiding !== undefined) setChecked('param-pyramiding', state.risk.pyramiding);
      if (state.risk.portfolioMode !== undefined) setChecked('param-portfolio-mode', state.risk.portfolioMode);
    }
  }

  // Auto-save workspace
  function saveWorkspaceAuto() {
    if (window.DbProvider) {
      const state = getWorkspaceState();
      window.DbProvider.saveWorkspace('default', state).catch(e => {
        console.warn("Failed to auto-save workspace state:", e);
      });
    }
  }

  // Setup input change event listeners to auto-save workspace
  function setupWorkspaceAutoSaveListeners() {
    const inputs = [
      'ai-gemini-key', 'ai-model-select', 'strategy-select', 'custom-strategy-code',
      'param-init-balance', 'param-leverage', 'param-fee', 'param-slippage',
      'param-stop-loss', 'param-take-profit', 'param-trailing-sl',
      'param-position-sizing', 'param-risk-percent', 'param-pyramiding', 'param-portfolio-mode'
    ];

    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
          saveWorkspaceAuto();
        });
      }
    });
  }

  // Viewport Culling logic to maintain 60fps rendering
  function updateViewportCulling() {
    if (!priceChart || !candleSeries || isCullingActive) return;
    isCullingActive = true;
    
    try {
      const visibleRange = priceChart.timeScale().getVisibleRange();
      if (!visibleRange || visibleRange.from === null || visibleRange.to === null) {
        isCullingActive = false;
        return;
      }
      
      const fromTime = typeof visibleRange.from === 'number' ? visibleRange.from : visibleRange.from.time;
      const toTime = typeof visibleRange.to === 'number' ? visibleRange.to : visibleRange.to.time;
      
      // 1. Cull Trend Lines (Series)
      customDrawingsList.forEach(item => {
        if (!item || !item.start || !item.end) return;
        const startT = getSortableTime(item.start.time);
        const endT = getSortableTime(item.end.time);
        const minT = Math.min(startT, endT);
        const maxT = Math.max(startT, endT);
        
        // Add buffer (10 candles) to avoid flickering at screen edges
        const buffer = 10 * (activeCandles.length > 1 ? (activeCandles[1].time - activeCandles[0].time) : 3600);
        const isVisible = (maxT >= fromTime - buffer) && (minT <= toTime + buffer);
        
        if (isVisible) {
          if (item.mainSeries && item.isCleared) {
            let dataArray = [
              { time: item.start.time, value: item.start.price },
              { time: item.end.time, value: item.end.price }
            ];
            dataArray.sort((a, b) => getSortableTime(a.time) - getSortableTime(b.time));
            item.mainSeries.setData(dataArray);
            
            if (item.wing1Series && item.wing1Data) {
              item.wing1Series.setData(item.wing1Data);
            }
            if (item.wing2Series && item.wing2Data) {
              item.wing2Series.setData(item.wing2Data);
            }
            item.isCleared = false;
          }
        } else {
          if (item.mainSeries && !item.isCleared) {
            item.mainSeries.setData([]);
            if (item.wing1Series) item.wing1Series.setData([]);
            if (item.wing2Series) item.wing2Series.setData([]);
            item.isCleared = true;
          }
        }
      });
      
      // 2. Cull Markers (Trades, BOS/CHoCH)
      if (allCleanMarkers && allCleanMarkers.length > 0) {
        const buffer = 15 * (activeCandles.length > 1 ? (activeCandles[1].time - activeCandles[0].time) : 3600);
        const visibleMarkers = allCleanMarkers.filter(m => {
          const mTime = getSortableTime(m.time);
          return mTime >= fromTime - buffer && mTime <= toTime + buffer;
        });
        candleSeries.setMarkers(visibleMarkers);
      }
    } catch (e) {
      console.warn("Viewport culling error:", e);
    } finally {
      isCullingActive = false;
    }
  }

  // Вспомогательные функции для работы со временем в Lightweight Charts (Оптимизировано без JSON.stringify)
  function getSavedDrawings(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return inMemoryDrawings[upperSymbol] || [];
  }

  function getActivatedStrategy(strategyId) {
    if (strategyId === 'custom') {
      const userCode = document.getElementById('custom-strategy-code').value;
      return StrategyRegistry.compileCustom(userCode);
    }
    
    const rawStrategy = StrategyRegistry.get(strategyId);
    if (!rawStrategy) return null;
    const strategy = { ...rawStrategy };
    
    // Bridge dynamic GUI parameters to the strategy instance cleanly
    strategy.activeParams = {
      fastPeriod: parseInt(document.getElementById('strategy-param-fastPeriod')?.value) || 9,
      slowPeriod: parseInt(document.getElementById('strategy-param-slowPeriod')?.value) || 21,
      rsiPeriod: parseInt(document.getElementById('strategy-param-rsiPeriod')?.value) || 14,
      oversold: parseInt(document.getElementById('strategy-param-oversold')?.value) || 30,
      overbought: parseInt(document.getElementById('strategy-param-overbought')?.value) || 70,
      bbPeriod: parseInt(document.getElementById('strategy-param-bbPeriod')?.value) || 20,
      stdDev: parseFloat(document.getElementById('strategy-param-stdDev')?.value) || 2,
      fast: parseInt(document.getElementById('strategy-param-fastPeriod')?.value) || 12,
      slow: parseInt(document.getElementById('strategy-param-slowPeriod')?.value) || 26,
      signal: parseInt(document.getElementById('strategy-param-signalPeriod')?.value) || 9,
      fractalPeriod: parseInt(document.getElementById('strategy-param-fractalPeriod')?.value) || 2,
      entryMode: parseInt(document.getElementById('strategy-param-entryMode')?.value) || 2
    };
    
    const overridenIndicators = [];
    if (strategyId === 'ema_crossover') {
      overridenIndicators.push({ name: 'emaFast', type: 'EMA', period: strategy.activeParams.fastPeriod });
      overridenIndicators.push({ name: 'emaSlow', type: 'EMA', period: strategy.activeParams.slowPeriod });
      strategy.indicators = overridenIndicators;
    } else if (strategyId === 'rsi_reversion') {
      overridenIndicators.push({ name: 'rsi', type: 'RSI', period: strategy.activeParams.rsiPeriod });
      strategy.indicators = overridenIndicators;
    } else if (strategyId === 'bb_reversion') {
      overridenIndicators.push({ name: 'bb', type: 'BB', period: strategy.activeParams.bbPeriod, stdDev: strategy.activeParams.stdDev });
      strategy.indicators = overridenIndicators;
    } else if (strategyId === 'macd_crossover') {
      overridenIndicators.push({ name: 'macd', type: 'MACD', fast: strategy.activeParams.fast, slow: strategy.activeParams.slow, signal: strategy.activeParams.signal });
      strategy.indicators = overridenIndicators;
    } else if (strategyId === 'smc_ict') {
      overridenIndicators.push({ name: 'smc', type: 'SMC', period: strategy.activeParams.fractalPeriod });
      strategy.indicators = overridenIndicators;
    }
    
    return strategy;
  }

  function timesAreEqual(t1, t2) {
    if (!t1 || !t2) return false;
    const s1 = getSortableTime(t1);
    const s2 = getSortableTime(t2);
    return s1 > 0 && s2 > 0 && s1 === s2;
  }

  function getSortableTime(t) {
    if (t instanceof Date) {
      return t.getTime() / 1000;
    }
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      if (t.includes('-') || t.includes('/') || t.includes('.')) {
        const parsed = new Date(t.replace(/\./g, '/')).getTime();
        if (!isNaN(parsed)) return parsed / 1000;
      }
      const num = parseFloat(t);
      return isNaN(num) ? Math.floor(Date.now() / 1000) : num;
    }
    if (typeof t === 'object' && t !== null) {
      if (t.year !== undefined) {
        const m = t.month !== undefined ? t.month : 1;
        const d = t.day !== undefined ? t.day : 1;
        return new Date(t.year, m - 1, d).getTime() / 1000;
      }
    }
    return Math.floor(Date.now() / 1000); // Safe fallback to avoid 0 values
  }

  function initDrawingTools() {
    const btns = document.querySelectorAll('.draw-tool-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTool = btn.id.replace('tool-', '');
        
        // Очищаем превью линию при переключении инструментов
        if (window.previewFrameId) {
          cancelAnimationFrame(window.previewFrameId);
          window.previewFrameId = null;
        }
        if (previewSeries) {
          try { previewSeries.setData([]); } catch(e){}
        }
        firstClick = null;
        
        if (activeTool === 'clear') {
          if (window.previewFrameId) {
            cancelAnimationFrame(window.previewFrameId);
            window.previewFrameId = null;
          }
          if (previewSeries) {
            try { previewSeries.setData([]); } catch(e){}
          }
          firstClick = null;

          customPriceLines.forEach(l => {
            try { candleSeries.removePriceLine(l); } catch(e){}
          });
          customPriceLines = [];
          
          customDrawingsList.forEach(s => {
            try { priceChart.removeSeries(s); } catch(e){}
          });
          customDrawingsList = [];

          const symbol = getActiveSymbol();
          inMemoryDrawings[symbol.toUpperCase()] = [];
          if (window.DbProvider) {
            window.DbProvider.saveDrawings(symbol, []).catch(err => console.error(err));
          }
          localStorage.removeItem(`qs-drawings-${symbol}`);
          showToast("Все графические фигуры успешно стерты!", "success");
          
          // Safe and direct active tool reset to avoid DOM click loops
          activeTool = 'cursor';
          btns.forEach(b => {
            if (b.id === 'tool-cursor') b.classList.add('active');
            else b.classList.remove('active');
          });
        }
      });
    });

    // Global keydown listener for selected drawing deletion
    if (!window.hasDrawingDeleteListener) {
      window.hasDrawingDeleteListener = true;
      window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
          const activeEl = document.activeElement;
          if (activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.classList.contains('ace_text-input')
          )) {
            return; // ignore if user is typing
          }
          e.preventDefault();
          const targetId = selectedDrawingId;
          selectedDrawingId = null;
          removeSpecificDrawing(targetId);
        }
      });
    }

    setTimeout(() => {
      loadSavedDrawings();
    }, 1000);
  }

  function getActiveSymbol() {
    const sourceType = document.getElementById('data-source-type').value;
    if (sourceType === 'crypto') return document.getElementById('crypto-symbol').value;
    if (sourceType === 'demo') return document.getElementById('demo-asset').value;
    return 'CSV';
  }

  // Вспомогательные функции для расчета крыльев стрелки и выборочного удаления
  function getClosestCandleIndex(time) {
    if (!activeCandles || activeCandles.length === 0) return -1;
    const timeSec = getSortableTime(time);
    let minDiff = Infinity;
    let closestIdx = -1;
    for (let i = 0; i < activeCandles.length; i++) {
      const diff = Math.abs(getSortableTime(activeCandles[i].time) - timeSec);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  function getAverageCandleRange() {
    if (!activeCandles || activeCandles.length === 0) return 0;
    const start = Math.max(0, activeCandles.length - 50);
    let sum = 0;
    for (let i = start; i < activeCandles.length; i++) {
      sum += Math.abs(activeCandles[i].high - activeCandles[i].low);
    }
    return sum / (activeCandles.length - start);
  }

  function calculateArrowheadPoints(start, end) {
    if (activeCandles && activeCandles.length > 0 && priceChart && candleSeries) {
      const xStart = priceChart.timeScale().timeToCoordinate(start.time);
      const xEnd = priceChart.timeScale().timeToCoordinate(end.time);
      const yStart = candleSeries.priceToCoordinate(start.price);
      const yEnd = candleSeries.priceToCoordinate(end.price);
      
      if (xStart !== null && xEnd !== null && yStart !== null && yEnd !== null) {
        const dX = xEnd - xStart;
        const dY = yEnd - yStart;
        const L = Math.sqrt(dX * dX + dY * dY);
        
        if (L > 0) {
          const uX = dX / L;
          const uY = dY / L;
          
          const arrowLenPx = Math.max(12, Math.min(35, L * 0.2));
          const arrowWidthPx = arrowLenPx * 0.55;
          
          const baseX = xEnd - arrowLenPx * uX;
          const baseY = yEnd - arrowLenPx * uY;
          
          const wing1X = baseX - arrowWidthPx * uY;
          const wing1Y = baseY + arrowWidthPx * uX;
          
          const wing2X = baseX + arrowWidthPx * uY;
          const wing2Y = baseY - arrowWidthPx * uX;
          
          const getInterpTime = (px) => {
            const l = priceChart.timeScale().coordinateToLogical(px);
            if (l === null || isNaN(l) || !isFinite(l)) return end.time;
            const idx = Math.floor(l);
            if (isNaN(idx) || !isFinite(idx)) return end.time;
            const i1 = Math.max(0, Math.min(activeCandles.length - 1, idx));
            const i2 = Math.max(0, Math.min(activeCandles.length - 1, idx + 1));
            if (isNaN(i1) || isNaN(i2) || !activeCandles[i1] || !activeCandles[i2]) return end.time;
            if (i1 === i2) return activeCandles[i1].time;
            const t1 = getSortableTime(activeCandles[i1].time);
            const t2 = getSortableTime(activeCandles[i2].time);
            const t = t1 + (l - i1) * (t2 - t1);
            return typeof end.time === 'number' ? Math.round(t) : t;
          };
          
          const tWing1 = getInterpTime(wing1X);
          const tWing2 = getInterpTime(wing2X);
          const pWing1 = candleSeries.coordinateToPrice(wing1Y);
          const pWing2 = candleSeries.coordinateToPrice(wing2Y);
          
          if (pWing1 !== null && pWing2 !== null) {
            return {
              tBase: end.time,
              tWing1, tWing2,
              wing1Price: pWing1, wing2Price: pWing2
            };
          }
        }
      }
    }
    
    // Запасной метод по таймстемпам (fallback)
    const tStart = getSortableTime(start.time);
    const tEnd = getSortableTime(end.time);
    const dt = tEnd - tStart;
    const tBaseVal = tEnd - dt * 0.12;
    const tBase = typeof end.time === 'number' ? Math.round(tBaseVal) : end.time;
    const pBase = start.price + (end.price - start.price) * 0.88;
    const priceOffset = Math.abs(end.price) * 0.002;
    
    return {
      tBase,
      tWing1: tBase,
      tWing2: tBase,
      wing1Price: pBase + priceOffset,
      wing2Price: pBase - priceOffset
    };
  }

  function renderArrowOnChart(id, start, end, color, isSelected = false) {
    // Защита от зависания Lightweight Charts при рисовании линии с одинаковым временем старта и финиша
    if (timesAreEqual(start.time, end.time)) {
      return null;
    }

    const lineWidth = isSelected ? 4 : 2.5;
    
    // 1. Рисуем основное тело стрелки (линию) без бесконечной линии цен и без лишних маркеров-точек
    const mainSeries = priceChart.addLineSeries({
      color: color,
      lineWidth: lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: ''
    });
    
    const dataArray = [
      { time: start.time, value: start.price },
      { time: end.time, value: end.price }
    ];
    dataArray.sort((a, b) => getSortableTime(a.time) - getSortableTime(b.time));
    mainSeries.setData(dataArray);
    
    let wing1Series = null;
    let wing2Series = null;
    let wing1Data = [];
    let wing2Data = [];

    // 2. Рисуем крылья наконечника стрелки (две косые палочки)
    try {
      const points = calculateArrowheadPoints(start, end);
      
      const endIdx = getClosestCandleIndex(end.time);
      let tWing1 = points.tWing1;
      let tWing2 = points.tWing2;
      
      // Защита от дублирующихся ключей времени (Lightweight Charts запрещает одинаковое время для точек серии)
      if (timesAreEqual(tWing1, end.time) && endIdx > 0) {
        tWing1 = activeCandles[endIdx - 1].time;
      }
      if (timesAreEqual(tWing2, end.time) && endIdx > 0) {
        tWing2 = activeCandles[endIdx - 1].time;
      }
      
      // Крыло 1
      wing1Series = priceChart.addLineSeries({
        color: color,
        lineWidth: lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      // Если время начала и конца крыла совпадают, передаем только одну точку во избежание зависаний в Lightweight Charts
      wing1Data = timesAreEqual(tWing1, end.time)
        ? [ { time: end.time, value: end.price } ]
        : [
            { time: tWing1, value: points.wing1Price },
            { time: end.time, value: end.price }
          ];
      wing1Data.sort((a, b) => getSortableTime(a.time) - getSortableTime(b.time));
      wing1Series.setData(wing1Data);
      
      // Крыло 2
      wing2Series = priceChart.addLineSeries({
        color: color,
        lineWidth: lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      wing2Data = timesAreEqual(tWing2, end.time)
        ? [ { time: end.time, value: end.price } ]
        : [
            { time: tWing2, value: points.wing2Price },
            { time: end.time, value: end.price }
          ];
      wing2Data.sort((a, b) => getSortableTime(a.time) - getSortableTime(b.time));
      wing2Series.setData(wing2Data);
    } catch (e) {
      console.error("Ошибка при рисовании наконечника стрелки:", e);
    }
    
    return {
      id: id,
      type: 'trend',
      start: start,
      end: end,
      mainSeries: mainSeries,
      wing1Series: wing1Series,
      wing2Series: wing2Series,
      wing1Data: wing1Data,
      wing2Data: wing2Data
    };
  }

  function updateDrawingVisualStates() {
    const isLight = document.body.classList.contains('light-theme');
    
    // Обновляем трендовые линии
    customDrawingsList.forEach(item => {
      if (item && item.type === 'trend') {
        const isSelected = item.id === selectedDrawingId;
        const trendColor = isSelected ? '#eab308' : (isLight ? '#6366f1' : '#a78bfa');
        const lineWidth = isSelected ? 4 : 2.5;
        
        if (item.mainSeries) {
          try {
            item.mainSeries.applyOptions({
              color: trendColor,
              lineWidth: lineWidth
            });
          } catch(e){}
        }
        if (item.wing1Series) {
          try {
            item.wing1Series.applyOptions({
              color: trendColor,
              lineWidth: lineWidth
            });
          } catch(e){}
        }
        if (item.wing2Series) {
          try {
            item.wing2Series.applyOptions({
              color: trendColor,
              lineWidth: lineWidth
            });
          } catch(e){}
        }
      }
    });

    // Обновляем горизонтальные уровни
    customPriceLines.forEach(item => {
      if (item && item.type === 'horizontal' && item.priceLine) {
        const isSelected = item.id === selectedDrawingId;
        const levelColor = isSelected ? '#eab308' : (isLight ? '#f43f5e' : '#ff4a6b');
        const lineWidth = isSelected ? 4 : 2;
        
        try {
          item.priceLine.applyOptions({
            color: levelColor,
            lineWidth: lineWidth,
            title: isSelected ? 'Уровень (выбран)' : 'Уровень'
          });
        } catch(e){}
      }
    });

    // Также обновим менеджер фигур в сайдбаре
    updateDrawingsManager();
  }

  function handleChartClick(param) {
    const point = (param && param.point !== undefined) ? param.point : window.lastCrosshairPoint;
    const time = (param && param.time !== undefined) ? param.time : window.lastCrosshairTime;

    if (!point) return;

    const clickedPrice = candleSeries.coordinateToPrice(point.y);
    const clickedTime = time;

    // В режиме обычного курсора клик вблизи горизонтальной линии или стрелки выбирает её (выполняется асинхронно для избежания бесконечных рендер-циклов в Lightweight Charts)
    if (activeTool === 'cursor') {
      if (clickedPrice !== null) {
        const symbol = getActiveSymbol();
        let saved = getSavedDrawings(symbol);
        let clickedNearDrawing = false;
        
        for (let i = 0; i < saved.length; i++) {
          const d = saved[i];
          if (d.type === 'horizontal') {
            const lineY = candleSeries.priceToCoordinate(d.price);
            if (lineY !== null && Math.abs(param.point.y - lineY) <= 12) {
              selectedDrawingId = d.id;
              clickedNearDrawing = true;
              updateDrawingVisualStates();
              showToast("Фигура выбрана. Нажмите Delete/Backspace для удаления.", "info");
              return;
            }
          } else if (d.type === 'trend') {
            if (!d.start || !d.end) continue;
            
            const startX = priceChart.timeScale().timeToCoordinate(d.start.time);
            const startY = candleSeries.priceToCoordinate(d.start.price);
            const endX = priceChart.timeScale().timeToCoordinate(d.end.time);
            const endY = candleSeries.priceToCoordinate(d.end.price);
            
            if (startX !== null && startY !== null && endX !== null && endY !== null) {
              const l2 = (endX - startX) ** 2 + (endY - startY) ** 2;
              let t = 0;
              if (l2 > 0) {
                t = ((param.point.x - startX) * (endX - startX) + (param.point.y - startY) * (endY - startY)) / l2;
                t = Math.max(0, Math.min(1, t));
              }
              const projX = startX + t * (endX - startX);
              const projY = startY + t * (endY - startY);
              const dist = Math.sqrt((param.point.x - projX) ** 2 + (param.point.y - projY) ** 2);
              
              if (dist <= 12) { // 12 пикселей радиус попадания
                selectedDrawingId = d.id;
                clickedNearDrawing = true;
                updateDrawingVisualStates();
                showToast("Фигура выбрана. Нажмите Delete/Backspace для удаления.", "info");
                return;
              }
            }
          }
        }
        
        if (!clickedNearDrawing && selectedDrawingId !== null) {
          selectedDrawingId = null;
          updateDrawingVisualStates();
        }
      }
      return;
    }

    if (!clickedTime || clickedPrice === null) return;

    if (activeTool === 'horizontal') {
      const isLight = document.body.classList.contains('light-theme');
      const levelColor = isLight ? '#f43f5e' : '#ff4a6b';

      const priceLine = candleSeries.createPriceLine({
        price: clickedPrice,
        color: levelColor,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Уровень'
      });
      customPriceLines.push({
        id: 'draw-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        type: 'horizontal',
        priceLine: priceLine
      });
      
      saveDrawingData({
        type: 'horizontal',
        price: clickedPrice
      });
      showToast(`Горизонтальный уровень установлен на цене ${clickedPrice.toFixed(2)}`, "success");
      document.getElementById('tool-cursor').click();
    } 
    
    else if (activeTool === 'trend') {
      if (!firstClick) {
        firstClick = { time: clickedTime, price: clickedPrice };
        if (window.previewFrameId) {
          cancelAnimationFrame(window.previewFrameId);
          window.previewFrameId = null;
        }
        if (previewSeries) {
          try { previewSeries.setData([]); } catch(e){}
        }
        showToast("Начальная точка стрелки выбрана. Кликните вторую точку.", "success");
      } else {
        if (timesAreEqual(firstClick.time, clickedTime)) {
          showToast("Стрелка должна соединять разные точки во времени!", "error");
          
          if (window.previewFrameId) {
            cancelAnimationFrame(window.previewFrameId);
            window.previewFrameId = null;
          }
          if (previewSeries) {
            try { previewSeries.setData([]); } catch(e){}
          }
          firstClick = null;
          
          activeTool = 'cursor';
          const btns = document.querySelectorAll('.draw-tool-btn');
          btns.forEach(b => {
            if (b.id === 'tool-cursor') b.classList.add('active');
            else b.classList.remove('active');
          });
          return;
        }

        try {
          saveDrawingData({
            type: 'trend',
            start: firstClick,
            end: { time: clickedTime, price: clickedPrice }
          });
          
          setTimeout(() => loadSavedDrawings(), 0);
          showToast("Стрелка-указатель успешно построена!", "success");
        } catch (e) {
          console.error("Ошибка при создании стрелки:", e);
          showToast("Не удалось построить стрелку-указатель", "error");
        } finally {
          if (window.previewFrameId) {
            cancelAnimationFrame(window.previewFrameId);
            window.previewFrameId = null;
          }
          if (previewSeries) {
            try { previewSeries.setData([]); } catch(e){}
          }
          firstClick = null;
          
          activeTool = 'cursor';
          const btns = document.querySelectorAll('.draw-tool-btn');
          btns.forEach(b => {
            if (b.id === 'tool-cursor') b.classList.add('active');
            else b.classList.remove('active');
          });
        }
      }
    }
  }

  function saveDrawingData(drawing) {
    const symbol = getActiveSymbol();
    const saved = getSavedDrawings(symbol);
    // Присваиваем уникальный ID каждой фигуре
    drawing.id = 'draw-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    saved.push(drawing);
    saveSavedDrawings(symbol, saved);
  }

  let drawingsLoadTimeout = null;
  function loadSavedDrawings() {
    if (drawingsLoadTimeout) {
      clearTimeout(drawingsLoadTimeout);
    }
    drawingsLoadTimeout = setTimeout(() => {
      customPriceLines.forEach(item => {
        try {
          if (item && item.priceLine) {
            candleSeries.removePriceLine(item.priceLine);
          } else {
            candleSeries.removePriceLine(item);
          }
        } catch(e){}
      });
      customPriceLines = [];
      customDrawingsList.forEach(item => {
        try {
          if (item && item.mainSeries) {
            priceChart.removeSeries(item.mainSeries);
            if (item.wing1Series) priceChart.removeSeries(item.wing1Series);
            if (item.wing2Series) priceChart.removeSeries(item.wing2Series);
          } else {
            priceChart.removeSeries(item);
          }
        } catch(e){}
      });
      customDrawingsList = [];

      const symbol = getActiveSymbol();
      const saved = getSavedDrawings(symbol);
      
      // Автоматическая миграция старых фигур на систему уникальных ID
      let needsSave = false;
      saved.forEach(d => {
        if (!d.id) {
          d.id = 'draw-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          needsSave = true;
        }
      });
      if (needsSave) {
        saveSavedDrawings(symbol, saved);
      }

      saved.forEach(d => {
        if (d.type === 'horizontal') {
          const isLight = document.body.classList.contains('light-theme');
          const isSelected = d.id === selectedDrawingId;
          const levelColor = isSelected ? '#eab308' : (isLight ? '#f43f5e' : '#ff4a6b');
          const lineWidth = isSelected ? 4 : 2;

          const priceLine = candleSeries.createPriceLine({
            price: d.price,
            color: levelColor,
            lineWidth: lineWidth,
            lineStyle: 2,
            axisLabelVisible: true,
            title: isSelected ? 'Уровень (выбран)' : 'Уровень'
          });
          customPriceLines.push({
            id: d.id,
            type: 'horizontal',
            priceLine: priceLine
          });
        } else if (d.type === 'trend') {
          if (!d.start || !d.end || !d.start.time || !d.end.time) return;
          const isLight = document.body.classList.contains('light-theme');
          const isSelected = d.id === selectedDrawingId;
          const trendColor = isSelected ? '#eab308' : (isLight ? '#6366f1' : '#a78bfa');
          
          const seriesObject = renderArrowOnChart(d.id, d.start, d.end, trendColor, isSelected);
          if (seriesObject) {
            customDrawingsList.push(seriesObject);
          }
        }
      });

      updateDrawingsManager();
    }, 0);
  }

  // Выборочное удаление фигуры по ее уникальному ID
  window.removeSpecificDrawing = function(id) {
    const symbol = getActiveSymbol();
    let saved = getSavedDrawings(symbol);
    
    saved = saved.filter(d => d.id !== id);
    
    saveSavedDrawings(symbol, saved);
    if (selectedDrawingId === id) {
      selectedDrawingId = null;
    }
    loadSavedDrawings();
    showToast("Фигура успешно удалена!", "success");
  };

  window.selectDrawingFromSidebar = function(id) {
    selectedDrawingId = id;
    updateDrawingVisualStates();
  };

  // Обновление списка фигур в сайдбаре
  function updateDrawingsManager() {
    const container = document.getElementById('drawings-manager-list');
    if (!container) return;
    
    const symbol = getActiveSymbol();
    const saved = getSavedDrawings(symbol);
    
    if (saved.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 10px 0;">Фигур нет</div>`;
      return;
    }
    
    const isLight = document.body.classList.contains('light-theme');
    const trendColor = isLight ? '#6366f1' : '#a78bfa';
    const levelColor = isLight ? '#f43f5e' : '#ff4a6b';
    
    let html = '';
    saved.forEach(d => {
      const isSelected = d.id === selectedDrawingId;
      const selectedClass = isSelected ? ' selected' : '';
      if (d.type === 'horizontal') {
        html += `
          <div class="drawing-item${selectedClass}" onclick="selectDrawingFromSidebar('${d.id}')" style="cursor: pointer;">
            <div class="drawing-item-info">
              <span class="drawing-item-dot" style="background: ${levelColor};"></span>
              <span>Уровень: <strong>${d.price.toFixed(2)}</strong>${isSelected ? ' <small style="color: #eab308;">(выбран)</small>' : ''}</span>
            </div>
            <button class="drawing-item-delete" onclick="event.stopPropagation(); removeSpecificDrawing('${d.id}')" title="Удалить этот уровень">
              <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
            </button>
          </div>
        `;
      } else if (d.type === 'trend') {
        let timeStr = '';
        if (typeof d.start.time === 'number') {
          const date = new Date(d.start.time * 1000);
          timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else if (typeof d.start.time === 'string') {
          timeStr = d.start.time;
        } else if (typeof d.start.time === 'object' && d.start.time !== null) {
          timeStr = `${d.start.time.day}.${d.start.time.month}`;
        }
        
        html += `
          <div class="drawing-item${selectedClass}" onclick="selectDrawingFromSidebar('${d.id}')" style="cursor: pointer;">
            <div class="drawing-item-info">
              <span class="drawing-item-dot" style="background: ${trendColor};"></span>
              <span>Стрелка (${timeStr})${isSelected ? ' <small style="color: #eab308;">(выбрана)</small>' : ''}</span>
            </div>
            <button class="drawing-item-delete" onclick="event.stopPropagation(); removeSpecificDrawing('${d.id}')" title="Удалить эту стрелку">
              <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
            </button>
          </div>
        `;
      }
    });
    
    if (selectedDrawingId && saved.some(d => d.id === selectedDrawingId)) {
      html += `
        <button id="btn-delete-selected" class="btn-secondary" style="border-color: #eab308; color: #eab308; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 6px; width: 100%; font-size: 12px; padding: 6px; cursor: pointer;" onclick="removeSpecificDrawing('${selectedDrawingId}')">
          <span class="material-symbols-outlined" style="font-size: 16px;">delete_forever</span>
          Удалить выбранную фигуру
        </button>
      `;
    }
    
    container.innerHTML = html;
  }

  window.showToast = function(message, type = 'info') {
    const toast = document.getElementById('toast-notification');
    const msgSpan = document.getElementById('toast-message');
    const iconSpan = document.getElementById('toast-icon');
    
    msgSpan.textContent = message;
    
    toast.className = 'toast'; 
    if (type === 'success') {
      toast.classList.add('success');
      iconSpan.textContent = 'check_circle';
    } else if (type === 'error') {
      toast.classList.add('error');
      iconSpan.textContent = 'error';
    } else {
      iconSpan.textContent = 'info';
    }
    
    toast.classList.add('show');
    
    if (toast.timeoutId) clearTimeout(toast.timeoutId);
    
    toast.timeoutId = setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
  };
})();
