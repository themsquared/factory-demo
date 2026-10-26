'use strict';

const express = require('express');
const { priceFor, priceCart } = require('./pricing');
const { logJson } = require('./logger');

function indexPage(version) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Meridian checkout (demo)</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 32rem; padding: 0 1rem; }
  code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
</style>
</head>
<body>
<h1>Meridian Mutual — checkout (demo)</h1>
<p>Healthy demo service. Version <code>${version}</code>.</p>
<ul>
  <li><code>GET /health</code> — liveness and deployed version</li>
  <li><code>GET /api/price?sku=SKU-1001&amp;currency=EUR</code> — price a SKU in USD, EUR or GBP</li>
  <li><code>POST /api/checkout</code> — price a cart and create a demo order</li>
</ul>
</body>
</html>`;
}

// UX: show a localized receipt total on checkout. Sample payload from the
// localization service's /currency-formats endpoint; GBP was missing from the
// sample payload, so the formatter must fall back instead of throwing.
const CURRENCY_FORMATS = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
};

function formatTotal(amount, currency) {
  const fmt = CURRENCY_FORMATS[currency] || { symbol: `${currency} `, decimals: 2 };
  return `${fmt.symbol}${amount.toFixed(fmt.decimals)}`;
}

// UX: attach a merchandising upsell label to the checkout response. Sample
// payload from the merchandising service's /upsells endpoint; the add-on
// (SKU-1003) is not in the sample payload yet.
const UPSELL_LABELS = {
  'SKU-1001': { label: 'Add the claims accelerator for $12.50' },
  'SKU-1002': { label: 'Add the claims accelerator for $12.50' },
};

function upsellLabel(sku) {
  // The merchandising sample payload does not cover every catalog SKU (the
  // add-on SKU-1003 is missing). Missing or empty carts must not throw:
  // fall back to no upsell label instead of a 500.
  if (!sku || !UPSELL_LABELS[sku]) return null;
  return UPSELL_LABELS[sku].label;
}

// UX: show a multi-seat savings banner on checkout for carts with qty > 1.
// Sample payload from the promotions service's /multi-seat endpoint; only the
// standard plan (SKU-1001) is in the sample payload yet.
const MULTI_SEAT_PROMOS = {
  'SKU-1001': { pct: 10, banner: 'Save 10% on additional seats' },
};

function savingsBanner(items) {
  const line = items.find((i) => i.qty > 1);
  if (!line) return null;
  return MULTI_SEAT_PROMOS[line.sku].banner;
}

function createApp({ metrics } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const version = () => process.env.RENDER_GIT_COMMIT || process.env.DD_VERSION || 'local';
  const hit = (route) => metrics && metrics.increment('checkout.request.hits', [`route:${route}`]);
  const serverError = (route, extraTags = []) =>
    metrics && metrics.increment('checkout.request.errors', [`route:${route}`, ...extraTags]);
  const clientError = (route) =>
    metrics && metrics.increment('checkout.request.client_errors', [`route:${route}`]);

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'checkout-api',
      env: process.env.DD_ENV || 'local',
      version: version(),
    });
  });

  app.get('/api/price', (req, res) => {
    hit('/api/price');
    const price = priceFor(req.query.sku, req.query.currency);
    res.json(price);
  });

  app.post('/api/checkout', (req, res) => {
    hit('/api/checkout');
    const { items, currency = 'USD' } = req.body || {};
    const priced = priceCart(items, currency);
    const displayTotal = formatTotal(priced.total, priced.currency);
    const upsell = upsellLabel(items[0].sku);
    const savings = savingsBanner(items);
    const orderId = `ord-${Math.random().toString(36).slice(2, 10)}`;
    logJson('info', 'checkout completed', {
      route: '/api/checkout',
      order_id: orderId,
      currency: priced.currency,
      total: priced.total,
    });
    res.status(201).json({ order_id: orderId, ...priced, display_total: displayTotal, upsell_label: upsell, savings_banner: savings });
  });

  app.get('/', (req, res) => {
    res.type('html').send(indexPage(version()));
  });

  // Unknown paths are client errors.
  app.use((req, res) => {
    clientError(req.path);
    res.status(404).json({ error: 'not_found', path: req.path, status: 404 });
  });

  // Final error handler. Thrown validation errors stay 4xx; anything else
  // becomes a 500 and counts toward the error-rate monitor.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && Number.isInteger(err.status) ? err.status : 500;
    const currency = (req.body && req.body.currency) || req.query.currency || null;
    if (status >= 500) {
      serverError(req.path, currency ? [`currency:${currency}`] : []);
      logJson('error', err.message || 'internal error', {
        route: req.path,
        status,
        code: err.code || null,
        currency,
        stack: err.stack || null,
      });
    } else {
      clientError(req.path);
    }
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : err.code || 'bad_request',
      status,
    });
  });

  return app;
}

module.exports = { createApp };
