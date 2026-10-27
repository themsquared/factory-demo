'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    );
  });
}

async function withServer(t, handler) {
  const { server, base } = await listen(createApp());
  t.after(() => server.close());
  await handler(base);
}

test('GET /health reports the deployed version', async (t) => {
  await withServer(t, async (base) => {
    const res = await fetch(base + '/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'checkout-api');
    assert.ok(typeof body.version === 'string');
  });
});

test('GET /api/price covers all currencies', async (t) => {
  await withServer(t, async (base) => {
    for (const currency of ['USD', 'EUR', 'GBP']) {
      const res = await fetch(`${base}/api/price?sku=SKU-1002&currency=${currency}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.currency, currency);
      assert.ok(body.amount > 0);
    }
    const bad = await fetch(`${base}/api/price?sku=SKU-1002&currency=JPY`);
    assert.equal(bad.status, 400);
  });
});

test('POST /api/checkout prices and validates a USD cart', async (t) => {
  await withServer(t, async (base) => {
    const ok = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ sku: 'SKU-1001', qty: 1 }], currency: 'USD' }),
    });
    assert.equal(ok.status, 201);
    const order = await ok.json();
    assert.match(order.order_id, /^ord-/);
    assert.equal(order.currency, 'USD');
    assert.equal(order.total, 49);

    const badSku = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ sku: 'NOPE', qty: 1 }], currency: 'USD' }),
    });
    assert.equal(badSku.status, 400);
    assert.equal((await badSku.json()).error, 'UNKNOWN_SKU');

    const empty = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(empty.status, 400);
  });
});

test('regression: checkout must return a display_total for every supported currency (GBP included)', async (t) => {
  // Incident d027e741 (deploy 6514707, PR #17, commit 6820d2d): formatTotal()
  // read CURRENCY_FORMATS[currency].symbol, but the map only covered USD and
  // EUR, so GBP checkouts threw a TypeError ("Cannot read properties of
  // undefined (reading 'symbol')") and returned 500 on the live service.
  for (const currency of ['USD', 'EUR', 'GBP']) {
    await withServer(t, async (base) => {
      const res = await fetch(base + '/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ sku: 'SKU-1001', qty: 1 }], currency }),
      });
      assert.equal(res.status, 201, `checkout in ${currency} should succeed`);
      const order = await res.json();
      assert.equal(order.currency, currency);
      assert.ok(order.display_total.length > 0, `display_total for ${currency} should be set`);
    });
  }
});

test('regression: checkout must succeed for SKUs missing from the upsell label map', async (t) => {
  // Incident IR-7 (deploy e058b13, PR #19, 2026-10-20): upsellLabel() read
  // UPSELL_LABELS[sku].label, but the sample map only covered SKU-1001 and
  // SKU-1002, so every checkout containing the add-on SKU-1003 threw a
  // TypeError ("Cannot read properties of undefined (reading 'label')") and
  // returned 500 on the live service.
  await withServer(t, async (base) => {
    const res = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ sku: 'SKU-1003', qty: 1 }], currency: 'USD' }),
    });
    assert.equal(res.status, 201, 'checkout with SKU-1003 should succeed');
    const order = await res.json();
    assert.equal(order.total > 0, true);
  });
});

test('regression: checkout must succeed for multi-quantity carts whose SKU has no savings promo', async (t) => {
  // Incident 20ef834e (deploy 18b4078, PR #21, 2026-10-26): savingsBanner()
  // read MULTI_SEAT_PROMOS[line.sku].banner for any cart line with qty > 1,
  // but the sample map only covered SKU-1001, so any multi-quantity cart of
  // another SKU threw a TypeError ("Cannot read properties of undefined
  // (reading 'banner')") and returned 500 on the live service.
  await withServer(t, async (base) => {
    const res = await fetch(base + '/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ sku: 'SKU-1002', qty: 3 }], currency: 'USD' }),
    });
    assert.equal(res.status, 201, 'checkout with qty > 1 of a SKU without a promo should succeed');
    const order = await res.json();
    assert.equal(order.total > 0, true);
  });
});

test('regression: checkout must succeed for EUR/GBP carts whose SKU has no regional disclosure', async (t) => {
  // Incident IR-9 (deploy ce61734, PR #23, commit 9b022a5, 2026-10-27):
  // disclosuresFor() read REGIONAL_DISCLOSURES[i.sku][currency] without a
  // fallback, but the sample map only covered SKU-1001 (EUR/GBP), so every
  // EUR or GBP checkout containing another SKU (e.g. SKU-1002, SKU-1003)
  // threw a TypeError ("Cannot read properties of undefined (reading
  // 'EUR'/'GBP')") and returned 500 on the live service.
  for (const [currency, sku] of [['EUR', 'SKU-1002'], ['GBP', 'SKU-1002'], ['EUR', 'SKU-1003'], ['GBP', 'SKU-1003']]) {
    await withServer(t, async (base) => {
      const res = await fetch(base + '/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ sku, qty: 1 }], currency }),
      });
      assert.equal(res.status, 201, `checkout of ${sku} in ${currency} should succeed`);
      const order = await res.json();
      assert.equal(order.currency, currency);
    });
  }
});

test('unknown paths return 404 json', async (t) => {
  await withServer(t, async (base) => {
    const res = await fetch(base + '/api/nope');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not_found');
  });
});
