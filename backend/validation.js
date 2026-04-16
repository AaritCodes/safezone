'use strict';

function addError(errors, field, issue) {
  errors.push({ field, issue });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '', maxLength = 120) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function readRangedNumber(value, field, min, max, required, errors, fallback = 0) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    if (required) {
      addError(errors, field, 'must be a finite number');
    }
    return fallback;
  }

  if (parsed < min || parsed > max) {
    addError(errors, field, `must be between ${min} and ${max}`);
  }

  return Math.max(min, Math.min(max, parsed));
}

function sanitizeServiceList(list, field, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    addError(errors, field, 'must be an array');
    return [];
  }

  if (list.length > 64) {
    addError(errors, field, 'must contain at most 64 entries');
  }

  return list.slice(0, 64).map((item, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(item)) {
      addError(errors, path, 'must be an object');
      return {
        id: `${field}_${index + 1}`,
        distance: 0,
        status: 'unknown'
      };
    }

    return {
      id: normalizeString(item.id, `${field}_${index + 1}`, 64),
      distance: readRangedNumber(item.distance, `${path}.distance`, 0, 100000, false, errors, 0),
      status: normalizeString(item.status, 'unknown', 32)
    };
  });
}

function sanitizeCameras(cameras, errors) {
  if (cameras === undefined) return [];
  if (!Array.isArray(cameras)) {
    addError(errors, 'cameras', 'must be an array');
    return [];
  }

  if (cameras.length > 200) {
    addError(errors, 'cameras', 'must contain at most 200 entries');
  }

  return cameras.slice(0, 200).map((camera, index) => {
    const path = `cameras[${index}]`;
    if (!isPlainObject(camera)) {
      addError(errors, path, 'must be an object');
      return {
        id: `camera_${index + 1}`,
        status: 'unknown',
        coverage: 0,
        distance: 0
      };
    }

    return {
      id: normalizeString(camera.id, `camera_${index + 1}`, 64),
      status: normalizeString(camera.status, 'unknown', 32),
      coverage: readRangedNumber(camera.coverage, `${path}.coverage`, 0, 1000, false, errors, 0),
      distance: readRangedNumber(camera.distance, `${path}.distance`, 0, 100000, false, errors, 0)
    };
  });
}

function sanitizePublicRisk(publicRisk, errors) {
  if (publicRisk === undefined) {
    return {
      theftCount: 0,
      violentCount: 0,
      accidentHotspots: 0,
      conflictPoints: 0,
      reliabilityScore: 0,
      confidence: 'low'
    };
  }

  if (!isPlainObject(publicRisk)) {
    addError(errors, 'publicRisk', 'must be an object');
    return {
      theftCount: 0,
      violentCount: 0,
      accidentHotspots: 0,
      conflictPoints: 0,
      reliabilityScore: 0,
      confidence: 'low'
    };
  }

  return {
    theftCount: readRangedNumber(publicRisk.theftCount, 'publicRisk.theftCount', 0, 100000, false, errors, 0),
    violentCount: readRangedNumber(publicRisk.violentCount, 'publicRisk.violentCount', 0, 100000, false, errors, 0),
    accidentHotspots: readRangedNumber(publicRisk.accidentHotspots, 'publicRisk.accidentHotspots', 0, 100000, false, errors, 0),
    conflictPoints: readRangedNumber(publicRisk.conflictPoints, 'publicRisk.conflictPoints', 0, 100000, false, errors, 0),
    reliabilityScore: readRangedNumber(publicRisk.reliabilityScore, 'publicRisk.reliabilityScore', 0, 100, false, errors, 0),
    confidence: normalizeString(publicRisk.confidence, 'low', 16)
  };
}

function sanitizeAreaInfo(areaInfo, errors) {
  if (areaInfo === undefined) {
    return {
      name: '',
      type: 'unknown',
      category: 'unknown'
    };
  }

  if (!isPlainObject(areaInfo)) {
    addError(errors, 'areaInfo', 'must be an object');
    return {
      name: '',
      type: 'unknown',
      category: 'unknown'
    };
  }

  return {
    name: normalizeString(areaInfo.name, '', 120),
    type: normalizeString(areaInfo.type, 'unknown', 48),
    category: normalizeString(areaInfo.category, 'unknown', 48)
  };
}

function sanitizeCvContext(cv, errors) {
  if (cv === undefined) return undefined;
  if (!isPlainObject(cv)) {
    addError(errors, 'cv', 'must be an object');
    return undefined;
  }

  const sceneRisk = isPlainObject(cv.sceneRisk) ? cv.sceneRisk : {};
  const detections = Array.isArray(cv.detections) ? cv.detections.slice(0, 500) : [];

  return {
    provider: normalizeString(cv.provider, 'yolov8-sim-coco', 64),
    detections,
    sceneRisk: {
      score: readRangedNumber(sceneRisk.score, 'cv.sceneRisk.score', 0, 100, false, errors, 0),
      level: normalizeString(sceneRisk.level, 'low', 24),
      confidence: readRangedNumber(sceneRisk.confidence, 'cv.sceneRisk.confidence', 0, 1, false, errors, 0.5),
      signals: Array.isArray(sceneRisk.signals)
        ? sceneRisk.signals.slice(0, 10).map((item) => normalizeString(item, '', 160)).filter(Boolean)
        : []
    }
  };
}

function validatePayload(payload, options = {}) {
  const requireCoordinates = options.requireCoordinates !== false;
  const allowCv = Boolean(options.allowCv);
  const errors = [];

  if (!isPlainObject(payload)) {
    addError(errors, 'payload', 'must be a JSON object');
    return {
      ok: false,
      errors,
      value: null
    };
  }

  const value = {
    lat: readRangedNumber(payload.lat, 'lat', -90, 90, requireCoordinates, errors, 0),
    lng: readRangedNumber(payload.lng, 'lng', -180, 180, requireCoordinates, errors, 0),
    hour: Math.round(readRangedNumber(payload.hour, 'hour', 0, 23, false, errors, new Date().getHours())),
    areaInfo: sanitizeAreaInfo(payload.areaInfo, errors),
    services: {
      police: sanitizeServiceList(payload.services && payload.services.police, 'services.police', errors),
      hospital: sanitizeServiceList(payload.services && payload.services.hospital, 'services.hospital', errors),
      fire: sanitizeServiceList(payload.services && payload.services.fire, 'services.fire', errors)
    },
    cameras: sanitizeCameras(payload.cameras, errors),
    publicRisk: sanitizePublicRisk(payload.publicRisk, errors)
  };

  if (allowCv) {
    const cv = sanitizeCvContext(payload.cv, errors);
    if (cv) value.cv = cv;
  }

  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 30),
    value
  };
}

function validateAnalyzePayload(payload) {
  return validatePayload(payload, {
    requireCoordinates: true,
    allowCv: false
  });
}

function validateCvSimulationPayload(payload) {
  return validatePayload(payload, {
    requireCoordinates: true,
    allowCv: false
  });
}

function validateRiskScorePayload(payload) {
  return validatePayload(payload, {
    requireCoordinates: true,
    allowCv: true
  });
}

function validateGovernanceLabelPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    addError(errors, 'payload', 'must be a JSON object');
    return {
      ok: false,
      errors,
      value: null
    };
  }

  const value = {
    traceId: normalizeString(payload.traceId, '', 128),
    modelVersion: normalizeString(payload.modelVersion, 'unknown', 64),
    sourceMode: normalizeString(payload.sourceMode, 'unknown', 32),
    labelSource: normalizeString(payload.labelSource, 'manual', 32),
    predictedProbability: readRangedNumber(
      payload.predictedProbability,
      'predictedProbability',
      0,
      1,
      true,
      errors,
      0
    ),
    incidentOccurred: false,
    timestamp: new Date().toISOString()
  };

  if (typeof payload.incidentOccurred === 'boolean') {
    value.incidentOccurred = payload.incidentOccurred;
  } else {
    addError(errors, 'incidentOccurred', 'must be a boolean');
  }

  if (payload.timestamp !== undefined) {
    const timestamp = String(payload.timestamp || '').trim();
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      addError(errors, 'timestamp', 'must be a valid ISO timestamp');
    } else {
      value.timestamp = new Date(timestamp).toISOString();
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 20),
    value
  };
}

module.exports = {
  validateAnalyzePayload,
  validateCvSimulationPayload,
  validateRiskScorePayload,
  validateGovernanceLabelPayload,
  validatePayload
};
