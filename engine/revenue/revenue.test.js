import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevenue, LOOKBACK_MS } from './revenue.js';
import createPixel, { toInput } from './pixel.js';

const S = 'shop1';
const T = Date.UTC(2026, 9, 19, 12);
const H = 60 * 60 * 1000;
const view = (r, clientId, path, ts) => assert.ok(r.pageView({ shop: S, clientId, path, ts }));
const link = (r, clientId, checkoutToken, ts) => assert.ok(r.checkoutLink({ shop: S, clientId, checkoutToken, ts }));
const order = (r, orderId, checkoutToken, totalCents, ts, currency = 'USD') => r.order({ shop: S, orderId, checkoutToken, totalCents, ts, currency });
const byPath = (rep) => Object.fromEntries(rep.pages.map(p => [p.path, p]));

test('1. credits only pages viewed in the 7 days before the order', () => {
  const r = createRevenue();
  view(r, 'c1', '/old', T - LOOKBACK_MS - 1);
  view(r, 'c1', '/', T - 2 * H);
  view(r, 'c1', '/products/watch', T - H);
  view(r, 'c1', '/after', T + H);
  link(r, 'c1', 'k1', T - 10);
  order(r, 'o1', 'k1', 10000, T);
  const p = byPath(r.report(S));
  assert.equal(p['/'].influencedCents, 10000);
  assert.equal(p['/products/watch'].influencedCents, 10000);
  assert.equal(p['/old']?.influencedCents ?? 0, 0);
  assert.equal(p['/after']?.influencedCents ?? 0, 0);
});

test('2. share sums exactly to the order, remainder to earliest pages', () => {
  const r = createRevenue();
  view(r, 'c1', '/a', T - 3 * H);
  view(r, 'c1', '/b', T - 2 * H);
  view(r, 'c1', '/c', T - H);
  link(r, 'c1', 'k1', T);
  order(r, 'o1', 'k1', 10000, T);
  const p = byPath(r.report(S));
  assert.deepEqual([p['/a'].shareCents, p['/b'].shareCents, p['/c'].shareCents], [3334, 3333, 3333]);
  assert.equal(r.report(S).pages.reduce((s, x) => s + x.shareCents, 0), 10000);
});

test('3. influenced counts an order once per page despite repeat views', () => {
  const r = createRevenue();
  for (let i = 1; i <= 4; i++) view(r, 'c1', '/products/watch', T - i * H);
  link(r, 'c1', 'k1', T);
  order(r, 'o1', 'k1', 5000, T);
  const p = byPath(r.report(S))['/products/watch'];
  assert.deepEqual([p.influencedCents, p.shareCents], [5000, 5000]);
});

test('4. sessions, buyers, conversion rate, revenue per session', () => {
  const r = createRevenue();
  for (const c of ['c1', 'c2', 'c3', 'c4']) view(r, c, '/products/watch', T - H);
  link(r, 'c1', 'k1', T);
  order(r, 'o1', 'k1', 12000, T);
  const p = byPath(r.report(S))['/products/watch'];
  assert.deepEqual([p.sessions, p.buyers, p.conversionRate, p.revenuePerSessionCents], [4, 1, 0.25, 3000]);
});

test('5. unlinked orders are unattributed and totals add up', () => {
  const r = createRevenue();
  view(r, 'c1', '/', T - H);
  link(r, 'c1', 'k1', T);
  order(r, 'o1', 'k1', 7000, T);
  order(r, 'o2', 'k-unknown', 3000, T);
  const rep = r.report(S);
  assert.deepEqual([rep.revenueCents, rep.attributedCents, rep.unattributedCents, rep.orders], [10000, 7000, 3000, 2]);
});

test('6. duplicate webhook counts once; link without order adds nothing', () => {
  const r = createRevenue();
  view(r, 'c1', '/', T - H);
  link(r, 'c1', 'k1', T);
  link(r, 'c2', 'k2', T);
  order(r, 'o1', 'k1', 4000, T);
  order(r, 'o1', 'k1', 4000, T);
  assert.equal(r.report(S).revenueCents, 4000);
});

test('6b. link arriving after the order still attributes', () => {
  const r = createRevenue();
  view(r, 'c1', '/', T - H);
  order(r, 'o1', 'k1', 4000, T);
  link(r, 'c1', 'k1', T + 5000);
  assert.equal(r.report(S).attributedCents, 4000);
});

test('7. linked buyer with no pages in window stays unattributed', () => {
  const r = createRevenue();
  link(r, 'c9', 'k9', T);
  order(r, 'o9', 'k9', 2500, T);
  const rep = r.report(S);
  assert.deepEqual([rep.attributedCents, rep.unattributedCents, rep.pages.length], [0, 2500, 0]);
});

test('8. mixed currency and invalid inputs are rejected', () => {
  const r = createRevenue();
  assert.equal(order(r, 'o1', 'k1', 1000, T, 'USD'), true);
  assert.equal(order(r, 'o2', 'k2', 1000, T, 'EUR'), false);
  assert.equal(order(r, 'o3', 'k3', 10.5, T), false);
  assert.equal(order(r, 'o4', 'k4', -1, T), false);
  assert.equal(r.pageView({ shop: S, clientId: 'c', path: 'no-slash', ts: T }), false);
  assert.equal(r.pageView({ shop: S, path: '/', ts: T }), false);
  assert.equal(r.checkoutLink({ shop: S, clientId: 'c', ts: T }), false);
  assert.equal(r.report(S).revenueCents, 1000);
});

test('9. query strings are stripped from paths', () => {
  const r = createRevenue();
  view(r, 'c1', '/products/watch?variant=1', T - H);
  view(r, 'c2', '/products/watch#reviews', T - H);
  assert.deepEqual(r.report(S).pages.map(p => [p.path, p.sessions]), [['/products/watch', 2]]);
});

test('10. order time range filters the report', () => {
  const r = createRevenue();
  view(r, 'c1', '/', T - H);
  link(r, 'c1', 'k1', T);
  order(r, 'o1', 'k1', 1000, T);
  order(r, 'o2', 'k2', 9000, T + 48 * H);
  assert.equal(r.report(S, T - H, T + H).revenueCents, 1000);
});

test('11. pixel maps real Shopify event shapes into our inputs', () => {
  const pv = { clientId: 'cid-1', timestamp: '2026-10-19T11:00:00.000Z', context: { document: { location: { pathname: '/products/watch', href: 'https://x.com/products/watch?v=1' } } } };
  const co = { clientId: 'cid-1', timestamp: '2026-10-19T12:00:00.000Z', data: { checkout: { token: 'tok-1', totalPrice: { amount: 120, currencyCode: 'USD' } } } };
  assert.deepEqual(toInput('page_viewed', pv, S), { kind: 'page', shop: S, clientId: 'cid-1', path: '/products/watch', ts: Date.parse(pv.timestamp) });
  assert.deepEqual(toInput('checkout_completed', co, S), { kind: 'checkout', shop: S, clientId: 'cid-1', checkoutToken: 'tok-1', ts: Date.parse(co.timestamp) });
  assert.equal(toInput('page_viewed', { timestamp: pv.timestamp }, S), null);
  assert.equal(toInput('product_added_to_cart', pv, S), null);
});

test('11b. full flow: pixel events + webhook order produce the report', async () => {
  const handlers = {};
  const sent = [];
  globalThis.fetch = async (_url, { body }) => { sent.push(JSON.parse(body)); return {}; };
  createPixel({ analytics: { subscribe: (n, fn) => { handlers[n] = fn; } }, settings: { shop: S, endpoint: 'https://example.test/px' } });
  handlers.page_viewed({ clientId: 'cid-1', timestamp: '2026-10-19T10:00:00Z', context: { document: { location: { pathname: '/' } } } });
  handlers.page_viewed({ clientId: 'cid-1', timestamp: '2026-10-19T10:05:00Z', context: { document: { location: { pathname: '/products/watch' } } } });
  handlers.checkout_completed({ clientId: 'cid-1', timestamp: '2026-10-19T10:09:00Z', data: { checkout: { token: 'tok-1' } } });
  const r = createRevenue();
  for (const b of sent) assert.ok(b.kind === 'page' ? r.pageView(b) : r.checkoutLink(b));
  // shape of Shopify's orders/create webhook (subset), converted to cents
  const webhook = { id: 5501, checkout_token: 'tok-1', current_total_price: '249.99', currency: 'USD', created_at: '2026-10-19T10:10:00Z' };
  assert.ok(r.order({ shop: S, orderId: webhook.id, checkoutToken: webhook.checkout_token, totalCents: Math.round(Number(webhook.current_total_price) * 100), currency: webhook.currency, ts: Date.parse(webhook.created_at) }));
  const rep = r.report(S);
  assert.equal(rep.attributedCents, 24999);
  assert.deepEqual(rep.pages.map(p => [p.path, p.shareCents]), [['/', 12500], ['/products/watch', 12499]]);
});
