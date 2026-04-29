/**
 * src/algorithms/RoutingAlgorithms.js
 *
 * Routing algorithms implemented from scratch:
 *
 *  1.  Dijkstra       — Classic shortest-path (OSPF uses this)
 *  2.  Bellman-Ford   — Distance-vector, handles negative weights (RIP basis)
 *  3.  OSPF           — Link-state with flooding and SPF recalculation
 *  4.  AODV           — Ad-hoc On-demand Distance Vector (reactive)
 *  5.  Load-balanced  — Multi-path routing with traffic splitting (ECMP)
 *  6.  QoS-aware      — Route selection weighted by latency + BW + loss
 */

// ─────────────────────────────────────────────────────────────────────────────
//  GRAPH representation (adjacency list with link metrics)
// ─────────────────────────────────────────────────────────────────────────────
class Graph {
  constructor(nodeCount) {
    this.n     = nodeCount;
    this.edges = {};  // { fromId: [{to, weight, bw, lat, loss}] }
    for (let i = 0; i < nodeCount; i++) this.edges[i] = [];
  }

  addEdge(from, to, weight = 1, bandwidth = 100, latency = 10, loss = 0.01) {
    this.edges[from].push({ to, weight, bandwidth, latency, loss });
    this.edges[to].push({ to: from, weight, bandwidth, latency, loss });  // undirected
  }

  neighbours(node) { return this.edges[node] || []; }

  updateEdge(from, to, updates) {
    [from, to].forEach((a, idx) => {
      const b = idx === 0 ? to : from;
      const edge = (this.edges[a] || []).find(e => e.to === b);
      if (edge) Object.assign(edge, updates);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. DIJKSTRA  (Priority-queue based, O((V+E) log V))
// ─────────────────────────────────────────────────────────────────────────────
function dijkstra(graph, src, dst, metric = 'weight') {
  const dist  = {};
  const prev  = {};
  const visited = new Set();
  const pq    = [{ node: src, cost: 0 }];  // min-heap simulation

  for (let i = 0; i < graph.n; i++) dist[i] = Infinity;
  dist[src] = 0;

  const getCost = (edge) => {
    switch (metric) {
      case 'latency':   return edge.latency;
      case 'bandwidth': return 1 / (edge.bandwidth + 0.001);  // maximise BW
      case 'loss':      return -Math.log(1 - edge.loss + 0.001);  // minimise loss (log metric)
      case 'composite': return edge.latency * 0.4 + (1/edge.bandwidth) * 0.3 + edge.loss * 100 * 0.3;
      default:          return edge.weight;
    }
  };

  while (pq.length > 0) {
    // Extract minimum (simple sort-based for clarity)
    pq.sort((a, b) => a.cost - b.cost);
    const { node: u, cost } = pq.shift();

    if (visited.has(u)) continue;
    visited.add(u);
    if (u === dst) break;

    for (const edge of graph.neighbours(u)) {
      if (visited.has(edge.to)) continue;
      const alt = dist[u] + getCost(edge);
      if (alt < dist[edge.to]) {
        dist[edge.to] = alt;
        prev[edge.to] = u;
        pq.push({ node: edge.to, cost: alt });
      }
    }
  }

  // Reconstruct path
  const path = [];
  let u = dst;
  while (u !== undefined) { path.unshift(u); u = prev[u]; }
  const valid = path[0] === src;

  return {
    path:   valid ? path : [],
    cost:   dist[dst],
    hops:   valid ? path.length - 1 : -1,
    algorithm: 'Dijkstra',
    metric,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. BELLMAN-FORD  (O(V×E), handles negative weights, basis for RIP)
// ─────────────────────────────────────────────────────────────────────────────
function bellmanFord(graph, src, dst) {
  const dist  = new Array(graph.n).fill(Infinity);
  const prev  = new Array(graph.n).fill(undefined);
  dist[src]   = 0;
  const iterations = [];

  // Collect all edges
  const allEdges = [];
  for (let u = 0; u < graph.n; u++) {
    for (const e of graph.neighbours(u)) {
      allEdges.push({ from: u, to: e.to, weight: e.weight });
    }
  }

  // Relax edges V-1 times
  for (let iter = 0; iter < graph.n - 1; iter++) {
    let updated = false;
    for (const { from, to, weight } of allEdges) {
      if (dist[from] + weight < dist[to]) {
        dist[to] = dist[from] + weight;
        prev[to] = from;
        updated  = true;
      }
    }
    iterations.push({ iter, dist: [...dist] });
    if (!updated) break;  // early termination
  }

  // Negative cycle detection
  let hasNegCycle = false;
  for (const { from, to, weight } of allEdges) {
    if (dist[from] + weight < dist[to]) { hasNegCycle = true; break; }
  }

  const path = [];
  let u = dst;
  while (u !== undefined) { path.unshift(u); u = prev[u]; }

  return {
    path:   path[0] === src ? path : [],
    dist:   dist[dst],
    hasNegativeCycle: hasNegCycle,
    iterations: iterations.length,
    algorithm: 'Bellman-Ford',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. OSPF  — Link-State Routing
//  Each router maintains full topology via flooding of LSAs.
//  Runs Dijkstra internally (SPF calculation).
// ─────────────────────────────────────────────────────────────────────────────
class OSPFRouter {
  constructor(routerId, nodeCount) {
    this.id       = routerId;
    this.lsdb     = {};   // Link-State Database: { routerId: { edges, seqNo } }
    this.n        = nodeCount;
    this.routingTable = {};
    this.seqNo    = 0;
    this.floodLog = [];
  }

  /** Originate an LSA for this router */
  originateLSA(edges) {
    this.seqNo++;
    const lsa = { routerId: this.id, edges, seqNo: this.seqNo, age: 0 };
    this.lsdb[this.id] = lsa;
    this.floodLog.push({ event: 'LSA_ORIGINATED', routerId: this.id, seqNo: this.seqNo });
    return lsa;
  }

  /** Receive and flood an LSA (flooding with duplicate suppression) */
  receiveLSA(lsa) {
    const existing = this.lsdb[lsa.routerId];
    if (existing && existing.seqNo >= lsa.seqNo) return false; // already have newer
    this.lsdb[lsa.routerId] = lsa;
    this.floodLog.push({ event: 'LSA_FLOODED', from: lsa.routerId, seqNo: lsa.seqNo });
    this._runSPF();
    return true; // should re-flood
  }

  /** Run Dijkstra (SPF) on LSDB to compute routing table */
  _runSPF() {
    // Reconstruct graph from LSDB
    const g = new Graph(this.n);
    for (const { edges } of Object.values(this.lsdb)) {
      for (const e of edges) g.addEdge(e.from, e.to, e.cost, e.bandwidth, e.latency, e.loss);
    }
    // Compute shortest paths from this router to all others
    this.routingTable = {};
    for (let dst = 0; dst < this.n; dst++) {
      if (dst !== this.id) {
        const result = dijkstra(g, this.id, dst);
        if (result.path.length > 1) {
          this.routingTable[dst] = { nextHop: result.path[1], cost: result.cost, path: result.path };
        }
      }
    }
  }

  getState() {
    return {
      routerId:  this.id,
      lsdbSize:  Object.keys(this.lsdb).length,
      routes:    this.routingTable,
      seqNo:     this.seqNo,
      recentLog: this.floodLog.slice(-5),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. AODV — Ad-hoc On-demand Distance Vector
//  Route discovery via RREQ flooding, route reply via RREP unicast.
// ─────────────────────────────────────────────────────────────────────────────
class AODVNode {
  constructor(nodeId) {
    this.id           = nodeId;
    this.routeTable   = {};    // dst → { nextHop, hopCount, seqNo, valid }
    this.seqNo        = 0;
    this.rreqId       = 0;
    this.pendingRREQ  = {};    // dst → Promise resolve
    this.processedRREQ= new Set();
    this.log          = [];
  }

  /** Initiate route discovery to dst */
  discoverRoute(dst, graph) {
    this.rreqId++;
    const rreq = {
      type: 'RREQ', srcId: this.id, dstId: dst,
      srcSeq: ++this.seqNo, hopCount: 0, rreqId: this.rreqId,
      path: [this.id],
    };
    this.log.push({ event: 'RREQ_SENT', to: dst, rreqId: this.rreqId });
    return this._floodRREQ(rreq, graph);
  }

  _floodRREQ(rreq, graph) {
    const key = `${rreq.srcId}-${rreq.rreqId}`;
    if (this.processedRREQ.has(key)) return null;
    this.processedRREQ.add(key);

    if (rreq.dstId === this.id || this.routeTable[rreq.dstId]?.valid) {
      // Send RREP back along reverse path
      return this._sendRREP(rreq);
    }

    rreq.hopCount++;
    rreq.path.push(this.id);

    // Propagate to neighbours (simulated)
    return { ...rreq, forwarded: true };
  }

  _sendRREP(rreq) {
    const rrep = {
      type: 'RREP', srcId: rreq.srcId, dstId: rreq.dstId,
      hopCount: rreq.hopCount, path: rreq.path,
    };
    // Install route
    this.routeTable[rreq.srcId] = { nextHop: rreq.path[rreq.path.length - 2] || rreq.srcId, hopCount: rreq.hopCount, valid: true };
    this.log.push({ event: 'RREP_SENT', path: rreq.path });
    return rrep;
  }

  getState() {
    return { nodeId: this.id, routes: Object.keys(this.routeTable).length, routeTable: this.routeTable, seqNo: this.seqNo, log: this.log.slice(-5) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. ECMP — Equal-Cost Multi-Path  (load balancing across equal-cost paths)
// ─────────────────────────────────────────────────────────────────────────────
class ECMPRouter {
  constructor() {
    this.paths   = [];    // array of equal-cost paths
    this.flowMap = {};    // flowId → pathIdx (sticky per flow)
    this.loads   = [];
    this.algo    = 'round-robin';  // 'round-robin' | 'hash' | 'least-loaded'
    this._rr     = 0;
  }

  setPaths(paths) {
    this.paths  = paths;
    this.loads  = new Array(paths.length).fill(0);
  }

  /** Select path for a packet */
  selectPath(packet) {
    if (!this.paths.length) return null;
    let idx;
    switch (this.algo) {
      case 'hash':
        // 5-tuple hash (src, dst, sport, dport, proto)
        idx = Math.abs((packet.srcNode * 31 + packet.dstNode * 17 + (packet.id || 0)) % this.paths.length);
        break;
      case 'least-loaded':
        idx = this.loads.indexOf(Math.min(...this.loads));
        break;
      case 'round-robin':
      default:
        idx = this._rr++ % this.paths.length;
        break;
    }
    this.loads[idx]++;
    return { path: this.paths[idx], pathIdx: idx, load: this.loads[idx] };
  }

  getState() {
    return { paths: this.paths.length, loads: this.loads, algo: this.algo, total: this.loads.reduce((s, l) => s + l, 0) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTING ENGINE — wires all above into the simulation
// ─────────────────────────────────────────────────────────────────────────────
class RoutingEngine {
  constructor(topology) {
    this.topology = topology;
    this.graph    = this._buildGraph(topology);
    this.ospf     = topology.nodes.map((_, i) => new OSPFRouter(i, topology.nodes.length));
    this.ecmp     = new ECMPRouter();
    this.aodvNodes= topology.nodes.map((_, i) => new AODVNode(i));
    this.algo     = 'dijkstra';
    this._initOSPF();
    this._initECMP();
  }

  _buildGraph(topo) {
    const g = new Graph(topo.nodes.length);
    topo.links.forEach(l => g.addEdge(l.from, l.to, l.weight || 1, 100, 10, 0.01));
    return g;
  }

  _initOSPF() {
    // Each router originates its own LSA
    this.topology.nodes.forEach((_, i) => {
      const edges = this.graph.neighbours(i).map(e => ({ from: i, ...e, cost: e.weight, bandwidth: e.bandwidth || 100, latency: e.latency || 10 }));
      const lsa   = this.ospf[i].originateLSA(edges);
      // Flood to all others
      this.ospf.forEach((r, j) => { if (j !== i) r.receiveLSA(lsa); });
    });
  }

  _initECMP() {
    const src = 0, dst = this.topology.nodes.length - 1;
    // Find all equal-cost paths via Dijkstra variants
    const primary = dijkstra(this.graph, src, dst, 'weight');
    const latPath = dijkstra(this.graph, src, dst, 'latency');
    const paths   = [primary.path];
    if (JSON.stringify(latPath.path) !== JSON.stringify(primary.path)) paths.push(latPath.path);
    this.ecmp.setPaths(paths);
  }

  route(packet, metric = 'weight') {
    const src = packet.srcNode || 0;
    const dst = packet.dstNode || this.topology.nodes.length - 1;

    switch (this.algo) {
      case 'ospf':
        return this.ospf[src]?.routingTable[dst] || { path: this.topology.primaryPath };
      case 'bellman-ford':
        return bellmanFord(this.graph, src, dst);
      case 'ecmp':
        return this.ecmp.selectPath(packet) || { path: this.topology.primaryPath };
      case 'aodv':
        return this.aodvNodes[src]?.routeTable[dst]?.valid
          ? { path: [src, this.aodvNodes[src].routeTable[dst].nextHop, dst] }
          : { path: this.topology.primaryPath };
      case 'qos':
        return dijkstra(this.graph, src, dst, 'composite');
      case 'dijkstra':
      default:
        return dijkstra(this.graph, src, dst, metric);
    }
  }

  /** Update link metrics dynamically (e.g. on congestion) */
  updateLinkMetric(from, to, updates) {
    this.graph.updateEdge(from, to, updates);
    // Trigger OSPF re-convergence
    this.topology.nodes.forEach((_, i) => {
      const edges = this.graph.neighbours(i).map(e => ({ from: i, ...e, cost: e.weight }));
      const lsa   = this.ospf[i].originateLSA(edges);
      this.ospf.forEach((r, j) => { if (j !== i) r.receiveLSA(lsa); });
    });
  }

  getState() {
    return {
      algo: this.algo,
      nodes: this.topology.nodes.length,
      ospfRoutes: this.ospf.map(r => r.getState()),
      ecmp: this.ecmp.getState(),
    };
  }
}

module.exports = { Graph, dijkstra, bellmanFord, OSPFRouter, AODVNode, ECMPRouter, RoutingEngine };
