// Shopify app pixel. In the extension's entry file:
//   import { register } from '@shopify/web-pixels-extension';
//   import createPixel from './pixel.js';
//   register(createPixel);
// Settings (from the app's pixel settings): shop, endpoint.

const EVENTS = ['page_viewed', 'checkout_started', 'checkout_completed'];

// Maps a Shopify customer event to our input shape, or null if it can't be used.
export function toInput(name, event, shop) {
  const clientId = event?.clientId;
  const t = Date.parse(event?.timestamp);
  if (!clientId || !Number.isFinite(t)) return null;
  if (name === 'page_viewed') {
    const path = event.context?.document?.location?.pathname;
    return path ? { kind: 'page', shop, clientId, path, ts: t } : null;
  }
  if (name === 'checkout_started' || name === 'checkout_completed') {
    const checkoutToken = event.data?.checkout?.token;
    return checkoutToken ? { kind: 'checkout', shop, clientId, checkoutToken, ts: t } : null;
  }
  return null;
}

export default function createPixel({ analytics, settings }) {
  for (const name of EVENTS) {
    analytics.subscribe(name, (event) => {
      const body = toInput(name, event, settings.shop);
      if (body) fetch(settings.endpoint, { method: 'POST', body: JSON.stringify(body), keepalive: true }).catch(() => {});
    });
  }
}
