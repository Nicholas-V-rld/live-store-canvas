// Live presence per shop, in memory.
// ponytail: single-process Map; move to a Redis sorted set per shop when running more than one server.
export const LIVE_MS = 35_000;
export const WINDOW_MS = 5 * 60_000;
const BOT = /HeadlessChrome|bot|crawl|spider|Lighthouse/i;
const TYPES = new Set(['page', 'beat', 'gone']);
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function valid(e) {
  return !!e && str(e.shop, 100) && str(e.visitor, 100) && TYPES.has(e.type) &&
    (e.type === 'gone' || (str(e.path, 500) && e.path.startsWith('/')));
}

// allowWebdriver: only for automated end-to-end tests; real traffic keeps it off.
export function createPresence({ now = Date.now, allowWebdriver = false } = {}) {
  const shops = new Map(); // shop -> Map(visitor -> { path, title, source, seen, gone })

  function record(e, userAgent = '') {
    if (!valid(e)) return 'invalid';
    if (BOT.test(userAgent) || (e.webdriver === true && !allowWebdriver)) return 'ignored';
    if (!shops.has(e.shop)) shops.set(e.shop, new Map());
    const rows = shops.get(e.shop);
    const prev = rows.get(e.visitor);
    if (e.type === 'gone') {
      if (prev) prev.gone = true;
      return 'ok';
    }
    rows.set(e.visitor, {
      path: e.path,
      title: typeof e.title === 'string' ? e.title.slice(0, 200) : prev?.title ?? '',
      source: str(e.source, 100) ? e.source : prev?.source ?? 'direct',
      seen: now(),
      gone: false,
    });
    return 'ok';
  }

  function snapshot(shop) {
    const t = now();
    const rows = shops.get(shop) ?? new Map();
    const pages = new Map();
    const sources = {};
    let live = 0, last5min = 0;
    for (const [visitor, r] of rows) {
      if (t - r.seen > WINDOW_MS) { rows.delete(visitor); continue; }
      last5min++;
      if (r.gone || t - r.seen > LIVE_MS) continue;
      live++;
      const p = pages.get(r.path) ?? { path: r.path, title: r.title, live: 0 };
      p.live++;
      pages.set(r.path, p);
      sources[r.source] = (sources[r.source] ?? 0) + 1;
    }
    return { shop, live, last5min, pages: [...pages.values()].sort((a, b) => b.live - a.live), sources };
  }

  return { record, snapshot };
}
