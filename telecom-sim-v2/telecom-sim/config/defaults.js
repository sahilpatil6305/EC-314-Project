/**
 * config/defaults.js
 * All simulation parameters with validation ranges.
 * These populate the UI form on first load.
 */

const DEFAULT_CONFIG = {
  // Network topology
  nodeCount:      4,          // 2 – 12
  topologyType:  'mesh',      // 'linear' | 'mesh' | 'ring' | 'star'
  networkType:   '4g',        // '4g' | '5g' | 'wifi' | 'fiber' | 'satellite'

  // Packet parameters
  packetSize:    512,         // bytes (64 – 9000)
  packetType:    'data',      // 'data' | 'voice' | 'video' | 'control' | 'ack'
  burstSize:     10,          // packets per burst (1 – 100)
  interArrival:  50,          // ms between auto-packets (10 – 2000)

  // Channel
  bandwidth:     20,          // MHz (1 – 400)
  noisedB:       5,           // dB  (0 – 35)
  channelModel: 'awgn',       // 'awgn' | 'rayleigh' | 'rician' | 'two-ray'

  // ARQ
  arqMode:      'go-back-n',  // 'stop-wait' | 'go-back-n' | 'selective'
  windowSize:    8,           // 1 – 32

  // Encoding / FEC
  encoding:     'turbo',      // 'none' | 'hamming' | 'crc32' | 'reed-solomon' | 'turbo' | 'ldpc'
  codingRate:    0.75,        // 1/2 | 2/3 | 3/4 (efficiency vs protection)

  // Queuing
  queueModel:   'priority',   // 'mm1' | 'mmc' | 'mg1' | 'priority' | 'wfq' | 'red' | 'token' | 'leaky'
  arrivalRate:  0.8,          // packets/tick (for M/M/1 theoretical)

  // TCP Congestion Control
  tcpAlgo:      'reno',       // 'reno' | 'cubic'

  // HARQ
  harqMode:     'ir',         // 'cc' (Chase Combining) | 'ir' (Incremental Redundancy)

  // Routing
  routingAlgo:  'dijkstra',   // 'dijkstra' | 'bellman-ford' | 'ospf' | 'aodv' | 'ecmp' | 'qos'

  // Simulation control
  autoSend:      true,
  speedMultiplier: 1.0,       // 0.25 – 4.0
};

const PARAM_RANGES = {
  nodeCount:      { min: 2,   max: 12,    step: 1    },
  packetSize:     { min: 64,  max: 9000,  step: 64   },
  burstSize:      { min: 1,   max: 100,   step: 1    },
  bandwidth:      { min: 1,   max: 400,   step: 1    },
  noisedB:        { min: 0,   max: 35,    step: 0.5  },
  windowSize:     { min: 1,   max: 32,    step: 1    },
  interArrival:   { min: 10,  max: 2000,  step: 10   },
  speedMultiplier:{ min: 0.25,max: 4.0,   step: 0.25 },
};

// Per-network-type preset KPI baselines
const NETWORK_PRESETS = {
  '4g':       { name:'4G LTE',     thrMbps:98,   latMs:20,  ploss:0.30, ber:1e-6,  snrDB:28, jitMs:2.0,  rssiDBm:-72, maxBW:20  },
  '5g':       { name:'5G NR',      thrMbps:980,  latMs:2,   ploss:0.05, ber:1e-9,  snrDB:42, jitMs:0.3,  rssiDBm:-68, maxBW:400 },
  'wifi':     { name:'Wi-Fi 6',    thrMbps:450,  latMs:5,   ploss:0.10, ber:1e-8,  snrDB:35, jitMs:0.8,  rssiDBm:-55, maxBW:160 },
  'fiber':    { name:'Fiber',      thrMbps:9800, latMs:0.5, ploss:0.001,ber:1e-12, snrDB:60, jitMs:0.05, rssiDBm:-10, maxBW:400 },
  'satellite':{ name:'Satellite',  thrMbps:50,   latMs:600, ploss:1.20, ber:1e-5,  snrDB:15, jitMs:30,   rssiDBm:-90, maxBW:500 },
};

const PACKET_TYPES = {
  data:    { priority: 3, color: '#388bfd', overhead: 40,  description: 'General data — TCP/IP payload' },
  voice:   { priority: 1, color: '#3fb950', overhead: 12,  description: 'VoIP — low latency critical, small packets' },
  video:   { priority: 2, color: '#a371f7', overhead: 20,  description: 'Streaming video — high bandwidth, burst-tolerant' },
  control: { priority: 0, color: '#f85149', overhead: 8,   description: 'Control plane — routing, signalling, highest priority' },
  ack:     { priority: 0, color: '#d29922', overhead: 4,   description: 'ACK frames — smallest, highest priority' },
};

const ARQ_MODES = {
  'stop-wait':  { winSize: 1,  desc: 'One frame in-flight at a time. Simple, low throughput.' },
  'go-back-n':  { winSize: 8,  desc: 'N frames in-flight, retransmit from error frame forward.' },
  'selective':  { winSize: 16, desc: 'Only retransmit errored frame. Maximum efficiency.' },
};

const ENCODING_SCHEMES = {
  none:            { overhead: 0.0,  corrBits: 0,  desc: 'No error correction' },
  hamming:         { overhead: 0.27, corrBits: 1,  desc: 'Single-bit correction, double-bit detection' },
  crc32:           { overhead: 0.05, corrBits: 0,  desc: 'CRC-32 error detection only' },
  'reed-solomon':  { overhead: 0.33, corrBits: 8,  desc: 'Burst error correction, used in DSL/DVDs' },
  turbo:           { overhead: 0.50, corrBits: 16, desc: 'Near Shannon limit, used in 4G/5G' },
  ldpc:            { overhead: 0.50, corrBits: 24, desc: 'Low-density parity check — 5G NR standard' },
};

module.exports = { DEFAULT_CONFIG, PARAM_RANGES, NETWORK_PRESETS, PACKET_TYPES, ARQ_MODES, ENCODING_SCHEMES };
