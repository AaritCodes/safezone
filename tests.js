/**
 * SafeZone Production Tests
 * These tests validate behavior of the shipped logic in data.js and sw.js.
 */

const {
  getDistanceDecayWeight,
  normalizeAndRankHotspots,
  getCrimeSignalReliability,
  trainRiskModel,
  calculateSafetyScore,
  optimizeRouteAlternatives,
  getGoogleApiKey,
  hasGoogleApiKey,
  getBackendApiKey
} = require('./data.js');

const {
  CACHE_NAME,
  isSafeCacheableResponse,
  isCacheableShellRequest
} = require('./sw.js');

const {
  simulateYolov8Scene
} = require('./backend/yolov8-sim.js');

const {
  scoreSafetyContext
} = require('./backend/risk-engine.js');

const {
  analyzeCvScene,
  inferEffectiveMode
} = require('./backend/yolov8-inference.js');

const {
  parseTraceparent,
  buildTraceparent
} = require('./backend/middleware/tracing.js');

const {
  createModelGovernance
} = require('./backend/model-governance.js');

const {
  createAlertManager
} = require('./backend/alerting.js');

describe('SafeZone Production Logic', () => {
  describe('Risk Core: getDistanceDecayWeight', () => {
    test('returns full weight near source and floor at far distances', () => {
      expect(getDistanceDecayWeight(0)).toBe(1);
      expect(getDistanceDecayWeight(180)).toBe(1);
      expect(getDistanceDecayWeight(2600)).toBe(0.14);
      expect(getDistanceDecayWeight(6400)).toBe(0.14);
    });

    test('decreases monotonically from near to far', () => {
      const near = getDistanceDecayWeight(400);
      const mid = getDistanceDecayWeight(1200);
      const far = getDistanceDecayWeight(2200);

      expect(near).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(far);
    });
  });

  describe('Risk Core: normalizeAndRankHotspots', () => {
    test('deduplicates by grid and keeps highest severity candidate', () => {
      const hotspots = [
        { lat: 12.9716, lng: 77.5946, type: 'theft', title: 'Low', source: 'feed', severity: 1.1 },
        { lat: 12.9716, lng: 77.5946, type: 'theft', title: 'High', source: 'feed', severity: 2.8 },
        { lat: 12.9732, lng: 77.5961, type: 'violent', title: 'Separate', source: 'feed', severity: 1.7 }
      ];

      const result = normalizeAndRankHotspots(hotspots, 12.9716, 77.5946, 10);
      expect(result.length).toBe(2);
      expect(result[0].title).toBe('High');
    });

    test('returns bounded list based on limit', () => {
      const hotspots = Array.from({ length: 30 }, (_, i) => ({
        lat: 12.8 + i * 0.01,
        lng: 77.2 + i * 0.01,
        type: 'accident',
        title: `Hotspot ${i}`,
        source: 'feed',
        severity: 1.2
      }));

      const result = normalizeAndRankHotspots(hotspots, 12.9, 77.3, 7);
      expect(result.length).toBeLessThanOrEqual(7);
    });
  });

  describe('Risk Core: reliability and model training', () => {
    test('official police feeds score higher reliability than proxy/model sources', () => {
      const indiaPolice = getCrimeSignalReliability({ source: 'india-police-data', total: 70, coverage: 1 });
      const proxy = getCrimeSignalReliability({ source: 'osm-civic-risk-proxy', total: 40, coverage: 1 });
      const model = getCrimeSignalReliability({ source: 'model-derived-risk-proxy', total: 10, coverage: 0.2 });

      expect(indiaPolice).toBeGreaterThan(proxy);
      expect(proxy).toBeGreaterThan(model);
    });

    test('trainRiskModel increases penalty with stronger reliability for same signals', () => {
      const crimeData = { theftCount: 9, violentCount: 3 };
      const accidentData = { weightedRisk: 4.5, hazardCount: 2, signalCount: 5 };

      const low = trainRiskModel(crimeData, accidentData, 0.3);
      const high = trainRiskModel(crimeData, accidentData, 0.9);

      expect(high.penalty).toBeGreaterThan(low.penalty);
      expect(high.reliability).toBeGreaterThan(low.reliability);
    });
  });

  describe('Scoring and route optimization integration', () => {
    test('calculateSafetyScore applies risk penalty and clamps range', () => {
      const services = {
        police: [{ distance: 180 }],
        hospital: [{ distance: 300 }],
        fire: [{ distance: 700 }]
      };
      const cameras = [{ status: 'active' }, { status: 'active' }, { status: 'active' }];
      const areaInfo = { type: 'residential', category: 'residential' };

      const withoutRisk = calculateSafetyScore(13, services, cameras, areaInfo, null).score;
      const withRisk = calculateSafetyScore(13, services, cameras, areaInfo, { penalty: 20, confidence: 'high' }).score;

      expect(withoutRisk).toBeGreaterThan(withRisk);
      expect(withoutRisk).toBeGreaterThanOrEqual(0);
      expect(withoutRisk).toBeLessThanOrEqual(100);
      expect(withRisk).toBeGreaterThanOrEqual(0);
      expect(withRisk).toBeLessThanOrEqual(100);
    });

    test('safest mode prefers lower exposure route while fastest prefers lower ETA route', () => {
      const alternatives = [
        {
          id: 'route_a',
          label: 'Route A',
          distance: 4200,
          duration: 540,
          path: [[12.9716, 77.5946], [12.978, 77.602]],
          steps: [{}, {}, {}, {}, {}, {}, {}]
        },
        {
          id: 'route_b',
          label: 'Route B',
          distance: 4700,
          duration: 700,
          path: [[12.94, 77.54], [12.948, 77.548]],
          steps: [{}, {}]
        }
      ];

      const riskData = {
        penalty: 18,
        confidence: 'high',
        accidentHotspots: 3,
        conflictPoints: 4,
        hotspots: [
          { lat: 12.9716, lng: 77.5946, type: 'violent', source: 'feed', title: 'Critical point' }
        ]
      };

      const safest = optimizeRouteAlternatives(alternatives, 'safest', 'driving', { hour: 22, riskData, edgeAiScore: 25 });
      const fastest = optimizeRouteAlternatives(alternatives, 'fastest', 'driving', { hour: 22, riskData, edgeAiScore: 25 });

      expect(safest.selectedRouteId).toBe('route_b');
      expect(fastest.selectedRouteId).toBe('route_a');
    });
  });

  describe('Security behavior: service worker cache guards', () => {
    beforeEach(() => {
      globalThis.self = { location: { origin: 'https://safezone.test' } };
    });

    afterEach(() => {
      delete globalThis.self;
    });

    test('uses current cache namespace version', () => {
      expect(CACHE_NAME).toMatch(/^safezone-shell-v\d+$/);
    });

    test('only basic successful responses are cacheable', () => {
      expect(isSafeCacheableResponse({ ok: true, type: 'basic' })).toBe(true);
      expect(isSafeCacheableResponse({ ok: true, type: 'opaque' })).toBe(false);
      expect(isSafeCacheableResponse({ ok: false, type: 'basic' })).toBe(false);
    });

    test('blocks querystring runtime requests from shell cache', () => {
      const request = { method: 'GET', mode: 'same-origin' };
      const requestUrl = new URL('https://safezone.test/app.js?cacheBust=1');
      expect(isCacheableShellRequest(request, requestUrl)).toBe(false);
    });

    test('permits same-origin navigation and denies cross-origin fetches', () => {
      const navRequest = { method: 'GET', mode: 'navigate' };
      const sameOrigin = new URL('https://safezone.test/index.html');
      const crossOrigin = new URL('https://example.com/index.html');

      expect(isCacheableShellRequest(navRequest, sameOrigin)).toBe(true);
      expect(isCacheableShellRequest(navRequest, crossOrigin)).toBe(false);
    });
  });

  describe('Security behavior: Google key handling', () => {
    afterEach(() => {
      delete global.window;
      delete global.document;
    });

    test('does not report Google API key availability by default', () => {
      expect(hasGoogleApiKey()).toBe(false);
    });

    test('accepts a valid SAFEZONE_GOOGLE_API_KEY from window', () => {
      global.window = { SAFEZONE_GOOGLE_API_KEY: 'safezone_google_key_valid_1234567890AB' };
      expect(getGoogleApiKey()).toBe('safezone_google_key_valid_1234567890AB');
      expect(hasGoogleApiKey()).toBe(true);
    });

    test('rejects malformed keys from window', () => {
      global.window = { SAFEZONE_GOOGLE_API_KEY: 'safezone_google_key<script>alert(1)</script>' };
      expect(getGoogleApiKey()).toBe('');
      expect(hasGoogleApiKey()).toBe(false);
    });

    test('falls back to meta tag when window key is missing', () => {
      global.window = {};
      global.document = {
        querySelector: jest.fn(() => ({
          getAttribute: jest.fn(() => 'safezone_google_meta_key_1234567890CD')
        }))
      };

      expect(getGoogleApiKey()).toBe('safezone_google_meta_key_1234567890CD');
      expect(hasGoogleApiKey()).toBe(true);
    });

    test('ignores placeholder-looking keys in meta tags', () => {
      global.window = {};
      global.document = {
        querySelector: jest.fn(() => ({
          getAttribute: jest.fn(() => 'YOUR_GOOGLE_API_KEY')
        }))
      };

      expect(getGoogleApiKey()).toBe('');
      expect(hasGoogleApiKey()).toBe(false);
    });
  });

  describe('Security behavior: backend key handling', () => {
    afterEach(() => {
      delete global.window;
      delete global.document;
    });

    test('does not report backend API key by default', () => {
      expect(getBackendApiKey()).toBe('');
    });

    test('accepts valid SAFEZONE_BACKEND_API_KEY from window', () => {
      global.window = { SAFEZONE_BACKEND_API_KEY: 'safezone_backend_key_1234567890' };
      expect(getBackendApiKey()).toBe('safezone_backend_key_1234567890');
    });

    test('rejects malformed backend key from window', () => {
      global.window = { SAFEZONE_BACKEND_API_KEY: 'key<script>alert(1)</script>' };
      expect(getBackendApiKey()).toBe('');
    });

    test('falls back to backend key meta tag', () => {
      global.window = {};
      global.document = {
        querySelector: jest.fn((selector) => {
          if (selector === 'meta[name="safezone-backend-api-key"]') {
            return {
              getAttribute: jest.fn(() => 'safezone_backend_meta_0987654321')
            };
          }
          return null;
        })
      };

      expect(getBackendApiKey()).toBe('safezone_backend_meta_0987654321');
    });
  });

  describe('Backend product-grade scoring', () => {
    test('YOLOv8 simulation is deterministic for same scene input', () => {
      const input = {
        lat: 12.9716,
        lng: 77.5946,
        hour: 22,
        areaInfo: { type: 'commercial', category: 'market' },
        services: {
          police: [{ distance: 640 }],
          hospital: [{ distance: 880 }],
          fire: [{ distance: 1200 }]
        },
        cameras: [
          { status: 'active', coverage: 130, distance: 180 },
          { status: 'active', coverage: 120, distance: 260 }
        ],
        publicRisk: {
          theftCount: 6,
          violentCount: 2,
          accidentHotspots: 3,
          conflictPoints: 4,
          reliabilityScore: 78,
          confidence: 'high'
        }
      };

      const first = simulateYolov8Scene(input);
      const second = simulateYolov8Scene(input);

      expect(first.frameId).toBe(second.frameId);
      expect(first.sceneRisk.score).toBe(second.sceneRisk.score);
      expect(first.detections.length).toBe(second.detections.length);
    });

    test('risk engine penalizes severe public+cv context more than protected context', () => {
      const protectedContext = {
        hour: 11,
        services: {
          police: [{ distance: 220 }],
          hospital: [{ distance: 380 }],
          fire: [{ distance: 600 }]
        },
        cameras: [
          { status: 'active', coverage: 160 },
          { status: 'active', coverage: 140 },
          { status: 'active', coverage: 120 }
        ],
        publicRisk: {
          theftCount: 0,
          violentCount: 0,
          accidentHotspots: 1,
          conflictPoints: 1,
          reliabilityScore: 84,
          confidence: 'high'
        },
        cv: {
          provider: 'yolov8-sim-coco',
          detections: [{}, {}, {}],
          sceneRisk: {
            score: 18,
            level: 'low',
            confidence: 0.88,
            signals: []
          }
        }
      };

      const severeContext = {
        hour: 2,
        services: {
          police: [{ distance: 2800 }],
          hospital: [{ distance: 3200 }],
          fire: []
        },
        cameras: [
          { status: 'maintenance', coverage: 90 }
        ],
        publicRisk: {
          theftCount: 12,
          violentCount: 5,
          accidentHotspots: 6,
          conflictPoints: 7,
          reliabilityScore: 66,
          confidence: 'medium'
        },
        cv: {
          provider: 'yolov8-sim-coco',
          detections: [{}, {}, {}, {}, {}, {}, {}],
          sceneRisk: {
            score: 81,
            level: 'critical',
            confidence: 0.73,
            signals: ['Loitering concentration observed in frame']
          }
        }
      };

      const protectedScore = scoreSafetyContext(protectedContext);
      const severeScore = scoreSafetyContext(severeContext);

      expect(severeScore.score).toBeLessThan(protectedScore.score);
      expect(severeScore.penalty).toBeGreaterThan(protectedScore.penalty);
    });
  });

  describe('Backend inference provider', () => {
    const samplePayload = {
      lat: 12.9716,
      lng: 77.5946,
      hour: 20,
      areaInfo: { type: 'commercial', category: 'market' },
      services: { police: [], hospital: [], fire: [] },
      cameras: [],
      publicRisk: {
        theftCount: 2,
        violentCount: 1,
        accidentHotspots: 1,
        conflictPoints: 1,
        reliabilityScore: 70,
        confidence: 'high'
      }
    };

    test('auto mode resolves to remote when endpoint exists', () => {
      expect(inferEffectiveMode({ mode: 'auto', endpoint: 'http://localhost:9999/infer' })).toBe('remote');
    });

    test('falls back to simulation when remote inference fails', async () => {
      const result = await analyzeCvScene(samplePayload, {
        config: {
          mode: 'remote',
          endpoint: 'http://127.0.0.1:1/infer',
          timeoutMs: 150,
          fallbackToSimulation: true,
          modelVersion: 'yolov8-sim-v1'
        },
        logger: {
          error: jest.fn(),
          warn: jest.fn()
        }
      });

      expect(result.sourceMode).toBe('simulation');
      expect(result.degraded).toBe(true);
      expect(result.cv.sceneRisk).toBeDefined();
    });
  });

  describe('Tracing and governance utilities', () => {
    test('parses and rebuilds traceparent header values', () => {
      const raw = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(raw);

      expect(parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed.parentSpanId).toBe('00f067aa0ba902b7');
      expect(buildTraceparent(parsed.traceId, '0123456789abcdef', parsed.traceFlags))
        .toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-0123456789abcdef-01');
    });

    test('governance report evaluates calibration after enough labels', () => {
      const governance = createModelGovernance({
        minLabelsForCalibration: 2,
        driftPsiThreshold: 0.2,
        calibrationBrierThreshold: 0.3
      }, {
        info: jest.fn()
      });

      governance.recordInference({
        modelVersion: 'yolov8-remote-v1',
        sourceMode: 'remote',
        sceneRiskScore: 42,
        detectionCount: 8,
        sceneConfidence: 0.72
      });

      governance.recordGroundTruth({
        predictedProbability: 0.8,
        incidentOccurred: true,
        modelVersion: 'yolov8-remote-v1'
      });

      governance.recordGroundTruth({
        predictedProbability: 0.1,
        incidentOccurred: false,
        modelVersion: 'yolov8-remote-v1'
      });

      const report = governance.getReport();
      expect(report.calibration.status).toBe('evaluated');
      expect(report.sampleCounts.labels).toBe(2);
    });
  });

  describe('Alerting window evaluation', () => {
    test('computes rolling error and latency stats', async () => {
      const alerting = createAlertManager({
        enabled: false,
        windowMs: 60000,
        minRequestCount: 2,
        errorRateThreshold: 0.1,
        p95LatencyMsThreshold: 250,
        cooldownMs: 0
      }, {
        warn: jest.fn(),
        error: jest.fn()
      });

      await alerting.observeRequest({ statusCode: 200, durationMs: 120, route: '/api/safety/analyze' });
      await alerting.observeRequest({ statusCode: 503, durationMs: 320, route: '/api/safety/analyze' });

      const status = alerting.getStatus();
      expect(status.windowStats.sampleSize).toBe(2);
      expect(status.windowStats.errorRate).toBeGreaterThan(0);
      expect(status.windowStats.p95LatencyMs).toBeGreaterThanOrEqual(320);
    });
  });
});
