/**
 * public/js/main.js  — Bootstrap
 * Initialises all modules on DOMContentLoaded.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Init canvas renderer
  Renderer.init();

  // Build config UI panel
  UI.buildConfigPanel();

  // Connect WebSocket
  WS.connect();

  // Initial log messages
  Log.add('SYS', 'OSI Telecom Simulator loaded', 'info');
  Log.add('SYS', 'Configure parameters and click ▶ RUN to start', 'info');
  Log.add('SYS', 'WebSocket: connecting to server...', 'info');

  // Auto-start with defaults after short delay (optional)
  setTimeout(() => {
    const defaultConfig = {
      networkType: '4g', topologyType: 'mesh', nodeCount: 4,
      bandwidth: 20, channelModel: 'awgn',
      packetSize: 512, packetType: 'data', burstSize: 10,
      interArrival: 50, noisedB: 5, speedMultiplier: 1,
      autoSend: true, arqMode: 'go-back-n', windowSize: 8, encoding: 'turbo',
    };
    WS.send('start', defaultConfig);
    Log.add('SYS', 'Auto-started with default config (4G LTE, 4 nodes, Go-Back-N, Turbo)', 'ok');
  }, 800);
});
