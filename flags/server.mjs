// Slipstream — feature-flags service (SERVER-SIDE control plane, dependency-free).
// The operator controls which features are on/off here; clients only fetch + apply.
//
//   GET  /flags            -> { flags:{…}, updatedAt }          (public, clients poll this)
//   POST /flags            -> merge flag changes (admin: Bearer token)  body { flags:{k:bool} }
//   GET  /health           -> { ok }
//
// Source of truth is flags.json (loaded on start, rewritten on POST). Flip flags by editing
// that file, or at runtime:
//   curl -X POST localhost:8110/flags -H "Authorization: Bearer $SLIP_FLAGS_TOKEN" \
//        -H 'content-type: application/json' -d '{"flags":{"spotify_connect":true}}'
//
// Usage:  SLIP_FLAGS_TOKEN=secret node flags/server.mjs [port]      (default 8110)

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORT = Number(process.argv[2]) || 8110;
const FILE = join(fileURLToPath(new URL('.', import.meta.url)), 'flags.json');
const ADMIN_TOKEN = process.env.SLIP_FLAGS_TOKEN || 'change-me';

let config = { flags: {}, updatedAt: null };
try { config = JSON.parse(await readFile(FILE, 'utf8')); }
catch { console.warn('flags.json missing/invalid — starting with empty flags'); }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function handlePost(req, res) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${ADMIN_TOKEN}`) { json(res, 401, { error: 'unauthorized' }); return; }
  let body = '';
  for await (const c of req) { body += c; if (body.length > 1e5) { req.destroy(); return; } }
  let patch;
  try { patch = JSON.parse(body); } catch { json(res, 400, { error: 'invalid json' }); return; }
  if (!patch || typeof patch.flags !== 'object') { json(res, 400, { error: 'expected { flags: {…} }' }); return; }

  config.flags = { ...config.flags, ...patch.flags };
  config.updatedAt = new Date().toISOString();
  try { await writeFile(FILE, JSON.stringify(config, null, 2) + '\n'); }
  catch (e) { json(res, 500, { error: `persist failed: ${e.message}` }); return; }
  console.log(`flags updated: ${Object.keys(patch.flags).join(', ')} @ ${config.updatedAt}`);
  json(res, 200, config);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (url.pathname === '/flags' && req.method === 'GET') return json(res, 200, config);
  if (url.pathname === '/flags' && req.method === 'POST') return handlePost(req, res);
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  if (ADMIN_TOKEN === 'change-me') console.warn('⚠  SLIP_FLAGS_TOKEN not set — admin POST uses default token');
  console.log(`Slipstream flags service on http://0.0.0.0:${PORT}  ·  GET /flags`);
});
