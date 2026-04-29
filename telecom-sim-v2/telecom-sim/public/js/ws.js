/**
 * public/js/ws.js  — WebSocket client
 * Connects to server, routes events to UI/Renderer/Log.
 */
const WS = (() => {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      document.getElementById('wsPill').textContent = '⬡ CONNECTED';
      document.getElementById('wsPill').className   = 'pill pill-ok';
      clearTimeout(reconnectTimer);
    };

    ws.onclose = () => {
      document.getElementById('wsPill').textContent = '⬡ RECONNECTING';
      document.getElementById('wsPill').className   = 'pill pill-warn';
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      document.getElementById('wsPill').textContent = '⬡ ERROR';
      document.getElementById('wsPill').className   = 'pill pill-err';
    };

    ws.onmessage = (evt) => {
      try {
        const { event, payload } = JSON.parse(evt.data);
        route(event, payload);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };
  }

  function route(event, payload) {
    switch (event) {
      case 'connected':
        Log.add('SYS', 'WebSocket connected to simulation server', 'info');
        break;

      case 'state':
        window._simState = payload;
        UI.updateKPIs(payload.kpis, payload.stats);
        if (payload.topology) Renderer.setTopology(payload.topology);
        UI.renderOSI(payload.kpis);
        UI.renderARQ(payload.arq, payload.stats);
        break;

      case 'topology':
        Renderer.setTopology(payload);
        Log.add('SYS', `Topology: ${payload.type} | ${payload.nodes.length} nodes`, 'info');
        break;

      case 'packet':
        handlePacketEvent(payload);
        break;

      case 'packet-move':
        handlePacketMove(payload);
        break;

      case 'layer-event':
        handleLayerEvent(payload);
        break;

      case 'log':
        Log.add(payload.layer, payload.msg, payload.type);
        break;

      case 'fault':
        Log.add('FAULT', payload.active ? '⚡ FAULT INJECTED' : 'Fault cleared', payload.active ? 'err' : 'ok');
        break;
    }
  }

  function handlePacketEvent(payload) {
    const pkt = payload.packet;
    if (!pkt) return;
    const color = payload.lost ? '#f85149' : (pkt.color || '#388bfd');
    Renderer.spawnPacket({ ...pkt, color, label: `#${pkt.id}` });
    // If retransmitted, spawn again after delay
    if (payload.arqResult?.retransmit) {
      setTimeout(() => {
        Renderer.spawnPacket({ ...pkt, color: '#d29922', label: `↺${pkt.id}`, retransmit: true });
      }, 400);
    }
  }

  function handlePacketMove(pkt) {
    Renderer.spawnPacket(pkt);
  }

  function handleLayerEvent(lf) {
    UI.fireLayerDot(lf.layer);
    UI.updateFrameView([lf]);
  }

  function send(action, data) {
    fetch(`/api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(err => console.error('API error:', err));
  }

  function sendImmediate(cfg) {
    // Trigger a packet via config endpoint
    send('start', { ...cfg, autoSend: false, burstNow: 1 });
  }

  return { connect, send, sendImmediate };
})();
