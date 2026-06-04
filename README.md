# QuantSphere v6.0.0 📊
> High-performance locally-running quantitative backtesting, optimization, and charting platform with LLM-assisted strategy code generation.

QuantSphere is a professional-grade web-based platform for traders and quantitative researchers to backtest trading strategies, run multi-threaded parameter optimization grids, draw charting elements, and automatically generate JavaScript strategy code from natural language prompts. 

Running 100% in-browser, it requires zero backend dependencies, preserving user privacy while delivering high-speed execution.

---

## 🚀 Key Features

* **Advanced Analytics Engine**: Calculates key risk-reward metrics including Sortino Ratio, Profit Factor, Expected Value, and standard PnL parameters.
* **Monte Carlo Simulator**: Runs 1,000 bootstrap iterations of backtest trade sequences to calculate Drawdown Confidence Intervals (95% CI) and Probability of Ruin.
* **Smart Money Concepts (SMC)**: Automatic real-time market structure mapping including Breaks of Structure (BOS), Change of Character (CHoCH), Order Blocks, and Fair Value Gaps (FVG).
* **Multi-threaded Web Workers**: Offloads heavy historical backtests and parameter optimization grids (`backtest-worker.js`) to background threads to prevent UI locking and ensure a responsive 60fps scrolling experience.
* **IndexedDB Local Database Caching (`db-provider.js`)**: Caches Binance API candles, drawings, and workspace states locally, bypassing the 5MB localStorage limit.
* **Viewport Culling**: Dynamically rendering drawings and markers inside the visible area of the Lightweight Charts timeline to optimize performance.
* **LLM Strategy Generator**: Translates natural language prompts into executable JavaScript trading strategies and auto-configures risk parameters (initial balance, fee, stop loss, leverage) instantly.

---

## 🛠 Tech Stack

* **Frontend**: HTML5, Vanilla ES6 JavaScript, Tailwind-compatible CSS.
* **Charting**: TradingView Lightweight Charts (v4.1.1).
* **Data Provider**: Binance Public REST API & WebSockets (Live mode).
* **Database**: Browser IndexedDB API.
* **Multithreading**: HTML5 Web Workers API.

---

## 📖 How to Run

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/quantsphere.git
   cd quantsphere
   ```
2. Run a local web server (e.g., Python, Node.js, or any static server):
   ```bash
   # Using Python 3
   python3 -m http.server 8080
   
   # Or using Node.js static server
   npx http-server -p 8080
   ```
3. Open `http://localhost:8080` in your web browser.

---

## 🤖 OpenAI API Integration Roadmap

We plan to utilize OpenAI API credits to:
1. Replace experimental models with official **GPT-4o** and **GPT-4o-mini** models for natural language strategy code generation.
2. Develop a serverless sandbox compiler to execute generated Python/JS strategies securely.
3. Enhance the backtester with automated GPT-4o portfolio asset selection based on current market regimes.
