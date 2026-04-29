/**
 * src/layers/OSIStack.js
 * Runs a packet through all 7 OSI layers (top-down for TX, bottom-up for RX).
 * Returns an array of layer-frame objects for the UI to animate.
 */

/**
 * Layer definitions with header fields and encapsulation logic.
 */
const LAYER_DEFS = [
  {
    n: 7, name: 'Application', pdu: 'Data',
    protocols: { '4g':'HTTP/2', '5g':'HTTP/3', wifi:'HTTP/2', fiber:'HTTP/2', satellite:'QUIC' },
    buildHeader: (pkt, cfg) => ({
      'Src-Port':  49152 + (pkt.id % 16383),
      'Dst-Port':  cfg.packetType === 'voice' ? 5060 : 443,
      'Protocol':  cfg.packetType === 'voice' ? 'SIP/RTP' : 'HTTP/2',
      'Payload-B': pkt.size,
      'Type':      pkt.type,
    }),
    overhead: 0,
  },
  {
    n: 6, name: 'Presentation', pdu: 'Data',
    protocols: { default: 'TLS 1.3' },
    buildHeader: (pkt, cfg) => ({
      'Format':    'TLS 1.3',
      'Cipher':    'AES-256-GCM',
      'Compress':  cfg.packetType === 'video' ? 'H.265' : 'LZ4',
      'IV-B':      12,
      'MAC-B':     16,
    }),
    overhead: 29,
  },
  {
    n: 5, name: 'Session', pdu: 'Data',
    protocols: { default: 'SIP' },
    buildHeader: (pkt, cfg) => ({
      'Session-ID': `0x${(pkt.id * 0xA3F + 0x1B2C).toString(16).toUpperCase().slice(0, 4)}`,
      'Dialog':     'FULL-DUPLEX',
      'Sync-Seq':   pkt.id,
      'Keep-Alive': 30,
    }),
    overhead: 8,
  },
  {
    n: 4, name: 'Transport', pdu: 'Segment',
    protocols: { voice: 'UDP', video: 'UDP', data: 'TCP', control: 'SCTP', ack: 'TCP', default: 'TCP' },
    buildHeader: (pkt, cfg) => {
      const proto = cfg.packetType === 'voice' || cfg.packetType === 'video' ? 'UDP' : 'TCP';
      return {
        'Protocol': proto,
        'Src-Port':  49152 + (pkt.id % 16383),
        'Dst-Port':  443,
        'Seq':      `0x${(pkt.id * 0xFF + 1000).toString(16).toUpperCase()}`,
        'Flags':    proto === 'TCP' ? 'ACK+PSH' : '—',
        'Win-B':    proto === 'TCP' ? 65535 : '—',
        'L4-Ovhd':  proto === 'TCP' ? '20B' : '8B',
      };
    },
    overhead: 20,
  },
  {
    n: 3, name: 'Network', pdu: 'Packet',
    protocols: { default: 'IPv4' },
    buildHeader: (pkt, cfg) => ({
      'Src-IP':  `192.168.${Math.floor(pkt.id / 256) % 256}.${pkt.id % 256}`,
      'Dst-IP':  '10.0.0.' + (pkt.dstNode + 1),
      'TTL':     64 - pkt.path.length,
      'Protocol':'TCP',
      'DSCP':    pkt.priority,
      'Frag':    'DF',
      'L3-Ovhd': '20B',
    }),
    overhead: 20,
  },
  {
    n: 2, name: 'Data Link', pdu: 'Frame',
    protocols: { '4g':'LTE MAC', '5g':'NR MAC', wifi:'802.11ax', fiber:'Ethernet', satellite:'DVB-S2', default:'Ethernet' },
    buildHeader: (pkt, cfg) => ({
      'Dst-MAC':  'AA:BB:CC:DD:EE:' + pkt.dstNode.toString(16).padStart(2,'0').toUpperCase(),
      'Src-MAC':  '11:22:33:44:55:' + pkt.srcNode.toString(16).padStart(2,'0').toUpperCase(),
      'EtherType':'0x0800',
      'VLAN':     100 + pkt.priority,
      'FCS':      `0x${(pkt.id * 0xA3B1 + 0xF2C4).toString(16).toUpperCase().slice(0, 8)}`,
      'EC-Scheme':cfg.encoding,
    }),
    overhead: 26,
  },
  {
    n: 1, name: 'Physical', pdu: 'Bit',
    protocols: { '4g':'OFDM/QAM-64', '5g':'OFDM/256-QAM', wifi:'OFDMA', fiber:'NRZ-PAM4', satellite:'QPSK', default:'NRZ' },
    buildHeader: (pkt, cfg) => ({
      'Modulation': cfg.networkType === '5g' ? '256-QAM' : cfg.networkType === 'fiber' ? 'PAM-4' : 'QAM-64',
      'BW-MHz':    cfg.bandwidth,
      'Coding':    cfg.encoding === 'ldpc' ? 'LDPC' : cfg.encoding === 'turbo' ? 'Turbo' : 'Convolutional',
      'Bits':      (pkt.size + 113) * 8,
      'Freq-GHz':  cfg.networkType === '5g' ? '28.0' : cfg.networkType === 'wifi' ? '5.8' : '2.1',
      'Power-dBm': '+23',
    }),
    overhead: 0,
  },
];

/**
 * Encapsulate a packet through all 7 OSI layers (TX side).
 * Returns array of layer-frame descriptors for animation + frame view.
 */
function processLayers(packet, cfg, kpis) {
  let cumulativeSize = packet.size;
  const frames = [];

  for (const layer of LAYER_DEFS) {
    cumulativeSize += layer.overhead;
    const proto = layer.protocols[cfg.networkType] || layer.protocols[packet.type] || layer.protocols.default || '—';
    const header = layer.buildHeader(packet, cfg);

    frames.push({
      layer:    layer.n,
      name:     layer.name,
      pdu:      layer.pdu,
      protocol: proto,
      header,
      frameSize: cumulativeSize,
      overhead:  layer.overhead,
      snr:       kpis.snr,
      ber:       kpis.ber,
      kpis:      buildLayerKPIs(layer.n, kpis, cfg, packet),
      timestamp: Date.now(),
    });
  }

  return frames;
}

/**
 * Build per-layer KPI snapshot.
 */
function buildLayerKPIs(layerN, kpis, cfg, pkt) {
  switch (layerN) {
    case 7: return { 'App Delay': `${kpis.lat.toFixed(1)}ms`, 'Sessions': 1, 'Pkt Type': pkt.type };
    case 6: return { 'Enc Rate': `${kpis.thr.toFixed(1)}Mbps`, 'Compress': '40%', 'Overhead': '29B' };
    case 5: return { 'Uptime': '99.9%', 'Sessions': 1, 'Timeout': '30s' };
    case 4: return { 'Retrans': `${kpis.ploss.toFixed(2)}%`, 'Loss': `${kpis.ploss.toFixed(2)}%`, 'Cwnd': `${Math.round(64 + kpis.snr * 0.5)}KB` };
    case 3: return { 'Hop Lat': `${kpis.lat.toFixed(1)}ms`, 'TTL': 64 - (pkt.path?.length || 2), 'Routes': 1 };
    case 2: return { 'Frame Err': `${kpis.ploss.toFixed(2)}%`, 'CRC/s': kpis.crc, 'Collisions': 0 };
    case 1: return { 'SNR': `${Math.round(kpis.snr)}dB`, 'BER': kpis.ber.toExponential(1), 'RSSI': `${Math.round(kpis.rssi)}dBm` };
    default: return {};
  }
}

module.exports = { processLayers, LAYER_DEFS };
