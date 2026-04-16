'use strict';

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeHour(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return new Date().getHours();
  return ((Math.round(raw) % 24) + 24) % 24;
}

function normalizeLabel(value, fallback = 'unknown') {
  const text = String(value || '').trim().toLowerCase();
  return text || fallback;
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

function mapDistanceRisk(distance, thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) return 60;

  for (const threshold of thresholds) {
    if (distance <= threshold.max) return threshold.risk;
  }

  return thresholds[thresholds.length - 1].risk;
}

function getActiveCameraStats(cameras) {
  const list = Array.isArray(cameras) ? cameras : [];
  const active = list.filter((camera) => normalizeLabel(camera && camera.status, 'inactive') === 'active');
  const avgCoverage = active.length
    ? active.reduce((sum, camera) => sum + safeNumber(camera && camera.coverage, 0), 0) / active.length
    : 0;

  return {
    total: list.length,
    active: active.length,
    avgCoverage
  };
}

function calculateInfrastructureRisk(context) {
  const services = context && context.services && typeof context.services === 'object' ? context.services : {};
  const cameras = Array.isArray(context.cameras) ? context.cameras : [];
  const cameraStats = getActiveCameraStats(cameras);

  const nearestPolice = nearestDistance(services.police, 5000);
  const nearestHospital = nearestDistance(services.hospital, 5500);
  const nearestFire = nearestDistance(services.fire, 6000);

  const policeRisk = mapDistanceRisk(nearestPolice, [
    { max: 350, risk: 8 },
    { max: 700, risk: 16 },
    { max: 1200, risk: 26 },
    { max: 2200, risk: 42 },
    { max: Infinity, risk: 62 }
  ]);

  const hospitalRisk = mapDistanceRisk(nearestHospital, [
    { max: 450, risk: 9 },
    { max: 900, risk: 17 },
    { max: 1700, risk: 28 },
    { max: 2800, risk: 39 },
    { max: Infinity, risk: 58 }
  ]);

  const fireRisk = mapDistanceRisk(nearestFire, [
    { max: 600, risk: 12 },
    { max: 1300, risk: 21 },
    { max: 2200, risk: 31 },
    { max: 3200, risk: 43 },
    { max: Infinity, risk: 57 }
  ]);

  const cameraRisk = clamp(
    62 - (cameraStats.active * 7) - (cameraStats.avgCoverage / 6),
    10,
    72
  );

  let baseRisk =
    (policeRisk * 0.36) +
    (hospitalRisk * 0.24) +
    (fireRisk * 0.15) +
    (cameraRisk * 0.25);

  if (cameraStats.active === 0) {
    baseRisk += 8;
  }

  if (!Array.isArray(services.police) || services.police.length === 0) {
    baseRisk += 9;
  }

  const score = clamp(baseRisk, 4, 96);

  const notes = [];
  if (nearestPolice > 1800) notes.push('Police response radius is wide');
  if (cameraStats.active < 2) notes.push('Sparse active surveillance coverage');
  if (nearestHospital > 2200) notes.push('Medical response access is delayed');
  if (notes.length === 0) notes.push('Emergency infrastructure coverage is balanced');

  return {
    score: Number(score.toFixed(2)),
    confidence: cameraStats.total > 0 ? 0.84 : 0.68,
    notes,
    diagnostics: {
      nearestPolice,
      nearestHospital,
      nearestFire,
      activeCameras: cameraStats.active,
      avgCameraCoverage: Number(cameraStats.avgCoverage.toFixed(1))
    }
  };
}

function calculateTemporalRisk(context) {
  const hour = normalizeHour(context && context.hour);
  let score = 34;

  if (hour >= 6 && hour <= 8) score = 24;
  else if (hour >= 9 && hour <= 17) score = 17;
  else if (hour >= 18 && hour <= 20) score = 38;
  else if (hour >= 21 && hour <= 22) score = 49;
  else if (hour === 23 || hour <= 1) score = 58;
  else if (hour >= 2 && hour <= 4) score = 66;
  else if (hour === 5) score = 53;

  const notes = [];
  if (score >= 55) notes.push('Late-hour temporal exposure is elevated');
  else if (score >= 40) notes.push('Evening transition window increases uncertainty');
  else notes.push('Time-of-day profile is favorable for mobility');

  return {
    score,
    confidence: 0.96,
    notes,
    diagnostics: {
      hour
    }
  };
}

function inferPublicReliability(publicRisk) {
  const explicit = safeNumber(publicRisk && publicRisk.reliabilityScore, NaN);
  if (Number.isFinite(explicit)) {
    return clamp(explicit / 100, 0.16, 0.98);
  }

  const confidenceLabel = normalizeLabel(publicRisk && publicRisk.confidence, 'low');
  if (confidenceLabel === 'high') return 0.8;
  if (confidenceLabel === 'medium') return 0.56;
  return 0.32;
}

function calculatePublicIncidentRisk(context) {
  const publicRisk = context && context.publicRisk && typeof context.publicRisk === 'object'
    ? context.publicRisk
    : {};

  const theft = safeNumber(publicRisk.theftCount, 0);
  const violent = safeNumber(publicRisk.violentCount, 0);
  const accidents = safeNumber(publicRisk.accidentHotspots, 0);
  const conflicts = safeNumber(publicRisk.conflictPoints, 0);

  const weightedIntensity =
    (theft * 1.2) +
    (violent * 2.15) +
    (accidents * 1.35) +
    (conflicts * 0.82);

  const normalizedIntensity = clamp(100 * (1 - Math.exp(-weightedIntensity / 24)), 0, 100);
  const reliability = inferPublicReliability(publicRisk);
  const calibrated = clamp((normalizedIntensity * (0.58 + reliability * 0.42)) + ((1 - reliability) * 14), 0, 100);

  const notes = [];
  if (violent > 0) notes.push(`${Math.round(violent)} violent/public-order signal(s) in buffer`);
  if (accidents > 0) notes.push(`${Math.round(accidents)} road hazard hotspot(s) in buffer`);
  if (theft > 0) notes.push(`${Math.round(theft)} theft pressure signal(s) in buffer`);
  if (notes.length === 0) notes.push('Public incident pressure is currently low');

  return {
    score: Number(calibrated.toFixed(2)),
    confidence: Number(reliability.toFixed(3)),
    notes,
    diagnostics: {
      theft,
      violent,
      accidents,
      conflicts,
      reliability
    }
  };
}

function calculateCvBehaviorRisk(context) {
  const cv = context && context.cv && typeof context.cv === 'object' ? context.cv : {};
  const scene = cv && cv.sceneRisk && typeof cv.sceneRisk === 'object' ? cv.sceneRisk : {};
  const detections = Array.isArray(cv.detections) ? cv.detections : [];

  const score = clamp(safeNumber(scene.score, 0), 0, 100);
  const sceneConfidence = clamp(safeNumber(scene.confidence, 0.45), 0.25, 0.99);
  const sampleCoverage = clamp(detections.length / 22, 0.22, 1);
  const confidence = clamp((sceneConfidence * 0.8) + (sampleCoverage * 0.2), 0.28, 0.98);
  const level = normalizeLabel(scene.level, 'low');

  const notes = [];
  if (level === 'critical' || level === 'high') {
    notes.push('CV scene analysis reports elevated behavioral anomaly pressure');
  } else if (level === 'moderate') {
    notes.push('CV scene analysis reports moderate anomaly pressure');
  } else {
    notes.push('CV scene analysis reports stable conditions');
  }

  const sceneSignals = Array.isArray(scene.signals) ? scene.signals : [];
  sceneSignals.slice(0, 2).forEach((signal) => {
    notes.push(String(signal));
  });

  return {
    score: Number(score.toFixed(2)),
    confidence: Number(confidence.toFixed(3)),
    notes,
    diagnostics: {
      level,
      detections: detections.length,
      sceneConfidence
    }
  };
}

function buildConfidence(components) {
  const infra = components.infrastructure;
  const temporal = components.temporal;
  const publicIncidents = components.publicIncidents;
  const cvBehavior = components.cvBehavior;

  const score = clamp(
    (safeNumber(infra.confidence, 0.5) * 0.28) +
    (safeNumber(temporal.confidence, 0.5) * 0.1) +
    (safeNumber(publicIncidents.confidence, 0.5) * 0.34) +
    (safeNumber(cvBehavior.confidence, 0.5) * 0.28),
    0,
    1
  );

  let label = 'low';
  if (score >= 0.75) label = 'high';
  else if (score >= 0.48) label = 'medium';

  return {
    score,
    label
  };
}

function buildRecommendations(componentScores) {
  const recommendations = [];

  if (componentScores.infrastructure >= 58) {
    recommendations.push('Prefer routes with stronger police and active camera coverage for this trip window.');
  }

  if (componentScores.temporal >= 55) {
    recommendations.push('Use buddy-travel or monitored pickup points during late-hour movement.');
  }

  if (componentScores.publicIncidents >= 60) {
    recommendations.push('Avoid hotspot corridors and select safer route mode where possible.');
  }

  if (componentScores.cvBehavior >= 62) {
    recommendations.push('Increase patrol attention around detected loitering and anomaly clusters.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Current multi-signal profile is stable. Keep routine monitoring cadence active.');
  }

  return recommendations;
}

function buildDeploymentReadiness(confidence, components) {
  const checks = {
    infrastructureSignals: components.infrastructure.confidence >= 0.65,
    temporalSignals: components.temporal.confidence >= 0.9,
    publicIncidentSignals: components.publicIncidents.confidence >= 0.45,
    cvSignals: components.cvBehavior.confidence >= 0.45,
    modelConfidence: confidence.score >= 0.5
  };

  const totalChecks = Object.keys(checks).length;
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const readinessScore = Math.round((passedChecks / totalChecks) * 100);

  let grade = 'needs-hardening';
  if (readinessScore >= 90 && confidence.score >= 0.75) grade = 'production-ready';
  else if (readinessScore >= 70 && confidence.score >= 0.58) grade = 'pilot-ready';
  else if (readinessScore >= 50) grade = 'staging-ready';

  return {
    grade,
    readinessScore,
    checks
  };
}

function buildFactors(components, score, confidence) {
  const factors = [];

  if (components.infrastructure.score >= 55) {
    factors.push('Infrastructure risk is elevated due to sparse emergency reach and/or surveillance.');
  } else {
    factors.push('Emergency infrastructure density reduces baseline exposure.');
  }

  if (components.publicIncidents.score >= 58) {
    factors.push('Public incident signal pressure is materially above baseline.');
  } else {
    factors.push('Public incident pressure remains contained in current area window.');
  }

  if (components.cvBehavior.score >= 60) {
    factors.push('CV behavior simulation indicates elevated anomaly footprint.');
  } else {
    factors.push('CV scene dynamics are stable with limited anomaly concentration.');
  }

  if (components.temporal.score >= 50) {
    factors.push('Time-of-day contribution increases exposure profile.');
  } else {
    factors.push('Time-of-day profile is supportive for safer mobility.');
  }

  factors.push(`Model confidence is ${confidence.label} (${Math.round(confidence.score * 100)}%).`);
  factors.push(`Product risk engine returned safety score ${Math.round(score)} / 100.`);

  return factors;
}

function scoreSafetyContext(context = {}) {
  const components = {
    infrastructure: calculateInfrastructureRisk(context),
    temporal: calculateTemporalRisk(context),
    publicIncidents: calculatePublicIncidentRisk(context),
    cvBehavior: calculateCvBehaviorRisk(context)
  };

  const weights = {
    infrastructure: 0.26,
    temporal: 0.17,
    publicIncidents: 0.33,
    cvBehavior: 0.24
  };

  const weightedRisk =
    (components.infrastructure.score * weights.infrastructure) +
    (components.temporal.score * weights.temporal) +
    (components.publicIncidents.score * weights.publicIncidents) +
    (components.cvBehavior.score * weights.cvBehavior);

  const confidence = buildConfidence(components);
  const uncertaintyBuffer = (1 - confidence.score) * 11;
  const totalRisk = clamp(weightedRisk + uncertaintyBuffer, 0, 100);
  const safetyScore = Math.round(clamp(100 - totalRisk, 0, 100));
  const penalty = Math.round(clamp(totalRisk * 0.35, 0, 36));

  const factors = buildFactors(components, safetyScore, confidence);
  const recommendations = buildRecommendations({
    infrastructure: components.infrastructure.score,
    temporal: components.temporal.score,
    publicIncidents: components.publicIncidents.score,
    cvBehavior: components.cvBehavior.score
  });

  const deploymentReadiness = buildDeploymentReadiness(confidence, components);

  return {
    model: 'safezone-product-risk-v1',
    score: safetyScore,
    penalty,
    confidence: confidence.label,
    confidenceScore: Number((confidence.score * 100).toFixed(1)),
    components: {
      infrastructure: Number(components.infrastructure.score.toFixed(2)),
      temporal: Number(components.temporal.score.toFixed(2)),
      publicIncidents: Number(components.publicIncidents.score.toFixed(2)),
      cvBehavior: Number(components.cvBehavior.score.toFixed(2))
    },
    weights,
    factors,
    recommendations,
    deploymentReadiness,
    diagnostics: {
      infrastructure: components.infrastructure.diagnostics,
      temporal: components.temporal.diagnostics,
      publicIncidents: components.publicIncidents.diagnostics,
      cvBehavior: components.cvBehavior.diagnostics
    }
  };
}

module.exports = {
  scoreSafetyContext,
  calculateInfrastructureRisk,
  calculatePublicIncidentRisk,
  calculateTemporalRisk,
  calculateCvBehaviorRisk
};
