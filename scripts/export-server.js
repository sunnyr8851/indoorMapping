#!/usr/bin/env node
/**
 * Dev server to receive field map JSON from the app and save to ./mapping-data/
 * Run: node scripts/export-server.js
 * App POSTs to http://10.0.2.2:3333/export (Android) or http://localhost:3333/export (iOS)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const OUT_DIR = path.join(__dirname, '..', 'mapping-data');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/export') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const floor = data.floor ?? 1;
        const outPath = path.join(OUT_DIR, `floor_${floor}_map.json`);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Saved to ${outPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: outPath }));
      } catch (e) {
        console.error(e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Export server running on http://192.168.1.125:${PORT}/export`);
  console.log('Android emulator: use 10.0.2.2:' + PORT);
  console.log('Physical device: use your machine LAN IP');
});
