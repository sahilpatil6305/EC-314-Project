# EC-314 Project: OSI Telecom Network Simulator

A hands-on network simulation tool built to understand how data flows through all 7 OSI layers. This project explores real channel models, ARQ protocols, error correction, and visualizes everything in real-time.



## Getting Started

```bash
cd telecom-sim-v2/telecom-sim

npm install

node server.js
```

Then open `http://localhost:3000` in your browser. You should see a network topology with nodes connected and packets flowing.

For development with hot-reload:
```bash
npm run dev
```

## What's in Here?

The simulator handles:
- **OSI Layers** — Physical, Link, Network, Transport, Session, Presentation, Application (all 7)
- **Topologies** — Mesh, linear, ring, star configurations
- **Channel Models** — AWGN, Rayleigh fading, Rician, Two-Ray ground reflection
- **ARQ Protocols** — Stop-Wait, Go-Back-N, Selective Repeat with sliding window
- **Error Correction** — Hamming, CRC-32, Reed-Solomon, Turbo codes, LDPC
- **Real Calculations** — Shannon capacity, BER formulas, SNR-to-KPI mapping

## How It Works

1. **Simulation Engine** runs the packet lifecycle each tick
2. **OSI Stack** builds headers for each layer (real IP/MAC addresses, TCP flags, etc.)
3. **Channel Model** simulates fading, noise, and calculates error probability
4. **ARQ Controller** handles retransmissions based on protocol choice
5. **Browser UI** renders the network graph and streams live KPI metrics via WebSocket

## Project Structure

```
telecom-sim-v2/
└── telecom-sim/
    ├── server.js              # Express + WebSocket entry point
    ├── config/
    │   └── defaults.js        # All configurable parameters
    ├── src/
    │   ├── engine/
    │   │   ├── SimulationEngine.js
    │   │   ├── Topology.js
    │   │   └── KPIEngine.js
    │   ├── layers/
    │   │   └── OSIStack.js
    │   ├── arq/
    │   │   └── ARQController.js
    │   └── encoding/
    │       └── Codec.js
    └── public/
        ├── index.html
        ├── css/
        └── js/
            ├── renderer.js      # Canvas visualization
            ├── ui.js            # Control panels
            ├── ws.js            # WebSocket client
            └── main.js
```

## Key Parameters to Play With

| Setting | Range | What It Does |
|---------|-------|-------------|
| Network Type | 4G, 5G, Wi-Fi 6, Fiber, Satellite | Presets the baseline KPIs |
| Topology | mesh, linear, ring, star | How nodes connect |
| Bandwidth | 1-400 MHz | Channel capacity |
| Noise | 0-35 dB | Signal degradation |
| ARQ Mode | Stop-Wait, Go-Back-N, Selective Repeat | Retransmission strategy |
| Encoding | None, Hamming, Reed-Solomon, Turbo, LDPC | Error handling |

## The Math 

**Shannon Capacity:**
```
C = B × log₂(1 + SNR)   [Mbps]
```

**BER (Bit Error Rate):**
- AWGN: `Pb = 0.5 × erfc(√SNR)`
- Rayleigh: `Pb ≈ 0.5 × (1 − √(SNR/(1+SNR)))`
- Two-Ray: `Pb ≈ 2×10⁻³ / SNR²`


## Dependencies

Just two npm packages:
- `express` — HTTP server
- `ws` — WebSocket for real-time updates

Plus `nodemon` for development.


## Notes

The simulator can handle networks of 2-12 nodes smoothly. Beyond that, you might hit browser rendering limits.

The channel models use standard communications theory formulas. If you're comparing against real data, tweak the K-factor for Rician or the Two-Ray parameters to match your environment.

---

Built as part of EC-314 coursework. Feel free to fork, extend, or break things while learning.
