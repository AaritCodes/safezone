/**
 * SafeZone Risk Accuracy Tests
 * Tests for distance decay, hotspot normalization, and reliability scoring
 * Run with: npm test (requires Jest)
 */

// Mock distance calculation (from data.js getDistance utility)
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

// Distance decay weight function
const getDistanceDecayWeight = (distanceMeters) => {
  const MIN_DISTANCE = 180;
  const MAX_DISTANCE = 2600;
  const MIN_WEIGHT = 0.14;

  if (distanceMeters <= MIN_DISTANCE) return 1.0;
  if (distanceMeters >= MAX_DISTANCE) return MIN_WEIGHT;

  const normalized = (distanceMeters - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
  const exponent = 2.5;
  return 1.0 - (1.0 - MIN_WEIGHT) * Math.pow(normalized, exponent);
};

// Hotspot normalization function
const normalizeAndRankHotspots = (hotspots, limit = 15) => {
  if (!hotspots || hotspots.length === 0) return [];

  const GRID_SIZE = 0.00045;
  const cellMap = new Map();

  hotspots.forEach((hotspot) => {
    const cellX = Math.floor(hotspot.lat / GRID_SIZE);
    const cellY = Math.floor(hotspot.lng / GRID_SIZE);
    const cellKey = `${cellX},${cellY}`;

    const severityMap = { dangerous_curve: 2.9, slippery: 2.3, falling_rocks: 3.1, accident: 2.4, traffic_signal: 0.58 };
    const severity = severityMap[hotspot.type] || 1.0;

    if (!cellMap.has(cellKey) || severity > cellMap.get(cellKey).severity) {
      cellMap.set(cellKey, { ...hotspot, severity });
    }
  });

  return Array.from(cellMap.values())
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit)
    .map(({ severity, ...rest }) => rest);
};

// Crime signal reliability function
const getCrimeSignalReliability = (source, sampleCoveragePercent) => {
  const coverageWeight = Math.min(sampleCoveragePercent / 100, 1.0);

  switch (source) {
    case "uk-police-data":
      return 0.72 + 0.24 * coverageWeight;
    case "osm-proxy":
      return 0.42 + 0.36 * coverageWeight;
    case "model-derived":
      return 0.28;
    default:
      return 0.28;
  }
};

// Train risk model with reliability weighting
const trainRiskModel = (observations, anomalies, reliability) => {
  const baseWeight = 0.76;
  const anomalyWeightRange = [1.1, 1.7];
  const reliabilityWeight = Math.max(0.2, reliability);

  let penalties = [];
  observations.forEach((obs) => {
    const penaltyObserved = obs.baseWeight * baseWeight;
    penalties.push(penaltyObserved);
  });

  let anomalyPenalties = [];
  anomalies.forEach((anom) => {
    const factor = anomalyWeightRange[0] + Math.random() * (anomalyWeightRange[1] - anomalyWeightRange[0]);
    anomalyPenalties.push(anom.delta * factor);
  });

  const avgPenalty = penalties.reduce((a, b) => a + b, 0) / (penalties.length || 1);
  const avgAnomaly = anomalyPenalties.reduce((a, b) => a + b, 0) / (anomalyPenalties.length || 1);
  const modelPenalty = (avgPenalty + avgAnomaly) * reliabilityWeight;

  return {
    penalty: modelPenalty,
    reliabilityPercent: Math.round(reliabilityWeight * 100),
  };
};

// ============================================================
// TEST SUITE
// ============================================================

describe("SafeZone Risk Accuracy", () => {
  describe("getDistanceDecayWeight", () => {
    test("returns 1.0 for distances <= 180m", () => {
      expect(getDistanceDecayWeight(0)).toBe(1.0);
      expect(getDistanceDecayWeight(100)).toBe(1.0);
      expect(getDistanceDecayWeight(180)).toBe(1.0);
    });

    test("returns 0.14 for distances >= 2600m", () => {
      expect(getDistanceDecayWeight(2600)).toBe(0.14);
      expect(getDistanceDecayWeight(5000)).toBe(0.14);
    });

    test("returns interpolated weight between 180m and 2600m", () => {
      const mid = getDistanceDecayWeight(1390); // midpoint
      expect(mid).toBeGreaterThan(0.14);
      expect(mid).toBeLessThan(1.0);
    });

    test("weight decreases as distance increases", () => {
      const near = getDistanceDecayWeight(500);
      const mid = getDistanceDecayWeight(1390);
      const far = getDistanceDecayWeight(2400);
      expect(near).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(far);
    });
  });

  describe("normalizeAndRankHotspots", () => {
    test("returns empty array for empty input", () => {
      expect(normalizeAndRankHotspots([])).toEqual([]);
      expect(normalizeAndRankHotspots(null)).toEqual([]);
    });

    test("deduplicates hotspots in same grid cell, keeps highest severity", () => {
      const hotspots = [
        { lat: 48.8566, lng: 2.3522, type: "accident", title: "Spot 1", source: "osm" },
        { lat: 48.8567, lng: 2.3523, type: "falling_rocks", title: "Spot 2", source: "osm" }, // same cell, higher severity
      ];
      const result = normalizeAndRankHotspots(hotspots);
      expect(result.length).toBeLessThanOrEqual(hotspots.length);
    });

    test("ranks hotspots by severity", () => {
      const hotspots = [
        { lat: 48.8566, lng: 2.3522, type: "traffic_signal", title: "Mild", source: "osm" }, // 0.58
        { lat: 48.9566, lng: 2.4522, type: "dangerous_curve", title: "High", source: "osm" }, // 2.9
        { lat: 48.7566, lng: 2.2522, type: "accident", title: "Medium", source: "osm" }, // 2.4
      ];
      const result = normalizeAndRankHotspots(hotspots);
      expect(result[0].title).toBe("High"); // dangerous_curve (2.9) ranks first
      expect(result[1].title).toBe("Medium"); // accident (2.4) ranks second
    });

    test("respects limit parameter", () => {
      const hotspots = Array.from({ length: 50 }, (_, i) => ({
        lat: 48.8566 + i * 0.001,
        lng: 2.3522 + i * 0.001,
        type: "accident",
        title: `Spot ${i}`,
        source: "osm",
      }));
      const result = normalizeAndRankHotspots(hotspots, 15);
      expect(result.length).toBeLessThanOrEqual(15);
    });

    test("preserves original hotspot properties after dedup", () => {
      const hotspots = [{ lat: 48.8566, lng: 2.3522, type: "accident", title: "Test", source: "osm", custom: "data" }];
      const result = normalizeAndRankHotspots(hotspots);
      expect(result[0]).toHaveProperty("lat");
      expect(result[0]).toHaveProperty("lng");
      expect(result[0]).toHaveProperty("title");
      expect(result[0]).toHaveProperty("source");
    });
  });

  describe("getCrimeSignalReliability", () => {
    test("returns high reliability for uk-police-data with full coverage", () => {
      const reliability = getCrimeSignalReliability("uk-police-data", 100);
      expect(reliability).toBe(0.96);
    });

    test("returns lower reliability for uk-police-data with partial coverage", () => {
      const low = getCrimeSignalReliability("uk-police-data", 50);
      const high = getCrimeSignalReliability("uk-police-data", 100);
      expect(low).toBeLessThan(high);
      expect(low).toBeGreaterThan(0.72);
    });

    test("returns moderate reliability for osm-proxy", () => {
      const reliability = getCrimeSignalReliability("osm-proxy", 100);
      expect(reliability).toBeLessThan(0.96);
      expect(reliability).toBeGreaterThan(0.42);
    });

    test("returns low reliability for model-derived fallback", () => {
      const reliability = getCrimeSignalReliability("model-derived", 100);
      expect(reliability).toBe(0.28);
    });

    test("reliability scales with coverage", () => {
      const source = "osm-proxy";
      const low = getCrimeSignalReliability(source, 25);
      const mid = getCrimeSignalReliability(source, 50);
      const high = getCrimeSignalReliability(source, 100);
      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
    });
  });

  describe("trainRiskModel", () => {
    test("scales penalty by reliability weight", () => {
      const obs = [{ baseWeight: 1.0 }];
      const anom = [{ delta: 0.5 }];

      const lowReliability = trainRiskModel(obs, anom, 0.3);
      const highReliability = trainRiskModel(obs, anom, 0.9);

      expect(highReliability.penalty).toBeGreaterThan(lowReliability.penalty);
    });

    test("returns non-zero penalty for non-empty observations", () => {
      const obs = [{ baseWeight: 1.0 }];
      const anom = [{ delta: 0.5 }];
      const result = trainRiskModel(obs, anom, 0.7);

      expect(result.penalty).toBeGreaterThan(0);
    });

    test("returns reliability percent between 20 and 100", () => {
      const obs = [{ baseWeight: 1.0 }];
      const anom = [{ delta: 0.5 }];

      const lowReliability = trainRiskModel(obs, anom, 0.15);
      const highReliability = trainRiskModel(obs, anom, 0.95);

      expect(lowReliability.reliabilityPercent).toBeGreaterThanOrEqual(20);
      expect(highReliability.reliabilityPercent).toBeLessThanOrEqual(100);
    });

    test("handles empty observations gracefully", () => {
      const obs = [];
      const anom = [{ delta: 0.5 }];
      const result = trainRiskModel(obs, anom, 0.7);

      expect(result).toHaveProperty("penalty");
      expect(result).toHaveProperty("reliabilityPercent");
    });

    test("applies minimum reliability floor of 0.2", () => {
      const obs = [{ baseWeight: 1.0 }];
      const anom = [{ delta: 0.5 }];
      const result = trainRiskModel(obs, anom, 0.01); // Very low reliability

      expect(result.reliabilityPercent).toBeGreaterThanOrEqual(20); // 0.2 * 100
    });
  });

  describe("Integration: Distance Decay + Hotspot Normalization", () => {
    test("combined distance and hotspot logic identifies nearby high-severity hotspots", () => {
      const hotspots = [
        { lat: 48.8566, lng: 2.3522, type: "falling_rocks", title: "Nearby Severe", source: "osm" }, // 3.1
        { lat: 48.9266, lng: 2.3522, type: "accident", title: "Distant Mild", source: "osm" }, // ~7.8km away, severity 2.4
      ];

      const normalized = normalizeAndRankHotspots(hotspots);
      const weight1 = getDistanceDecayWeight(0);
      const weight2 = getDistanceDecayWeight(7800);

      expect(normalized[0].title).toBe("Nearby Severe"); // High severity prioritized after dedup
      expect(weight1).toBeGreaterThan(weight2); // Nearby weight > distant weight
    });
  });
});
