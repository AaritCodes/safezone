'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { readConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMetricsStore } = require('./metrics');
const { createApiKeyAuthMiddleware, createTokenGuardMiddleware } = require('./middleware/auth');
const { createRateLimitMiddleware } = require('./middleware/rate-limit');
const { createTracingMiddleware } = require('./middleware/tracing');
const {
  validateAnalyzePayload,
  validateCvSimulationPayload,
  validateRiskScorePayload,
  validateGovernanceLabelPayload
} = require('./validation');
const { simulateYolov8Scene } = require('./yolov8-sim');
const { analyzeCvScene } = require('./yolov8-inference');
const { createAlertManager } = require('./alerting');
const { createModelGovernance } = require('./model-governance');
const { scoreSafetyContext } = require('./risk-engine');

function buildCorsOptions(config) {
  const configuredOrigins = Array.isArray(config.cors.origins)
    ? config.cors.origins
    : [];
  const allowAll = configuredOrigins.includes('*');
  const normalizedConfigured = configuredOrigins
    .filter((origin) => origin !== '*')
    .map((origin) => origin.toLowerCase());

  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8787',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8787'
  ];

  function isAllowedOrigin(origin) {
    if (!origin) return true;
    const normalized = String(origin).toLowerCase();
    if (allowAll) return true;
    if (normalizedConfigured.length > 0) {
      return normalizedConfigured.includes(normalized);
    }
    return defaultDevOrigins.includes(normalized);
  }

  return {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by SafeZone CORS policy'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id', 'X-Metrics-Token'],
    maxAge: 600
  };
}

function createPayloadValidationMiddleware(validator, metrics) {
  return function validatePayload(req, res, next) {
    const result = validator(req.body);
    if (result.ok) {
      req.validatedPayload = result.value;
      return next();
    }

    metrics.noteValidationFailed();
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Request payload validation failed.',
      details: result.errors,
      requestId: req.requestId
    });
  };
}

function asyncHandler(handler) {
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function buildReadiness(config) {
  const checks = {
    authConfigured: !config.auth.required || config.auth.keys.length > 0,
    rateLimitConfigured: config.rateLimit.windowMs > 0 && config.rateLimit.maxRequests > 0,
    corsPolicyConfigured: config.nodeEnv !== 'production' || config.cors.origins.length > 0,
    memoryHealthy: process.memoryUsage().heapUsed < (process.memoryUsage().heapTotal * 0.92),
    cvProviderConfigured: config.cv.mode !== 'remote' || config.cv.endpoint.length > 0,
    alertingConfigured: !config.alerting.enabled || config.alerting.webhookUrl.length > 0,
    tracingConfigured: typeof config.tracing.enabled === 'boolean',
    governanceConfigured: !config.governance.enabled || config.governance.maxInferenceSamples > 0
  };

  const ok = Object.values(checks).every(Boolean);
  return {
    ok,
    checks,
    nodeEnv: config.nodeEnv,
    timestamp: new Date().toISOString()
  };
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function countServices(services) {
  const source = services && typeof services === 'object' ? services : {};
  const police = Array.isArray(source.police) ? source.police.length : 0;
  const hospital = Array.isArray(source.hospital) ? source.hospital.length : 0;
  const fire = Array.isArray(source.fire) ? source.fire.length : 0;
  return police + hospital + fire;
}

function buildGovernanceInferenceEvent(payload, inference, scoring, traceContext, defaultModelVersion) {
  const cv = inference && inference.cv && typeof inference.cv === 'object'
    ? inference.cv
    : {};
  const sceneRisk = cv.sceneRisk && typeof cv.sceneRisk === 'object'
    ? cv.sceneRisk
    : {};

  const safetyScore = Math.max(0, Math.min(100, toFiniteNumber(scoring && scoring.score, 50)));
  const riskProbability = Math.max(0, Math.min(1, (100 - safetyScore) / 100));

  const publicRisk = payload && payload.publicRisk && typeof payload.publicRisk === 'object'
    ? payload.publicRisk
    : {};

  return {
    timestamp: new Date().toISOString(),
    traceId: traceContext && traceContext.traceId ? traceContext.traceId : '',
    modelVersion: scoring && scoring.model
      ? String(scoring.model)
      : (cv.modelVersion ? String(cv.modelVersion) : String(defaultModelVersion || 'unknown')),
    sourceMode: inference && inference.sourceMode ? String(inference.sourceMode) : 'unknown',
    sceneRiskScore: toFiniteNumber(sceneRisk.score, 0),
    detectionCount: Array.isArray(cv.detections) ? cv.detections.length : 0,
    sceneConfidence: toFiniteNumber(sceneRisk.confidence, 0),
    predictionScore: Math.round((1 - riskProbability) * 100),
    predictedProbability: riskProbability,
    inferenceLatencyMs: toFiniteNumber(inference && inference.inferenceLatencyMs, 0),
    inputSummary: {
      hour: toFiniteNumber(payload && payload.hour, new Date().getHours()),
      areaType: payload && payload.areaInfo && payload.areaInfo.type ? String(payload.areaInfo.type) : 'unknown',
      areaCategory: payload && payload.areaInfo && payload.areaInfo.category ? String(payload.areaInfo.category) : 'unknown',
      serviceCount: countServices(payload && payload.services),
      cameraCount: Array.isArray(payload && payload.cameras) ? payload.cameras.length : 0,
      publicRiskSignals: toFiniteNumber(publicRisk.theftCount, 0) +
        toFiniteNumber(publicRisk.violentCount, 0) +
        toFiniteNumber(publicRisk.accidentHotspots, 0) +
        toFiniteNumber(publicRisk.conflictPoints, 0)
    }
  };
}

function createApp(runtime = {}) {
  const config = runtime.config || readConfig();
  const logger = runtime.logger || createLogger({
    level: config.logLevel,
    context: {
      service: 'safezone-backend'
    }
  });
  const metrics = runtime.metrics || createMetricsStore();
  const alerting = runtime.alerting || createAlertManager(config.alerting, logger.child({ component: 'alerting' }));
  const governance = runtime.governance || createModelGovernance(config.governance, logger.child({ component: 'governance' }));

  const app = express();
  const staticRoot = path.resolve(__dirname, '..');

  const rateLimitMiddleware = createRateLimitMiddleware({
    windowMs: config.rateLimit.windowMs,
    maxRequests: config.rateLimit.maxRequests,
    onLimit: (details) => {
      metrics.noteRateLimited();
      logger.warn('rate_limit.triggered', details);
    }
  });
  const authMiddleware = createApiKeyAuthMiddleware({
    required: config.auth.required,
    keys: config.auth.keys,
    onReject: () => {
      metrics.noteAuthRejected();
    }
  });
  const metricsGuard = createTokenGuardMiddleware(config.metrics.token, {
    headerName: 'x-metrics-token',
    onReject: () => {
      metrics.noteAuthRejected();
    }
  });

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false
  }));
  app.use(cors(buildCorsOptions(config)));
  app.use(express.json({ limit: config.bodyLimit || '1mb' }));
  app.use(createTracingMiddleware({ enabled: config.tracing.enabled }));

  app.use((req, res, next) => {
    const incomingRequestId = String(req.get('x-request-id') || '').trim();
    req.requestId = incomingRequestId || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);

    const traceId = req.traceContext && req.traceContext.traceId
      ? req.traceContext.traceId
      : undefined;

    const requestLogger = logger.child({
      requestId: req.requestId,
      traceId
    });
    req.log = requestLogger;

    const startedAt = process.hrtime.bigint();

    requestLogger.info('request.start', {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip || req.socket.remoteAddress,
      traceparent: req.traceContext && req.traceContext.traceparent
    });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
      const fallbackPath = `${req.baseUrl || ''}${req.path || ''}`;
      const routePath = req.route && req.route.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : (fallbackPath || req.originalUrl || 'unmatched');

      metrics.recordRequest({
        method: req.method,
        route: routePath,
        statusCode: res.statusCode,
        durationMs
      });

      const level = res.statusCode >= 500
        ? 'error'
        : res.statusCode >= 400
          ? 'warn'
          : 'info';

      requestLogger[level]('request.complete', {
        method: req.method,
        path: req.originalUrl,
        route: routePath,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: req.ip || req.socket.remoteAddress
      });

      if (alerting && typeof alerting.observeRequest === 'function') {
        Promise.resolve(alerting.observeRequest({
          statusCode: res.statusCode,
          durationMs,
          route: routePath
        })).catch((error) => {
          requestLogger.error('alerting.observe_failed', { error });
        });
      }
    });

    next();
  });

  app.use('/api', rateLimitMiddleware);
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/readiness' || req.path === '/metrics') {
      return next();
    }
    return authMiddleware(req, res, next);
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'safezone-backend',
      version: '1.0.0',
      env: config.nodeEnv,
      cvMode: config.cv.mode,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/readiness', (req, res) => {
    const readiness = buildReadiness(config);
    const statusCode = readiness.ok ? 200 : 503;
    res.status(statusCode).json({
      status: readiness.ok ? 'ok' : 'not_ready',
      service: 'safezone-backend',
      checks: readiness.checks,
      cvMode: config.cv.mode,
      timestamp: readiness.timestamp,
      requestId: req.requestId
    });
  });

  app.get('/api/metrics', metricsGuard, (req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.toPrometheus());
  });

  app.post('/api/cv/yolov8/simulate', createPayloadValidationMiddleware(validateCvSimulationPayload, metrics), (req, res) => {
    const payload = req.validatedPayload;
    const cv = simulateYolov8Scene(payload);

    res.json({
      status: 'ok',
      cv,
      generatedAt: new Date().toISOString(),
      requestId: req.requestId
    });
  });

  app.post('/api/risk/score', createPayloadValidationMiddleware(validateRiskScorePayload, metrics), (req, res) => {
    const payload = req.validatedPayload;
    const scoring = scoreSafetyContext(payload);

    res.json({
      status: 'ok',
      scoring,
      generatedAt: new Date().toISOString(),
      requestId: req.requestId
    });
  });

  app.get('/api/ops/alerts', (req, res) => {
    res.json({
      status: 'ok',
      alerting: alerting.getStatus(),
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  });

  app.get('/api/ops/slo', (req, res) => {
    const alertStatus = alerting.getStatus();
    const availability = Number((1 - alertStatus.windowStats.errorRate).toFixed(5));

    res.json({
      status: 'ok',
      slo: {
        windowMs: alertStatus.config.windowMs,
        minRequestCount: alertStatus.config.minRequestCount,
        errorRate: alertStatus.windowStats.errorRate,
        availability,
        p95LatencyMs: alertStatus.windowStats.p95LatencyMs,
        targetAvailability: 0.995,
        targetP95LatencyMs: config.alerting.p95LatencyMsThreshold
      },
      metrics: metrics.snapshot(),
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  });

  app.get('/api/governance/report', (req, res) => {
    const report = governance.getReport();

    if (alerting && typeof alerting.observeGovernance === 'function') {
      Promise.resolve(alerting.observeGovernance(report)).catch((error) => {
        req.log.error('governance.alert_observation_failed', { error });
      });
    }

    res.json({
      status: 'ok',
      report,
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  });

  app.get('/api/governance/manifest', (req, res) => {
    res.json({
      status: 'ok',
      manifest: governance.getManifest(),
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  });

  app.post('/api/governance/labels', createPayloadValidationMiddleware(validateGovernanceLabelPayload, metrics), (req, res) => {
    const payload = req.validatedPayload;
    const result = governance.recordGroundTruth(payload);
    metrics.noteGovernanceLabel(Boolean(result && result.accepted));
    const statusCode = result.accepted ? 202 : 503;

    res.status(statusCode).json({
      status: result.accepted ? 'accepted' : 'error',
      result,
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  });

  app.post('/api/safety/analyze', createPayloadValidationMiddleware(validateAnalyzePayload, metrics), asyncHandler(async (req, res) => {
    const payload = req.validatedPayload;
    const inference = await analyzeCvScene(payload, {
      config: config.cv,
      logger: req.log || logger,
      traceContext: req.traceContext
    });

    const cv = inference.cv;
    const scoring = scoreSafetyContext({
      ...payload,
      cv
    });

    const governanceEvent = buildGovernanceInferenceEvent(payload, inference, scoring, req.traceContext, config.cv.modelVersion);
    const governanceIngestion = governance.recordInference(governanceEvent);

    if (governanceIngestion && typeof governanceIngestion.accepted === 'boolean') {
      metrics.noteGovernanceInference(governanceIngestion.accepted);

      if (!governanceIngestion.accepted) {
        (req.log || logger).warn('governance.inference_not_ingested', {
          reasons: governanceIngestion.reasons,
          missingFields: governanceIngestion.missingFields,
          nullRate: governanceIngestion.nullRate
        });
      }
    }

    res.json({
      status: 'ok',
      version: '1.0.0',
      cv,
      scoring,
      recommendations: Array.isArray(scoring.recommendations) ? scoring.recommendations : [],
      inference: {
        mode: inference.sourceMode,
        degraded: Boolean(inference.degraded),
        fallbackReason: inference.fallbackReason,
        latencyMs: inference.inferenceLatencyMs,
        modelVersion: cv && cv.modelVersion ? cv.modelVersion : config.cv.modelVersion
      },
      governance: governanceIngestion && typeof governanceIngestion.accepted === 'boolean'
        ? {
            ingested: governanceIngestion.accepted,
            reasons: Array.isArray(governanceIngestion.reasons) ? governanceIngestion.reasons : [],
            nullRate: Number(governanceIngestion.nullRate || 0)
          }
        : {
            ingested: false,
            reasons: ['governance_disabled_or_unavailable'],
            nullRate: 0
          },
      generatedAt: new Date().toISOString(),
      requestId: req.requestId,
      traceId: req.traceContext && req.traceContext.traceId
    });
  }));

  app.use(express.static(staticRoot, {
    extensions: ['html'],
    index: 'index.html'
  }));

  app.get('*', (req, res) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });

  app.use((err, req, res, next) => {
    metrics.noteInternalError();
    const requestId = req && req.requestId ? req.requestId : randomUUID();
    const requestLogger = req && req.log ? req.log : logger.child({ requestId });

    requestLogger.error('request.failed', {
      method: req && req.method,
      path: req && req.originalUrl,
      error: err
    });

    res.status(500).json({
      status: 'error',
      code: 'BACKEND_INTERNAL_ERROR',
      message: 'SafeZone backend failed to process the request.',
      requestId,
      traceId: req && req.traceContext && req.traceContext.traceId
    });
  });

  app.locals.config = config;
  app.locals.metrics = metrics;
  app.locals.logger = logger;
  app.locals.alerting = alerting;
  app.locals.governance = governance;

  return app;
}

function start(runtime = {}) {
  const config = runtime.config || readConfig();
  const logger = runtime.logger || createLogger({
    level: config.logLevel,
    context: {
      service: 'safezone-backend'
    }
  });

  const app = createApp({
    ...runtime,
    config,
    logger
  });

  const server = app.listen(config.port, () => {
    logger.info('server.started', {
      url: `http://localhost:${config.port}`,
      env: config.nodeEnv,
      authRequired: config.auth.required || config.auth.keys.length > 0,
      corsOrigins: config.cors.origins.length > 0 ? config.cors.origins : ['dev-defaults'],
      tracingEnabled: config.tracing.enabled,
      cvMode: config.cv.mode,
      governanceEnabled: config.governance.enabled,
      alertingEnabled: config.alerting.enabled
    });
  });

  return {
    app,
    server,
    config
  };
}

if (require.main === module) {
  const runtime = start();
  const { server } = runtime;
  const logger = runtime.app.locals.logger;

  function shutdown(signal) {
    logger.info('server.shutdown.requested', { signal });

    server.close(() => {
      logger.info('server.shutdown.complete', { signal });
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('server.shutdown.timeout', { signal });
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
  createApp,
  start,
  buildCorsOptions,
  createPayloadValidationMiddleware,
  buildReadiness
};
