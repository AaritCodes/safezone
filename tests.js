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
  hasGoogleApiKey
} = require('./data.js');

const {
  CACHE_NAME,
  isSafeCacheableResponse,
  isCacheableShellRequest
} = require('./sw.js');

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
      global.window = { SAFEZONE_GOOGLE_API_KEY: 'AIzaSyA123456789012345678901234567890AB' };
      expect(getGoogleApiKey()).toBe('AIzaSyA123456789012345678901234567890AB');
      expect(hasGoogleApiKey()).toBe(true);
    });

    test('rejects malformed keys from window', () => {
      global.window = { SAFEZONE_GOOGLE_API_KEY: 'AIzaSyA1234567890<script>alert(1)</script>' };
      expect(getGoogleApiKey()).toBe('');
      expect(hasGoogleApiKey()).toBe(false);
    });

    test('falls back to meta tag when window key is missing', () => {
      global.window = {};
      global.document = {
        querySelector: jest.fn(() => ({
          getAttribute: jest.fn(() => 'AIzaSyB123456789012345678901234567890CD')
        }))
      };

      expect(getGoogleApiKey()).toBe('AIzaSyB123456789012345678901234567890CD');
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
});
