#!/usr/bin/env node
/* Development server for the shared web layer.

   Serves tv/shared/web and speaks exactly the /api/* dialect the Windows build
   speaks, so the phone controller, the display and both TV shells can be exercised
   on a laptop before anything is installed on a TV. It is also the reference the
   Kotlin server in the Android app is written against.

   node tv/tools/dev-server.js [port]      →  http://localhost:8765/display */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const WEB = path.join(__dirname, '..', 'shared', 'web');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const { TimerEngine } = require(path.join(WEB, 'timer-core.js'));

const engine = new TimerEngine({});
const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const sessions = new Set();
setInterval(() => engine.tick(), 50).unref?.();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png'
};

function localUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}/control`);
    }
  }
  return urls;
}

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"
  }, extra || {}));
  res.end(body);
}

const json = (res, status, value, extra) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), extra);

function sessionOf(req) {
  const cookie = req.headers.cookie || '';
  const match = /(?:^|;\s*)session=([a-f0-9]{32})/.exec(cookie);
  return match ? match[1] : null;
}

/* A request from the machine the timer runs on is the TV's own screen, so it is
   trusted without a code. Everything arriving over the network still has to pair —
   the Android app applies the same rule. */
function isLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/* X-Timer-Pin carries the same code a controller pairs with, for clients whose
   cookie jar does not survive talking to another machine — the Samsung app in
   companion mode, in particular. */
function isTrusted(req, session) {
  return sessions.has(session) || isLoopback(req) || req.headers['x-timer-pin'] === pin;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  let session = sessionOf(req);
  const extra = {};
  if (!session) {
    session = crypto.randomBytes(16).toString('hex');
    extra['Set-Cookie'] = `session=${session}; HttpOnly; SameSite=Strict; Path=/`;
  }

  if (req.method === 'GET') {
    if (route === '/' || route === '/display' || route === '/control') {
      return send(res, 200, TYPES['.html'], fs.readFileSync(path.join(WEB, 'index.html')), extra);
    }
    if (route === '/api/state') {
      const state = engine.state();
      state.paired = isTrusted(req, session);
      state.pair_pin = state.paired ? pin : null;
      const urls = localUrls();
      state.local_url = urls[0] || null;
      state.local_urls = urls;
      return json(res, 200, state, extra);
    }
    const file = path.join(WEB, path.normalize(route).replace(/^([/\\])+/, ''));
    if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file), extra);
    }
    return json(res, 404, { error: 'Not found' }, extra);
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Not found' }, extra);

  let payload;
  try { payload = JSON.parse(await readBody(req) || '{}'); }
  catch (_) { return json(res, 400, { error: 'Invalid request' }, extra); }

  if (route === '/api/pair') {
    if (String(payload.pin) !== pin) return json(res, 403, { error: 'Incorrect access code' }, extra);
    sessions.add(session);
    return json(res, 200, { ok: true }, extra);
  }
  if (!isTrusted(req, session)) return json(res, 403, { error: 'Pair this device first' }, extra);

  if (route === '/api/action') {
    if (!engine.action(payload.action)) return json(res, 400, { error: 'Unknown action' }, extra);
    return json(res, 200, { ok: true }, extra);
  }
  if (route === '/api/config') {
    if (!engine.setConfig(payload)) return json(res, 400, { error: 'Invalid settings' }, extra);
    return json(res, 200, { ok: true }, extra);
  }
  return json(res, 404, { error: 'Not found' }, extra);
});

server.listen(PORT, () => {
  console.log('Gracie Barra Timer dev server');
  console.log('  TV display:  http://localhost:' + PORT + '/display');
  console.log('  Android TV:  http://localhost:' + PORT + '/display?shell=android');
  console.log('  Control:     http://localhost:' + PORT + '/control');
  for (const url of localUrls()) console.log('  Phone:       ' + url);
  console.log('  Access code: ' + pin);
});
