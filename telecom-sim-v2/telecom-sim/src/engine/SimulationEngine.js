/**
 * src/engine/SimulationEngine.js  (v2 — Algorithm-rich)
 *
 * Wires together every algorithm module into one simulation tick:
 *   QueueManager (M/M/1, M/G/1, PQ, WFQ, RED, Token Bucket)
 *   TCPCongestionControl (Reno + CUBIC, AIMD)
 *   AdaptiveMCS  (AMC — SNR→MCS, outer-loop link adaptation)
 *   HARQController (Chase Combining + Incremental Redundancy)
 *   PowerController (Foschini-Miljanic distributed power control)
 *   WaterFilling (OFDM subchannel power allocation)
 *   RoutingEngine (Dijkstra, OSPF, Bellman-Ford, AODV, ECMP, QoS)
 *   ARQController (Stop-Wait, Go-Back-N, Selective Repeat)
 *   OSIStack (all 7 layers with live headers)
 *   KPIEngine (Shannon capacity, BER channel models)
 */

const { NETWORK_PRESETS, PACKET_TYPES, ENCODING_SCHEMES } = require('../../config/defaults');
const { buildTopology }        = require('./Topology');
const { computeKPIs }          = require('./KPIEngine');
const { ARQController }        = require('../arq/ARQController');
const { encodePacket }         = require('../encoding/Codec');
const { processLayers }        = require('../layers/OSIStack');
const { QueueManager }         = require('../algorithms/QueueingSystem');
const {
  TCPCongestionControl,
  AdaptiveMCS,
  HARQController,
  PowerController,
  WaterFilling,
} = require('../algorithms/AdaptiveAlgorithms');
const { RoutingEngine } = require('../algorithms/RoutingAlgorithms');

class SimulationEngine {
  constructor(config, broadcast) {
    this.cfg       = config;
    this.broadcast = broadcast;
    this.running   = false;
    this.tick      = 0;
    this.timer     = null;

    // Core topology
    this.topology = buildTopology(config.nodeCount, config.topologyType);

    // ARQ
    this.arq = new ARQController(config.arqMode, config.windowSize);

    // Queuing
    this.queueMgr = new QueueManager({
      arrivalRate:   config.interArrival ? 1000 / config.interArrival : 0.8,
      serviceRate:   1.2,
      servers:       Math.max(1, Math.floor(config.nodeCount / 2)),
      queueModel:    config.queueModel || 'priority',
      bandwidthMbps: config.bandwidth  || 20,
    });

    // TCP Congestion Control
    this.tcp      = new TCPCongestionControl({ initCwnd: 1, maxCwnd: 1024 });
    this.tcp.algo = config.tcpAlgo || 'reno';

    // Adaptive MCS
    this.amc = new AdaptiveMCS();

    // HARQ
    this.harq = new HARQController(config.harqMode || 'ir', 4);

    // Power Control
    this.powerCtrl = new PowerController(config.nodeCount, 10);

    // Water-Filling
    this.waterFill = new WaterFilling(Math.max(4, Math.floor((config.bandwidth || 20) / 5)));

    // Routing Engine
    this.routing      = new RoutingEngine(this.topology);
    this.routing.algo = config.routingAlgo || 'dijkstra';

    // Stats
    this.stats = {
      pktSent: 0, pktRcvd: 0, pktLost: 0, pktRetrans: 0,
      bytesSent: 0, bytesRcvd: 0,
      arqAck: 0, arqNack: 0, arqRetrans: 0,
      crcErrors: 0, correctedErrors: 0,
      faultActive: false,
      queueDrops: 0, harqRounds: 0, powerIterations: 0, routeChanges: 0,
    };

    this.kpiHistory = {
      thr: [], lat: [], ber: [], snr: [], ploss: [], arqEff: [],
      cwnd: [], queueLen: [], mcsIndex: [], power: [],
    };
    this.MAX_HIST = 120;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const ms = Math.round(100 / (this.cfg.speedMultiplier || 1));
    this.timer = setInterval(() => this._tick(), ms);

    this._log('SYS',  `Engine v2 started — ${this.cfg.networkType.toUpperCase()} | ${this.cfg.nodeCount} nodes`);
    this._log('SYS',  `ARQ:${this.cfg.arqMode} | ENC:${this.cfg.encoding} | Q:${this.cfg.queueModel || 'priority'} | Route:${this.cfg.routingAlgo || 'dijkstra'}`);
    this._log('TCP',  `Congestion control: ${this.tcp.algo.toUpperCase()} | init cwnd=1 MSS`);
    this._log('AMC',  `Adaptive MCS online | target BLER=10% | ${this.amc.currentMCS} initial MCS`);
    this._log('HARQ', `HARQ ${this.harq.mode.toUpperCase()} | max ${this.harq.maxRounds} rounds`);
    this._log('PWR',  `Power control: Foschini-Miljanic | ${this.cfg.nodeCount} nodes | target SINR=10dB`);
    this._log('Q',    `Queue model: ${this.cfg.queueModel || 'priority'} | λ=${(1000/(this.cfg.interArrival||50)).toFixed(2)} pkt/s`);

    this.broadcast('topology', this.topology);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this._log('SYS', 'Engine stopped');
  }

  injectFault(options = {}) {
    this.stats.faultActive = !this.stats.faultActive;
    if (this.stats.faultActive) {
      this._log('FAULT', `⚡ FAULT: ${options.type || 'interference'} on ${options.link || 'all links'}`, 'err');
      this._log('TCP',   'TCP congestion detected → ssthresh halved, cwnd reset', 'warn');
      this.tcp.onTimeout();
      this.routing.updateLinkMetric(0, 1, { weight: 999, latency: 500 });
      this.stats.routeChanges++;
      this._log('OSPF', 'LSA flooded — SPF recomputed, alternate path selected', 'warn');
    } else {
      this._log('FAULT', 'Fault cleared — link recovering', 'ok');
      this.routing.updateLinkMetric(0, 1, { weight: 1, latency: 10 });
      this.stats.routeChanges++;
      this._log('OSPF', 'Link restored — OSPF reconverging', 'ok');
      this._log('TCP',  'TCP entering slow start on recovered link', 'ok');
    }
    this.broadcast('fault', { active: this.stats.faultActive });
  }

  _tick() {
    this.tick++;
    const kpis     = computeKPIs(this.cfg, this.stats, this.tick);
    const mcsEntry = this.amc.selectMCS(kpis.snr);

    // Power control (every 5 ticks)
    if (this.tick % 5 === 0) {
      const pc = this.powerCtrl.iterate();
      this.stats.powerIterations++;
      if (pc.converged && this.tick % 50 === 0)
        this._log('PWR', `Foschini-Miljanic converged | powers: ${pc.powers.map(p=>p.toFixed(3)+'W').join(', ')}`);
    }

    // Water-filling update (every 10 ticks)
    if (this.tick % 10 === 0) this.waterFill.updateGains(kpis.snr);

    // AMC log (every 20 ticks)
    if (this.tick % 20 === 0)
      this._log('AMC', `MCS${mcsEntry.mcs} ${mcsEntry.mod} rate=${mcsEntry.rate.toFixed(2)} eff=${mcsEntry.eff}b/s/Hz SNR=${kpis.snr.toFixed(1)}dB`);

    // Auto-send
    const sendEvery = Math.max(1, Math.round((this.cfg.interArrival || 50) / 100));
    if (this.cfg.autoSend && this.tick % sendEvery === 0) {
      this._sendPacket(kpis, mcsEntry);
    }

    // Queue tick
    this.queueMgr.tick(this.tick);

    // KPI history
    this._pushHistory(kpis, mcsEntry);

    // Broadcast (every 3 ticks)
    if (this.tick % 3 === 0) {
      this.broadcast('state', {
        tick:       this.tick,
        kpis,
        stats:      this.stats,
        topology:   this.topology,
        arq:        this.arq.getState(),
        tcp:        this.tcp.getState(),
        amc:        this.amc.getState(),
        harq:       this.harq.getState(),
        powerCtrl:  this.powerCtrl.getState(),
        waterFill:  this.waterFill.getState(),
        queue:      this.queueMgr.getAllStats(),
        routing:    { algo: this.routing.algo, routeChanges: this.stats.routeChanges },
        kpiHistory: this.kpiHistory,
      });
    }
  }

  _sendPacket(kpis, mcsEntry) {
    const cfg   = this.cfg;
    const pType = PACKET_TYPES[cfg.packetType] || PACKET_TYPES.data;
    const enc   = ENCODING_SCHEMES[cfg.encoding] || ENCODING_SCHEMES.none;

    const pkt = {
      id:        ++this.stats.pktSent,
      size:      cfg.packetSize,
      type:      cfg.packetType,
      priority:  pType.priority,
      color:     pType.color,
      srcNode:   0,
      dstNode:   this.topology.nodes.length - 1,
      path:      this.topology.primaryPath,
      timestamp: Date.now(),
    };

    // Routing
    const route = this.routing.route(pkt);
    pkt.path = route.path?.length > 1 ? route.path : this.topology.primaryPath;

    // Queue
    const qr = this.queueMgr.enqueue(pkt);
    if (!qr.accepted) {
      this.stats.queueDrops++;
      this._log('Q', `#${pkt.id} DROPPED by ${cfg.queueModel||'priority'} — ${qr.reason||'full'} avgQ=${qr.avgQ||'?'}`, 'err');
      return;
    }
    if (qr.prob && parseFloat(qr.prob) > 0.01)
      this._log('RED', `#${pkt.id} RED early-drop p=${qr.prob} avgQ=${qr.avgQ}`, 'warn');

    // OSI encapsulation
    const layerFrames = processLayers(pkt, cfg, kpis);
    const encodedSize = Math.round(pkt.size * (1 + enc.overhead));
    this.stats.bytesSent += encodedSize;

    // Channel loss
    const berLoss  = Math.random() < kpis.ber * pkt.size * 8;
    const fadeLoss = kpis.snr < 3 || this.stats.faultActive;
    let   lost     = Math.random() < kpis.ploss / 100 || berLoss || fadeLoss;

    // HARQ recovery
    if (lost) {
      const hr = this.harq.receive(pkt.id, kpis.snr);
      this.stats.harqRounds++;
      if (hr.decoded) {
        lost = false;
        this._log('HARQ', `#${pkt.id} recovered — ${this.harq.mode.toUpperCase()} round ${hr.round} combSNR=${hr.combinedSNR}dB`, 'warn');
        this.amc.onBlockResult(true);
      } else {
        this.amc.onBlockResult(false);
        this._log('HARQ', `#${pkt.id} unrecoverable after ${hr.round} HARQ rounds`, 'err');
      }
    } else {
      this.amc.onBlockResult(true);
    }

    // ARQ
    const arqR = this.arq.send(pkt.id, lost);

    if (arqR.lost) {
      this.stats.pktLost++;
      this.stats.crcErrors++;
      this._log('L2',  `Frame #${pkt.id} LOST — ${cfg.encoding} overhead=${enc.overhead*100|0}%`, 'err');
      this._log('ARQ', `NACK #${pkt.id} — ${cfg.arqMode} | base=${this.arq.sendBase} win=${this.arq.winSize}`, 'warn');
      this.tcp.onDupACK();

      if (arqR.retransmit) {
        this.stats.pktRetrans++;
        this.stats.arqRetrans++;
        this._log('ARQ', `↺ Retransmit #${pkt.id} | ${cfg.arqMode === 'go-back-n' ? 'resending from base' : 'selective frame only'}`, 'ok');
        this.broadcast('packet-move', { ...pkt, color: '#d29922', label: `↺${pkt.id}`, retransmit: true });
        this.stats.pktRcvd++;
        this.stats.bytesRcvd += encodedSize;
        this.tcp.onACK();
      }
    } else {
      this.stats.pktRcvd++;
      this.stats.arqAck++;
      this.stats.bytesRcvd += encodedSize;
      if (enc.corrBits > 0 && kpis.ber > 1e-8) {
        this.stats.correctedErrors++;
        this._log('L2', `Frame #${pkt.id} — ${enc.corrBits}-bit errors CORRECTED by ${cfg.encoding}`, 'warn');
      } else {
        this._log('L2', `Frame #${pkt.id} OK — ${encodedSize}B | MCS${mcsEntry.mcs} ${mcsEntry.mod} | path ${pkt.path.join('→')}`, 'ok');
      }
      this._log('L4', `Seg #${pkt.id} ACK | cwnd=${Math.round(this.tcp.cwnd)} | ${this.tcp.state} | via ${route.algorithm||this.routing.algo}`, 'ok');
      this.tcp.onACK();
      this.tcp.updateRTT(kpis.lat + Math.random() * 4);
    }

    // Broadcast layer events
    layerFrames.forEach((lf, i) => setTimeout(() => this.broadcast('layer-event', lf), i * 28));
    this.broadcast('packet', { packet: pkt, layerFrames, lost, arqResult: arqR, encodedSize, mcs: mcsEntry, route });
  }

  _pushHistory(kpis, mcs) {
    const h = this.kpiHistory;
    const push = (k, v) => { h[k].push(v); if (h[k].length > this.MAX_HIST) h[k].shift(); };
    push('thr',      kpis.thr);
    push('lat',      kpis.lat);
    push('ber',      Math.max(-12, Math.log10(kpis.ber)));
    push('snr',      kpis.snr);
    push('ploss',    kpis.ploss);
    push('arqEff',   this.stats.arqAck > 0 ? (this.stats.arqAck/(this.stats.arqAck+this.stats.arqRetrans))*100 : 100);
    push('cwnd',     this.tcp.cwnd);
    push('queueLen', this.queueMgr.getActiveStats()?.queueLen || 0);
    push('mcsIndex', mcs.mcs);
    push('power',    this.powerCtrl.powers[0] * 1000);
  }

  _log(layer, msg, type = 'ok') {
    this.broadcast('log', { layer, msg, type, ts: Date.now() });
  }
}

module.exports = { SimulationEngine };
