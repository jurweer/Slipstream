// Slipstream — signaling server (dependency-free).
// Brokers "rides" (rooms): peers join by ride code, discover each other, and relay the
// WebRTC handshake (offer/answer/ICE) + shared-clock messages. Transport is SSE
// (server -> client) + POST (client -> server) so it needs only Node built-ins — no ws,
// no npm install. This is signalling only; audio/data flows peer-to-peer over WebRTC.
//
// Endpoints:
//   GET  /events?ride=CODE&peer=ID[&name=NAME]   -> SSE stream (join the ride)
//   POST /signal   body { ride, from, to?, type, data }   -> relay (to one peer, or all)
//   GET  /rides/CODE                             -> { code, peers:[{id,name}] } (lobby view)
//   GET  /health                                 -> { ok, rides, peers }
//
// Usage:  node signaling/server.mjs [port]      (default 8100)

import { createServer } from 'node:http';

const PORT = Number(process.argv[2]) || 8100;

// rides: Map<code, Map<peerId, { res, name, joinedAt }>>
const rides = new Map();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function peerList(ride) {
  return [...ride.entries()].map(([id, p]) => ({ id, name: p.name }));
}

function broadcast(ride, fromId, event, data) {
  for (const [id, p] of ride) {
    if (id !== fromId) sseSend(p.res, event, data);
  }
}

// --- join (SSE) --------------------------------------------------------------

function handleEvents(req, res, url) {
  const code = url.searchParams.get('ride');
  const peer = url.searchParams.get('peer');
  const name = url.searchParams.get('name') || 'rider';
  if (!code || !peer) { json(res, 400, { error: 'ride and peer required' }); return; }

  cors(res);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n'); // client reconnect hint

  if (!rides.has(code)) rides.set(code, new Map());
  const ride = rides.get(code);

  // If this peer id reconnects, drop the stale entry first.
  if (ride.has(peer)) { try { ride.get(peer).res.end(); } catch { /* gone */ } }

  // Tell the newcomer who's already here, then announce them to the rest.
  sseSend(res, 'joined', { self: peer, peers: peerList(ride) });
  broadcast(ride, peer, 'peer-joined', { id: peer, name });
  ride.set(peer, { res, name, joinedAt: Date.now() });

  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    const r = rides.get(code);
    if (r && r.get(peer)?.res === res) {
      r.delete(peer);
      broadcast(r, peer, 'peer-left', { id: peer });
      if (r.size === 0) rides.delete(code);
    }
  });
}

// --- relay (POST) ------------------------------------------------------------

async function handleSignal(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e6) { json(res, 413, { error: 'payload too large' }); req.destroy(); return; }
  }
  let msg;
  try { msg = JSON.parse(body); } catch { json(res, 400, { error: 'invalid json' }); return; }

  const { ride: code, from, to, type, data } = msg;
  const ride = rides.get(code);
  if (!ride) { json(res, 404, { error: 'ride not found' }); return; }

  const payload = { from, type, data };
  if (to) {
    const target = ride.get(to);
    if (!target) { json(res, 404, { error: 'peer not found' }); return; }
    sseSend(target.res, 'signal', payload);
  } else {
    broadcast(ride, from, 'signal', payload); // broadcast to the rest of the ride
  }
  json(res, 200, { ok: true });
}

// --- router ------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (url.pathname === '/events' && req.method === 'GET') return handleEvents(req, res, url);
  if (url.pathname === '/signal' && req.method === 'POST') return handleSignal(req, res);

  if (url.pathname.startsWith('/rides/') && req.method === 'GET') {
    const code = decodeURIComponent(url.pathname.slice('/rides/'.length));
    const ride = rides.get(code);
    return json(res, 200, { code, peers: ride ? peerList(ride) : [] });
  }
  if (url.pathname === '/health') {
    let peers = 0; for (const r of rides.values()) peers += r.size;
    return json(res, 200, { ok: true, rides: rides.size, peers });
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Slipstream signaling on http://0.0.0.0:${PORT}`);
  console.log(`  join:   GET  /events?ride=CODE&peer=ID`);
  console.log(`  relay:  POST /signal   { ride, from, to?, type, data }`);
  console.log(`  lobby:  GET  /rides/CODE   ·   health: GET /health`);
});
