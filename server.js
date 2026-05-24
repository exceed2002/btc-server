const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

app.use(cors());

let currentPrice = 0;

const logs = [];

const ws = new WebSocket(
    'wss://fstream.binance.com/ws/btcusdt@trade'
);

ws.onmessage = (event) => {

    const data = JSON.parse(event.data);

    currentPrice = parseFloat(data.p);

    logs.unshift(
        `[${new Date().toLocaleTimeString()}] BTC ${currentPrice}`
    );

    if (logs.length > 20) {
        logs.pop();
    }
};

app.get('/status', (req, res) => {

    res.json({

        price: currentPrice,

        logs
    });
});

app.listen(3000, () => {

    console.log('SERVER START');
});