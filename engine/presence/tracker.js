// Storefront presence script. Load with: <script async src=".../tracker.js" data-shop="my-shop"></script>
(() => {
  if (window.__lscConsent === false) return; // production: Shopify Customer Privacy API
  const script = document.currentScript;
  const shop = script?.dataset.shop;
  if (!shop) return;
  const endpoint = new URL('/e', script.src).href;

  const keep = (store, key, make) => {
    try {
      let v = store.getItem(key);
      if (!v) store.setItem(key, (v = make()));
      return v;
    } catch { return make(); }
  };
  const id = () => crypto.randomUUID();
  const visitor = keep(localStorage, 'lsc_v', id);
  const session = keep(sessionStorage, 'lsc_s', id);
  const source = keep(sessionStorage, 'lsc_src', () => {
    const utm = new URLSearchParams(location.search).get('utm_source');
    if (utm) return utm.slice(0, 100);
    try {
      const ref = new URL(document.referrer).host;
      if (ref && ref !== location.host) return ref;
    } catch {}
    return 'direct';
  });

  const send = (type) => {
    const body = JSON.stringify({
      shop, visitor, session, type, source,
      path: location.pathname, title: document.title,
      webdriver: navigator.webdriver === true,
    });
    // text/plain beacon avoids a CORS preflight and survives page close
    if (!navigator.sendBeacon?.(endpoint, body)) fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => {});
  };

  let timer;
  const start = () => {
    send('page');
    clearInterval(timer);
    timer = setInterval(() => send('beat'), 15000);
  };
  const stop = () => { clearInterval(timer); send('gone'); };

  const push = history.pushState;
  history.pushState = function (...args) { const r = push.apply(this, args); start(); return r; };
  addEventListener('popstate', start);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  addEventListener('pagehide', stop);
  start();
})();
