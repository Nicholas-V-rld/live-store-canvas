# VERIFY: Live visitors per page

Run 2026-10-18, Node 22.17, Chrome 155, REA 6.7.0.

```sh
cd build
node --test                                   # acceptance tests 1-7
node verify-e2e.mjs /abs/path/competitor-lab/bin/rea   # acceptance test 8
node server.js                                # manual: open http://127.0.0.1:4317/?utm_source=meta
```

## Results

| Test | Result | Notes |
|---|---|---|
| 1 page event → live on path | PASS | |
| 2 page move, no double count | PASS | |
| 3 gone → off live, kept in 5-min | PASS | |
| 4 35 s expiry, 5-min window, prune | PASS | plus 4b: a beat keeps the visitor live |
| 5 bots + webdriver ignored | PASS | |
| 6 invalid bodies rejected | PASS | |
| 7 source counts live only | PASS | |
| 8 end to end in real Chrome | PASS | timeline below |

Test-the-tests: removing the bot rule made test 5 fail (7/8), restored to 8/8.

## End-to-end timeline (ms after REA started the browser)

```
   260  live=0
  2758  live=1  /:1                       {"meta":1}
  8023  live=1  /products/glow-serum:1    {"meta":1}   (in-app navigation, same visitor)
 42855  live=0  (browser closed)          5-min count still 1
headless Chrome: never counted
beat payload: 212 bytes every 15 s
```

## What this showed

- **Bot rule works both ways.** Playwright's Chrome reports `navigator.webdriver = true` even with a visible window, so our own filter blocked the first e2e run. The e2e now sets `allowWebdriver: true` (test only); the user-agent rule still blocked headless Chrome. Lucky Orange's filter let the visible Playwright browser through, so ours is stricter. Decide before launch whether `webdriver` should block or only flag (some real users run browser automation and extensions).
- **"gone" did not arrive when REA closed the browser.** The visitor dropped by expiry 30 s later instead. A normal tab close should fire `pagehide` and the beacon, but that path is **not verified** yet.
- **Size vs Lucky Orange:** 212 bytes per 15 s from us vs roughly 4.7–8.4 KB per 3 s from them (FINDINGS claim 9), around 100–200× less data per visitor, plus no 58–226 KB page snapshots.

## Not covered

- Real tab close / back-forward cache restore.
- Consent flag (`__lscConsent === false`) — logic is one line, not exercised in a test.
- Load: one process, in-memory Map. Fine for the demo; Redis per the architecture plan for production.
