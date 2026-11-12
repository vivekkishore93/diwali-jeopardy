// Diwali Quiz Night — LAN game server.
// Run: npm start   (PORT=3000 by default; ADMIN_PIN=1234 to protect host/admin pages)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { newState, dispatch, setMeta, viewFor, GameError } from './src/engine.js';
import { csvToSet, setToCSV } from './src/csv.js';
import { createStore } from './src/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PIN = process.env.ADMIN_PIN || '';
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(ROOT, 'node_modules', '@fontsource');
const store = createStore(process.env.DATA_ROOT || ROOT);
let wss = null; // created below; may not exist yet during startup

// ---------------------------------------------------------------------------
// State

let state = store.loadState();
if (!state?.meta || !state?.game) {
  state = newState();
  const sets = store.listSets();
  const first = sets.find(s => s.name === 'diwali-starter') || sets.find(s => s.name !== 'TEMPLATE');
  if (first) activateSet(first.name, false);
}

function activateSet(name, resetGame = true) {
  const { set, errors } = csvToSet(store.readSet(name));
  if (errors.length) throw new GameError(`"${name}" has errors — fix them first:\n` + errors.slice(0, 5).join('\n'));
  state = setMeta(state, { set, setName: name });
  if (resetGame && state.game.phase !== 'lobby') state = dispatch(state, { type: 'resetGame' });
  commit();
}

// ---------------------------------------------------------------------------
// Network helpers

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
  return out.sort((a, b) => rank(a.address) - rank(b.address));
}
function baseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const ip = lanAddresses()[0]?.address || 'localhost';
  return `http://${ip}:${PORT}`;
}

// ---------------------------------------------------------------------------
// HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.csv': 'text/csv; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/tv': 'tv.html', '/host': 'host.html', '/play': 'play.html', '/admin': 'admin.html' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
function within(dir, p) {
  const full = path.normalize(path.join(dir, p));
  return full.startsWith(dir + path.sep) ? full : null;
}
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const authed = req => !PIN || req.headers['x-pin'] === PIN || new URL(req.url, 'http://x').searchParams.get('pin') === PIN;

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // after 'api'
  const m = req.method;

  if (parts[0] === 'info') {
    return send(res, 200, { baseUrl: baseUrl(), playUrl: `${baseUrl()}/play`, addresses: lanAddresses(), pinRequired: !!PIN });
  }
  if (parts[0] === 'qr.svg') {
    const svg = await QRCode.toString(url.searchParams.get('url') || `${baseUrl()}/play`, { type: 'svg', margin: 1, color: { dark: '#0b0d3a', light: '#ffffff' } });
    return send(res, 200, svg, 'image/svg+xml');
  }
  if (parts[0] === 'assets') {
    // Lists user-supplied override sounds/fonts so the client knows what to load.
    const list = dir => { try { return fs.readdirSync(path.join(PUBLIC, dir)).filter(f => !f.startsWith('.') && !/readme/i.test(f)); } catch { return []; } };
    return send(res, 200, { sounds: list('sounds'), fonts: list('fonts') });
  }
  if (parts[0] === 'auth') {
    return send(res, authed(req) ? 200 : 401, { ok: authed(req) });
  }

  if (parts[0] === 'sets') {
    if (!authed(req) && !(parts[1] === 'TEMPLATE' && parts[2] === 'download')) return send(res, 401, { error: 'PIN required' });
    const name = parts[1];
    if (!name && m === 'GET') {
      return send(res, 200, { sets: store.listSets(), active: state.meta.setName });
    }
    if (name && parts[2] === 'download' && m === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME['.csv'], 'Content-Disposition': `attachment; filename="${store.safeName(name)}.csv"` });
      return res.end(store.readSet(name));
    }
    if (name && parts[2] === 'activate' && m === 'POST') {
      activateSet(name);
      return send(res, 200, { ok: true });
    }
    if (name && m === 'GET') {
      const csv = store.readSet(name);
      return send(res, 200, { name: store.safeName(name), csv, ...csvToSet(csv) });
    }
    if (name && m === 'PUT') {
      // Body: raw CSV text, or JSON {set} from the grid editor.
      const body = await readBody(req);
      let csv = body;
      if ((req.headers['content-type'] || '').includes('application/json')) csv = setToCSV(JSON.parse(body).set);
      const result = csvToSet(csv);
      const saved = store.writeSet(name, csv);
      // Keep the live game in sync if this set is active and still in the lobby.
      if (saved === state.meta.setName && !result.errors.length && state.game.phase === 'lobby') {
        state = setMeta(state, { set: result.set }); commit();
      }
      return send(res, 200, { name: saved, ...result });
    }
    if (name && m === 'DELETE') {
      store.deleteSet(name);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'Unknown API route' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (PAGES[url.pathname]) return serveFile(res, path.join(PUBLIC, PAGES[url.pathname]));
    if (url.pathname.startsWith('/vendor/fonts/')) {
      const f = within(FONTS, url.pathname.slice('/vendor/fonts/'.length));
      return f ? serveFile(res, f) : send(res, 404, 'Not found', 'text/plain');
    }
    const f = within(PUBLIC, decodeURIComponent(url.pathname));
    return f ? serveFile(res, f) : send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    const code = e instanceof GameError ? 400 : e.code === 'ENOENT' ? 404 : 500;
    if (code === 500) console.error(e);
    send(res, code, { error: e.message });
  }
});

// ---------------------------------------------------------------------------
// WebSocket: live state + actions

wss = new WebSocketServer({ server, path: '/ws' });
const PLAYER_ACTIONS = new Set(['buzz', 'finalWager', 'finalAnswer']);
const META_KEYS = new Set(['title']);
const lockedUntil = new WeakMap();

function sendState(ws) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'state', state: viewFor(state, ws.role === 'admin' ? 'host' : ws.role), serverNow: Date.now() }));
}
function broadcast() { if (wss) for (const ws of wss.clients) sendState(ws); }
function commit() { store.saveState(state); broadcast(); }

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const role = ['tv', 'host', 'play', 'admin'].includes(q.get('role')) ? q.get('role') : 'play';
  if ((role === 'host' || role === 'admin') && PIN && q.get('pin') !== PIN) {
    ws.send(JSON.stringify({ type: 'auth', ok: false }));
    return ws.close();
  }
  ws.role = role;
  sendState(ws);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverNow: Date.now() }));
    if (msg.type !== 'action' || !msg.action?.type) return;
    const a = msg.action;
    try {
      if (ws.role === 'tv') throw new GameError('The TV screen is display-only.');
      if (ws.role === 'play' && !PLAYER_ACTIONS.has(a.type)) throw new GameError('Not allowed from a player phone.');
      if (ws.role === 'play') delete a.byHost;

      if (a.type === 'setMeta') {
        const patch = {};
        for (const [k, v] of Object.entries(a.patch || {})) if (META_KEYS.has(k)) patch[k] = String(v).slice(0, 60);
        if (a.patch?.config) patch.config = sanitizeConfig(a.patch.config);
        state = setMeta(state, patch);
        return commit();
      }
      if (a.type === 'buzz') {
        const now = Date.now();
        if ((lockedUntil.get(ws) || 0) > now) return;
        try {
          state = dispatch(state, a, { now });
        } catch (e) {
          if (e.message === 'early' && state.game.phase === 'clue' && state.game.current && !state.game.current.revealed && !state.game.current.buzzedTeam) {
            lockedUntil.set(ws, now + 250); // buzzed before buzzers opened
            return ws.send(JSON.stringify({ type: 'lockout', ms: 250 }));
          }
          if (e.message === 'early') return;
          throw e;
        }
        return commit();
      }
      state = dispatch(state, a, { now: Date.now() });
      commit();
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});

function sanitizeConfig(c) {
  const out = {};
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (c.muted != null) out.muted = !!c.muted;
  if (c.ddLabel != null) out.ddLabel = String(c.ddLabel).slice(0, 30);
  if (c.finalLabel != null) out.finalLabel = String(c.finalLabel).slice(0, 30);
  if (c.answerSeconds != null) out.answerSeconds = num(c.answerSeconds, 0, 60);
  if (c.finalSeconds != null) out.finalSeconds = num(c.finalSeconds, 5, 300);
  if (c.ddCount) out.ddCount = { 1: num(c.ddCount[1] ?? 1, 0, 6), 2: num(c.ddCount[2] ?? 2, 0, 6) };
  if (c.roundLabels) out.roundLabels = { 1: String(c.roundLabels[1] ?? 'ROUND ONE').slice(0, 30), 2: String(c.roundLabels[2] ?? 'DOUBLE ROUND').slice(0, 30) };
  return out;
}

server.listen(PORT, HOST, () => {
  const lines = [`\n  🪔  Diwali Quiz Night is running!\n`];
  const addrs = lanAddresses();
  const bases = addrs.length ? addrs.map(a => `http://${a.address}:${PORT}`) : [`http://localhost:${PORT}`];
  lines.push(`  TV screen   ${bases[0]}/tv`);
  lines.push(`  Host        ${bases[0]}/host`);
  lines.push(`  Players     ${bases[0]}/play   (QR code shown on the TV)`);
  lines.push(`  Admin       ${bases[0]}/admin`);
  if (bases.length > 1) lines.push(`\n  Other addresses: ${bases.slice(1).join(', ')}`);
  if (PIN) lines.push(`\n  Host/Admin PIN is set.`);
  console.log(lines.join('\n') + '\n');
});
