'use strict';

const { simulateYolov8Scene } = require('./yolov8-sim');

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function normalizeDetection(item, index) {
  const detection = item && typeof item === 'object' ? item : {};
  const label = String(detection.label || detection.class || 'unknown').trim() || 'unknown';
  const confidence = clamp(Number(detection.confidence || detection.score || 0.5), 0, 1);
  const bbox = Array.isArray(detection.bbox) && detection.bbox.length === 4
    ? detection.bbox.map((value) => clamp(Number(value || 0), 0, 1))
    : [0, 0, 0.05, 0.05];

  return {
    trackingId: String(detection.trackingId || detection.id || `${label}-${index + 1}`),
    label,
    confidence: Number(confidence.toFixed(3)),
    bbox,
    attributes: detection.attributes && typeof detection.attributes === 'object' ? detection.attributes : {},
    severity: Number(clamp(Number(detection.severity || 0.2), 0, 1).toFixed(3))
  };
}

function normalizeRemoteCv(remoteResponse, fallbackModelVersion = 'yolov8-remote') {
  const root = remoteResponse && typeof remoteResponse === 'object'
    ? remoteResponse
    : {};

  const cv = root.cv && typeof root.cv === 'object'
    ? root.cv
    : root;

  const sceneRisk = cv.sceneRisk && typeof cv.sceneRisk === 'object'
    ? cv.sceneRisk
    : {};

  const detectionsRaw = Array.isArray(cv.detections)
    ? cv.detections
    : [];

  const detections = detectionsRaw.slice(0, 500).map((item, index) => normalizeDetection(item, index));

  const objectCounts = detections.reduce((acc, item) => {
    const key = item.label;
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    provider: String(cv.provider || 'yolov8-remote'),
    modelVersion: String(cv.modelVersion || root.modelVersion || fallbackModelVersion),
    frameId: String(cv.frameId || root.frameId || `frame-${Date.now()}`),
    detections,
    sceneRisk: {
      score: Math.round(clamp(Number(sceneRisk.score || 0), 0, 100)),
      level: String(sceneRisk.level || 'low'),
      confidence: Number(clamp(Number(sceneRisk.confidence || 0.5), 0, 1).toFixed(3)),
      objectCounts,
      signals: Array.isArray(sceneRisk.signals)
        ? sceneRisk.signals.slice(0, 10).map((item) => String(item || '').trim()).filter(Boolean)
        : []
    }
  };
}

async function invokeRemoteInference(payload, config, traceContext) {
  const endpoint = String(config.endpoint || '').trim();
  if (!endpoint) {
    throw new Error('SAFEZONE_CV_ENDPOINT is not configured for remote inference mode');
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${String(config.apiKey).trim()}`;
  }

  if (traceContext && traceContext.traceId) {
    headers['X-Trace-Id'] = traceContext.traceId;
  }

  if (traceContext && traceContext.traceparent) {
    headers.traceparent = traceContext.traceparent;
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(250, Number(config.timeoutMs || 2500));
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        request: payload,
        timestamp: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Remote CV inference returned status ${response.status}`);
    }

    const json = await response.json();
    return normalizeRemoteCv(json, config.modelVersion || 'yolov8-remote');
  } finally {
    clearTimeout(timeoutId);
  }
}

function inferEffectiveMode(config) {
  const mode = String(config.mode || 'auto').trim().toLowerCase();
  if (mode === 'simulation' || mode === 'remote') return mode;
  return config.endpoint ? 'remote' : 'simulation';
}

async function analyzeCvScene(payload, runtime = {}) {
  const config = runtime.config && typeof runtime.config === 'object'
    ? runtime.config
    : {};
  const logger = runtime.logger;
  const traceContext = runtime.traceContext;
  const governance = runtime.governance;

  const effectiveMode = inferEffectiveMode(config);
  const startedAt = Date.now();

  async function useSimulation(fallbackReason) {
    const cv = simulateYolov8Scene(payload || {});
    cv.modelVersion = String(config.modelVersion || 'yolov8-sim-v1');

    return {
      cv,
      sourceMode: 'simulation',
      degraded: Boolean(fallbackReason),
      fallbackReason: fallbackReason || null,
      inferenceLatencyMs: Date.now() - startedAt
    };
  }

  try {
    if (effectiveMode === 'simulation') {
      const result = await useSimulation(null);
      if (governance && typeof governance.recordInference === 'function') {
        governance.recordInference({
          traceId: traceContext && traceContext.traceId,
          modelVersion: result.cv.modelVersion,
          sourceMode: result.sourceMode,
          sceneRiskScore: result.cv.sceneRisk && result.cv.sceneRisk.score,
          detectionCount: Array.isArray(result.cv.detections) ? result.cv.detections.length : 0,
          sceneConfidence: result.cv.sceneRisk && result.cv.sceneRisk.confidence
        });
      }
      return result;
    }

    const remoteCv = await invokeRemoteInference(payload, config, traceContext);
    const result = {
      cv: remoteCv,
      sourceMode: 'remote',
      degraded: false,
      fallbackReason: null,
      inferenceLatencyMs: Date.now() - startedAt
    };

    if (governance && typeof governance.recordInference === 'function') {
      governance.recordInference({
        traceId: traceContext && traceContext.traceId,
        modelVersion: remoteCv.modelVersion,
        sourceMode: result.sourceMode,
        sceneRiskScore: remoteCv.sceneRisk && remoteCv.sceneRisk.score,
        detectionCount: Array.isArray(remoteCv.detections) ? remoteCv.detections.length : 0,
        sceneConfidence: remoteCv.sceneRisk && remoteCv.sceneRisk.confidence
      });
    }

    return result;
  } catch (err) {
    if (logger && typeof logger.error === 'function') {
      logger.error('cv.inference_failed', {
        mode: effectiveMode,
        error: err
      });
    }

    if (config.fallbackToSimulation !== false) {
      const fallback = await useSimulation(err && err.message ? err.message : 'remote_inference_failed');
      if (logger && typeof logger.warn === 'function') {
        logger.warn('cv.fallback_to_simulation', {
          reason: fallback.fallbackReason
        });
      }

      if (governance && typeof governance.recordInference === 'function') {
        governance.recordInference({
          traceId: traceContext && traceContext.traceId,
          modelVersion: fallback.cv.modelVersion,
          sourceMode: fallback.sourceMode,
          sceneRiskScore: fallback.cv.sceneRisk && fallback.cv.sceneRisk.score,
          detectionCount: Array.isArray(fallback.cv.detections) ? fallback.cv.detections.length : 0,
          sceneConfidence: fallback.cv.sceneRisk && fallback.cv.sceneRisk.confidence
        });
      }

      return fallback;
    }

    throw err;
  }
}

module.exports = {
  analyzeCvScene,
  normalizeRemoteCv,
  inferEffectiveMode,
  invokeRemoteInference
};
