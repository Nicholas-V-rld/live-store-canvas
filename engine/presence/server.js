import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createPresence } from './presence.js';

const MAX_BODY = 2048;
const STATIC = { '/': ['demo.html', 'text/html'], '/tracker.js': ['tracker.js', 'text/javascript'] };

export function createServer(presence = createPresence()) {
  const streams = new Map(); // shop -> Set(res)
  const lastSent = new Map(); // shop -> json

  function push(shop) {
    const clients = streams.get(shop);
    if (!clients?.size) return;
    const json = JSON.stringify(presence.snapshot(shop));
    if (json === lastSent.get(shop)) return;
    lastSent.set(shop, json);
    for (const res of clients) res.write(`event: live\ndata: ${json}\n\n`);
  }
  // Expiries happen without an incoming event, so re-check every second.
  // ponytail: one timer for all shops; fine until thousands of open streams per process.
  const timer = setInterval(() => { for (const shop of streams.keys()) push(shop); }, 1000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Headers': 'content-type' }).end();

    if (req.method === 'POST' && url.pathname === '/e') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) return res.writeHead(400).end();
      }
      let e;
      try { e = JSON.parse(body); } catch { return res.writeHead(400).end(); }
      const result = presence.record(e, req.headers['user-agent'] ?? '');
      return res.writeHead(result === 'invalid' ? 400 : 204).end();
    }

    if (req.method === 'GET' && url.pathname === '/live') {
      const shop = url.searchParams.get('shop');
      if (!shop) return res.writeHead(400).end();
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(presence.snapshot(shop)));
    }

    if (req.method === 'GET' && url.pathname === '/stream') {
      const shop = url.searchParams.get('shop');
      if (!shop) return res.writeHead(400).end();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (!streams.has(shop)) streams.set(shop, new Set());
      streams.get(shop).add(res);
      lastSent.delete(shop);
      push(shop);
      req.on('close', () => streams.get(shop)?.delete(res));
      return;
    }

    const file = STATIC[url.pathname] ?? (url.pathname.startsWith('/products/') || url.pathname === '/cart' ? STATIC['/'] : null);
    if (req.method === 'GET' && file) {
      const html = await readFile(new URL(file[0], import.meta.url));
      return res.writeHead(200, { 'content-type': file[1] }).end(html);
    }
    res.writeHead(404).end();
  });
  server.on('close', () => clearInterval(timer));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4317);
  createServer().listen(port, () => console.log(`live presence on http://127.0.0.1:${port}`));
}
