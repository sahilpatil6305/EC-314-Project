/**
 * src/engine/KPIEngine.js
 * Computes live KPIs from config + noise + fault state.
 * Models: AWGN, Rayleigh fading, Rician fading, Two-Ray ground reflection.
 *
 * Key formulas:
 *   Shannon capacity:  C = B * log2(1 + SNR)
 *   AWGN BER (BPSK):   Pb = 0.5 * erfc(sqrt(Eb/N0))
 *   Rayleigh BER:      Pb ≈ 0.5 * (1 - sqrt(SNR/(1+SNR)))
 */

const { NETWORK_PRESETS, ENCODING_SCHEMES } = require('../../config/defaults');

/**
 * Complementary error function approximation (for BER formulas)
 */
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}

/**
 * Compute SNR → BER for selected channel model
 */
function berFromSNR(snrDB, channelModel) {
  const snrLin = Math.pow(10, snrDB / 10);
  switch (channelModel) {
    case 'rayleigh':
      return Math.max(1e-12, 0.5 * (1 - Math.sqrt(snrLin / (1 + snrLin))));
    case 'rician': {
      const K = 3; // Rician K-factor
      return Math.max(1e-12, 0.5 * erfc(Math.sqrt(K + snrLin)));
    }
    case 'two-ray':
      return Math.max(1e-12, 2e-3 / Math.pow(snrLin, 2));
    case 'awgn':
    default:
      return Math.max(1e-12, 0.5 * erfc(Math.sqrt(snrLin)));
  }
}

/**
 * Shannon capacity in Mbps: C = B * log2(1 + SNR)
 */
function shannonCapacity(bandwidthMHz, snrDB) {
  const snrLin = Math.pow(10, snrDB / 10);
  return bandwidthMHz * Math.log2(1 + snrLin);
}

/**
 * Main KPI computation.
 * Returns object with thr, lat, ploss, ber, snr, jit, rssi, crc, capacity, efficiency
 */
function computeKPIs(cfg, stats, tick) {
  const preset  = NETWORK_PRESETS[cfg.networkType] || NETWORK_PRESETS['4g'];
  const enc     = ENCODING_SCHEMES[cfg.encoding]   || ENCODING_SCHEMES.none;
  const noise   = cfg.noisedB || 0;
  const fault   = stats.faultActive ? 1 : 0;
  const faultMul = fault ? 5 : 1;

  // Effective SNR
  const snr = Math.max(0, preset.snrDB - noise * 0.9 - fault * 18 + (Math.random() - 0.5) * 1.5);

  // Shannon capacity (theoretical max for this bandwidth + SNR)
  const capacity = shannonCapacity(cfg.bandwidth || preset.maxBW, snr);

  // Effective throughput — apply encoding overhead and congestion
  const encPenalty = 1 - enc.overhead;
  const thr = Math.min(capacity, preset.thrMbps * (1 - noise / 80) * encPenalty * (fault ? 0.15 : 1));

  // BER from channel model
  const rawBER = berFromSNR(snr, cfg.channelModel || 'awgn');

  // Encoding reduces effective BER
  const corrFactor = enc.corrBits > 0 ? Math.pow(10, -enc.corrBits * 0.3) : 1;
  const ber = Math.max(1e-13, rawBER * corrFactor * faultMul);

  // Packet loss: combines channel BER over packet length + explicit loss model
  const pktBits   = (cfg.packetSize || 512) * 8;
  const berPloss  = (1 - Math.pow(1 - ber, pktBits)) * 100;
  const ploss     = Math.min(30, berPloss + preset.ploss * (1 + noise / 8) * faultMul);

  // Latency: propagation + queuing + processing
  const procDelay  = (cfg.packetSize / 1000) * (1 + noise / 20);
  const lat        = preset.latMs * (1 + noise / 20) * faultMul + procDelay;

  // Jitter: variation in latency
  const jit = preset.jitMs * (1 + noise / 10) * faultMul + Math.random() * 0.5;

  // RSSI with log-distance model
  const rssi = preset.rssiDBm - noise * 0.4 - fault * 8;

  // CRC errors per second (modelled)
  const crc = Math.round(preset.crc * (1 + noise / 5) * faultMul + (fault ? 15 : 0));

  // ARQ efficiency
  const arqEff = ploss > 0
    ? (1 - ploss / 100) * 100
    : 100;

  return { thr, lat, ploss, ber, snr, jit, rssi, crc, capacity, arqEff, encPenalty };
}

module.exports = { computeKPIs, berFromSNR, shannonCapacity };
