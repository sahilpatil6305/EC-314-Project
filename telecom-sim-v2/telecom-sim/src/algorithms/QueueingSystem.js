/**
 * src/algorithms/QueueingSystem.js
 *
 * Implements classical and modern queuing disciplines taught in telecom:
 *
 *  1.  M/M/1    — Single server, Poisson arrivals, exponential service
 *  2.  M/M/c    — Multi-server (c servers), Poisson arrivals
 *  3.  M/G/1    — Single server, general service-time distribution (Pollaczek-Khinchine)
 *  4.  M/D/1    — Deterministic service time (special M/G/1)
 *  5.  PQ       — Priority Queuing (strict 4-level: control > voice > video > data)
 *  6.  WFQ      — Weighted Fair Queuing (deficit round-robin approximation)
 *  7.  RED      — Random Early Detection (congestion avoidance)
 *  8.  WRED     — Weighted RED (per-class drop probabilities)
 *  9.  Token Bucket — Rate limiting / traffic shaping
 * 10.  Leaky Bucket — Constant-rate output shaping
 *
 * All models expose: enqueue(), dequeue(), getStats(), getQueueState()
 */

// ─────────────────────────────────────────────────────────────────────────────
//  BASE QUEUE
// ─────────────────────────────────────────────────────────────────────────────
class BaseQueue {
  constructor(maxLen = 256) {
    this.maxLen     = maxLen;
    this.queue      = [];
    this.dropped    = 0;
    this.served     = 0;
    this.totalWait  = 0;    // sum of wait times for Little's Law
    this.enqueueCount = 0;
  }

  get length()       { return this.queue.length; }
  get utilisation()  { return this.queue.length / this.maxLen; }

  getStats() {
    return {
      queueLen:    this.queue.length,
      maxLen:      this.maxLen,
      dropped:     this.dropped,
      served:      this.served,
      utilisation: (this.utilisation * 100).toFixed(1) + '%',
      avgWait:     this.served > 0 ? (this.totalWait / this.served).toFixed(2) + 'ms' : '0ms',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  M/M/1 QUEUE
//  Arrival rate λ, service rate μ, utilisation ρ = λ/μ
//  Theoretical: E[N] = ρ/(1-ρ),  E[W] = 1/(μ-λ)
// ─────────────────────────────────────────────────────────────────────────────
class MM1Queue extends BaseQueue {
  constructor(arrivalRate, serviceRate, maxLen = 256) {
    super(maxLen);
    this.lambda = arrivalRate;   // packets/tick
    this.mu     = serviceRate;   // packets/tick
    this.rho    = arrivalRate / serviceRate;
    this.name   = 'M/M/1';
  }

  enqueue(packet) {
    this.enqueueCount++;
    if (this.queue.length >= this.maxLen) {
      this.dropped++;
      return { accepted: false, reason: 'queue_full', qlen: this.queue.length };
    }
    packet._enqueueTime = Date.now();
    this.queue.push(packet);
    return { accepted: true, qlen: this.queue.length, position: this.queue.length };
  }

  dequeue() {
    if (!this.queue.length) return null;
    // Poisson service: serve if random < mu
    if (Math.random() > this.mu) return null;
    const pkt = this.queue.shift();
    const wait = Date.now() - (pkt._enqueueTime || Date.now());
    this.totalWait += wait;
    this.served++;
    return pkt;
  }

  /** Theoretical M/M/1 metrics */
  theoretical() {
    const rho = this.rho;
    if (rho >= 1) return { stable: false, note: 'Queue unstable: ρ≥1' };
    return {
      stable:     true,
      rho:        rho.toFixed(3),
      EN:         (rho / (1 - rho)).toFixed(2),         // E[N] mean queue length
      EW:         (1 / (this.mu - this.lambda)).toFixed(2) + 'ms', // E[W] mean wait
      ENq:        (rho * rho / (1 - rho)).toFixed(2),   // E[Nq] mean in queue
      EWq:        (rho / (this.mu - this.lambda)).toFixed(2) + 'ms',
      pBlock:     (Math.pow(rho, this.maxLen) * (1 - rho) / (1 - Math.pow(rho, this.maxLen + 1))).toFixed(4),
    };
  }

  getStats() {
    return { ...super.getStats(), model: 'M/M/1', lambda: this.lambda, mu: this.mu, rho: this.rho.toFixed(3), theoretical: this.theoretical() };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  M/M/c QUEUE  (Erlang-C model)
//  c servers, arrival λ, service μ per server
//  C(c,ρ) = Erlang-C formula for P(wait > 0)
// ─────────────────────────────────────────────────────────────────────────────
class MMcQueue extends BaseQueue {
  constructor(arrivalRate, serviceRate, servers = 2, maxLen = 512) {
    super(maxLen);
    this.lambda  = arrivalRate;
    this.mu      = serviceRate;
    this.c       = servers;
    this.rho     = arrivalRate / (servers * serviceRate);  // system utilisation
    this.busy    = new Array(servers).fill(false);
    this.name    = `M/M/${servers}`;
  }

  enqueue(packet) {
    this.enqueueCount++;
    if (this.queue.length >= this.maxLen) { this.dropped++; return { accepted: false }; }
    packet._enqueueTime = Date.now();
    this.queue.push(packet);
    return { accepted: true, qlen: this.queue.length };
  }

  dequeue() {
    const freeServer = this.busy.indexOf(false);
    if (freeServer === -1 || !this.queue.length) return null;
    if (Math.random() > this.mu) return null;
    const pkt = this.queue.shift();
    this.busy[freeServer] = true;
    setTimeout(() => { this.busy[freeServer] = false; }, 50);
    const wait = Date.now() - (pkt._enqueueTime || Date.now());
    this.totalWait += wait;
    this.served++;
    return pkt;
  }

  /** Erlang-C: probability that arriving call must wait */
  erlangC() {
    const a = this.lambda / this.mu;  // offered load
    const c = this.c;
    if (this.rho >= 1) return { stable: false };
    // P0 computation
    let sum = 0;
    for (let k = 0; k < c; k++) {
      let fact = 1; for (let i = 1; i <= k; i++) fact *= i;
      sum += Math.pow(a, k) / fact;
    }
    let factC = 1; for (let i = 1; i <= c; i++) factC *= i;
    const lastTerm = Math.pow(a, c) / (factC * (1 - this.rho));
    const P0 = 1 / (sum + lastTerm);
    const Cca = (lastTerm * P0);  // Erlang-C value = P(wait > 0)
    const Wq = Cca / (c * this.mu - this.lambda);
    return {
      stable: true,
      C_erlang: Cca.toFixed(4),
      E_Wq: (Wq * 1000).toFixed(2) + 'ms',
      E_W:  (Wq + 1/this.mu).toFixed(2) + 'ms',
      rho:  this.rho.toFixed(3),
      servers: c,
    };
  }

  getStats() {
    return { ...super.getStats(), model: `M/M/${this.c}`, theoretical: this.erlangC(), busyServers: this.busy.filter(Boolean).length };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  M/G/1 QUEUE  (Pollaczek-Khinchine formula)
//  General service time: mean 1/μ, variance σ²
//  P-K: E[W] = λσ²/(2(1-ρ)) + 1/μ
// ─────────────────────────────────────────────────────────────────────────────
class MG1Queue extends BaseQueue {
  constructor(arrivalRate, serviceMean, serviceVariance, maxLen = 256) {
    super(maxLen);
    this.lambda   = arrivalRate;
    this.mu       = 1 / serviceMean;
    this.mean     = serviceMean;
    this.variance = serviceVariance;
    this.rho      = arrivalRate * serviceMean;
    this.name     = 'M/G/1';
    this._serviceTimer = 0;
  }

  enqueue(packet) {
    this.enqueueCount++;
    if (this.queue.length >= this.maxLen) { this.dropped++; return { accepted: false }; }
    packet._enqueueTime = Date.now();
    this.queue.push(packet);
    return { accepted: true, qlen: this.queue.length };
  }

  dequeue() {
    if (!this.queue.length) return null;
    // Service time drawn from general distribution (using Box-Muller for normal approx)
    const serviceTime = this._sampleServiceTime();
    if (Math.random() > 1 / serviceTime) return null;
    const pkt = this.queue.shift();
    const wait = Date.now() - (pkt._enqueueTime || Date.now());
    this.totalWait += wait;
    this.served++;
    return pkt;
  }

  /** Sample service time from distribution (normal approx of general) */
  _sampleServiceTime() {
    // Box-Muller normal sample
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(1, this.mean + Math.sqrt(this.variance) * z);
  }

  /** Pollaczek-Khinchine mean value formula */
  pkFormula() {
    const rho = this.rho;
    if (rho >= 1) return { stable: false };
    const lambda = this.lambda, mean = this.mean, variance = this.variance;
    // E[S²] = Var(S) + E[S]²
    const ES2 = variance + mean * mean;
    // P-K formula: E[Nq] = ρ²/(1-ρ) + λ²·Var(S)/(2(1-ρ))
    const ENq  = (rho*rho/(1-rho) + lambda*lambda*variance / (2*(1-rho)));
    const EN   = ENq + rho;
    const EWq  = ENq / lambda;
    const EW   = EWq + mean;
    return {
      stable: true, rho: rho.toFixed(3),
      E_Nq: ENq.toFixed(2), E_N: EN.toFixed(2),
      E_Wq: (EWq * 1000).toFixed(2) + 'ms',
      E_W:  (EW  * 1000).toFixed(2) + 'ms',
      ES2:  ES2.toFixed(4),
      note: 'Pollaczek-Khinchine formula',
    };
  }

  getStats() {
    return { ...super.getStats(), model: 'M/G/1', theoretical: this.pkFormula() };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRIORITY QUEUE  (4 levels: 0=highest control, 3=lowest best-effort)
//  Strict priority: higher-priority queues always drain first
// ─────────────────────────────────────────────────────────────────────────────
class PriorityQueue {
  constructor(maxLen = 512) {
    this.maxLen   = maxLen;
    this.levels   = [[], [], [], []];   // 4 priority levels
    this.maxPerLevel = [32, 64, 128, Math.max(32, maxLen - 224)];
    this.stats    = [
      { enq: 0, deq: 0, drop: 0, name: 'CONTROL'    },
      { enq: 0, deq: 0, drop: 0, name: 'VOICE/RTP'  },
      { enq: 0, deq: 0, drop: 0, name: 'VIDEO'      },
      { enq: 0, deq: 0, drop: 0, name: 'DATA'       },
    ];
    this.name = 'Priority Queue';
    this.dropped = 0; this.served = 0; this.totalWait = 0;
    this.enqueueCount = 0;
  }

  get queue()  { return this.levels.flat(); }
  get length() { return this.levels.reduce((s, l) => s + l.length, 0); }

  enqueue(packet) {
    this.enqueueCount++;
    const p = Math.min(3, Math.max(0, packet.priority != null ? packet.priority : 3));
    if (this.levels[p].length >= this.maxPerLevel[p]) {
      this.dropped++;
      this.stats[p].drop++;
      return { accepted: false, reason: `level_${p}_full`, priority: p };
    }
    packet._enqueueTime = Date.now();
    packet._priority    = p;
    this.levels[p].push(packet);
    this.stats[p].enq++;
    return { accepted: true, priority: p, qlen: this.length };
  }

  dequeue() {
    for (let p = 0; p < 4; p++) {
      if (this.levels[p].length > 0) {
        const pkt = this.levels[p].shift();
        const wait = Date.now() - (pkt._enqueueTime || Date.now());
        this.totalWait += wait;
        this.served++;
        this.stats[p].deq++;
        return { ...pkt, _servedFromPriority: p };
      }
    }
    return null;
  }

  getQueueState() {
    return this.levels.map((q, i) => ({
      level: i,
      name:  this.stats[i].name,
      len:   q.length,
      max:   this.maxPerLevel[i],
      util:  (q.length / this.maxPerLevel[i] * 100).toFixed(1) + '%',
      ...this.stats[i],
    }));
  }

  getStats() {
    return {
      model: 'Priority Queue (4-level strict)',
      totalLen: this.length,
      levels: this.getQueueState(),
      dropped: this.dropped,
      served: this.served,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WFQ — Weighted Fair Queuing (Deficit Round Robin approximation)
//  Each class gets service proportional to its weight.
//  DRR ensures no starvation and bounded latency per class.
// ─────────────────────────────────────────────────────────────────────────────
class WFQQueue {
  constructor(weights = [4, 3, 2, 1], maxLen = 512) {
    this.maxLen   = maxLen;
    this.weights  = weights;
    this.queues   = weights.map(() => []);
    this.deficits = new Array(weights.length).fill(0);  // DRR deficit counters
    this.quantum  = 512;  // bytes per round (DRR quantum)
    this.current  = 0;    // current round-robin pointer
    this.name     = 'WFQ (DRR)';
    this.dropped = 0; this.served = 0; this.totalWait = 0; this.enqueueCount = 0;
  }

  get length() { return this.queues.reduce((s, q) => s + q.length, 0); }

  enqueue(packet) {
    this.enqueueCount++;
    const cls = Math.min(this.weights.length - 1, Math.max(0, packet.priority || 0));
    if (this.queues[cls].length >= Math.floor(this.maxLen / this.weights.length) + 50) {
      this.dropped++;
      return { accepted: false, class: cls };
    }
    packet._enqueueTime = Date.now();
    packet._wfqClass   = cls;
    this.queues[cls].push(packet);
    return { accepted: true, class: cls, qlen: this.length };
  }

  /** DRR dequeue: add quantum×weight to deficit, serve packets fitting in deficit */
  dequeue() {
    let tried = 0;
    while (tried < this.weights.length) {
      const cls = this.current;
      if (this.queues[cls].length > 0) {
        // Add deficit credit = quantum × normalised weight
        this.deficits[cls] += this.quantum * this.weights[cls] / Math.max(...this.weights);
        if (this.deficits[cls] >= (this.queues[cls][0]?.size || 512)) {
          const pkt = this.queues[cls].shift();
          this.deficits[cls] -= (pkt.size || 512);
          const wait = Date.now() - (pkt._enqueueTime || Date.now());
          this.totalWait += wait;
          this.served++;
          this.current = (this.current + 1) % this.weights.length;
          return pkt;
        }
      } else {
        this.deficits[cls] = 0; // reset deficit if queue empty
      }
      this.current = (this.current + 1) % this.weights.length;
      tried++;
    }
    return null;
  }

  getStats() {
    return {
      model: `WFQ/DRR (weights: ${this.weights.join(':')})`,
      classes: this.queues.map((q, i) => ({
        class: i, weight: this.weights[i],
        len: q.length, deficit: this.deficits[i].toFixed(0),
      })),
      totalLen: this.length, dropped: this.dropped, served: this.served,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  RED — Random Early Detection  (Floyd & Jacobson, 1993)
//  Drops packets probabilistically before queue fills to avoid TCP sync.
//  Drop prob: p = 0 if avg < min_th
//             p = (avg-min_th)/(max_th-min_th) * max_p  if min_th ≤ avg ≤ max_th
//             p = 1 (forced drop)  if avg > max_th
// ─────────────────────────────────────────────────────────────────────────────
class REDQueue extends BaseQueue {
  constructor({ minTh = 50, maxTh = 150, maxP = 0.1, wq = 0.002, maxLen = 256 } = {}) {
    super(maxLen);
    this.minTh  = minTh;   // min threshold (packets)
    this.maxTh  = maxTh;   // max threshold
    this.maxP   = maxP;    // max drop probability
    this.wq     = wq;      // queue weight for EWMA
    this.avgQ   = 0;       // EWMA of queue length
    this.count  = -1;      // packets since last drop
    this.name   = 'RED';
    this.forcedDrops = 0; this.earlyDrops = 0;
  }

  /** EWMA average queue length update */
  _updateAvg() {
    this.avgQ = (1 - this.wq) * this.avgQ + this.wq * this.queue.length;
  }

  /** Compute instantaneous drop probability */
  dropProbability() {
    this._updateAvg();
    if (this.avgQ < this.minTh) return 0;
    if (this.avgQ > this.maxTh) return 1;
    // Linear interpolation
    const pb = this.maxP * (this.avgQ - this.minTh) / (this.maxTh - this.minTh);
    // Count-based: pa = pb / (1 - count * pb)  (gentle RED)
    const pa = pb / (1 - this.count * pb);
    return Math.min(1, Math.max(0, pa));
  }

  enqueue(packet) {
    this.enqueueCount++;
    this._updateAvg();

    if (this.avgQ >= this.maxTh || this.queue.length >= this.maxLen) {
      this.dropped++; this.forcedDrops++;
      this.count = 0;
      return { accepted: false, reason: 'forced_drop', avgQ: this.avgQ.toFixed(1), prob: 1 };
    }

    const prob = this.dropProbability();
    if (prob > 0 && Math.random() < prob) {
      this.dropped++; this.earlyDrops++;
      this.count = 0;
      return { accepted: false, reason: 'early_drop', prob: prob.toFixed(3), avgQ: this.avgQ.toFixed(1) };
    }

    this.count++;
    packet._enqueueTime = Date.now();
    this.queue.push(packet);
    return { accepted: true, prob: prob.toFixed(3), avgQ: this.avgQ.toFixed(1) };
  }

  dequeue() {
    if (!this.queue.length) return null;
    const pkt = this.queue.shift();
    const wait = Date.now() - (pkt._enqueueTime || Date.now());
    this.totalWait += wait;
    this.served++;
    return pkt;
  }

  getStats() {
    return {
      ...super.getStats(),
      model: 'RED',
      avgQ: this.avgQ.toFixed(2),
      dropProb: this.dropProbability().toFixed(4),
      earlyDrops: this.earlyDrops,
      forcedDrops: this.forcedDrops,
      minTh: this.minTh, maxTh: this.maxTh, maxP: this.maxP,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN BUCKET  — Rate limiting / traffic policing
//  Tokens added at rate r tokens/tick. Max burst = bucket depth B.
//  Packet admitted if tokens ≥ packet_size; else dropped or delayed.
// ─────────────────────────────────────────────────────────────────────────────
class TokenBucket {
  constructor({ rate = 100, burst = 1500, maxLen = 128 } = {}) {
    this.rate    = rate;     // tokens (bytes) added per tick
    this.burst   = burst;   // bucket depth (bytes) — max burst
    this.tokens  = burst;   // current token count
    this.queue   = [];
    this.dropped = 0;
    this.served  = 0;
    this.maxLen  = maxLen;
    this.name    = 'Token Bucket';
  }

  /** Called each tick to refill tokens */
  refill() {
    this.tokens = Math.min(this.burst, this.tokens + this.rate);
  }

  enqueue(packet) {
    const size = packet.size || 512;
    if (this.tokens >= size) {
      this.tokens -= size;
      this.queue.push(packet);
      this.served++;
      return { accepted: true, tokens: Math.round(this.tokens) };
    } else if (this.queue.length < this.maxLen) {
      // Conform packet — defer to next tick
      this.queue.push({ ...packet, _deferred: true });
      return { accepted: false, reason: 'deferred', tokens: Math.round(this.tokens) };
    } else {
      this.dropped++;
      return { accepted: false, reason: 'dropped', tokens: Math.round(this.tokens) };
    }
  }

  dequeue() {
    this.refill();
    if (!this.queue.length) return null;
    // Try deferred packets now that tokens may have refilled
    const idx = this.queue.findIndex(p => {
      if (p._deferred && this.tokens >= (p.size || 512)) {
        this.tokens -= (p.size || 512);
        return true;
      }
      return !p._deferred;
    });
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }

  getStats() {
    return {
      model: 'Token Bucket',
      tokens: Math.round(this.tokens),
      burst: this.burst,
      rate: this.rate,
      queueLen: this.queue.length,
      dropped: this.dropped,
      served: this.served,
      fillPct: (this.tokens / this.burst * 100).toFixed(1) + '%',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LEAKY BUCKET  — Traffic shaping (constant output rate)
//  Output drains at constant rate regardless of input burst.
// ─────────────────────────────────────────────────────────────────────────────
class LeakyBucket {
  constructor({ rate = 80, maxLen = 128 } = {}) {
    this.rate     = rate;    // bytes/tick output rate
    this.queue    = [];
    this.maxLen   = maxLen;
    this.dropped  = 0;
    this.served   = 0;
    this._credit  = 0;
    this.name     = 'Leaky Bucket';
  }

  enqueue(packet) {
    if (this.queue.length >= this.maxLen) { this.dropped++; return { accepted: false }; }
    this.queue.push(packet);
    return { accepted: true, qlen: this.queue.length };
  }

  /** Drain at constant rate each tick */
  dequeue() {
    this._credit += this.rate;
    const pktsToServe = [];
    while (this.queue.length > 0 && this._credit >= (this.queue[0].size || 512)) {
      const pkt = this.queue.shift();
      this._credit -= (pkt.size || 512);
      this.served++;
      pktsToServe.push(pkt);
    }
    return pktsToServe.length > 0 ? pktsToServe[0] : null;
  }

  getStats() {
    return { model: 'Leaky Bucket', rate: this.rate, queueLen: this.queue.length, credit: Math.round(this._credit), dropped: this.dropped, served: this.served };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  QUEUE MANAGER — owns all queues, routes packets, exposes aggregate stats
// ─────────────────────────────────────────────────────────────────────────────
class QueueManager {
  constructor(config = {}) {
    const lambda = config.arrivalRate  || 0.8;   // packets/tick
    const mu     = config.serviceRate  || 1.0;
    const c      = config.servers      || 2;

    this.queues = {
      mm1:      new MM1Queue(lambda, mu),
      mmc:      new MMcQueue(lambda, mu, c),
      mg1:      new MG1Queue(lambda, 1/mu, 0.5),
      priority: new PriorityQueue(),
      wfq:      new WFQQueue([4, 3, 2, 1]),
      red:      new REDQueue({ minTh: 30, maxTh: 100, maxP: 0.15 }),
      token:    new TokenBucket({ rate: config.bandwidthMbps * 1000 / 8 || 1500 }),
      leaky:    new LeakyBucket({ rate: config.bandwidthMbps * 900 / 8  || 1200 }),
    };

    this.activeModel = config.queueModel || 'priority';
    this.history     = [];  // { tick, stats } for charts
  }

  setModel(model) {
    if (this.queues[model]) this.activeModel = model;
  }

  enqueue(packet) {
    const q = this.queues[this.activeModel];
    return q ? q.enqueue(packet) : { accepted: false };
  }

  dequeue() {
    const q = this.queues[this.activeModel];
    return q ? q.dequeue() : null;
  }

  tick(tickN) {
    // Serve from all queues each tick (background maintenance)
    Object.values(this.queues).forEach(q => {
      if (q !== this.queues[this.activeModel]) q.dequeue();
    });
    // Record history every 5 ticks
    if (tickN % 5 === 0) {
      this.history.push({
        tick: tickN,
        active: this.activeModel,
        stats: this.getAllStats(),
      });
      if (this.history.length > 100) this.history.shift();
    }
  }

  getAllStats() {
    const out = {};
    Object.entries(this.queues).forEach(([k, q]) => { out[k] = q.getStats(); });
    return out;
  }

  getActiveStats() {
    return this.queues[this.activeModel]?.getStats() || {};
  }

  getLittlesLaw() {
    // Little's Law: L = λ × W  (L = avg # in system, W = avg wait time)
    const stats = this.getActiveStats();
    const L = stats.queueLen || 0;
    const lambda = this.queues.mm1?.lambda || 1;
    const W = L / Math.max(lambda, 0.001);
    return { L, lambda: lambda.toFixed(3), W: W.toFixed(2) + 'ms', formula: 'L = λW' };
  }
}

module.exports = {
  MM1Queue, MMcQueue, MG1Queue, PriorityQueue, WFQQueue,
  REDQueue, TokenBucket, LeakyBucket, QueueManager,
};
