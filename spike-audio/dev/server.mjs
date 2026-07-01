// Zero-dependency HTTPS static server for on-phone spike testing.
// Serves the parent spike-audio/ dir over TLS so MediaSession / service worker have a
// secure context. Cert is self-signed (see dev/README.md) — you must accept it on the
// phone once (and install the CA for the installed-PWA path).
//
// Usage:  node dev/server.mjs [port]     (default 8443)

import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(__dirname, '..'));      // serve spike-audio/
const PORT = Number(process.argv[2]) || 8443;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.flac': 'audio/flac',
};

const [key, cert] = await Promise.all([
  readFile(join(__dirname, 'key.pem')),
  readFile(join(__dirname, 'cert.pem')),
]).catch(() => {
  console.error('Missing key.pem / cert.pem in dev/. Generate them first (see dev/README.md).');
  process.exit(1);
});

// Serve the server-side feature flags same-origin so the HTTPS app can fetch them without
// CORS / mixed-content. Reads the flags service's source of truth (flags/flags.json).
const FLAGS_FILE = join(__dirname, '..', '..', 'flags', 'flags.json');

createServer({ key, cert }, async (req, res) => {
  const pathname = new URL(req.url, 'https://x').pathname;
  if (pathname === '/flags') {
    res.setHeader('access-control-allow-origin', '*');
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(await readFile(FLAGS_FILE).catch(() => '{"flags":{}}'));
    return;
  }
  // Resolve request path safely inside ROOT.
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(filePath)] || 'application/octet-stream',
    'service-worker-allowed': '/',
  });
  createReadStream(filePath).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Slipstream spike serving ${ROOT}`);
  console.log(`  local:   https://localhost:${PORT}`);
  for (const ip of ips) console.log(`  network: https://${ip}:${PORT}`);
  console.log('Open the network URL on your phone and accept the self-signed cert.');
});
