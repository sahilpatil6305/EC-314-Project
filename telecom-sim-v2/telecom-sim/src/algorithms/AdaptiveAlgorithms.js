/**
 * src/algorithms/AdaptiveAlgorithms.js
 *
 * Advanced adaptive algorithms used in real telecom systems:
 *
 *  1.  TCP Congestion Control  — Slow Start, AIMD, Fast Retransmit, CUBIC
 *  2.  AMC  — Adaptive Modulation & Coding (chooses QAM order from SNR)
 *  3.  HARQ — Hybrid ARQ with Chase Combining and Incremental Redundancy
 *  4.  Power Control — Uplink power adjustment (Foschini-Miljanic algorithm)
 *  5.  Adaptive Beamforming — Simplified SINR-maximising beam weight selection
 *  6.  OFDM Resource Scheduler — Water-filling power allocation
 *  7.  Link Adaptation — Cross-layer SNR → MCS → throughput mapping
 */

// ─────────────────────────────────────────────────────────────────────────────
//  1. TCP CONGESTION CONTROL
//  States: SLOW_START → CONGESTION_AVOIDANCE → FAST_RECOVERY
//  AIMD: additive increase on ACK, multiplicative decrease on loss
// ─────────────────────────────────────────────────────────────────────────────
class TCPCongestionControl {
  constructor({ initCwnd = 1, maxCwnd = 1024, mss = 1460 } = {}) {
    this.cwnd     = initCwnd;  // congestion window (MSS units)
    this.ssthresh = 64;        // slow-start threshold
    this.mss      = mss;
    this.maxCwnd  = maxCwnd;
    this.state    = 'SLOW_START';
    this.dupAcks  = 0;
    this.rtt      = 50;        // ms, estimated RTT
    this.srtt     = 50;        // smoothed RTT
    this.rttvar   = 5;
    this.rto      = 200;       // retransmission timeout
    this.history  = [];
    this.algo     = 'reno';    // 'reno' | 'cubic'
    // CUBIC state
    this._cubic = { Wmax: 64, t: 0, K: 0, beta: 0.7, C: 0.4 };
  }

  /** Called on each ACK received */
  onACK() {
    this.dupAcks = 0;
    if (this.state === 'SLOW_START') {
      // Exponential increase
      this.cwnd = Math.min(this.cwnd + this.mss, this.maxCwnd);
      if (this.cwnd >= this.ssthresh) this.state = 'CONGESTION_AVOIDANCE';
    } else if (this.state === 'CONGESTION_AVOIDANCE') {
      if (this.algo === 'cubic') {
        this.cwnd = Math.min(this._cubicUpdate(), this.maxCwnd);
      } else {
        // AIMD additive increase: +1 MSS per RTT
        this.cwnd = Math.min(this.cwnd + this.mss * this.mss / this.cwnd, this.maxCwnd);
      }
    } else if (this.state === 'FAST_RECOVERY') {
      this.cwnd = this.ssthresh;
      this.state = 'CONGESTION_AVOIDANCE';
    }
    this._recordHistory('ACK');
  }

  /** Called on duplicate ACK (potential loss signal) */
  onDupACK() {
    this.dupAcks++;
    if (this.dupAcks === 3) {
      // Fast retransmit + fast recovery
      this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
      this.cwnd     = this.ssthresh + 3 * this.mss;
      this.state    = 'FAST_RECOVERY';
      this._cubic.Wmax = this.cwnd;
      this._recordHistory('LOSS-3DUPACK');
    } else if (this.state === 'FAST_RECOVERY') {
      this.cwnd += this.mss;
    }
  }

  /** Called on timeout (severe loss) */
  onTimeout() {
    this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
    this.cwnd     = this.mss;  // reset to 1 MSS
    this.state    = 'SLOW_START';
    this.dupAcks  = 0;
    this._recordHistory('TIMEOUT');
  }

  /** CUBIC window update */
  _cubicUpdate() {
    const c = this._cubic;
    c.t++;
    // Cubic function: W(t) = C(t-K)³ + Wmax
    const K = Math.cbrt(c.Wmax * (1 - c.beta) / c.C);
    c.K = K;
    const cubicW = c.C * Math.pow(c.t - K, 3) + c.Wmax;
    return Math.max(this.cwnd + this.mss * this.mss / this.cwnd, cubicW);
  }

  /** Update RTT estimate (Jacobson/Karels algorithm) */
  updateRTT(measuredRTT) {
    const alpha = 0.125, beta = 0.25;
    this.srtt   = (1 - alpha) * this.srtt + alpha * measuredRTT;
    this.rttvar = (1 - beta)  * this.rttvar + beta * Math.abs(measuredRTT - this.srtt);
    this.rto    = Math.min(60000, Math.max(200, this.srtt + 4 * this.rttvar));
    this.rtt    = measuredRTT;
  }

  _recordHistory(event) {
    this.history.push({ event, cwnd: Math.round(this.cwnd), ssthresh: Math.round(this.ssthresh), state: this.state });
    if (this.history.length > 100) this.history.shift();
  }

  getState() {
    return {
      cwnd:     Math.round(this.cwnd),
      cwndBytes: Math.round(this.cwnd),
      ssthresh: Math.round(this.ssthresh),
      state:    this.state,
      dupAcks:  this.dupAcks,
      rtt:      this.rtt.toFixed(1) + 'ms',
      srtt:     this.srtt.toFixed(1) + 'ms',
      rto:      this.rto.toFixed(0) + 'ms',
      algo:     this.algo,
      history:  this.history.slice(-40),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. ADAPTIVE MODULATION & CODING (AMC / Link Adaptation)
//  Maps SNR → Modulation → Coding Rate → Spectral Efficiency
//  Used in LTE/5G as MCS (Modulation and Coding Scheme) tables
// ─────────────────────────────────────────────────────────────────────────────
const MCS_TABLE = [
  // { mcs, modulation, bitsPerSymbol, codeRate, snrMin, spectralEff }
  { mcs:  0, mod: 'BPSK',    bps: 1,  rate: 0.076, snrMin: -6,   eff: 0.08  },
  { mcs:  1, mod: 'QPSK',    bps: 2,  rate: 0.120, snrMin: -3,   eff: 0.24  },
  { mcs:  2, mod: 'QPSK',    bps: 2,  rate: 0.188, snrMin:  0,   eff: 0.38  },
  { mcs:  3, mod: 'QPSK',    bps: 2,  rate: 0.300, snrMin:  2,   eff: 0.60  },
  { mcs:  4, mod: 'QPSK',    bps: 2,  rate: 0.438, snrMin:  4,   eff: 0.88  },
  { mcs:  5, mod: '16-QAM',  bps: 4,  rate: 0.330, snrMin:  6,   eff: 1.32  },
  { mcs:  6, mod: '16-QAM',  bps: 4,  rate: 0.438, snrMin:  8,   eff: 1.75  },
  { mcs:  7, mod: '16-QAM',  bps: 4,  rate: 0.588, snrMin: 10,   eff: 2.35  },
  { mcs:  8, mod: '64-QAM',  bps: 6,  rate: 0.438, snrMin: 13,   eff: 2.63  },
  { mcs:  9, mod: '64-QAM',  bps: 6,  rate: 0.553, snrMin: 15,   eff: 3.32  },
  { mcs: 10, mod: '64-QAM',  bps: 6,  rate: 0.650, snrMin: 17,   eff: 3.90  },
  { mcs: 11, mod: '64-QAM',  bps: 6,  rate: 0.754, snrMin: 19,   eff: 4.52  },
  { mcs: 12, mod: '256-QAM', bps: 8,  rate: 0.650, snrMin: 22,   eff: 5.20  },
  { mcs: 13, mod: '256-QAM', bps: 8,  rate: 0.754, snrMin: 24,   eff: 6.03  },
  { mcs: 14, mod: '256-QAM', bps: 8,  rate: 0.853, snrMin: 27,   eff: 6.82  },
  { mcs: 15, mod: '1024-QAM',bps: 10, rate: 0.854, snrMin: 32,   eff: 8.54  },
];

class AdaptiveMCS {
  constructor() {
    this.currentMCS   = 6;
    this.targetBLER   = 0.10;  // target block error rate
    this.hysteresis   = 2;     // dB hysteresis to prevent ping-pong
    this.history      = [];
    this.outerLoopAdj = 0;     // outer-loop link adaptation offset
  }

  /** Select best MCS for given SNR */
  selectMCS(snrDB) {
    const adjustedSNR = snrDB + this.outerLoopAdj;
    let best = MCS_TABLE[0];
    for (const entry of MCS_TABLE) {
      if (adjustedSNR >= entry.snrMin + this.hysteresis) best = entry;
    }
    // Outer-loop: if BLER too high, reduce MCS; if BLER too low, try higher
    const prevMCS = this.currentMCS;
    this.currentMCS = best.mcs;
    if (this.currentMCS !== prevMCS) {
      this.history.push({ from: prevMCS, to: best.mcs, snr: snrDB.toFixed(1) });
      if (this.history.length > 50) this.history.shift();
    }
    return best;
  }

  /** Called when block received — outer-loop link adaptation */
  onBlockResult(success) {
    if (success) {
      this.outerLoopAdj = Math.max(-6, this.outerLoopAdj - 0.1);
    } else {
      this.outerLoopAdj = Math.min(6, this.outerLoopAdj + 0.3);
    }
  }

  /** Theoretical throughput for bandwidth + MCS */
  throughput(bandwidthMHz, snrDB) {
    const mcs = this.selectMCS(snrDB);
    // Thr = BW × spectral_efficiency × (1 - overhead)
    return (bandwidthMHz * mcs.eff * 0.85).toFixed(2);
  }

  getState() {
    const entry = MCS_TABLE[this.currentMCS] || MCS_TABLE[6];
    return {
      mcs: this.currentMCS,
      modulation: entry.mod,
      codeRate:   entry.rate.toFixed(3),
      bitsPerSym: entry.bps,
      spectralEff:entry.eff.toFixed(2) + ' bit/s/Hz',
      outerLoopAdj: this.outerLoopAdj.toFixed(2) + 'dB',
      history: this.history.slice(-20),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. HARQ — Hybrid ARQ
//  Combines FEC with ARQ retransmission.
//  Chase Combining (CC): retransmit same coded bits, MRC at receiver
//  Incremental Redundancy (IR): send extra parity bits each retransmission
// ─────────────────────────────────────────────────────────────────────────────
class HARQController {
  constructor(mode = 'ir', maxRounds = 4) {
    this.mode      = mode;       // 'cc' | 'ir'
    this.maxRounds = maxRounds;  // max HARQ rounds (typically 4 in LTE)
    this.processes = {};         // process_id → { round, snrAccum, irBits }
    this.stats     = { success: 0, fail: 0, rounds: [0, 0, 0, 0] };
  }

  /** Attempt to decode a HARQ process. Returns { decoded, round, combinedSNR } */
  receive(processId, receivedSNR, round = null) {
    if (!this.processes[processId]) {
      this.processes[processId] = { round: 0, snrAccum: 0, irBits: [] };
    }
    const proc = this.processes[processId];
    proc.round++;

    if (this.mode === 'cc') {
      // Chase Combining: MRC combines SNR linearly (energy combining)
      proc.snrAccum += receivedSNR;
      const combinedSNR = proc.snrAccum;  // MRC gain ~ N × SNR per tx
      const ber = 0.5 * Math.exp(-combinedSNR / 10);
      if (ber < 0.01 || proc.round >= this.maxRounds) {
        return this._finalize(processId, proc, combinedSNR, ber < 0.01);
      }
    } else {
      // Incremental Redundancy: each round adds more parity bits
      // Effective code rate decreases: R/1, R/2, R/3, R/4
      const effRate = 0.75 / proc.round;
      const codingGain = -10 * Math.log10(effRate);  // coding gain dB
      const effSNR = receivedSNR + codingGain;
      proc.snrAccum = Math.max(proc.snrAccum, effSNR);
      const ber = 0.5 * Math.exp(-effSNR / 8);
      if (ber < 0.01 || proc.round >= this.maxRounds) {
        return this._finalize(processId, proc, effSNR, ber < 0.01);
      }
    }
    return { decoded: false, round: proc.round, nack: true, processId };
  }

  _finalize(processId, proc, combinedSNR, success) {
    this.stats.rounds[proc.round - 1]++;
    if (success) this.stats.success++; else this.stats.fail++;
    delete this.processes[processId];
    return { decoded: success, round: proc.round, combinedSNR: combinedSNR.toFixed(1), processId };
  }

  getState() {
    return {
      mode: this.mode,
      maxRounds: this.maxRounds,
      activeProcesses: Object.keys(this.processes).length,
      stats: this.stats,
      efficiency: this.stats.success > 0
        ? ((this.stats.success / (this.stats.success + this.stats.fail)) * 100).toFixed(1) + '%'
        : '—',
      roundDist: this.stats.rounds.map((v, i) => `R${i+1}:${v}`).join(', '),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. POWER CONTROL  (Foschini-Miljanic distributed algorithm)
//  Each transmitter adjusts power so received SINR meets target.
//  p_i(n+1) = p_i(n) × (γ_target / γ_i(n))
// ─────────────────────────────────────────────────────────────────────────────
class PowerController {
  constructor(nodeCount, targetSINR_dB = 10) {
    this.n           = nodeCount;
    this.targetSINR  = Math.pow(10, targetSINR_dB / 10);
    this.powers      = new Array(nodeCount).fill(0.1);   // watts
    this.maxPower    = 2.0;   // watts
    this.minPower    = 0.001;
    this.gains       = this._initGains();
    this.noise       = 1e-9;  // thermal noise watts
    this.history     = [];
    this.converged   = false;
  }

  _initGains() {
    // Random path gains between nodes (symmetric)
    const G = [];
    for (let i = 0; i < this.n; i++) {
      G[i] = [];
      for (let j = 0; j < this.n; j++) {
        G[i][j] = i === j ? 0.5 + Math.random() * 0.3 : Math.random() * 0.01;
      }
    }
    return G;
  }

  /** One iteration of Foschini-Miljanic */
  iterate() {
    const newPowers = [...this.powers];
    let maxChange = 0;

    for (let i = 0; i < this.n; i++) {
      const signal      = this.gains[i][i] * this.powers[i];
      let   interference = this.noise;
      for (let j = 0; j < this.n; j++) {
        if (j !== i) interference += this.gains[i][j] * this.powers[j];
      }
      const sinr = signal / interference;
      // FM update: p_i *= (target_SINR / current_SINR)
      newPowers[i] = Math.min(this.maxPower, Math.max(this.minPower, this.powers[i] * (this.targetSINR / sinr)));
      maxChange = Math.max(maxChange, Math.abs(newPowers[i] - this.powers[i]));
    }

    this.powers = newPowers;
    this.converged = maxChange < 1e-4;
    this.history.push({ powers: [...this.powers], maxChange });
    if (this.history.length > 50) this.history.shift();
    return { powers: this.powers, converged: this.converged, maxChange };
  }

  getSINRs() {
    return this.powers.map((p, i) => {
      const sig   = this.gains[i][i] * p;
      let   inter = this.noise;
      for (let j = 0; j < this.n; j++) if (j !== i) inter += this.gains[i][j] * this.powers[j];
      return 10 * Math.log10(sig / inter);
    });
  }

  getState() {
    const sinrs = this.getSINRs();
    return {
      powers:    this.powers.map(p => p.toFixed(4) + 'W'),
      sinrs:     sinrs.map(s => s.toFixed(1) + 'dB'),
      targetSINR: (10 * Math.log10(this.targetSINR)).toFixed(1) + 'dB',
      converged:  this.converged,
      algorithm:  'Foschini-Miljanic',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. WATER-FILLING POWER ALLOCATION (OFDM)
//  Optimal power allocation across N subchannels to maximise capacity.
//  p_i = (μ - N₀/|H_i|²)⁺  where μ is water level (Lagrange multiplier)
// ─────────────────────────────────────────────────────────────────────────────
class WaterFilling {
  constructor(subchannels = 8) {
    this.N       = subchannels;
    this.noise   = 1.0;          // normalised noise per subchannel
    // Channel gains (vary over time — simulates frequency-selective fading)
    this.gains   = Array.from({ length: subchannels }, () => 0.5 + Math.random());
    this.history = [];
  }

  /** Allocate total power P across subchannels */
  allocate(totalPower) {
    const N   = this.N;
    const inv = this.gains.map(h => this.noise / (h * h));  // N₀/|H|²

    // Sort indices by inverse gain (fill lowest-cost channels first)
    const order = inv.map((v, i) => ({ i, v })).sort((a, b) => a.v - b.v);

    let   waterLevel = 0;
    let   powers     = new Array(N).fill(0);
    let   remaining  = totalPower;
    let   active     = 0;

    // Binary search for water level μ: Σ(μ - inv_i)⁺ = P
    let lo = Math.min(...inv), hi = Math.max(...inv) + totalPower;
    for (let iter = 0; iter < 50; iter++) {
      waterLevel = (lo + hi) / 2;
      const total = inv.reduce((s, v) => s + Math.max(0, waterLevel - v), 0);
      if (Math.abs(total - totalPower) < 1e-6) break;
      if (total < totalPower) lo = waterLevel; else hi = waterLevel;
    }

    powers = inv.map(v => Math.max(0, waterLevel - v));

    // Capacity per subchannel (bits/s/Hz)
    const caps = powers.map((p, i) => Math.log2(1 + p * this.gains[i] * this.gains[i] / this.noise));
    const totalCap = caps.reduce((s, c) => s + c, 0);

    this.history.push({ waterLevel: waterLevel.toFixed(3), totalCap: totalCap.toFixed(2) });
    if (this.history.length > 30) this.history.shift();

    return { powers, caps, totalCap, waterLevel, active: powers.filter(p => p > 0).length };
  }

  /** Update channel gains (simulate fading over time) */
  updateGains(snrDB) {
    const base = Math.pow(10, snrDB / 20);
    this.gains = this.gains.map(g => Math.max(0.05, g + (Math.random() - 0.5) * 0.15 * base));
  }

  getState(totalPower = 1) {
    const result = this.allocate(totalPower);
    return {
      subchannels: this.N,
      gains:  this.gains.map(g => g.toFixed(3)),
      powers: result.powers.map(p => p.toFixed(3)),
      caps:   result.caps.map(c => c.toFixed(2) + ' bit/s/Hz'),
      totalCapacity: result.totalCap.toFixed(3) + ' bit/s/Hz',
      waterLevel: result.waterLevel.toFixed(3),
      activeChannels: result.active,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  6. ADAPTIVE BEAMFORMING — simplified max-SINR beamsteering
//  Adjusts beam weights to maximise signal toward desired direction.
// ─────────────────────────────────────────────────────────────────────────────
class AdaptiveBeamformer {
  constructor(antennas = 4) {
    this.M        = antennas;
    this.weights  = Array.from({ length: antennas }, () => ({ re: 1/antennas, im: 0 }));
    this.steeringAngle = 0;   // degrees
    this.history  = [];
  }

  /** Steer beam toward angle θ (ULA steering vector) */
  steer(angleDeg, wavelength = 0.1, spacing = 0.05) {
    this.steeringAngle = angleDeg;
    const theta = angleDeg * Math.PI / 180;
    const d_lambda = spacing / wavelength;
    this.weights = Array.from({ length: this.M }, (_, m) => {
      const phase = 2 * Math.PI * m * d_lambda * Math.sin(theta);
      return { re: Math.cos(phase) / this.M, im: -Math.sin(phase) / this.M };
    });
    return this.weights;
  }

  /** Array gain in dB toward angle */
  gain(angleDeg, wavelength = 0.1, spacing = 0.05) {
    const theta = angleDeg * Math.PI / 180;
    const d_lambda = spacing / wavelength;
    let re = 0, im = 0;
    for (let m = 0; m < this.M; m++) {
      const phase = 2 * Math.PI * m * d_lambda * Math.sin(theta);
      re += this.weights[m].re * Math.cos(phase) - this.weights[m].im * Math.sin(phase);
      im += this.weights[m].re * Math.sin(phase) + this.weights[m].im * Math.cos(phase);
    }
    return 10 * Math.log10(re*re + im*im + 1e-10);
  }

  /** Generate beam pattern across -90° to +90° */
  beamPattern() {
    const angles = Array.from({ length: 37 }, (_, i) => -90 + i * 5);
    return angles.map(a => ({ angle: a, gainDB: this.gain(a).toFixed(1) }));
  }

  getState() {
    return {
      antennas:     this.M,
      steeringAngle: this.steeringAngle + '°',
      mainlobeGain: this.gain(this.steeringAngle).toFixed(1) + 'dB',
      weights:      this.weights.map(w => `${w.re.toFixed(3)}+j${w.im.toFixed(3)}`),
      pattern:      this.beamPattern(),
    };
  }
}

module.exports = {
  TCPCongestionControl,
  AdaptiveMCS, MCS_TABLE,
  HARQController,
  PowerController,
  WaterFilling,
  AdaptiveBeamformer,
};
