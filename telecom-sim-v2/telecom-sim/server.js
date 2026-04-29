/**
 * server.js — Telecom OSI Simulator Backend
 * Runs Express HTTP + WebSocket server.
 * WebSocket carries real-time simulation events to the browser.
 *
 * Usage:
 *   npm install
 *   node server.js          (production)
 *   npm run dev             (auto-reload with nodemon)
 *
 * Then open: http://localhost:3000
 */

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const path     = require('path');

const { SimulationEngine } = require('./src/engine/SimulationEngine');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── REST endpoint: start or update a simulation ──────────────────────────────
app.post('/api/start', (req, res) => {
  const config = req.body;
  try {
    activeEngine = new SimulationEngine(config, broadcast);
    activeEngine.start();
    res.json({ ok: true, message: 'Simulation started', config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/stop', (req, res) => {
  if (activeEngine) { activeEngine.stop(); activeEngine = null; }
  res.json({ ok: true });
});

app.post('/api/inject-fault', (req, res) => {
  if (activeEngine) activeEngine.injectFault(req.body);
  res.json({ ok: true });
});

app.get('/api/config-defaults', (req, res) => {
  const { DEFAULT_CONFIG } = require('./config/defaults');
  res.json(DEFAULT_CONFIG);
});

// ── WebSocket: push simulation state to all connected browsers ────────────────
let activeEngine = null;

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ event: 'connected', payload: { msg: 'Telecom Sim ready' } }));
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     TELECOM OSI NETWORK SIMULATOR        ║');
  console.log('  ║     http://localhost:' + PORT + '                 ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  → Open the URL above in your browser');
  console.log('  → Configure and run the simulation from the UI');
  console.log('  → Press Ctrl+C to stop\n');
});
