# OSI Telecom Network Simulator

A full-stack, real-time network simulation with all 7 OSI layers, ARQ protocols,
error correction schemes, and live KPI dashboards.

## Quick Start

```bash
# 1. Clone or unzip the project
cd telecom-sim

# 2. Install dependencies (only needs express + ws)
npm install

# 3. Run the simulation server
node server.js
# OR with auto-reload:
npm run dev

# 4. Open your browser
# http://localhost:3000
```

## Project Structure

```
telecom-sim/
├── server.js                    ← Express + WebSocket server entry point
├── package.json
├── config/
│   └── defaults.js              ← All simulation parameters & presets
├── src/
│   ├── engine/
│   │   ├── SimulationEngine.js  ← Core simulation loop & packet lifecycle
│   │   ├── Topology.js          ← Node graph builder (mesh/linear/ring/star)
│   │   └── KPIEngine.js         ← Shannon capacity, BER models, SNR→KPI
│   ├── layers/
│   │   └── OSIStack.js          ← All 7 OSI layer header builders
│   ├── arq/
│   │   └── ARQController.js     ← Stop-Wait / Go-Back-N / Selective Repeat
│   └── encoding/
│       └── Codec.js             ← Hamming / CRC-32 / Reed-Solomon / Turbo / LDPC
├── public/
│   ├── index.html               ← Main UI shell
│   ├── css/
│   │   └── style.css            ← Terminal/phosphor aesthetic
│   └── js/
│       ├── renderer.js          ← Canvas: nodes, links, animated packets
│       ├── ui.js                ← Config panel, OSI panel, ARQ/Frame views, KPI
│       ├── ws.js                ← WebSocket client + event router
│       ├── log.js               ← Event log module
│       └── main.js              ← Bootstrap / DOMContentLoaded init
└── docs/
    └── README.md                ← This file
```

## Configurable Parameters

| Parameter      | Values                                      | Description                      |
|----------------|---------------------------------------------|----------------------------------|
| Network type   | 4G LTE, 5G NR, Wi-Fi 6, Fiber, Satellite   | Sets baseline KPI presets        |
| Topology       | mesh, linear, ring, star                    | Node connection layout           |
| Nodes          | 2 – 12                                      | Number of network nodes          |
| Bandwidth      | 1 – 400 MHz                                 | Channel bandwidth                |
| Channel model  | AWGN, Rayleigh, Rician, Two-Ray             | Fading/noise model               |
| Packet size    | 64 – 9000 bytes                             | Payload size per packet          |
| Packet type    | data, voice, video, control, ack            | Priority & overhead settings     |
| Burst size     | 1 – 100                                     | Packets per burst send           |
| Inter-arrival  | 10 – 2000 ms                                | Auto-send interval               |
| Noise          | 0 – 35 dB                                   | Channel noise level              |
| ARQ mode       | Stop-Wait, Go-Back-N, Selective Repeat      | Retransmission protocol          |
| Window size    | 1 – 32                                      | ARQ sliding window               |
| Encoding / FEC | None, Hamming, CRC-32, Reed-Solomon, Turbo, LDPC | Error correction scheme   |

## What Makes This Unique

1. **Real channel models** — KPIs computed from Shannon capacity formula, AWGN BER
   (complementary error function), Rayleigh fading, Rician (K-factor), Two-Ray models
2. **Per-layer live headers** — every OSI layer builds actual protocol headers
   (real IP/MAC addresses, TCP flags, TLS cipher suite) updated each tick
3. **Full ARQ state machine** — sliding window visualiser shows each frame slot
   transitioning: free → sent → acked/nacked → retransmit
4. **Codec simulation** — encoding overhead and correction capability modelled per scheme
   (Hamming parity positions, RS codeword structure, Turbo/LDPC iteration counts)
5. **WebSocket real-time** — server pushes events, browser renders; no polling
6. **Phosphor terminal UI** — CRT scanline overlay, glow effects, sparkline KPI charts,
   per-layer pulse animations — unlike any generic network sim

## Shannon Capacity (implemented in KPIEngine.js)

```
C = B × log₂(1 + SNR)        [Mbps, where B in MHz]
```

## BER Models (KPIEngine.js)

| Model    | Formula                                    |
|----------|--------------------------------------------|
| AWGN     | Pb = 0.5 × erfc(√SNR)                      |
| Rayleigh | Pb ≈ 0.5 × (1 − √(SNR/(1+SNR)))           |
| Rician   | Pb ≈ 0.5 × erfc(√(K + SNR))              |
| Two-Ray  | Pb ≈ 2×10⁻³ / SNR²                        |

## Extending the Simulator

- Add a new network preset in `config/defaults.js` → `NETWORK_PRESETS`
- Add a new encoding scheme in `config/defaults.js` + `src/encoding/Codec.js`
- Add a new topology in `src/engine/Topology.js` → `buildTopology()`
- Add REST endpoints in `server.js` for new scenarios

## Dependencies

- `express` — HTTP server + REST API
- `ws` — WebSocket server
- `nodemon` (dev) — auto-reload on file change
