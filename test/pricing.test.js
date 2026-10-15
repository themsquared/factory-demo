'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceFor, priceCart, CURRENCIES } = require('../src/pricing');

test('prices a sku in all three currencies', () => {
  const usd = priceFor('SKU-1001', 'USD');
  for (const currency of CURRENCIES) {
    const price = priceFor('SKU-1001', currency);
    assert.equal(price.currency, currency);
    assert.ok(price.amount > 0);
  }
  assert.notEqual(priceFor('SKU-1001', 'EUR').amount, usd.amount);
  assert.notEqual(priceFor('SKU-1001', 'GBP').amount, usd.amount);
});

test('rejects unknown skus and unsupported currencies', () => {
  assert.throws(() => priceFor('SKU-9999', 'USD'), /unknown sku/);
  assert.throws(() => priceFor('SKU-1001', 'JPY'), /unsupported currency/);
});

test('prices a cart and totals it', () => {
  const cart = priceCart(
    [
      { sku: 'SKU-1001', qty: 2 },
      { sku: 'SKU-1003', qty: 1 },
    ],
    'USD'
  );
  assert.equal(cart.currency, 'USD');
  assert.equal(cart.lines.length, 2);
  assert.equal(cart.total, 110.5);
});

test('regression: every supported currency is priceable through the FX provider cache', () => {
  // Incident b1ac7104: providerSnapshot() omitted EUR, so providerRate('EUR')
  // threw a TypeError and EUR checkouts returned 500 on the live service.
  for (const currency of CURRENCIES) {
    const cart = priceCart(
      [{ sku: 'SKU-1001', qty: 1 }],
      currency
    );
    assert.equal(cart.currency, currency);
    assert.ok(cart.total > 0, `cart total for ${currency} should be positive`);
  }
  const eur = priceCart([{ sku: 'SKU-1001', qty: 2 }], 'EUR');
  assert.equal(eur.total, 90.16); // 49.00 * 0.92 * 2
});

test('rejects empty or invalid carts', () => {
  assert.throws(() => priceCart([], 'USD'), /at least one item/);
  assert.throws(() => priceCart(undefined, 'USD'), /at least one item/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 0 }], 'USD'), /invalid quantity/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 'many' }], 'USD'), /invalid quantity/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 1 }], 'CHF'), /unsupported currency/);
});
