# SPEC: Revenue per page

Written from FINDINGS.md only. No competitor code, names or strings.

## Behaviour

1. Our Shopify app pixel listens to Shopify's `page_viewed`, `checkout_started` and `checkout_completed` events. Every event carries Shopify's `clientId`, which identifies the buyer's browser on both the storefront and checkout.
2. On `page_viewed` it sends: shop, clientId, page path, timestamp.
3. On `checkout_started` / `checkout_completed` it sends: shop, clientId, checkout token, timestamp. This only **links** a checkout to a browser.
4. Revenue comes from Shopify's `orders/create` webhook: order id, checkout token, total in cents, currency, created time. A missed pixel event never loses revenue.
5. An order is linked to a browser when its checkout token matches a pixel checkout event. Linked orders credit the pages that browser viewed in the **7 days before the order**. Unlinked orders go to an "Unattributed" row, so page totals plus unattributed always equal store revenue.
6. Each page gets two numbers, both labelled in the UI with the rule:
   - **Influenced revenue:** full value of every order whose buyer viewed the page (an order counts once per page however many times it was viewed). Pages overlap, so these don't sum to revenue.
   - **Revenue share:** each order split equally across the distinct pages its buyer viewed, in whole cents, remainder cents to the earliest pages. These sum exactly to attributed revenue.
7. Per page also: sessions (distinct clientIds that viewed it in the period), buyers, conversion rate (buyers ÷ sessions), and revenue per session (influenced ÷ sessions).

## Inputs / outputs

- Page view: `{ shop, clientId, path, ts }`
- Checkout link: `{ shop, clientId, checkoutToken, ts }`
- Order: `{ shop, orderId, checkoutToken, totalCents, currency, ts }`
- Report for `{ shop, from, to }` (orders whose time is in the range):
  `{ currency, revenueCents, attributedCents, unattributedCents, orders, pages: [{ path, sessions, buyers, conversionRate, influencedCents, shareCents, revenuePerSessionCents }] }`, pages sorted by share, highest first.

## Edge cases

- **Same order delivered twice** (webhooks retry): counted once by order id.
- **Page viewed after the order:** no credit.
- **Page viewed more than 7 days before the order:** no credit.
- **Checkout link arrives after the order webhook:** the order links at report time, so arrival order doesn't matter.
- **Linked buyer with no page views in the window** (for example they went straight to checkout): order is attributed to the "(no pages)" bucket inside unattributed.
- **Mixed currency in one shop:** rejected; one report has one currency.
- **Bad input:** missing fields, non-integer or negative cents, path not starting with `/` → rejected, nothing stored.
- **Query strings:** paths are stored without `?…` so `/products/x?variant=1` and `/products/x` are one page.

## Unknowns we build on

- Their crediting rule is unknown. We choose and **show** ours: 7-day lookback; influenced plus equal-split share.
- Refunds and edits (`orders/updated`, refunds) are out of scope for this round. Revenue is order total at creation.

## Where we come in different

- **Revenue that matches Shopify.** Totals come from the order webhook, and every cent lands on a page or in Unattributed. Their numbers come from a pixel that can miss purchases.
- **One id, no cookie stitching.** Shopify's own `clientId` across storefront and checkout.
- **The rule is on screen.** Merchants see "7-day lookback, split equally" next to the number, and both influenced and share views.
- **On the canvas.** Each page frame shows its share, revenue per session and conversion rate next to its live visitor count from round 1.
- **No recording needed.** Page views and checkout links only. A few hundred bytes per page instead of a full session recording.

## Acceptance tests

1. An order credits only the pages its buyer viewed in the 7 days before it: not later pages, not older ones.
2. Revenue share across pages sums exactly to the order total in cents, remainder going to the earliest pages.
3. Influenced counts each order once per page even with repeat views.
4. Sessions, buyers, conversion rate and revenue per session are correct per page.
5. Orders without a matching checkout link are unattributed; attributed + unattributed = revenue.
6. Duplicate order webhooks count once; a checkout link without an order adds no revenue.
7. A linked buyer with no pages in the window goes to unattributed.
8. Mixed currency and invalid inputs are rejected and change nothing.
9. Query strings are stripped from paths.
10. The order time range filters the report.
11. The pixel code turns real Shopify event shapes into our page-view and checkout-link inputs.
