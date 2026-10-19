# SPEC: Live visitors per page

Written from FINDINGS.md only. No competitor code, names or strings.

## Behaviour

1. A small script on each storefront page creates a visitor id (kept in the browser) and a session id (kept per tab session).
2. On page load it reports: visitor, session, page path, page title, traffic source (UTM source, else referrer host, else "direct").
3. While the tab is visible it sends a heartbeat every 15 s.
4. When the page changes without a reload (history push / back / forward) it reports the new page on the same session.
5. When the tab is hidden or closed it sends a "gone" signal so the visitor drops off immediately.
6. The server keeps one presence row per visitor: current page, source, last seen.
7. A visitor is **live** if last seen within 35 s. The server also reports a **5-minute** count to match Shopify's own "visitors right now".
8. The canvas reads live counts per page and the source mix, and gets pushed updates within ~2 s of a change.

## Inputs / outputs

- `POST /e` body: `{ shop, visitor, session, type: "page" | "beat" | "gone", path, title, source }`. Reply `204`.
- `GET /live?shop=` → `{ shop, live, last5min, pages: [{ path, title, live }], sources: { name: count } }`.
- `GET /stream?shop=` → Server-Sent Events, one `live` message (same JSON) on every change, at most every 1 s.

## Edge cases

- **Bots:** server ignores user agents containing `HeadlessChrome`, `bot`, `crawl`, `spider`, `Lighthouse`, and requests where the script saw `navigator.webdriver === true`.
- **Two tabs, same visitor:** counted once, on the most recent page.
- **Tab hidden:** "gone" sent; visitor leaves the live count; comes back on next "page"/"beat".
- **Network drop:** no "gone" arrives; visitor expires after 35 s.
- **Consent declined:** if the store's consent API says analytics is not allowed, the script sends nothing. (Shopify Customer Privacy API in production; a `window.__lscConsent === false` flag in the demo.)
- **Bad input:** missing shop/visitor/type, or body over 2 KB → `400`, nothing stored.

## Unknowns we build on

- Their exact live timeout is unknown. We use 35 s (heartbeat 15 s, tolerates one lost beat).

## Where we come in different

- **Presence without recording.** ~200-byte beats every 15 s instead of KB-sized batches every 3 s and page snapshots. Roughly 100× less data per visitor, so it can run on every store without slowing it.
- **Per-page on the canvas.** Live counts sit on the page frames of the store map, not in a separate list.
- **Source on every visitor.** Each live visitor carries where they came from, so the canvas shows "18 on the serum page, 11 from Meta".
- **Honest freshness.** Two numbers, labelled: live (35 s) and last 5 min.
- **Same bot rule they use**, applied before anything is stored.

## Acceptance tests

1. A "page" event makes that visitor live on that path.
2. A later "page" event from the same visitor moves them; they are not counted twice.
3. A "gone" event removes them from live immediately but keeps them in the 5-minute count.
4. With no beat for 35 s a visitor is not live; within 5 min they still count in `last5min`.
5. Bot user agents and `webdriver: true` are ignored.
6. Invalid bodies get `400` and change nothing.
7. Source counts reflect live visitors only.
8. End to end: a real browser on the demo page shows up in `/live` within 3 s, moves page on an in-app navigation, and a headless browser is never counted.
