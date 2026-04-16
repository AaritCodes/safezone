'use strict';

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(level) {
  const normalized = String(level || '').toLowerCase();
  return LEVEL_PRIORITY[normalized] ? normalized : 'info';
}

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};

  const sanitized = {};
  const keys = Object.keys(meta);

  for (const key of keys) {
    const value = meta[key];
    if (value === undefined) continue;
    sanitized[key] = value instanceof Error ? serializeError(value) : value;
  }

  return sanitized;
}

function createLogger(options = {}) {
  const level = normalizeLevel(options.level || 'info');
  const baseContext = options.context && typeof options.context === 'object'
    ? { ...options.context }
    : {};

  function shouldLog(candidateLevel) {
    return LEVEL_PRIORITY[normalizeLevel(candidateLevel)] >= LEVEL_PRIORITY[level];
  }

  function write(candidateLevel, message, meta = {}) {
    const finalLevel = normalizeLevel(candidateLevel);
    if (!shouldLog(finalLevel)) return;

    const payload = {
      timestamp: new Date().toISOString(),
      level: finalLevel,
      message: String(message || ''),
      ...baseContext,
      ...sanitizeMeta(meta)
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    level,
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child(extraContext = {}) {
      return createLogger({
        level,
        context: {
          ...baseContext,
          ...(extraContext && typeof extraContext === 'object' ? extraContext : {})
        }
      });
    }
  };
}

module.exports = {
  createLogger
};
