'use strict';

const crypto = require('crypto');

function extractApiKey(req) {
  const headerKey = String(req.get('x-api-key') || '').trim();
  if (headerKey) return headerKey;

  const authHeader = String(req.get('authorization') || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match && match[1]) {
    return String(match[1]).trim();
  }

  return '';
}

function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createApiKeyAuthMiddleware(options = {}) {
  const keys = Array.isArray(options.keys)
    ? options.keys.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const required = Boolean(options.required);
  const onReject = typeof options.onReject === 'function' ? options.onReject : null;
  const enabled = required || keys.length > 0;

  return function apiKeyAuth(req, res, next) {
    if (!enabled) return next();

    const key = extractApiKey(req);
    if (!key) {
      if (onReject) onReject('missing');
      return res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing API key. Provide x-api-key header or Bearer token.'
      });
    }

    const isAuthorized = keys.some((allowed) => constantTimeEqual(allowed, key));
    if (!isAuthorized) {
      if (onReject) onReject('invalid');
      return res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Invalid API key.'
      });
    }

    req.authenticated = true;
    next();
  };
}

function createTokenGuardMiddleware(expectedToken, options = {}) {
  const token = String(expectedToken || '').trim();
  const headerName = String(options.headerName || 'x-metrics-token').toLowerCase();
  const onReject = typeof options.onReject === 'function' ? options.onReject : null;

  if (!token) {
    return function allowWithoutToken(req, res, next) {
      next();
    };
  }

  return function tokenGuard(req, res, next) {
    const incoming = String(req.get(headerName) || '').trim();
    if (constantTimeEqual(incoming, token)) return next();

    if (onReject) onReject();
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: `Missing or invalid ${headerName} header.`
    });
  };
}

module.exports = {
  createApiKeyAuthMiddleware,
  createTokenGuardMiddleware,
  extractApiKey,
  constantTimeEqual
};
