'use strict';

// JSON-line logging with trace correlation. dd-trace can inject trace ids into
// supported loggers; here we attach the active span's ids by hand so every
// error line carries the exact trace a responder can open in Datadog.

function traceContext() {
  try {
    const tracer = require('dd-trace');
    const span = tracer.scope().active();
    if (span) {
      const context = span.context();
      return { trace_id: String(context.toTraceId()), span_id: String(context.toSpanId()) };
    }
  } catch {
    // tracer not initialized (unit tests, local runs)
  }
  return { trace_id: null, span_id: null };
}

function logJson(level, message, extra = {}) {
  const { trace_id, span_id } = traceContext();
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    service: process.env.DD_SERVICE || 'checkout-api',
    env: process.env.DD_ENV || 'local',
    version: process.env.RENDER_GIT_COMMIT || process.env.DD_VERSION || 'local',
    trace_id,
    span_id,
    ...extra,
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = { logJson };
