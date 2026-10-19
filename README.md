# Live Store Canvas

A Figma-style canvas of a Shopify store: every page is a frame, live shoppers appear as cursors on the page they're viewing, arrows show how people move between pages, and each page shows the revenue it helped make.

## What's here

| Path | What it is |
|---|---|
| `public/index.html` | Client demo. A sample store (Northline Boards) running on simulated shoppers. Deployed to Vercel. |
| `engine/presence/` | Live visitors per page: storefront tracker, presence rules, server with a live feed. |
| `engine/revenue/` | Revenue per page: Shopify pixel, order-webhook receiver, attribution rules (7-day lookback, influenced + equal-split share). |
| `docs/` | Behaviour specs and test results for both engines. |

## Run

```sh
npm test                 # unit + HTTP tests for both engines (Node 22+)
npm run presence         # live-visitor server on :4317, demo store at http://127.0.0.1:4317/?utm_source=meta
npm run revenue          # revenue receiver on :4318 (pixel events, orders/create webhooks, /report)
```

The demo in `public/` is a single static page with no build step.

## Status

- Engines are tested in isolation and in a real browser, but have not yet run against a live Shopify store.
- Data is kept in memory. Production moves presence to Redis and events to ClickHouse (see the engineering plan).
