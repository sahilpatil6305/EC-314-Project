/**
 * src/engine/Topology.js
 * Builds node graphs for different topology types.
 * Returns { nodes, links, primaryPath } for the simulation and renderer.
 */

function buildTopology(nodeCount, type) {
  const n = Math.max(2, Math.min(12, nodeCount));

  // Assign roles
  const nodes = Array.from({ length: n }, (_, i) => ({
    id:    i,
    label: i === 0 ? 'TX' : i === n - 1 ? 'RX' : `Node ${i}`,
    role:  i === 0 ? 'tx' : i === n - 1 ? 'rx' : (i % 3 === 0 ? 'router' : 'relay'),
    x: 0, y: 0,   // Canvas coords set by renderer
    rxCount: 0,
    active: false,
  }));

  let links = [];
  let primaryPath = [];

  switch (type) {
    case 'linear':
      links = Array.from({ length: n - 1 }, (_, i) => ({ from: i, to: i + 1, quality: 1 }));
      primaryPath = nodes.map(n => n.id);
      break;

    case 'ring':
      links = Array.from({ length: n }, (_, i) => ({ from: i, to: (i + 1) % n, quality: 1 }));
      primaryPath = [0, ...Array.from({ length: Math.floor(n / 2) }, (_, i) => i + 1), n - 1];
      break;

    case 'star': {
      const hub = Math.floor(n / 2);
      links = [];
      for (let i = 0; i < n; i++) {
        if (i !== hub) links.push({ from: hub, to: i, quality: 1 });
      }
      primaryPath = [0, hub, n - 1];
      break;
    }

    case 'mesh':
    default: {
      // Connect each node to next 2 nodes (creates redundant paths)
      const linkSet = new Set();
      for (let i = 0; i < n; i++) {
        for (let j = 1; j <= 2; j++) {
          const target = i + j;
          if (target < n) {
            const key = `${i}-${target}`;
            if (!linkSet.has(key)) { linkSet.add(key); links.push({ from: i, to: target, quality: 1 }); }
          }
        }
      }
      // Primary path: shortest route from 0 to n-1
      primaryPath = dijkstra(nodes, links, 0, n - 1);
      break;
    }
  }

  return { nodes, links, primaryPath, type };
}

/** Simple Dijkstra for shortest path */
function dijkstra(nodes, links, src, dst) {
  const dist  = {};
  const prev  = {};
  const queue = new Set(nodes.map(n => n.id));
  nodes.forEach(n => dist[n.id] = Infinity);
  dist[src] = 0;

  // Build adjacency
  const adj = {};
  nodes.forEach(n => adj[n.id] = []);
  links.forEach(l => { adj[l.from].push(l.to); adj[l.to].push(l.from); });

  while (queue.size > 0) {
    const u = [...queue].reduce((a, b) => dist[a] < dist[b] ? a : b);
    queue.delete(u);
    if (u === dst) break;
    (adj[u] || []).forEach(v => {
      const alt = dist[u] + 1;
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
    });
  }

  const path = [];
  let u = dst;
  while (u !== undefined) { path.unshift(u); u = prev[u]; }
  return path[0] === src ? path : [src, dst];
}

module.exports = { buildTopology };
