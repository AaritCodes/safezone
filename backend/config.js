'use strict';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readConfig() {
  const authKeys = parseList(process.env.SAFEZONE_API_KEYS);
  const authRequired = parseBoolean(
    process.env.SAFEZONE_AUTH_REQUIRED,
    process.env.NODE_ENV === 'production'
  );

  const cvModeInput = String(process.env.SAFEZONE_CV_MODE || 'auto').trim().toLowerCase();
  const cvMode = ['auto', 'remote', 'simulation'].includes(cvModeInput)
    ? cvModeInput
    : 'auto';

  const metricsToken = String(process.env.SAFEZONE_METRICS_TOKEN || '').trim();

  return {
    port: parseInteger(process.env.PORT, 8787, 1, 65535),
    nodeEnv: String(process.env.NODE_ENV || 'development'),
    logLevel: String(process.env.SAFEZONE_LOG_LEVEL || 'info').trim().toLowerCase(),
    bodyLimit: String(process.env.SAFEZONE_BODY_LIMIT || '1mb').trim(),
    trustProxy: parseBoolean(process.env.SAFEZONE_TRUST_PROXY, false),
    auth: {
      required: authRequired,
      keys: authKeys
    },
    cors: {
      origins: parseList(process.env.SAFEZONE_CORS_ORIGINS)
    },
    rateLimit: {
      windowMs: parseInteger(process.env.SAFEZONE_RATE_LIMIT_WINDOW_MS, 60000, 1000, 3600000),
      maxRequests: parseInteger(process.env.SAFEZONE_RATE_LIMIT_MAX_REQUESTS, 120, 1, 100000)
    },
    metrics: {
      token: metricsToken,
      requireToken: metricsToken.length > 0
    },
    tracing: {
      enabled: parseBoolean(process.env.SAFEZONE_TRACING_ENABLED, true)
    },
    cv: {
      mode: cvMode,
      endpoint: String(process.env.SAFEZONE_CV_ENDPOINT || '').trim(),
      apiKey: String(process.env.SAFEZONE_CV_API_KEY || '').trim(),
      timeoutMs: parseInteger(process.env.SAFEZONE_CV_TIMEOUT_MS, 2500, 250, 30000),
      fallbackToSimulation: parseBoolean(process.env.SAFEZONE_CV_FALLBACK_TO_SIMULATION, true),
      modelVersion: String(process.env.SAFEZONE_CV_MODEL_VERSION || 'yolov8-sim-v1').trim()
    },
    alerting: {
      enabled: parseBoolean(process.env.SAFEZONE_ALERTING_ENABLED, false),
      webhookUrl: String(process.env.SAFEZONE_ALERTING_WEBHOOK_URL || '').trim(),
      authToken: String(process.env.SAFEZONE_ALERTING_AUTH_TOKEN || '').trim(),
      windowMs: parseInteger(process.env.SAFEZONE_ALERTING_WINDOW_MS, 60000, 5000, 600000),
      minRequestCount: parseInteger(process.env.SAFEZONE_ALERTING_MIN_REQUEST_COUNT, 20, 1, 100000),
      errorRateThreshold: parseNumber(process.env.SAFEZONE_ALERTING_ERROR_RATE_THRESHOLD, 0.05, 0.001, 1),
      p95LatencyMsThreshold: parseInteger(process.env.SAFEZONE_ALERTING_P95_LATENCY_MS_THRESHOLD, 800, 50, 120000),
      cooldownMs: parseInteger(process.env.SAFEZONE_ALERTING_COOLDOWN_MS, 300000, 5000, 3600000),
      governanceEnabled: parseBoolean(process.env.SAFEZONE_ALERTING_GOVERNANCE_ENABLED, true),
      governanceCooldownMs: parseInteger(process.env.SAFEZONE_ALERTING_GOVERNANCE_COOLDOWN_MS, 900000, 5000, 3600000)
    },
    governance: {
      enabled: parseBoolean(process.env.SAFEZONE_GOVERNANCE_ENABLED, true),
      driftPsiThreshold: parseNumber(process.env.SAFEZONE_GOVERNANCE_PSI_THRESHOLD, 0.2, 0.05, 1),
      minSamplesForDrift: parseInteger(process.env.SAFEZONE_GOVERNANCE_MIN_DRIFT_SAMPLES, 100, 10, 1000000),
      calibrationBrierThreshold: parseNumber(process.env.SAFEZONE_GOVERNANCE_BRIER_THRESHOLD, 0.22, 0.01, 1),
      minLabelsForCalibration: parseInteger(process.env.SAFEZONE_GOVERNANCE_MIN_LABELS, 50, 5, 100000),
      maxInferenceSamples: parseInteger(process.env.SAFEZONE_GOVERNANCE_MAX_INFERENCE_SAMPLES, 5000, 100, 1000000),
      maxLabelSamples: parseInteger(process.env.SAFEZONE_GOVERNANCE_MAX_LABEL_SAMPLES, 2000, 50, 500000),
      staleInferenceHours: parseInteger(process.env.SAFEZONE_GOVERNANCE_STALE_INFERENCE_HOURS, 24, 1, 720),
      staleLabelHours: parseInteger(process.env.SAFEZONE_GOVERNANCE_STALE_LABEL_HOURS, 336, 1, 4320),
      maxNullRate: parseNumber(process.env.SAFEZONE_GOVERNANCE_MAX_NULL_RATE, 0.35, 0, 1),
      maxHistoryDays: parseInteger(process.env.SAFEZONE_GOVERNANCE_MAX_HISTORY_DAYS, 180, 7, 2000),
      historyEnabled: parseBoolean(process.env.SAFEZONE_GOVERNANCE_HISTORY_ENABLED, true),
      historyFileName: String(process.env.SAFEZONE_GOVERNANCE_HISTORY_FILE || 'governance-history.json').trim(),
      baselineFileName: String(process.env.SAFEZONE_GOVERNANCE_BASELINE_FILE || 'default-baseline.json').trim(),
      manifestFileName: String(process.env.SAFEZONE_GOVERNANCE_MANIFEST_FILE || 'model-manifest.json').trim(),
      calibrationBinCount: parseInteger(process.env.SAFEZONE_GOVERNANCE_CALIBRATION_BINS, 10, 5, 20),
      minLabelsForDiscrimination: parseInteger(process.env.SAFEZONE_GOVERNANCE_MIN_LABELS_FOR_AUC, 50, 5, 100000)
    }
  };
}

module.exports = {
  readConfig,
  parseBoolean,
  parseInteger,
  parseNumber,
  parseList
};
