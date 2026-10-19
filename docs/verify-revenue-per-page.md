# VERIFY: Revenue per page

Run 2026-10-19, Node 22.17.

```sh
cd build
node --test        # acceptance tests 1-11
```

## Results: 13 of 13 pass

| Test | Result |
|---|---|
| 1 only pages viewed in the 7 days before the order | PASS |
| 2 share sums exactly, remainder to earliest pages | PASS |
| 3 influenced once per page despite repeat views | PASS |
| 4 sessions, buyers, conversion rate, revenue per session | PASS |
| 5 unattributed orders, totals add up | PASS |
| 6 duplicate webhook once; link without order adds nothing | PASS |
| 6b link arriving after the order still attributes | PASS |
| 7 linked buyer with no pages → unattributed | PASS |
| 8 mixed currency and invalid inputs rejected | PASS |
| 9 query strings stripped | PASS |
| 10 time range filter | PASS |
| 11 pixel maps Shopify event shapes | PASS |
| 11b full flow: pixel events + `orders/create` webhook → report | PASS |

Test-the-tests:
- Removing the "no credit after the order" rule failed test 1 (12/13).
- Dropping remainder cents failed tests 2 and 11b (11/13).
- Restored to 13/13.

## Side-by-side with Heatmap.com

**Not possible this round.** Their revenue numbers live in the merchant's dashboard, and triggering a purchase on someone else's store is off limits. What we compared instead:

| | Heatmap.com (observed) | Ours |
|---|---|---|
| Revenue source | Shopify pixel `checkout_completed` | `orders/create` webhook (pixel only links) |
| Buyer id | Own cookie + Shopify `clientId` | Shopify `clientId` only |
| Crediting rule | Hidden, server-side | 7-day lookback, influenced + equal split, shown in UI |
| Data per visit | ~60 requests incl. session recording in 75 s, 2 pages | 1 small event per page view + 1 per checkout |
| Totals reconcile with Shopify | Unknown | Yes: attributed + unattributed = order revenue (test 5) |

## Not covered

- Real Shopify: the pixel runs only inside a Shopify app extension on a dev store. The event shapes in tests 11 and 11b follow Shopify's documented format but were not captured from a live checkout.
- Refunds, order edits, multi-currency stores.
- Element-level revenue (their claim 10). This round is page level only.
- HTTP wiring: `revenue.js` isn't yet behind the round-1 server.
