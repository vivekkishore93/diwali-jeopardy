// WebSocket client with auto-reconnect and server-clock sync.
export function connect(role, { onState, onError, onLockout, onStatus, pin } = {}) {
  let ws;
  let offset = 0; // serverNow - Date.now()
  let retry = 500;
  let closedByAuth = false;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ role });
    if (pin) q.set('pin', pin);
    ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    ws.onopen = () => { retry = 500; onStatus?.(true); ping(); };
    ws.onclose = () => {
      onStatus?.(false);
      if (closedByAuth) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 1.6, 5000);
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.serverNow) offset = msg.serverNow - Date.now();
      if (msg.type === 'state') onState?.(msg.state);
      else if (msg.type === 'error') onError?.(msg.message);
      else if (msg.type === 'lockout') onLockout?.(msg.ms);
      else if (msg.type === 'auth' && !msg.ok) { closedByAuth = true; onError?.('PIN required'); }
      else if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t;
        offset = msg.serverNow + rtt / 2 - Date.now();
      }
    };
  }
  function ping() { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); }
  setInterval(ping, 15000);
  open();

  return {
    send(action) {
      if (ws?.readyState === 1) { ws.send(JSON.stringify({ type: 'action', action })); return true; }
      onError?.('Not connected — retrying…');
      return false;
    },
    serverNow: () => Date.now() + offset,
  };
}

export function getPin() {
  try { return localStorage.getItem('dq-pin') || ''; } catch { return ''; }
}
export function setPin(p) {
  try { localStorage.setItem('dq-pin', p); } catch { /* ignore */ }
}

/** Ask for the PIN if the server requires one. Resolves with the PIN ('' if none needed). */
export async function ensurePin() {
  const info = await fetch('/api/info').then(r => r.json()).catch(() => ({}));
  if (!info.pinRequired) return '';
  let pin = getPin();
  for (;;) {
    const ok = pin && (await fetch('/api/auth', { headers: { 'x-pin': pin } })).ok;
    if (ok) { setPin(pin); return pin; }
    pin = prompt('Enter the host PIN') || '';
  }
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US');
