/**
 * public/js/log.js  — Event log module
 */
const Log = (() => {
  let entries = [];
  const MAX = 300;

  function add(layer, msg, type = 'ok') {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().slice(0,2)}`;
    entries.unshift({ ts, layer, msg, type });
    if (entries.length > MAX) entries.pop();
    render();
  }

  function render() {
    const filter = document.getElementById('logFilter')?.value || 'all';
    let list = entries;
    if (filter !== 'all') {
      if (filter === 'ERR') list = list.filter(e => e.type === 'err');
      else list = list.filter(e => e.layer.startsWith(filter));
    }
    const body = document.getElementById('logBody');
    if (!body) return;
    body.innerHTML = list.slice(0, 80).map(e =>
      `<div class="log-line">
        <span class="log-ts">${e.ts}</span>
        <span class="log-layer ${e.type === 'ok' ? 'l-ok' : e.type === 'err' ? 'l-err' : e.type === 'warn' ? 'l-warn' : 'l-info'}">[${e.layer}]</span>
        <span class="log-msg">${e.msg}</span>
      </div>`
    ).join('');
  }

  function clear() { entries = []; render(); }

  return { add, render, clear };
})();
