// Revenue per page: page views + checkout links (from our pixel) joined to orders (from the webhook).
// ponytail: in-memory arrays and a full scan per report; move to ClickHouse when a shop has millions of views.
export const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const str = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const ts = (v) => Number.isFinite(v) && v > 0;
const cleanPath = (p) => p.split(/[?#]/)[0];

export function createRevenue() {
  const views = [];                  // { shop, clientId, path, ts }
  const links = new Map();           // `${shop}|${checkoutToken}` -> clientId
  const orders = new Map();          // `${shop}|${orderId}` -> order
  const currency = new Map();        // shop -> currency

  return {
    pageView(e) {
      if (!e || !str(e.shop) || !str(e.clientId) || !str(e.path, 1000) || !e.path.startsWith('/') || !ts(e.ts)) return false;
      views.push({ shop: e.shop, clientId: e.clientId, path: cleanPath(e.path), ts: e.ts });
      return true;
    },

    checkoutLink(e) {
      if (!e || !str(e.shop) || !str(e.clientId) || !str(e.checkoutToken) || !ts(e.ts)) return false;
      links.set(`${e.shop}|${e.checkoutToken}`, e.clientId);
      return true;
    },

    order(o) {
      if (!o || !str(o.shop) || !str(String(o.orderId ?? '')) || !str(o.checkoutToken) || !ts(o.ts) ||
          !Number.isInteger(o.totalCents) || o.totalCents < 0 || !/^[A-Z]{3}$/.test(o.currency ?? '')) return false;
      const known = currency.get(o.shop);
      if (known && known !== o.currency) return false;
      currency.set(o.shop, o.currency);
      orders.set(`${o.shop}|${o.orderId}`, { ...o }); // retries overwrite the same key
      return true;
    },

    report(shop, from = 0, to = Infinity) {
      const pages = new Map();
      const page = (path) => pages.get(path) ?? pages.set(path, { path, sessions: new Set(), buyers: new Set(), influencedCents: 0, shareCents: 0 }).get(path);
      for (const v of views) if (v.shop === shop && v.ts >= from && v.ts <= to) page(v.path).sessions.add(v.clientId);

      let revenueCents = 0, attributedCents = 0, count = 0;
      for (const o of orders.values()) {
        if (o.shop !== shop || o.ts < from || o.ts > to) continue;
        count++;
        revenueCents += o.totalCents;
        const clientId = links.get(`${shop}|${o.checkoutToken}`);
        if (!clientId) continue;
        // distinct pages this buyer viewed in the lookback window, earliest first
        const firstSeen = new Map();
        for (const v of views) {
          if (v.shop !== shop || v.clientId !== clientId || v.ts > o.ts || v.ts < o.ts - LOOKBACK_MS) continue;
          if (!firstSeen.has(v.path) || v.ts < firstSeen.get(v.path)) firstSeen.set(v.path, v.ts);
        }
        if (firstSeen.size === 0) continue; // linked but no pages: stays unattributed
        const credited = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
        const base = Math.floor(o.totalCents / credited.length);
        let remainder = o.totalCents - base * credited.length;
        for (const path of credited) {
          const p = page(path);
          p.influencedCents += o.totalCents;
          p.shareCents += base + (remainder-- > 0 ? 1 : 0);
          p.buyers.add(clientId);
        }
        attributedCents += o.totalCents;
      }

      return {
        currency: currency.get(shop) ?? null,
        revenueCents,
        attributedCents,
        unattributedCents: revenueCents - attributedCents,
        orders: count,
        pages: [...pages.values()]
          .map(p => ({
            path: p.path,
            sessions: p.sessions.size,
            buyers: p.buyers.size,
            conversionRate: p.sessions.size ? p.buyers.size / p.sessions.size : 0,
            influencedCents: p.influencedCents,
            shareCents: p.shareCents,
            revenuePerSessionCents: p.sessions.size ? Math.round(p.influencedCents / p.sessions.size) : 0,
          }))
          .sort((a, b) => b.shareCents - a.shareCents || a.path.localeCompare(b.path)),
      };
    },
  };
}
