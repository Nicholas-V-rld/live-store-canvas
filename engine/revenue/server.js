// Receiver for the live dev-store test: pixel events, Shopify order webhooks, report.
// Run: PORT=4318 [SHOPIFY_WEBHOOK_SECRET=…] node server.js
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createRevenue } from './revenue.js';

const MAX_BODY = 512 * 1024; // order webhooks with many line items can be large

export function orderFromWebhook(shop, w) {
  return {
    shop,
    orderId: String(w.id),
    checkoutToken: w.checkout_token,
    totalCents: Math.round(Number(w.current_total_price ?? w.total_price) * 100),
    currency: w.currency,
    ts: Date.parse(w.created_at),
  };
}

function signed(raw, header, secret) {
  if (!secret) return true; // ponytail: unsigned allowed only for the short dev-store test; set the secret for anything longer
  if (!header) return false;
  const a = Buffer.from(createHmac('sha256', secret).update(raw).digest('base64'));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createServer({ revenue = createRevenue(), secret = process.env.SHOPIFY_WEBHOOK_SECRET, logFile } = {}) {
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  const log = (entry) => logFile && appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      // Chrome asks before a public https page may call a local address
      return res.writeHead(204, { 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' }).end();
    }

    let raw = '';
    if (req.method === 'POST') {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return res.writeHead(413).end();
      }
    }
    let body;
    if (raw) try { body = JSON.parse(raw); } catch { return res.writeHead(400).end(); }

    if (req.method === 'POST' && url.pathname === '/px') {
      const ok = body?.kind === 'page' ? revenue.pageView(body) : body?.kind === 'checkout' ? revenue.checkoutLink(body) : false;
      log({ type: 'pixel', ok, body });
      return res.writeHead(ok ? 204 : 400).end();
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/orders-create') {
      if (!signed(raw, req.headers['x-shopify-hmac-sha256'], secret)) return res.writeHead(401).end();
      const shop = req.headers['x-shopify-shop-domain'];
      const order = orderFromWebhook(shop, body ?? {});
      const ok = !!shop && revenue.order(order);
      log({ type: 'order', ok, order });
      return res.writeHead(ok ? 200 : 400).end(); // Shopify retries anything but 2xx
    }

    if (req.method === 'GET' && url.pathname === '/report') {
      const shop = url.searchParams.get('shop');
      if (!shop) return res.writeHead(400).end();
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(revenue.report(shop), null, 2));
    }
    res.writeHead(404).end();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4318);
  const logFile = fileURLToPath(new URL('../evidence/live-test/events.jsonl', import.meta.url));
  createServer({ logFile }).listen(port, () => console.log(`revenue receiver on http://127.0.0.1:${port}  (log: ${logFile})`));
}
