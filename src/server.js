'use strict';

// Initialize the tracer before any other require so instrumentation applies.
// Traces are exported via OTLP straight to Datadog's intake (no agent needed):
//   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.datadoghq.com (set on Render)
//   OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf (set on Render)
//   OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=<DD_API_KEY> (assembled below, so
//   the key itself only ever lives in the DD_API_KEY secret)
if (process.env.DD_TRACE_ENABLED !== 'false') {
  process.env.OTEL_EXPORTER_OTLP_HEADERS ||= `dd-api-key=${process.env.DD_API_KEY || ''}`;
  require('dd-trace').init({
    service: process.env.DD_SERVICE || 'checkout-api',
    env: process.env.DD_ENV || 'local',
    version: process.env.DD_VERSION || process.env.RENDER_GIT_COMMIT || 'local',
  });
}

const { createApp } = require('./app');
const { Metrics } = require('./metrics');
const { logJson } = require('./logger');

const port = Number(process.env.PORT || 3000);

const metrics = new Metrics({
  apiKey: process.env.DD_API_KEY,
  site: process.env.DD_SITE || 'datadoghq.com',
});
metrics.start();

const app = createApp({ metrics });
const server = app.listen(port, () => {
  logJson('info', 'checkout-api listening', {
    port,
    version: process.env.RENDER_GIT_COMMIT || process.env.DD_VERSION || 'local',
    agentless_traces: process.env.DD_TRACE_EXPERIMENTAL_EXPORTER || 'agent-default',
  });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

module.exports = server;
