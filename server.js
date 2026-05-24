import express from "express";
import fs from "fs";
import cors from "cors";

const app = express();
const PORT = 3000;
const FILE = "./trades.json";
const INITIAL_BALANCE = 1000;

app.use(cors());

// 상태 변수
let position = null;
let openPrice = null;
let prices = [];
let lastSignal = "HOLD";
let signalTime = "-";

// --------------------
// 수학 함수 (WMA, HMA)
// --------------------
function wma(data, length) {
    let result = [];
    for (let i = length - 1; i < data.length; i++) {
        let sum = 0, weight = 0;
        for (let j = 0; j < length; j++) {
            let w = length - j;
            sum += data[i - j] * w;
            weight += w;
        }
        result.push(sum / weight);
    }
    return result;
}

function getHMA(data, length) {
    let sqrtLen = Math.round(Math.sqrt(length));
    let halfLen = Math.round(length / 2);
    let wma1 = wma(data, halfLen);
    let wma2 = wma(data, length);
    let diff = [];
    for (let i = 0; i < wma2.length; i++) {
        diff.push(2 * wma1[wma1.length - wma2.length + i] - wma2[i]);
    }
    return wma(diff, sqrtLen);
}

// --------------------
// 데이터 로드 (과거 데이터 100개)
// --------------------
async function loadHistory() {
    try {
        const res = await fetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=100");
        const data = await res.json();
        prices = data.map(k => Number(k[4]));
        console.log("History loaded. Current price count:", prices.length);
    } catch (e) { console.error("History load error:", e); }
}

// --------------------
// 실시간 가격 조회
// --------------------
async function fetchPrice() {
    try {
        const res = await fetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=1");
        const data = await res.json();
        return Number(data[0][4]); // 종가(Close)
    } catch (e) { return null; }
}

// --------------------
// 신호 생성 (60으로 변경)
// --------------------
function getSignal() {
    if (prices.length < 70) return "HOLD";
    const hma = getHMA(prices, 60);
    const current = hma.at(-1);
    const prev2 = hma.at(-3);

    if (current > prev2 && lastSignal !== "BUY") {
        lastSignal = "BUY";
        signalTime = new Date().toLocaleTimeString();
        return "BUY";
    }
    if (current < prev2 && lastSignal !== "SELL") {
        lastSignal = "SELL";
        signalTime = new Date().toLocaleTimeString();
        return "SELL";
    }
    return "HOLD";
}

// --------------------
// 거래 처리
// --------------------
function executeTrade(signal, price) {
    let data = JSON.parse(fs.readFileSync(FILE));
    let pnl = 0;

    if (position !== null) {
        const diff = position === "LONG" ? (price - openPrice) : (openPrice - price);
        pnl = (diff / openPrice) * 100;
        data.balance += (data.balance * (pnl / 100));
    }

    position = signal === "BUY" ? "LONG" : "SHORT";
    openPrice = price;

    data.history.push({
        type: signal,
        price,
        time: new Date().toLocaleString(),
        pnl: pnl.toFixed(2),
        currentBalance: data.balance.toFixed(2)
    });

    if (data.history.length > 100) data.history.shift();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// --------------------
// 메인 루프 (매 분 01초에 실행)
// --------------------
function startTradeLoop() {
    setInterval(async () => {
        const now = new Date();
        if (now.getSeconds() === 1) { // 정확히 매 분 1초에 실행
            const price = await fetchPrice();
            if (!price) return;

            prices.push(price);
            if (prices.length > 200) prices.shift();

            const signal = getSignal();
            if (signal !== "HOLD") {
                executeTrade(signal, price);
            }
            console.log(`[${now.toLocaleTimeString()}] Price: ${price} | Signal: ${lastSignal}`);
        }
    }, 1000);
}

// --------------------
// API & 시작
// --------------------
app.get("/status", (req, res) => {
    const data = JSON.parse(fs.readFileSync(FILE));
    const price = prices.length ? prices.at(-1) : null;
    
    let currentPnl = 0;
    if (position === "LONG") currentPnl = ((price - openPrice) / openPrice) * 100;
    if (position === "SHORT") currentPnl = ((openPrice - price) / openPrice) * 100;

    res.json({
        price,
        position: position || "NONE",
        currentPnl: currentPnl.toFixed(2),
        balance: data.balance.toFixed(2),
        lastSignal,
        signalTime,
        logs: data.history.slice().reverse()
    });
});

async function start() {
    console.log("Server starting... Initializing trades.json");
    fs.writeFileSync(FILE, JSON.stringify({ balance: INITIAL_BALANCE, history: [] }));
    
    await loadHistory();
    startTradeLoop();
    
    app.listen(PORT, () => console.log("running http://localhost:" + PORT));
}

start();