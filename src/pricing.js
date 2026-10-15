'use strict';

// Static demo catalog and FX table. No external provider, no database.
// Finance refreshes these tables by hand in real life; here they are constants.

const CATALOG = {
  'SKU-1001': { name: 'Standard coverage plan', usd: 49.0 },
  'SKU-1002': { name: 'Premium coverage plan', usd: 89.0 },
  'SKU-1003': { name: 'Add-on: claims accelerator', usd: 12.5 },
};

// USD-base FX rates.
const FX = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
};

const CURRENCIES = Object.keys(FX);

function priceFor(sku, currency) {
  const item = CATALOG[sku];
  if (!item) {
    const err = new Error(`unknown sku: ${sku}`);
    err.status = 400;
    err.code = 'UNKNOWN_SKU';
    throw err;
  }
  if (!FX[currency]) {
    const err = new Error(`unsupported currency: ${currency}`);
    err.status = 400;
    err.code = 'UNSUPPORTED_CURRENCY';
    throw err;
  }
  const amount = round2(item.usd * FX[currency]);
  return { sku, name: item.name, currency, amount };
}

// Prices a whole cart in one currency. Used by POST /api/checkout.
function priceCart(items, currency) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('cart must contain at least one item');
    err.status = 400;
    err.code = 'EMPTY_CART';
    throw err;
  }
  if (!FX[currency]) {
    const err = new Error(`unsupported currency: ${currency}`);
    err.status = 400;
    err.code = 'UNSUPPORTED_CURRENCY';
    throw err;
  }
  const lines = items.map(({ sku, qty }) => {
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      const err = new Error(`invalid quantity for ${sku}`);
      err.status = 400;
      err.code = 'INVALID_QUANTITY';
      throw err;
    }
    const line = priceFor(sku, currency);
    return {
      sku: line.sku,
      name: line.name,
      qty,
      unit: line.amount,
      total: round2(line.amount * qty),
    };
  });
  const total = round2(lines.reduce((sum, l) => sum + l.total, 0));
  return { currency, lines, total };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { priceFor, priceCart, CURRENCIES, CATALOG, FX, round2 };
