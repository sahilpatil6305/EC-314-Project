/**
 * public/js/renderer.js
 * Handles all canvas drawing: nodes, links, animated packets, glow effects.
 */

const Renderer = (() => {
  let canvas, ctx;
  let topology = null;
  let packets  = [];  // active animated packets
  let highlight = 0;
  let animFrame = null;
  let tick = 0;

  const LAYER_COLORS = ['#39d353','#f85149','#d29922','#3fb950','#39d353','#a371f7','#388bfd'];

  function init() {
    canvas = document.getElementById('netCanvas');
    ctx    = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
    loop();
  }

  function resize() {
    const wrap = canvas.parentElement;
    canvas.width  = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    if (topology) layoutNodes();
  }

  function setTopology(topo) {
    topology = topo;
    layoutNodes();
  }

  function layoutNodes(topo) {
    if (!topology) return;
    const W = canvas.width, H = canvas.height;
    const nodes = topology.nodes;
    const n = nodes.length;
    const type = topology.type;
    const pad = 80;

    if (type === 'linear' || n <= 2) {
      nodes.forEach((nd, i) => {
        nd.x = pad + (i / (n - 1)) * (W - pad * 2);
        nd.y = H / 2;
      });
    } else if (type === 'ring') {
      nodes.forEach((nd, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        nd.x = W / 2 + Math.cos(angle) * (Math.min(W, H) / 2 - pad);
        nd.y = H / 2 + Math.sin(angle) * (Math.min(W, H) / 2 - pad);
      });
    } else if (type === 'star') {
      const hub = Math.floor(n / 2);
      nodes[hub].x = W / 2; nodes[hub].y = H / 2;
      const others = nodes.filter((_, i) => i !== hub);
      others.forEach((nd, i) => {
        const angle = (i / others.length) * Math.PI * 2 - Math.PI / 2;
        nd.x = W / 2 + Math.cos(angle) * (Math.min(W, H) / 2 - pad);
        nd.y = H / 2 + Math.sin(angle) * (Math.min(W, H) / 2 - pad);
      });
    } else {
      // mesh — spread across canvas with slight vertical offset for visibility
      nodes.forEach((nd, i) => {
        const cols = Math.ceil(Math.sqrt(n * 1.6));
        const col  = i % cols;
        const row  = Math.floor(i / cols);
        const rows = Math.ceil(n / cols);
        nd.x = pad + col * ((W - pad * 2) / (cols - 1 || 1));
        nd.y = pad + row * ((H - pad * 2) / (rows - 1 || 1));
        nd.x += (i % 2 === 0 ? -15 : 15);  // slight zigzag
        nd.y += (row % 2 === 0 ? 0 : 20);
      });
    }
  }

  function spawnPacket(pkt) {
    const path = pkt.path || [];
    if (!topology || path.length < 2) return;
    packets.push({
      ...pkt,
      pathIdx: 0,
      fromNode: path[0],
      toNode:   path[1],
      progress: 0,
      speed: 0.016 + Math.random() * 0.006,
    });
  }

  function setHighlight(layer) { highlight = layer; }

  function loop() {
    tick++;
    draw();
    updatePackets();
    animFrame = requestAnimationFrame(loop);
  }

  function updatePackets() {
    packets = packets.filter(p => {
      p.progress += p.speed;
      if (p.progress >= 1) {
        p.pathIdx++;
        if (p.pathIdx < p.path.length - 1) {
          p.fromNode = p.path[p.pathIdx];
          p.toNode   = p.path[p.pathIdx + 1];
          if (topology?.nodes[p.fromNode]) topology.nodes[p.fromNode].active = true;
          setTimeout(() => { if (topology?.nodes[p.fromNode]) topology.nodes[p.fromNode].active = false; }, 200);
          p.progress = 0;
          return true;
        }
        if (topology?.nodes[p.toNode]) {
          topology.nodes[p.toNode].rxCount = (topology.nodes[p.toNode].rxCount || 0) + 1;
          topology.nodes[p.toNode].active = true;
          setTimeout(() => { if (topology?.nodes[p.toNode]) topology.nodes[p.toNode].active = false; }, 250);
        }
        if (p.onArrive) p.onArrive(p);
        return false;
      }
      return true;
    });
  }

  function draw() {
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background grid (phosphor green)
    ctx.fillStyle = 'rgba(0,255,136,.03)';
    for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) {
      ctx.fillRect(x, y, 1, 1);
    }

    if (!topology) {
      ctx.fillStyle = 'rgba(0,255,136,.15)';
      ctx.font = '14px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Configure simulation and click RUN', W/2, H/2);
      return;
    }

    // Draw links
    topology.links.forEach(lnk => {
      const a = topology.nodes[lnk.from], b = topology.nodes[lnk.to];
      if (!a || !b) return;
      const isPrimary = isOnPrimaryPath(lnk.from, lnk.to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isPrimary ? 'rgba(0,255,136,.2)' : 'rgba(30,48,40,.8)';
      ctx.lineWidth   = isPrimary ? 1.5 : 1;
      ctx.setLineDash(isPrimary ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Link quality indicator
      if (isPrimary) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = 'rgba(0,255,136,.4)';
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(lnk.snrLabel || '', mx, my - 6);
      }
    });

    // Highlight ring for selected layer
    if (highlight > 0) {
      const lc = LAYER_COLORS[7 - highlight] || '#388bfd';
      topology.nodes.forEach(nd => {
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, 32 + (7 - highlight) * 2, 0, Math.PI * 2);
        ctx.strokeStyle = lc + '55';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Draw nodes
    topology.nodes.forEach((nd, i) => {
      const active = nd.active || packets.some(p => p.fromNode === i || p.toNode === i);

      // Glow halo
      if (active) {
        const g = ctx.createRadialGradient(nd.x, nd.y, 5, nd.x, nd.y, 36);
        g.addColorStop(0, nd.color + '44');
        g.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(nd.x, nd.y, 36, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
      }

      // Node circle
      ctx.beginPath(); ctx.arc(nd.x, nd.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = '#050a08'; ctx.fill();
      ctx.strokeStyle = active ? nd.color : '#1e3028';
      ctx.lineWidth   = active ? 2.5 : 1;
      if (active) ctx.shadowColor = nd.color, ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Role text
      const roleLabel = { tx: 'TX', rx: 'RX', router: 'RTR', relay: 'RLY' }[nd.role] || 'N';
      ctx.fillStyle = nd.color; ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(roleLabel, nd.x, nd.y - 3);
      ctx.fillStyle = '#3d7050'; ctx.font = '7px JetBrains Mono, monospace';
      ctx.fillText(`#${i}`, nd.x, nd.y + 6);

      // Label below
      ctx.fillStyle = '#c8ffd8'; ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(nd.label, nd.x, nd.y + 34);
      ctx.fillStyle = '#3d7050'; ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillText(`rx:${nd.rxCount || 0}`, nd.x, nd.y + 45);

      // Active layer badge
      const layerIdx = tick % 7;
      const lc2 = LAYER_COLORS[layerIdx];
      ctx.beginPath(); ctx.arc(nd.x + 16, nd.y - 16, 5, 0, Math.PI * 2);
      ctx.fillStyle = lc2; ctx.globalAlpha = .85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#050a08'; ctx.font = 'bold 6px monospace';
      ctx.fillText('L' + (7 - layerIdx), nd.x + 16, nd.y - 16);
    });

    // Draw packets
    packets.forEach(p => {
      const fr = topology.nodes[p.fromNode], to = topology.nodes[p.toNode];
      if (!fr || !to) return;
      const t = p.progress;
      const x = fr.x + (to.x - fr.x) * t;
      const y = fr.y + (to.y - fr.y) * t;

      // Trail
      ctx.beginPath();
      ctx.moveTo(fr.x + (to.x - fr.x) * Math.max(0, t - 0.2), fr.y + (to.y - fr.y) * Math.max(0, t - 0.2));
      ctx.lineTo(x, y);
      ctx.strokeStyle = p.color + '77';
      ctx.lineWidth = 2; ctx.stroke();

      // Dot with glow
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, p.retransmit ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      if (p.label) {
        ctx.fillStyle = '#c8ffd8'; ctx.font = 'bold 8px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.label, x, y - 11);
      }
    });

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function isOnPrimaryPath(a, b) {
    if (!topology?.primaryPath) return false;
    const path = topology.primaryPath;
    for (let i = 0; i < path.length - 1; i++) {
      if ((path[i] === a && path[i+1] === b) || (path[i] === b && path[i+1] === a)) return true;
    }
    return false;
  }

  function getTopology() { return topology; }
  function getPacketCount() { return packets.length; }

  return { init, setTopology, spawnPacket, setHighlight, resize, getTopology, getPacketCount };
})();
