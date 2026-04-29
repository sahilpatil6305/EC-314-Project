/**
 * public/js/ui.js
 * Handles config panel, OSI layer display, ARQ view, frame view, KPI updates.
 */

const UI = (() => {

  const LAYERS = [
    { n:7, name:'Application', color:'#388bfd', pdu:'Data',    kpiKeys:['Delay','Sessions','DNS'],     protocols:['HTTP/2','HTTP/3','HTTPS','DNS','SMTP','SSH'], detail:'Provides services to end-user apps. Handles session init, data encoding, and presentation. KPIs: app latency, active sessions, DNS resolution time.' },
    { n:6, name:'Presentation',color:'#a371f7', pdu:'Data',    kpiKeys:['Enc Rate','Compress','Ovhd'], protocols:['TLS 1.3','SSL','JPEG','H.265','ASN.1'],       detail:'Data translation: encryption (TLS 1.3), compression (LZ4/H.265), serialisation. KPIs: enc throughput, compression ratio, overhead bytes.' },
    { n:5, name:'Session',     color:'#39d353', pdu:'Data',    kpiKeys:['Uptime','Sessions','TO'],     protocols:['SIP','NetBIOS','RPC','L2TP','PPTP'],           detail:'Manages sessions: establishment, maintenance, teardown, synchronisation. Dialog = FULL-DUPLEX. KPIs: uptime %, session count, timeout events.' },
    { n:4, name:'Transport',   color:'#3fb950', pdu:'Segment', kpiKeys:['Retrans','Loss','Cwnd'],      protocols:['TCP','UDP','SCTP','QUIC','DCCP'],              detail:'End-to-end delivery, flow/congestion control, ARQ, multiplexing. TCP = reliable; UDP = low-latency. KPIs: retransmission %, CWND, segment loss.' },
    { n:3, name:'Network',     color:'#d29922', pdu:'Packet',  kpiKeys:['Hop Lat','TTL','Routes'],     protocols:['IPv4','IPv6','OSPF','BGP','MPLS','ICMP'],      detail:'Logical addressing, routing, fragmentation. Selects best path across multiple hops. KPIs: hop latency, TTL expiry rate, routing table size.' },
    { n:2, name:'Data Link',   color:'#f85149', pdu:'Frame',   kpiKeys:['FrErr','CRC/s','Coll'],       protocols:['Ethernet','802.11ax','LTE MAC','NR MAC','ARP'],detail:'Node-to-node transfer. MAC addressing, framing, error detection (CRC/FCS). MAC-layer ARQ. KPIs: frame error %, CRC errors/s, collision count.' },
    { n:1, name:'Physical',    color:'#00ff88', pdu:'Bit',     kpiKeys:['SNR','BER','RSSI'],           protocols:['OFDM','QAM-64','256-QAM','LDPC','NRZ','PAM4'],detail:'Raw bit transmission. Modulation (QAM, OFDM), line coding, synchronisation, power levels. KPIs: SNR (dB), BER, RSSI (dBm), channel capacity.' },
  ];

  const NETWORKS   = ['4g','5g','wifi','fiber','satellite'];
  const NET_LABELS = { '4g':'4G LTE', '5g':'5G NR', wifi:'Wi-Fi 6', fiber:'Fiber', satellite:'Satellite' };
  const TOPOLOGIES = ['mesh','linear','ring','star'];
  const PKT_TYPES  = ['data','voice','video','control','ack'];
  const ARQ_MODES  = ['stop-wait','go-back-n','selective'];
  const ENCODINGS  = ['none','hamming','crc32','reed-solomon','turbo','ldpc'];
  const CHANNELS   = ['awgn','rayleigh','rician','two-ray'];

  const ARQ_DESCS  = {
    'stop-wait': 'Window=1. Sender waits for ACK before next frame. Simple but wastes BW on high-latency links.',
    'go-back-n': 'Window=N. On NACK, retransmits from errored frame onward. Efficient but may waste BW on bursts.',
    'selective': 'Window=N. Retransmits ONLY the errored frame. Maximum efficiency, requires RX buffering.',
  };
  const EC_DESCS = {
    none:           'No FEC. All errors rely on ARQ retransmission.',
    hamming:        'Hamming(n,k): detects 2-bit errors, corrects 1-bit errors. Overhead ≈27%.',
    crc32:          'CRC-32: error detection only (burst ≤32 bits). Relies on ARQ for correction.',
    'reed-solomon': 'RS(255,223): corrects up to 16 symbol errors per codeword. Used in DSL, DVDs.',
    turbo:          'Turbo codes: near-Shannon capacity. Iterative decoding. Used in 4G LTE.',
    ldpc:           'Low-Density Parity Check: iterative belief propagation. Used in 5G NR, Wi-Fi 6.',
  };

  let currentConfig = null;
  let simRunning    = false;
  let selectedLayer = 7;
  let arqState      = null;
  let lastKPIs      = null;
  let lastStats     = null;
  let sparkData     = { thr:[], lat:[], ploss:[], ber:[], snr:[], cap:[], jit:[], arq:[] };
  let activeTab     = 'layers';
  let layerFiringEl = null;

  // ── Config panel builder ───────────────────────────────────────
  function buildConfigPanel() {
    const el = document.getElementById('configPanel');
    el.innerHTML = `
      <div class="cfg-section">
        <div class="cfg-section-head">NETWORK</div>
        <div class="cfg-rows">
          <div class="cfg-row">
            <div class="cfg-label">Type</div>
            <select class="cfg-select" id="cfgNetwork">${NETWORKS.map(n=>`<option value="${n}">${NET_LABELS[n]}</option>`).join('')}</select>
          </div>
          <div class="cfg-row">
            <div class="cfg-label">Topology</div>
            <select class="cfg-select" id="cfgTopology">${TOPOLOGIES.map(t=>`<option value="${t}"${t==='mesh'?' selected':''}>${t}</option>`).join('')}</select>
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Nodes <span class="cfg-label-val" id="vNodes">4</span></label>
            <input type="range" min="2" max="12" value="4" id="cfgNodes" oninput="UI._sliderUpdate('vNodes',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Bandwidth <span class="cfg-label-val" id="vBW">20</span> MHz</label>
            <input type="range" min="1" max="400" value="20" id="cfgBW" oninput="UI._sliderUpdate('vBW',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <div class="cfg-label">Channel model</div>
            <select class="cfg-select" id="cfgChannel">${CHANNELS.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
          </div>
        </div>
      </div>

      <div class="cfg-section">
        <div class="cfg-section-head">PACKET</div>
        <div class="cfg-rows">
          <div class="cfg-row">
            <label class="cfg-label">Size <span class="cfg-label-val" id="vPktSize">512</span> B</label>
            <input type="range" min="64" max="9000" step="64" value="512" id="cfgPktSize" oninput="UI._sliderUpdate('vPktSize',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <div class="cfg-label">Type</div>
            <select class="cfg-select" id="cfgPktType">${PKT_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Burst size <span class="cfg-label-val" id="vBurst">10</span></label>
            <input type="range" min="1" max="100" value="10" id="cfgBurst" oninput="UI._sliderUpdate('vBurst',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Inter-arrival <span class="cfg-label-val" id="vIA">50</span> ms</label>
            <input type="range" min="10" max="2000" step="10" value="50" id="cfgIA" oninput="UI._sliderUpdate('vIA',this.value)" style="width:100%">
          </div>
        </div>
      </div>

      <div class="cfg-section">
        <div class="cfg-section-head">CHANNEL</div>
        <div class="cfg-rows">
          <div class="cfg-row">
            <label class="cfg-label">Noise <span class="cfg-label-val" id="vNoise">5</span> dB</label>
            <input type="range" min="0" max="35" step="0.5" value="5" id="cfgNoise" oninput="UI._sliderUpdate('vNoise',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Speed <span class="cfg-label-val" id="vSpeed">1.0</span>×</label>
            <input type="range" min="0.25" max="4" step="0.25" value="1.0" id="cfgSpeed" oninput="UI._sliderUpdate('vSpeed',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <label class="cfg-label"><input type="checkbox" id="cfgAutoSend" checked style="accent-color:var(--green)"> Auto-send packets</label>
          </div>
        </div>
      </div>

      <div class="cfg-section">
        <div class="cfg-section-head">ARQ + ENCODING</div>
        <div class="cfg-rows">
          <div class="cfg-row">
            <div class="cfg-label">ARQ mode</div>
            <select class="cfg-select" id="cfgARQ">${ARQ_MODES.map(m=>`<option value="${m}"${m==='go-back-n'?' selected':''}>${m}</option>`).join('')}</select>
          </div>
          <div class="cfg-row">
            <label class="cfg-label">Window <span class="cfg-label-val" id="vWin">8</span></label>
            <input type="range" min="1" max="32" value="8" id="cfgWin" oninput="UI._sliderUpdate('vWin',this.value)" style="width:100%">
          </div>
          <div class="cfg-row">
            <div class="cfg-label">Encoding / FEC</div>
            <select class="cfg-select" id="cfgEnc">${ENCODINGS.map(e=>`<option value="${e}"${e==='turbo'?' selected':''}>${e}</option>`).join('')}</select>
          </div>
        </div>
      </div>
    `;
  }

  function _sliderUpdate(valId, val) {
    document.getElementById(valId).textContent = val;
  }

  function readConfig() {
    return {
      networkType:      document.getElementById('cfgNetwork').value,
      topologyType:     document.getElementById('cfgTopology').value,
      nodeCount:        +document.getElementById('cfgNodes').value,
      bandwidth:        +document.getElementById('cfgBW').value,
      channelModel:     document.getElementById('cfgChannel').value,
      packetSize:       +document.getElementById('cfgPktSize').value,
      packetType:       document.getElementById('cfgPktType').value,
      burstSize:        +document.getElementById('cfgBurst').value,
      interArrival:     +document.getElementById('cfgIA').value,
      noisedB:          +document.getElementById('cfgNoise').value,
      speedMultiplier:  +document.getElementById('cfgSpeed').value,
      autoSend:         document.getElementById('cfgAutoSend').checked,
      arqMode:          document.getElementById('cfgARQ').value,
      windowSize:       +document.getElementById('cfgWin').value,
      encoding:         document.getElementById('cfgEnc').value,
    };
  }

  function applyAndStart() {
    const cfg = readConfig();
    currentConfig = cfg;
    simRunning = true;
    document.getElementById('simPill').textContent = '● LIVE';
    document.getElementById('simPill').className = 'pill pill-live';
    WS.send('start', cfg);
    document.getElementById('topologyLabel').textContent = `${cfg.topologyType} | ${cfg.nodeCount} nodes | ${cfg.arqMode} | ${cfg.encoding}`;
  }

  function toggleSim() {
    simRunning = !simRunning;
    const btn = document.getElementById('btnToggle');
    const pill = document.getElementById('simPill');
    if (simRunning) {
      btn.textContent = '⏸ PAUSE';
      pill.textContent = '● LIVE';
      pill.className = 'pill pill-live';
      WS.send('start', currentConfig || readConfig());
    } else {
      btn.textContent = '▶ RESUME';
      pill.textContent = '⏸ PAUSED';
      pill.className = 'pill pill-warn';
      WS.send('stop', {});
    }
  }

  function resetSim() {
    WS.send('stop', {});
    setTimeout(() => WS.send('start', currentConfig || readConfig()), 200);
    Log.clear();
  }

  function injectFault() {
    WS.send('fault', { type: 'interference', link: 'all' });
    const btn = document.getElementById('btnFault');
    btn.textContent = '⚡ CLEAR FAULT';
    setTimeout(() => { btn.textContent = '⚡ FAULT'; }, 3000);
  }

  function sendBurst(count) {
    const cfg = readConfig();
    for (let i = 0; i < count; i++) {
      setTimeout(() => WS.sendImmediate(cfg), i * 80);
    }
  }

  // ── KPI updates ────────────────────────────────────────────────
  function updateKPIs(kpis, stats) {
    lastKPIs  = kpis;
    lastStats = stats;

    const f = v => v >= 1000 ? (v/1000).toFixed(1)+'G' : v >= 100 ? Math.round(v) : v.toFixed(1);
    document.getElementById('kThr').textContent    = f(kpis.thr);
    document.getElementById('kLat').textContent    = kpis.lat >= 100 ? Math.round(kpis.lat) : kpis.lat.toFixed(1);
    document.getElementById('kPL').textContent     = kpis.ploss.toFixed(2);
    document.getElementById('kBER').textContent    = kpis.ber < 1e-10 ? '<1e-10' : kpis.ber.toExponential(1);
    document.getElementById('kSNR').textContent    = Math.round(kpis.snr);
    document.getElementById('kCap').textContent    = f(kpis.capacity || 0);
    document.getElementById('kJit').textContent    = kpis.jit.toFixed(1);
    document.getElementById('kARQ').textContent    = kpis.arqEff ? kpis.arqEff.toFixed(1) : '100';
    document.getElementById('kSent').textContent   = stats.pktSent || 0;
    document.getElementById('kRcvd').textContent   = stats.pktRcvd || 0;
    document.getElementById('kRetrans').textContent= stats.pktRetrans || 0;

    // Sparklines
    const push = (k, v) => { sparkData[k].push(v); if (sparkData[k].length > 80) sparkData[k].shift(); };
    push('thr',   kpis.thr);
    push('lat',   kpis.lat);
    push('ploss', kpis.ploss);
    push('ber',   Math.max(-12, Math.log10(kpis.ber)));
    push('snr',   kpis.snr);
    push('cap',   kpis.capacity || 0);
    push('jit',   kpis.jit);
    push('arq',   kpis.arqEff || 100);

    drawSparkline('spThr',  sparkData.thr,   '#388bfd');
    drawSparkline('spLat',  sparkData.lat,   '#d29922');
    drawSparkline('spPL',   sparkData.ploss, '#f85149');
    drawSparkline('spBER',  sparkData.ber,   '#f85149');
    drawSparkline('spSNR',  sparkData.snr,   '#00ff88');
    drawSparkline('spCap',  sparkData.cap,   '#39d353');
    drawSparkline('spJit',  sparkData.jit,   '#a371f7');
    drawSparkline('spARQ',  sparkData.arq,   '#00ff88');

    // Link pill
    const lp = document.getElementById('linkPill');
    if (kpis.snr < 5) { lp.textContent = 'LINK ✕ DOWN'; lp.className = 'pill pill-err'; }
    else if (kpis.snr < 15 || kpis.ploss > 5) { lp.textContent = 'LINK ~ DEGR'; lp.className = 'pill pill-warn'; }
    else { lp.textContent = 'LINK ● UP'; lp.className = 'pill pill-ok'; }
  }

  function drawSparkline(canvasId, data, color) {
    const c = document.getElementById(canvasId);
    if (!c || data.length < 2) return;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const min = Math.min(...data), max = Math.max(...data) || 1;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((v - min) / (max - min)) * (H - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
    // Last value dot
    const lx = W, ly = H - ((data[data.length-1] - min) / (max - min)) * (H-4) - 2;
    ctx.beginPath(); ctx.arc(lx-2, ly, 2, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
  }

  // ── OSI Layer list ─────────────────────────────────────────────
  function renderOSI(kpis) {
    if (!kpis) return;
    const container = document.getElementById('osiStack');
    const kpiVals = [
      [kpis.lat.toFixed(1)+'ms', '1', kpis.lat.toFixed(0)+'ms'],
      [(kpis.thr > 0 ? (kpis.thr * (1-0.27)).toFixed(1) : '—')+'Mbps', '40%', '29B'],
      ['99.9%', '1', '30s'],
      [kpis.ploss.toFixed(2)+'%', kpis.ploss.toFixed(2)+'%', Math.round(64+kpis.snr*.5)+'KB'],
      [kpis.lat.toFixed(1)+'ms', '64', '1'],
      [kpis.ploss.toFixed(2)+'%', kpis.crc, '0'],
      [Math.round(kpis.snr)+'dB', kpis.ber<1e-10?'<1e-10':kpis.ber.toExponential(1), Math.round(kpis.rssi)+'dBm'],
    ];
    container.innerHTML = '';
    LAYERS.forEach((l, i) => {
      const isSel = selectedLayer === l.n;
      const div = document.createElement('div');
      div.className = 'osi-layer' + (isSel ? ' sel' : '');
      div.onclick = () => { selectedLayer = l.n; renderOSI(lastKPIs); updateFrameView(); };
      const vals = kpiVals[i] || [];
      div.innerHTML = `
        <div class="osi-lh">
          <div class="osi-num" style="background:${l.color}22;color:${l.color}">${l.n}</div>
          <div class="osi-name" style="color:${l.color}">${l.name}</div>
          <div class="osi-pdu">${l.pdu}</div>
          <div class="osi-dot" style="background:${l.color}" id="ldot${l.n}"></div>
        </div>
        <div class="osi-kpis">
          ${l.kpiKeys.map((k,j)=>`<div class="osi-kpi"><span class="osi-kpi-n">${k}:</span><span class="osi-kpi-v" style="color:${l.color}">${vals[j]||'—'}</span></div>`).join('')}
        </div>
        <div class="osi-detail">${l.detail}<div class="proto-tags">${l.protocols.map(p=>`<span class="proto-tag">${p}</span>`).join('')}</div></div>
      `;
      container.appendChild(div);
    });
  }

  function fireLayerDot(layerN) {
    const dot = document.getElementById('ldot' + layerN);
    if (dot) { dot.classList.add('active'); setTimeout(() => dot.classList.remove('active'), 500); }
    const layerEl = dot?.closest('.osi-layer');
    if (layerEl) { layerEl.classList.add('firing'); setTimeout(() => layerEl.classList.remove('firing'), 400); }
  }

  // ── ARQ View ───────────────────────────────────────────────────
  function renderARQ(arq, stats) {
    if (!arq) return;
    arqState = arq;
    const el = document.getElementById('arqView');
    const winHTML = arq.windowHistory.map((f, i) => {
      const cls = f === 'acked' ? 'wf-a' : f === 'nacked' ? 'wf-n' : f === 'waiting' ? 'wf-w' : f === 'sent' ? 'wf-s' : 'wf-f';
      const label = f === 'acked' ? '✓' : f === 'nacked' ? '✕' : f === 'waiting' ? '…' : f === 'sent' ? i % arq.winSize : i % arq.winSize;
      return `<div class="wf ${cls}">${label}</div>`;
    }).join('');

    el.innerHTML = `
      <div>
        <div class="arq-section-title">Protocol: ${arq.mode.toUpperCase()} | Window=${arq.winSize}</div>
        <div class="arq-desc">${ARQ_DESCS[arq.mode] || ''}</div>
        <div class="arq-section-title">Sliding window (${arq.winSize * 2} slots)</div>
        <div class="win-vis">${winHTML}</div>
      </div>
      <div>
        <div class="arq-section-title">EC: ${(lastKPIs ? '' : '')} ${currentConfig?.encoding?.toUpperCase() || '—'}</div>
        <div class="arq-desc">${EC_DESCS[currentConfig?.encoding] || ''}</div>
      </div>
      <div>
        <div class="arq-section-title">Statistics</div>
        <div class="arq-stats-grid">
          <div class="arq-stat"><div class="arq-stat-n">FRAMES SENT</div><div class="arq-stat-v">${arq.ackCount + arq.nackCount}</div></div>
          <div class="arq-stat"><div class="arq-stat-n">ACKs RCVD</div><div class="arq-stat-v" style="color:var(--green)">${arq.ackCount}</div></div>
          <div class="arq-stat"><div class="arq-stat-n">NACKs / TO</div><div class="arq-stat-v" style="color:var(--red)">${arq.nackCount}</div></div>
          <div class="arq-stat"><div class="arq-stat-n">RETRANS</div><div class="arq-stat-v" style="color:var(--amber)">${arq.retransCount}</div></div>
          <div class="arq-stat"><div class="arq-stat-n">EFFICIENCY</div><div class="arq-stat-v">${arq.efficiency}</div></div>
          <div class="arq-stat"><div class="arq-stat-n">PKTS LOST</div><div class="arq-stat-v">${stats?.pktLost || 0}</div></div>
        </div>
        <div class="arq-section-title" style="margin-top:8px">BER history (log scale)</div>
        <div class="ber-canvas-wrap"><canvas id="berChart" width="280" height="52"></canvas></div>
      </div>
    `;
    // Redraw BER chart
    if (window._simState?.kpiHistory?.ber) drawBERChart(window._simState.kpiHistory.ber);
  }

  function drawBERChart(berHist) {
    const c = document.getElementById('berChart');
    if (!c || berHist.length < 2) return;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const min = -12, max = 0;
    ctx.beginPath();
    berHist.forEach((v, i) => {
      const x = (i / (berHist.length - 1)) * W;
      const y = H - ((v - min) / (max - min)) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#f85149'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#3d7050'; ctx.font = '8px JetBrains Mono, monospace';
    ctx.fillText('BER (log10)', 2, 10);
  }

  // ── Frame View ─────────────────────────────────────────────────
  function updateFrameView(layerFrames) {
    const el = document.getElementById('frameView');
    const layer = LAYERS.find(l => l.n === selectedLayer);
    if (!layer) return;
    const k = lastKPIs;

    // Encapsulation stack
    let encap = LAYERS.map(l => {
      const isSel = l.n === selectedLayer;
      return `<div class="encap-row">
        <div class="encap-label" style="color:${l.color};font-size:8px">L${l.n} ${l.name}</div>
        <div class="encap-bar" style="background:${l.color}${isSel?'cc':'22'};border:1px solid ${l.color}${isSel?'ff':'44'};color:${isSel?'#050a08':l.color}">${l.pdu} | ${l.protocols[0]}${isSel?' ◄ ACTIVE':''}</div>
      </div>`;
    }).join('');

    const lf = layerFrames?.find(f => f.layer === selectedLayer) || {};
    const hdr = lf.header || {};
    const hdrHTML = Object.entries(hdr).map(([k,v]) =>
      `<div class="ff"><div class="ff-n">${k}</div><div class="ff-v">${v}</div></div>`
    );
    // Group into rows of 3
    let hdrRows = '';
    for (let i = 0; i < hdrHTML.length; i += 3) {
      hdrRows += `<div class="frame-row">${hdrHTML.slice(i, i+3).join('')}</div>`;
    }

    el.innerHTML = `
      <div>
        <div class="frame-sec-title">L${selectedLayer} ${layer.name} — Frame Header</div>
        <div class="frame-box">
          <div class="frame-row">
            <div class="ff ff-hl"><div class="ff-n">LAYER</div><div class="ff-v" style="color:${layer.color}">L${selectedLayer} ${layer.name}</div></div>
            <div class="ff"><div class="ff-n">PDU</div><div class="ff-v">${layer.pdu}</div></div>
            <div class="ff"><div class="ff-n">PROTO</div><div class="ff-v">${lf.protocol || layer.protocols[0]}</div></div>
          </div>
          ${hdrRows || '<div class="frame-row"><div class="ff"><div class="ff-n">—</div><div class="ff-v">Run simulation to see live headers</div></div></div>'}
        </div>
      </div>
      ${k ? `<div>
        <div class="frame-sec-title">Error Control Status</div>
        <div class="frame-box">
          <div class="frame-row">
            <div class="ff ff-hl"><div class="ff-n">SCHEME</div><div class="ff-v">${currentConfig?.encoding?.toUpperCase()||'—'}</div></div>
            <div class="ff ${k.ber < 1e-5 ? 'ff-ok' : 'ff-err'}"><div class="ff-n">STATUS</div><div class="ff-v">${k.ber < 1e-5 ? '✓ NOMINAL' : '✕ CORRECTING'}</div></div>
          </div>
          <div class="frame-row">
            <div class="ff"><div class="ff-n">BER</div><div class="ff-v">${k.ber.toExponential(1)}</div></div>
            <div class="ff"><div class="ff-n">SNR</div><div class="ff-v">${Math.round(k.snr)}dB</div></div>
            <div class="ff"><div class="ff-n">ARQ</div><div class="ff-v">${currentConfig?.arqMode?.toUpperCase()||'—'}</div></div>
          </div>
        </div>
      </div>` : ''}
      <div>
        <div class="frame-sec-title">Encapsulation Stack</div>
        ${encap}
      </div>
    `;
  }

  // ── Tabs ──────────────────────────────────────────────────────
  function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.tab').forEach((t, i) => {
      const ids = ['layers', 'arq', 'frame', 'log'];
      t.classList.toggle('active', ids[i] === id);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === 'tc-' + id);
    });
    if (id === 'frame') updateFrameView();
  }

  return {
    buildConfigPanel, readConfig, applyAndStart, toggleSim, resetSim,
    injectFault, sendBurst, updateKPIs, renderOSI, renderARQ,
    updateFrameView, switchTab, fireLayerDot, drawBERChart,
    _sliderUpdate,
  };
})();
