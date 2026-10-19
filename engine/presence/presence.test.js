import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence, LIVE_MS } from './presence.js';

const UA = 'Mozilla/5.0 (Macintosh) Chrome/155.0 Safari/537.36';
const setup = () => {
  let t = 1_000_000;
  const p = createPresence({ now: () => t });
  return { p, tick: ms => { t += ms; } };
};
const ev = (o) => ({ shop: 's1', visitor: 'v1', type: 'page', path: '/', source: 'meta', ...o });

test('1. page event makes visitor live on that path', () => {
  const { p } = setup();
  assert.equal(p.record(ev({ path: '/products/serum' }), UA), 'ok');
  const s = p.snapshot('s1');
  assert.equal(s.live, 1);
  assert.deepEqual(s.pages.map(x => [x.path, x.live]), [['/products/serum', 1]]);
});

test('2. second page event moves the visitor, no double count', () => {
  const { p } = setup();
  p.record(ev({ path: '/' }), UA);
  p.record(ev({ path: '/cart' }), UA);
  const s = p.snapshot('s1');
  assert.equal(s.live, 1);
  assert.deepEqual(s.pages.map(x => x.path), ['/cart']);
});

test('3. gone removes from live but keeps 5-minute count', () => {
  const { p } = setup();
  p.record(ev({}), UA);
  p.record(ev({ type: 'gone' }), UA);
  const s = p.snapshot('s1');
  assert.equal(s.live, 0);
  assert.equal(s.last5min, 1);
});

test('4. no beat for 35s expires live; 5-minute window still counts, then prunes', () => {
  const { p, tick } = setup();
  p.record(ev({}), UA);
  tick(LIVE_MS + 1);
  assert.deepEqual([p.snapshot('s1').live, p.snapshot('s1').last5min], [0, 1]);
  tick(5 * 60_000);
  assert.equal(p.snapshot('s1').last5min, 0);
});

test('4b. a beat keeps the visitor live', () => {
  const { p, tick } = setup();
  p.record(ev({}), UA);
  tick(20_000);
  p.record(ev({ type: 'beat' }), UA);
  tick(20_000);
  assert.equal(p.snapshot('s1').live, 1);
});

test('5. bots and webdriver are ignored', () => {
  const { p } = setup();
  assert.equal(p.record(ev({}), 'Mozilla/5.0 HeadlessChrome/155.0'), 'ignored');
  assert.equal(p.record(ev({ visitor: 'v2' }), 'Googlebot/2.1'), 'ignored');
  assert.equal(p.record(ev({ visitor: 'v3', webdriver: true }), UA), 'ignored');
  assert.equal(p.snapshot('s1').live, 0);
});

test('6. invalid bodies are rejected and change nothing', () => {
  const { p } = setup();
  for (const bad of [null, {}, ev({ type: 'click' }), ev({ path: 'no-slash' }), ev({ shop: '' }), ev({ visitor: 'x'.repeat(101) })]) {
    assert.equal(p.record(bad, UA), 'invalid');
  }
  assert.equal(p.snapshot('s1').last5min, 0);
});

test('7. source counts cover live visitors only', () => {
  const { p } = setup();
  p.record(ev({ visitor: 'a', source: 'meta' }), UA);
  p.record(ev({ visitor: 'b', source: 'google' }), UA);
  p.record(ev({ visitor: 'c', source: 'meta' }), UA);
  p.record(ev({ visitor: 'c', type: 'gone' }), UA);
  assert.deepEqual(p.snapshot('s1').sources, { meta: 1, google: 1 });
});
