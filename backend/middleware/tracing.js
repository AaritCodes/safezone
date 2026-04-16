'use strict';

const { randomBytes } = require('crypto');

const TRACEPARENT_PATTERN = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

function toLowerHex(value) {
  return String(value || '').trim().toLowerCase();
}

function generateTraceId() {
  return randomBytes(16).toString('hex');
}

function generateSpanId() {
  return randomBytes(8).toString('hex');
}

function parseTraceparent(headerValue) {
  const match = TRACEPARENT_PATTERN.exec(String(headerValue || '').trim());
  if (!match) return null;

  return {
    version: toLowerHex(match[1]),
    traceId: toLowerHex(match[2]),
    parentSpanId: toLowerHex(match[3]),
    traceFlags: toLowerHex(match[4])
  };
}

function buildTraceparent(traceId, spanId, traceFlags = '01') {
  return `00-${traceId}-${spanId}-${traceFlags}`;
}

function createTracingMiddleware(options = {}) {
  const enabled = options.enabled !== false;

  return function tracingMiddleware(req, res, next) {
    if (!enabled) {
      req.traceContext = null;
      return next();
    }

    const incoming = parseTraceparent(req.get('traceparent'));
    const traceId = incoming && incoming.traceId ? incoming.traceId : generateTraceId();
    const spanId = generateSpanId();
    const traceFlags = incoming && incoming.traceFlags ? incoming.traceFlags : '01';

    req.traceContext = {
      traceId,
      spanId,
      parentSpanId: incoming ? incoming.parentSpanId : null,
      traceFlags,
      startedAt: Date.now(),
      traceparent: buildTraceparent(traceId, spanId, traceFlags)
    };

    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('traceparent', req.traceContext.traceparent);

    next();
  };
}

module.exports = {
  createTracingMiddleware,
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  buildTraceparent
};
