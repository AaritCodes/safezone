'use strict';

function defaultKeyGenerator(req) {
  return String(req.ip || req.socket.remoteAddress || 'unknown');
}

function createRateLimitMiddleware(options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || 60000));
  const maxRequests = Math.max(1, Number(options.maxRequests || 120));
  const keyGenerator = typeof options.keyGenerator === 'function'
    ? options.keyGenerator
    : defaultKeyGenerator;
  const onLimit = typeof options.onLimit === 'function' ? options.onLimit : null;

  const store = new Map();
  let lastCleanupAt = 0;

  function cleanupExpired(now) {
    if (now - lastCleanupAt < windowMs && store.size < 10000) return;
    lastCleanupAt = now;

    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    cleanupExpired(now);

    const key = keyGenerator(req);
    const existing = store.get(key);

    let entry = existing;
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowMs
      };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(maxRequests - entry.count, 0);
    const resetInSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetInSeconds));

    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', String(resetInSeconds));

      if (onLimit) {
        onLimit({
          key,
          windowMs,
          maxRequests,
          retryAfterSeconds: resetInSeconds
        });
      }

      return res.status(429).json({
        status: 'error',
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please retry shortly.',
        retryAfterSeconds: resetInSeconds
      });
    }

    next();
  };
}

module.exports = {
  createRateLimitMiddleware
};
