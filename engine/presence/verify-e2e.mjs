// End-to-end check (acceptance test 8): a real browser via REA, polled through /live.
// Usage: node verify-e2e.mjs <path-to-rea-wrapper>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from './server.js';
import { createPresence, LIVE_MS } from './presence.js';

const rea = process.argv[2];
const PORT = 4317;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Playwright-driven Chrome reports navigator.webdriver = true, so allow it here; the UA bot rule still applies.
const server = createServer(createPresence({ allowWebdriver: true })).listen(PORT);
const dir = mkdtempSync(join(tmpdir(), 'lsc-'));

async function run(name, headless) {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({
    browser: { mode: 'launch', executable_path: CHROME, headless },
    start_url: { url: `http://127.0.0.1:${PORT}/?utm_source=meta` },
    actions: [
      { step_id: 'on-home', action: 'wait_for_timeout', duration_ms: 5000 },
      { step_id: 'go-product', action: 'click', locator: { kind: 'css', selector: '#to-product' }, timeout_ms: 5000 },
      { step_id: 'on-product', action: 'wait_for_timeout', duration_ms: 5000 },
    ],
  }));
  const seen = [];
  const started = Date.now();
  const poll = setInterval(async () => {
    const s = await (await fetch(`http://127.0.0.1:${PORT}/live?shop=demo`)).json();
    seen.push({ t: Date.now() - started, live: s.live, last5min: s.last5min, pages: s.pages.map(p => `${p.path}:${p.live}`).join(' '), sources: s.sources });
  }, 250);
  const code = await new Promise(r => spawn(rea, ['capture-browser-scenario', file, '--format', 'json'], { stdio: 'ignore' }).on('exit', r));
  // A closed browser may not deliver "gone"; then the visitor must expire within LIVE_MS.
  const closedAt = Date.now();
  let final;
  do {
    await new Promise(r => setTimeout(r, 500));
    final = await (await fetch(`http://127.0.0.1:${PORT}/live?shop=demo`)).json();
  } while (final.live > 0 && Date.now() - closedAt < LIVE_MS + 3000);
  clearInterval(poll);
  return { code, seen, final, droppedAfterMs: Date.now() - closedAt };
}

const changes = (seen) => seen.filter((s, i) => i === 0 || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...seen[i - 1], t: 0 }));

const real = await run('visible', false);
console.log('visible browser timeline (ms since REA launch):');
for (const s of changes(real.seen)) console.log(' ', s.t, `live=${s.live}`, `5min=${s.last5min}`, s.pages, JSON.stringify(s.sources));
assert.equal(real.code, 0, 'REA scenario failed');
assert.ok(real.seen.some(s => s.pages === '/:1'), 'visitor never seen live on /');
assert.ok(real.seen.some(s => s.pages === '/products/glow-serum:1'), 'visitor never moved to the product page');
assert.ok(real.seen.every(s => s.live <= 1), 'visitor double-counted');
assert.ok(real.seen.some(s => s.sources.meta === 1), 'utm source not attached');
const home = real.seen.find(s => s.pages === '/:1').t, product = real.seen.find(s => s.pages === '/products/glow-serum:1').t;
assert.ok(product - home >= 4000 && product - home <= 7000, `page move timing off: ${product - home} ms`);
console.log(`left live count ${real.droppedAfterMs} ms after the browser closed`);
assert.equal(real.final.live, 0, 'visitor still live after browser closed');
assert.equal(real.final.last5min, 1, 'visitor missing from 5-minute count');

const bot = await run('headless', true);
console.log(`headless browser: max live seen = ${Math.max(...bot.seen.map(s => s.live))}, final 5min = ${bot.final.last5min}`);
assert.equal(bot.code, 0, 'REA headless scenario failed');
assert.ok(bot.seen.every(s => s.live === 0), 'headless browser was counted');
assert.equal(bot.final.last5min, 1, 'headless visit changed the 5-minute count');

const beat = JSON.stringify({ shop: 'demo', visitor: crypto.randomUUID(), session: crypto.randomUUID(), type: 'beat', source: 'meta', path: '/products/glow-serum', title: 'Glow Serum', webdriver: false });
console.log(`beat payload: ${beat.length} bytes every 15 s`);
console.log('E2E PASS');
server.close();
process.exit(0);
