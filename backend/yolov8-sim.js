'use strict';

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function hashString(value) {
  const text = String(value || '');
  let hash = 2166136261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createPrng(seed) {
  let state = seed >>> 0;

  return function next() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(prng, min, max) {
  return min + (max - min) * prng();
}

function randInt(prng, min, max) {
  return Math.floor(randRange(prng, min, max + 1));
}

function normalizeHour(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return new Date().getHours();
  return ((Math.round(raw) % 24) + 24) % 24;
}

function countItems(value) {
  return Array.isArray(value) ? value.length : 0;
}

function getActiveCameraStats(cameras) {
  const list = Array.isArray(cameras) ? cameras : [];
  const active = list.filter((camera) => String(camera && camera.status || '').toLowerCase() === 'active');
  const averageCoverage = active.length
    ? active.reduce((sum, camera) => sum + safeNumber(camera && camera.coverage, 0), 0) / active.length
    : 0;

  return {
    total: list.length,
    active: active.length,
    averageCoverage
  };
}

function nearestDistance(items, fallback = 5000) {
  const list = Array.isArray(items) ? items : [];
  let nearest = Infinity;

  for (const item of list) {
    const distance = safeNumber(item && item.distance, NaN);
    if (Number.isFinite(distance) && distance >= 0 && distance < nearest) {
      nearest = distance;
    }
  }

  return Number.isFinite(nearest) ? nearest : fallback;
}

function normalizeInput(input = {}) {
  const lat = safeNumber(input.lat, 0);
  const lng = safeNumber(input.lng, 0);
  const hour = normalizeHour(input.hour);
  const areaInfo = input && typeof input.areaInfo === 'object' && input.areaInfo ? input.areaInfo : {};
  const areaType = `${String(areaInfo.type || '')} ${String(areaInfo.category || '')}`.toLowerCase();

  const services = input && typeof input.services === 'object' && input.services ? input.services : {};
  const cameras = Array.isArray(input.cameras) ? input.cameras : [];
  const publicRisk = input && typeof input.publicRisk === 'object' && input.publicRisk ? input.publicRisk : {};

  return {
    lat,
    lng,
    hour,
    areaType,
    services,
    cameras,
    publicRisk,
    cameraStats: getActiveCameraStats(cameras)
  };
}

function buildBoundingBox(prng, large = false) {
  const width = clamp(randRange(prng, large ? 0.08 : 0.03, large ? 0.28 : 0.18), 0.02, 0.32);
  const height = clamp(randRange(prng, large ? 0.1 : 0.05, large ? 0.38 : 0.26), 0.03, 0.4);
  const x1 = randRange(prng, 0.0, 1.0 - width);
  const y1 = randRange(prng, 0.0, 1.0 - height);

  return [
    Number(x1.toFixed(4)),
    Number(y1.toFixed(4)),
    Number((x1 + width).toFixed(4)),
    Number((y1 + height).toFixed(4))
  ];
}

function buildTimeContext(hour) {
  if (hour >= 6 && hour <= 17) {
    return {
      visibility: 0.9,
      populationBias: 1.0,
      label: 'day'
    };
  }

  if (hour >= 18 && hour <= 21) {
    return {
      visibility: 0.62,
      populationBias: 1.15,
      label: 'evening'
    };
  }

  return {
    visibility: 0.33,
    populationBias: 0.58,
    label: 'night'
  };
}

function inferAreaPopulationBase(areaType) {
  if (areaType.includes('commercial') || areaType.includes('market')) return 14;
  if (areaType.includes('industrial')) return 9;
  if (areaType.includes('residential')) return 8;
  if (areaType.includes('park') || areaType.includes('garden')) return 6;
  return 10;
}

function computeGuardianScore(input) {
  const policeDistance = nearestDistance(input.services.police, 5000);
  const cameraCoverage = clamp(input.cameraStats.active / 8, 0, 1);
  const coverageRadiusScore = clamp(input.cameraStats.averageCoverage / 180, 0, 1);
  const policeScore = clamp(1 - (policeDistance / 2600), 0, 1);
  const fireScore = clamp(1 - (nearestDistance(input.services.fire, 6000) / 4200), 0, 1);

  return clamp((policeScore * 0.48) + (cameraCoverage * 0.24) + (coverageRadiusScore * 0.16) + (fireScore * 0.12), 0, 1);
}

function computeIncidentPressure(publicRisk) {
  const theft = safeNumber(publicRisk.theftCount, 0);
  const violent = safeNumber(publicRisk.violentCount, 0);
  const accident = safeNumber(publicRisk.accidentHotspots, 0);
  const conflict = safeNumber(publicRisk.conflictPoints, 0);
  const reliability = clamp(safeNumber(publicRisk.reliabilityScore, 45) / 100, 0.18, 1);

  const weighted = theft * 1.2 + violent * 2.1 + accident * 1.4 + conflict * 0.9;
  const normalized = clamp(1 - Math.exp(-weighted / 26), 0, 1);

  return clamp(normalized * (0.62 + reliability * 0.38), 0, 1);
}

function simulateYolov8Scene(input = {}) {
  const normalized = normalizeInput(input);
  const timeContext = buildTimeContext(normalized.hour);
  const guardianScore = computeGuardianScore(normalized);
  const incidentPressure = computeIncidentPressure(normalized.publicRisk);

  const seed = hashString([
    normalized.lat.toFixed(4),
    normalized.lng.toFixed(4),
    normalized.hour,
    normalized.areaType,
    normalized.cameraStats.active,
    safeNumber(normalized.publicRisk.theftCount, 0),
    safeNumber(normalized.publicRisk.violentCount, 0)
  ].join('|'));

  const prng = createPrng(seed);

  const populationBase = inferAreaPopulationBase(normalized.areaType) * timeContext.populationBias;
  const peopleCount = clamp(
    Math.round(populationBase + incidentPressure * 8 - guardianScore * 2 + randRange(prng, -2.4, 2.6)),
    1,
    28
  );
  const vehicleCount = clamp(
    Math.round((populationBase * 0.46) + incidentPressure * 4 + randRange(prng, -2, 2)),
    0,
    16
  );

  const loiteringBias = clamp((1 - timeContext.visibility) * 0.52 + incidentPressure * 0.48 - guardianScore * 0.26, 0.05, 0.72);
  const runningBias = clamp(incidentPressure * 0.28 + (timeContext.label === 'night' ? 0.14 : 0.05), 0.03, 0.38);
  const heavyVehicleBias = clamp(incidentPressure * 0.35 + (timeContext.label === 'night' ? 0.18 : 0.07), 0.05, 0.44);

  const detections = [];
  let loiteringCount = 0;
  let runningCount = 0;
  let groupedCount = 0;
  let heavyVehicleCount = 0;

  for (let i = 0; i < peopleCount; i += 1) {
    const behaviorRoll = prng();
    let behavior = 'walking';
    let severity = 0.18;

    if (behaviorRoll < loiteringBias * 0.5) {
      behavior = 'loitering';
      severity = 0.72;
      loiteringCount += 1;
    } else if (behaviorRoll < (loiteringBias * 0.5) + runningBias) {
      behavior = 'running';
      severity = 0.58;
      runningCount += 1;
    } else if (behaviorRoll < 0.74) {
      behavior = 'walking';
      severity = 0.22;
    } else {
      behavior = 'grouped';
      severity = 0.41;
      groupedCount += 1;
    }

    const confidence = clamp(0.55 + prng() * 0.4, 0.52, 0.96);
    detections.push({
      trackingId: `person-${i + 1}`,
      label: 'person',
      confidence: Number(confidence.toFixed(3)),
      bbox: buildBoundingBox(prng, false),
      attributes: {
        behavior
      },
      severity: Number(severity.toFixed(3))
    });
  }

  const vehicleLabels = ['car', 'motorcycle', 'truck', 'bus', 'bicycle'];

  for (let i = 0; i < vehicleCount; i += 1) {
    const labelRoll = prng();
    let label = 'car';

    if (labelRoll < 0.2) label = 'motorcycle';
    else if (labelRoll < 0.31) label = 'truck';
    else if (labelRoll < 0.37) label = 'bus';
    else if (labelRoll < 0.45) label = 'bicycle';

    if (!vehicleLabels.includes(label)) label = 'car';

    const isHeavy = label === 'truck' || label === 'bus' || (label === 'motorcycle' && prng() < 0.3);
    if (isHeavy && prng() < heavyVehicleBias) {
      heavyVehicleCount += 1;
    }

    const confidence = clamp(0.58 + prng() * 0.34, 0.54, 0.94);
    detections.push({
      trackingId: `vehicle-${i + 1}`,
      label,
      confidence: Number(confidence.toFixed(3)),
      bbox: buildBoundingBox(prng, true),
      attributes: {
        motion: prng() < 0.18 ? 'stopped' : 'moving'
      },
      severity: Number((isHeavy ? 0.46 : 0.2).toFixed(3))
    });
  }

  const objectCounts = {
    person: peopleCount,
    car: detections.filter((item) => item.label === 'car').length,
    motorcycle: detections.filter((item) => item.label === 'motorcycle').length,
    truck: detections.filter((item) => item.label === 'truck').length,
    bus: detections.filter((item) => item.label === 'bus').length,
    bicycle: detections.filter((item) => item.label === 'bicycle').length
  };

  const crowdDensity = clamp(peopleCount / 22, 0, 1);
  const loiteringRatio = clamp(loiteringCount / Math.max(1, peopleCount), 0, 1);
  const runningRatio = clamp(runningCount / Math.max(1, peopleCount), 0, 1);
  const heavyVehicleRatio = clamp(heavyVehicleCount / Math.max(1, vehicleCount), 0, 1);
  const lowVisibility = clamp(1 - timeContext.visibility, 0, 1);
  const sparseGuardianship = clamp(1 - guardianScore, 0, 1);

  const sceneRiskRaw =
    (crowdDensity * 14) +
    (loiteringRatio * 26) +
    (runningRatio * 18) +
    (heavyVehicleRatio * 13) +
    (lowVisibility * 13) +
    (sparseGuardianship * 14) +
    (incidentPressure * 21);

  const sceneRiskScore = Math.round(clamp(sceneRiskRaw, 4, 98));
  const avgConfidence = detections.length
    ? detections.reduce((sum, detection) => sum + safeNumber(detection.confidence, 0), 0) / detections.length
    : 0.5;
  const sampleConfidence = clamp(detections.length / 24, 0.38, 1);
  const sceneConfidence = clamp((avgConfidence * 0.72) + (sampleConfidence * 0.28), 0.42, 0.97);

  let level = 'low';
  if (sceneRiskScore >= 75) level = 'critical';
  else if (sceneRiskScore >= 55) level = 'high';
  else if (sceneRiskScore >= 32) level = 'moderate';

  const signals = [];
  if (loiteringRatio >= 0.24) signals.push('Loitering concentration observed in frame');
  if (runningRatio >= 0.18) signals.push('Frequent rapid motion detected in pedestrian flow');
  if (heavyVehicleRatio >= 0.22) signals.push('Heavy-vehicle share is elevated for this corridor');
  if (lowVisibility >= 0.48) signals.push('Low-light conditions reduce visual certainty');
  if (sparseGuardianship >= 0.45) signals.push('Sparse guardianship coverage near camera zone');
  if (signals.length === 0) signals.push('Scene dynamics are stable with no high-risk CV anomalies');

  return {
    provider: 'yolov8-sim-coco',
    frameId: `frame-${seed.toString(16).padStart(8, '0')}`,
    detections,
    sceneRisk: {
      score: sceneRiskScore,
      level,
      confidence: Number(sceneConfidence.toFixed(3)),
      objectCounts,
      signals,
      context: {
        period: timeContext.label,
        guardianScore: Number(guardianScore.toFixed(3)),
        incidentPressure: Number(incidentPressure.toFixed(3))
      }
    }
  };
}

module.exports = {
  simulateYolov8Scene
};
