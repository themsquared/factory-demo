#!/usr/bin/env node
// Steady load generator for the checkout demo.
// Usage: node scripts/load.mjs [baseUrl] [rps]
// Mixed currencies so an FX-path regression shows up as a real error-rate spike.
const base = process.argv[2] || process.env.APP_URL || 'http://localhost:3000';
const rps = Number(process.argv[3] || process.env.APP_RPS || 5);

const currencies = ['USD', 'USD', 'EUR', 'EUR', 'GBP'];
const skus = ['SKU-1001', 'SKU-1002', 'SKU-1003'];

let sent = 0;
let failed = 0;

async function one() {
  const currency = currencies[Math.floor(Math.random() * currencies.length)];
  const sku = skus[Math.floor(Math.random() * skus.length)];
  const qty = 1 + Math.floor(Math.random() * 2);
  const isCheckout = Math.random() > 0.35;
  try {
    let res;
    if (isCheckout) {
      res = await fetch(`${base}/api/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ sku, qty }], currency }),
      });
    } else {
      res = await fetch(`${base}/api/price?sku=${sku}&currency=${currency}`);
    }
    if (!res.ok) {
      failed++;
      if (failed <= 5 || failed % 50 === 0) {
        console.log(`load: non-ok ${res.status} (${isCheckout ? 'checkout' : 'price'} ${currency})`);
      }
    }
  } catch {
    failed++;
  }
  sent++;
}

console.log(`load: ~${rps} rps against ${base} (Ctrl-C to stop)`);
setInterval(() => console.log(`load: sent=${sent} failed=${failed}`), 30000);

while (true) {
  const batch = Array.from({ length: rps }, () => one());
  await Promise.all(batch);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
