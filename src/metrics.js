'use strict';

const { logJson } = require('./logger');

// Reports the service's own request counters to the Datadog metrics API.
// Agentless by design: batches POST straight to the intake every interval,
// which keeps the demo on Render's free tier with no private agent service.
//
// Metrics (type=count, summed by Datadog):
//   checkout.request.hits          tags: route
//   checkout.request.errors        tags: route, currency   (5xx only)
//   checkout.request.client_errors tags: route             (4xx only)
//
// The error-rate monitor computes checkout.request.errors / checkout.request.hits.

class Metrics {
  constructor({ apiKey, site = 'datadoghq.com', intervalMs = 10000 }) {
    this.apiKey = apiKey;
    this.site = site;
    this.intervalMs = intervalMs;
    this.buckets = new Map();
    this.interval = null;
  }

  increment(metric, tags = []) {
    const key = [metric, ...[...tags].sort()].join('|');
    this.buckets.set(key, (this.buckets.get(key) || 0) + 1);
  }

  start() {
    if (!this.apiKey || this.interval) return;
    this.interval = setInterval(() => {
      this.flush().catch((err) =>
        logJson('warn', 'metrics flush failed', { error: String((err && err.message) || err) })
      );
    }, this.intervalMs);
    this.interval.unref();
  }

  async flush() {
    if (this.buckets.size === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const series = [];
    for (const [key, value] of this.buckets) {
      const [metric, ...tags] = key.split('|');
      series.push({
        metric,
        type: 'count',
        points: [[now, value]],
        tags: ['service:checkout-api', `env:${process.env.DD_ENV || 'local'}`, ...tags],
      });
    }
    this.buckets.clear();
    const res = await fetch(`https://api.${this.site}/api/v2/series`, {
      method: 'POST',
      headers: {
        'DD-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ series }),
    });
    if (!res.ok) {
      logJson('warn', 'metrics flush rejected', { status: res.status });
    }
  }
}

module.exports = { Metrics };
