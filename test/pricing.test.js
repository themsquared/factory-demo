'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceFor, priceCart, CURRENCIES, CATALOG } = require('../src/pricing');

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

test('regression: every catalog sku is priceable — tier-fee map must not throw on missing tiers', () => {
  // Incident ef940e0f: tierFee() read TIER_FEES[sku].fee, but SKU-1002 was not
  // in the sample /tiers payload, so any cart containing SKU-1002 threw a
  // TypeError ("Cannot read properties of undefined (reading 'fee')") and the
  // checkout returned 500 on the live service.
  for (const sku of Object.keys(CATALOG)) {
    for (const currency of CURRENCIES) {
      const cart = priceCart([{ sku, qty: 1 }], currency);
      assert.equal(cart.currency, currency);
      const line = cart.lines.find((l) => l.sku === sku);
      assert.ok(line.total > 0, `${sku} in ${currency} should price positively`);
      assert.equal(typeof line.fee, 'number', `${sku} fee should be a number`);
    }
  }
});

test('rejects empty or invalid carts', () => {
  assert.throws(() => priceCart([], 'USD'), /at least one item/);
  assert.throws(() => priceCart(undefined, 'USD'), /at least one item/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 0 }], 'USD'), /invalid quantity/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 'many' }], 'USD'), /invalid quantity/);
  assert.throws(() => priceCart([{ sku: 'SKU-1001', qty: 1 }], 'CHF'), /unsupported currency/);
});
