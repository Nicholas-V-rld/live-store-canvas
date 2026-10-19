import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from './server.js';

const SHOP = 'dev.myshopify.com';
const webhook = { id: 820982911946154500, checkout_token: 'tok-1', current_total_price: '249.99', currency: 'USD', created_at: '2026-10-19T10:10:00Z' };

async function withServer(opts, fn) {
  const server = createServer(opts).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });

test('pixel events + order webhook over HTTP produce the report', () => withServer({}, async (base) => {
  assert.equal((await post(base, '/px', { kind: 'page', shop: SHOP, clientId: 'c1', path: '/', ts: Date.parse('2026-10-19T10:00:00Z') })).status, 204);
  assert.equal((await post(base, '/px', { kind: 'page', shop: SHOP, clientId: 'c1', path: '/products/watch', ts: Date.parse('2026-10-19T10:05:00Z') })).status, 204);
  assert.equal((await post(base, '/px', { kind: 'checkout', shop: SHOP, clientId: 'c1', checkoutToken: 'tok-1', ts: Date.parse('2026-10-19T10:09:00Z') })).status, 204);
  assert.equal((await post(base, '/webhooks/orders-create', webhook, { 'x-shopify-shop-domain': SHOP })).status, 200);
  const rep = await (await fetch(`${base}/report?shop=${SHOP}`)).json();
  assert.equal(rep.attributedCents, 24999);
  assert.deepEqual(rep.pages.map(p => p.path), ['/', '/products/watch']);
}));

test('bad pixel bodies get 400; CORS preflight allows private network', () => withServer({}, async (base) => {
  assert.equal((await post(base, '/px', '{nope')).status, 400);
  assert.equal((await post(base, '/px', { kind: 'other' })).status, 400);
  const pre = await fetch(`${base}/px`, { method: 'OPTIONS' });
  assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
}));

test('with a secret, only correctly signed webhooks are accepted', () => withServer({ secret: 's3cret' }, async (base) => {
  const raw = JSON.stringify(webhook);
  const good = createHmac('sha256', 's3cret').update(raw).digest('base64');
  assert.equal((await post(base, '/webhooks/orders-create', raw, { 'x-shopify-shop-domain': SHOP })).status, 401);
  assert.equal((await post(base, '/webhooks/orders-create', raw, { 'x-shopify-shop-domain': SHOP, 'x-shopify-hmac-sha256': 'AAAA' })).status, 401);
  assert.equal((await post(base, '/webhooks/orders-create', raw, { 'x-shopify-shop-domain': SHOP, 'x-shopify-hmac-sha256': good })).status, 200);
}));
