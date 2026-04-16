'use strict';

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BASELINE_METRICS = {
  sceneRiskScore: [0.1, 0.2, 0.35, 0.25, 0.1],
  detectionCount: [0.25, 0.35, 0.25, 0.1, 0.05],
  sceneConfidence: [0.05, 0.15, 0.35, 0.3, 0.15]
};

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + Number(value || 0), 0);
  return sum / values.length;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function readNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value, fallback = 'unknown', maxLength = 64) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function toIsoTimestamp(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString();
}

function sanitizeFileName(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\\/g, '/').split('/').pop();
  return normalized || fallback;
}

function safeJsonParse(content, fallback) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function loadJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return safeJsonParse(raw, fallback);
  } catch (err) {
    return fallback;
  }
}

function round(value, precision = 5) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = Math.pow(10, precision);
  return Math.round(Number(value) * factor) / factor;
}

function computeRate(numerator, denominator) {
  if (!Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator)) || Number(denominator) <= 0) {
    return null;
  }
  return Number(numerator) / Number(denominator);
}

function parseHourBucket(hourValue) {
  const hour = readNumber(hourValue, null);
  if (hour === null) return 'unknown';
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  if (normalized <= 5) return 'night';
  if (normalized <= 11) return 'morning';
  if (normalized <= 17) return 'afternoon';
  return 'evening';
}

function parseRiskBucket(scoreValue) {
  const score = readNumber(scoreValue, null);
  if (score === null) return 'unknown';
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function mergeBaselineMetrics(candidate) {
  const source = candidate && typeof candidate === 'object'
    ? candidate
    : {};

  const merged = {};
  for (const key of Object.keys(DEFAULT_BASELINE_METRICS)) {
    const fallback = DEFAULT_BASELINE_METRICS[key];
    const input = Array.isArray(source[key]) ? source[key] : fallback;
    merged[key] = input.length === fallback.length
      ? input.map((item) => Math.max(0, Number(item || 0)))
      : fallback.slice();
  }

  return merged;
}

function buildHistogram(values, bins) {
  const counts = new Array(bins.length - 1).fill(0);
  if (!Array.isArray(values) || values.length === 0) return counts;

  for (const rawValue of values) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;

    for (let i = 0; i < bins.length - 1; i += 1) {
      const lower = bins[i];
      const upper = bins[i + 1];
      const isLastBin = i === bins.length - 2;

      if ((value >= lower && value < upper) || (isLastBin && value === upper)) {
        counts[i] += 1;
        break;
      }
    }
  }

  return counts;
}

function normalizeCounts(counts) {
  const total = counts.reduce((acc, item) => acc + item, 0);
  if (total <= 0) return counts.map(() => 0);
  return counts.map((count) => count / total);
}

function computePsi(expectedDist, actualDist, epsilon = 1e-6) {
  let psi = 0;

  for (let i = 0; i < expectedDist.length; i += 1) {
    const expected = Math.max(expectedDist[i], epsilon);
    const actual = Math.max(actualDist[i], epsilon);
    psi += (actual - expected) * Math.log(actual / expected);
  }

  return psi;
}

function computeBrierScore(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const values = samples
    .map((item) => {
      const probability = clamp(item.predictedProbability, 0, 1);
      const observed = item.incidentOccurred ? 1 : 0;
      return Math.pow(probability - observed, 2);
    })
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return null;
  return mean(values);
}

function computeAuroc(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const entries = samples
    .map((item) => ({
      probability: clamp(item.predictedProbability, 0, 1),
      label: item.incidentOccurred ? 1 : 0
    }))
    .filter((item) => Number.isFinite(item.probability));

  const positiveCount = entries.filter((item) => item.label === 1).length;
  const negativeCount = entries.length - positiveCount;

  if (positiveCount === 0 || negativeCount === 0) {
    return null;
  }

  entries.sort((a, b) => a.probability - b.probability);

  let rank = 1;
  let positiveRankSum = 0;

  for (let i = 0; i < entries.length; i += 1) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].probability === entries[i].probability) {
      j += 1;
    }

    const averageRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k += 1) {
      if (entries[k].label === 1) {
        positiveRankSum += averageRank;
      }
    }

    rank += (j - i + 1);
    i = j;
  }

  const auc = (positiveRankSum - ((positiveCount * (positiveCount + 1)) / 2)) / (positiveCount * negativeCount);
  return round(auc, 5);
}

function computePrAuc(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const entries = samples
    .map((item) => ({
      probability: clamp(item.predictedProbability, 0, 1),
      label: item.incidentOccurred ? 1 : 0
    }))
    .filter((item) => Number.isFinite(item.probability))
    .sort((a, b) => b.probability - a.probability);

  const positiveCount = entries.filter((item) => item.label === 1).length;
  if (positiveCount === 0) {
    return null;
  }

  let tp = 0;
  let fp = 0;
  let previousRecall = 0;
  let area = 0;

  for (const entry of entries) {
    if (entry.label === 1) tp += 1;
    else fp += 1;

    const recall = tp / positiveCount;
    const precision = tp / (tp + fp);
    area += (recall - previousRecall) * precision;
    previousRecall = recall;
  }

  return round(area, 5);
}

function computeCalibrationBins(samples, binCount = 10) {
  const bins = [];
  for (let i = 0; i < binCount; i += 1) {
    bins.push({
      start: i / binCount,
      end: (i + 1) / binCount,
      count: 0,
      predictedSum: 0,
      observedSum: 0
    });
  }

  for (const sample of samples || []) {
    const probability = clamp(sample.predictedProbability, 0, 1);
    if (!Number.isFinite(probability)) continue;
    const index = Math.min(binCount - 1, Math.floor(probability * binCount));
    bins[index].count += 1;
    bins[index].predictedSum += probability;
    bins[index].observedSum += sample.incidentOccurred ? 1 : 0;
  }

  return bins.map((bucket) => ({
    rangeStart: round(bucket.start, 3),
    rangeEnd: round(bucket.end, 3),
    sampleSize: bucket.count,
    meanPredictedProbability: bucket.count > 0 ? round(bucket.predictedSum / bucket.count, 5) : null,
    observedIncidentRate: bucket.count > 0 ? round(bucket.observedSum / bucket.count, 5) : null,
    calibrationGap: bucket.count > 0
      ? round((bucket.predictedSum / bucket.count) - (bucket.observedSum / bucket.count), 5)
      : null
  }));
}

function summarizeSliceSamples(samples, labelLookup) {
  const probabilities = samples.map((item) => item.predictedProbability).filter((value) => Number.isFinite(value));
  const confidences = samples.map((item) => item.sceneConfidence).filter((value) => Number.isFinite(value));
  const latencies = samples.map((item) => item.inferenceLatencyMs).filter((value) => Number.isFinite(value));

  let labeledMatches = 0;
  let labeledIncidents = 0;

  for (const sample of samples) {
    const traceId = String(sample.traceId || '').trim();
    if (!traceId || !labelLookup.has(traceId)) continue;
    const outcomes = labelLookup.get(traceId);
    labeledMatches += outcomes.length;
    labeledIncidents += outcomes.reduce((acc, item) => acc + (item ? 1 : 0), 0);
  }

  return {
    sampleSize: samples.length,
    meanPredictedProbability: probabilities.length > 0 ? round(mean(probabilities), 5) : null,
    meanConfidence: confidences.length > 0 ? round(mean(confidences), 5) : null,
    meanLatencyMs: latencies.length > 0 ? round(mean(latencies), 2) : null,
    labeledSampleSize: labeledMatches,
    observedIncidentRate: labeledMatches > 0 ? round(labeledIncidents / labeledMatches, 5) : null
  };
}

function summarizeHistoryWindow(entries, days) {
  const now = Date.now();
  const cutoff = now - (days * DAY_MS);

  const filtered = (entries || []).filter((entry) => {
    const ts = Date.parse(entry.generatedAt || entry.date || '');
    return Number.isFinite(ts) && ts >= cutoff;
  });

  if (filtered.length === 0) {
    return {
      days,
      sampleSize: 0,
      avgMaxDriftPsi: null,
      avgBrierScore: null,
      requiresActionRate: null,
      staleInferenceRate: null
    };
  }

  const driftValues = filtered.map((entry) => readNumber(entry.maxDriftPsi, null)).filter((item) => item !== null);
  const brierValues = filtered.map((entry) => readNumber(entry.brierScore, null)).filter((item) => item !== null);
  const requiresAction = filtered.filter((entry) => entry.status === 'requires_action').length;
  const staleInference = filtered.filter((entry) => Boolean(entry.inferenceStale)).length;

  return {
    days,
    sampleSize: filtered.length,
    avgMaxDriftPsi: driftValues.length > 0 ? round(mean(driftValues), 5) : null,
    avgBrierScore: brierValues.length > 0 ? round(mean(brierValues), 5) : null,
    requiresActionRate: round(requiresAction / filtered.length, 5),
    staleInferenceRate: round(staleInference / filtered.length, 5)
  };
}

function loadBaseline(filePath) {
  const parsed = loadJsonFile(filePath, {});

  return {
    filePath,
    version: normalizeText(parsed.version, 'default-baseline', 64),
    promotedAt: toIsoTimestamp(parsed.promotedAt, null),
    modelVersion: normalizeText(parsed.modelVersion, 'unknown', 64),
    metrics: mergeBaselineMetrics(parsed.metrics),
    notes: normalizeText(parsed.notes, '', 500)
  };
}

function loadManifest(filePath) {
  const fallback = {
    modelVersion: 'unknown',
    owner: 'unassigned',
    trainingWindow: 'unspecified',
    intendedUse: 'SafeZone safety scoring support',
    limitations: ['Manifest not configured. Add backend/model-baselines/model-manifest.json.'],
    approval: {
      status: 'pending',
      approvedBy: '',
      approvedAt: null
    }
  };

  const parsed = loadJsonFile(filePath, fallback);
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map((item) => normalizeText(item, '', 220)).filter(Boolean)
    : fallback.limitations;

  return {
    modelVersion: normalizeText(parsed.modelVersion, fallback.modelVersion, 64),
    owner: normalizeText(parsed.owner, fallback.owner, 120),
    trainingWindow: normalizeText(parsed.trainingWindow, fallback.trainingWindow, 120),
    intendedUse: normalizeText(parsed.intendedUse, fallback.intendedUse, 320),
    limitations,
    approval: {
      status: normalizeText(parsed.approval && parsed.approval.status, 'pending', 32),
      approvedBy: normalizeText(parsed.approval && parsed.approval.approvedBy, '', 120),
      approvedAt: toIsoTimestamp(parsed.approval && parsed.approval.approvedAt, null)
    }
  };
}

function loadHistory(filePath, maxHistoryDays) {
  const parsed = loadJsonFile(filePath, {});
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

  const normalized = entries.map((entry) => ({
    date: String(entry.date || '').slice(0, 10),
    generatedAt: toIsoTimestamp(entry.generatedAt, null),
    status: normalizeText(entry.status, 'unknown', 32),
    severity: normalizeText(entry.severity, 'warning', 32),
    maxDriftPsi: readNumber(entry.maxDriftPsi, null),
    brierScore: readNumber(entry.brierScore, null),
    inferenceSamples: readNumber(entry.inferenceSamples, 0),
    labelSamples: readNumber(entry.labelSamples, 0),
    inferenceStale: Boolean(entry.inferenceStale)
  })).filter((entry) => entry.date.length === 10);

  if (normalized.length <= maxHistoryDays) {
    return normalized;
  }

  return normalized.slice(normalized.length - maxHistoryDays);
}

class ModelGovernance {
  constructor(config = {}, logger) {
    this.config = {
      enabled: config.enabled !== false,
      driftPsiThreshold: Number(config.driftPsiThreshold || 0.2),
      minSamplesForDrift: Number(config.minSamplesForDrift || 100),
      calibrationBrierThreshold: Number(config.calibrationBrierThreshold || 0.22),
      minLabelsForCalibration: Number(config.minLabelsForCalibration || 50),
      maxInferenceSamples: Number(config.maxInferenceSamples || 5000),
      maxLabelSamples: Number(config.maxLabelSamples || 2000),
      staleInferenceHours: Number(config.staleInferenceHours || 24),
      staleLabelHours: Number(config.staleLabelHours || (24 * 14)),
      maxNullRate: Number(config.maxNullRate || 0.35),
      maxHistoryDays: Number(config.maxHistoryDays || 180),
      historyEnabled: config.historyEnabled !== false && process.env.NODE_ENV !== 'test',
      calibrationBinCount: Math.max(5, Math.min(20, Number(config.calibrationBinCount || 10))),
      minLabelsForDiscrimination: Number(config.minLabelsForDiscrimination || 50)
    };

    this.logger = logger || {
      info() {},
      warn() {},
      error() {}
    };
    this.startedAt = new Date().toISOString();
    this.inferenceSamples = [];
    this.labelSamples = [];
    this.ingestionStats = {
      acceptedInference: 0,
      rejectedInference: 0,
      acceptedNullRateSum: 0,
      rejectedByReason: {},
      lastRejectedAt: null,
      lastRejectedReasons: []
    };

    this.bins = {
      sceneRiskScore: [0, 20, 40, 60, 80, 100],
      detectionCount: [0, 5, 10, 20, 40, 100],
      sceneConfidence: [0, 0.2, 0.4, 0.6, 0.8, 1]
    };

    this.baselineDir = path.resolve(__dirname, 'model-baselines');
    this.baselineFileName = sanitizeFileName(config.baselineFileName, 'default-baseline.json');
    this.manifestFileName = sanitizeFileName(config.manifestFileName, 'model-manifest.json');
    this.historyFileName = sanitizeFileName(config.historyFileName, 'governance-history.json');

    this.baselinePath = path.resolve(this.baselineDir, this.baselineFileName);
    this.manifestPath = path.resolve(this.baselineDir, this.manifestFileName);
    this.historyPath = path.resolve(this.baselineDir, this.historyFileName);

    this.baseline = loadBaseline(this.baselinePath);
    this.manifest = loadManifest(this.manifestPath);
    this.history = this.config.historyEnabled
      ? loadHistory(this.historyPath, this.config.maxHistoryDays)
      : [];
  }

  trimBuffers() {
    if (this.inferenceSamples.length > this.config.maxInferenceSamples) {
      this.inferenceSamples.splice(0, this.inferenceSamples.length - this.config.maxInferenceSamples);
    }

    if (this.labelSamples.length > this.config.maxLabelSamples) {
      this.labelSamples.splice(0, this.labelSamples.length - this.config.maxLabelSamples);
    }
  }

  normalizeInferenceSample(sample = {}) {
    const inputSummary = sample.inputSummary && typeof sample.inputSummary === 'object'
      ? sample.inputSummary
      : {};

    const missingFields = [];

    const modelVersionRaw = normalizeText(sample.modelVersion, '', 64);
    if (!modelVersionRaw) missingFields.push('modelVersion');

    const sourceModeRaw = normalizeText(sample.sourceMode, '', 32);
    if (!sourceModeRaw) missingFields.push('sourceMode');

    const sceneRiskScoreRaw = readNumber(sample.sceneRiskScore, null);
    if (sceneRiskScoreRaw === null) missingFields.push('sceneRiskScore');

    const sceneConfidenceRaw = readNumber(sample.sceneConfidence, readNumber(sample.confidence, null));
    if (sceneConfidenceRaw === null) missingFields.push('sceneConfidence');

    const predictionProbabilityRaw = readNumber(
      sample.predictedProbability,
      sceneRiskScoreRaw === null ? null : (sceneRiskScoreRaw / 100)
    );
    if (predictionProbabilityRaw === null) missingFields.push('predictedProbability');

    const inferenceLatencyMsRaw = readNumber(sample.inferenceLatencyMs, readNumber(sample.latencyMs, null));
    if (inferenceLatencyMsRaw === null) missingFields.push('inferenceLatencyMs');

    const qualityFieldsTotal = 6;
    const nullRate = missingFields.length / qualityFieldsTotal;
    const rejectionReasons = [];

    if (nullRate > this.config.maxNullRate) {
      rejectionReasons.push('null_rate_exceeded');
    }

    if (missingFields.includes('modelVersion')) rejectionReasons.push('missing_model_version');
    if (missingFields.includes('sourceMode')) rejectionReasons.push('missing_source_mode');
    if (missingFields.includes('sceneRiskScore')) rejectionReasons.push('missing_scene_risk_score');
    if (missingFields.includes('sceneConfidence')) rejectionReasons.push('missing_scene_confidence');
    if (missingFields.includes('predictedProbability')) rejectionReasons.push('missing_predicted_probability');

    if (rejectionReasons.length > 0) {
      return {
        accepted: false,
        nullRate: round(nullRate, 5),
        missingFields,
        rejectionReasons
      };
    }

    const hourRaw = readNumber(inputSummary.hour, readNumber(sample.hour, null));
    const cameraCountRaw = readNumber(inputSummary.cameraCount, null);
    const serviceCountRaw = readNumber(inputSummary.serviceCount, null);
    const publicRiskSignalsRaw = readNumber(inputSummary.publicRiskSignals, null);

    const sceneRiskScore = clamp(sceneRiskScoreRaw, 0, 100);
    const predictedProbability = clamp(predictionProbabilityRaw, 0, 1);
    const sceneConfidence = clamp(sceneConfidenceRaw, 0, 1);
    const inferenceLatencyMs = clamp(inferenceLatencyMsRaw, 0, 300000);

    return {
      accepted: true,
      sample: {
        timestamp: toIsoTimestamp(sample.timestamp, new Date().toISOString()),
        traceId: normalizeText(sample.traceId, '', 128),
        modelVersion: modelVersionRaw,
        sourceMode: sourceModeRaw,
        sceneRiskScore: round(sceneRiskScore, 5),
        detectionCount: Math.round(clamp(readNumber(sample.detectionCount, 0), 0, 500)),
        sceneConfidence: round(sceneConfidence, 5),
        predictedProbability: round(predictedProbability, 5),
        predictionScore: Math.round(clamp(readNumber(sample.predictionScore, sceneRiskScore), 0, 100)),
        inferenceLatencyMs: Math.round(inferenceLatencyMs),
        inputSummary: {
          hour: hourRaw === null ? null : ((Math.round(hourRaw) % 24) + 24) % 24,
          hourBucket: parseHourBucket(hourRaw),
          areaType: normalizeText(inputSummary.areaType, normalizeText(sample.areaType, 'unknown', 48), 48).toLowerCase(),
          areaCategory: normalizeText(inputSummary.areaCategory, normalizeText(sample.areaCategory, 'unknown', 48), 48).toLowerCase(),
          serviceCount: Math.max(0, Math.round(serviceCountRaw === null ? 0 : serviceCountRaw)),
          cameraCount: Math.max(0, Math.round(cameraCountRaw === null ? 0 : cameraCountRaw)),
          publicRiskSignals: Math.max(0, Math.round(publicRiskSignalsRaw === null ? 0 : publicRiskSignalsRaw))
        },
        riskBucket: parseRiskBucket(sceneRiskScore),
        quality: {
          nullRate: round(nullRate, 5),
          missingFields: []
        }
      }
    };
  }

  recordInference(sample = {}) {
    if (!this.config.enabled) {
      return {
        accepted: false,
        reasons: ['governance_disabled'],
        missingFields: [],
        nullRate: 0
      };
    }

    const normalized = this.normalizeInferenceSample(sample);
    if (!normalized.accepted) {
      this.ingestionStats.rejectedInference += 1;
      this.ingestionStats.lastRejectedAt = new Date().toISOString();
      this.ingestionStats.lastRejectedReasons = normalized.rejectionReasons.slice(0, 5);

      for (const reason of normalized.rejectionReasons) {
        this.ingestionStats.rejectedByReason[reason] = Number(this.ingestionStats.rejectedByReason[reason] || 0) + 1;
      }

      this.logger.warn('governance.inference_rejected', {
        reasons: normalized.rejectionReasons,
        missingFields: normalized.missingFields,
        nullRate: normalized.nullRate
      });

      return {
        accepted: false,
        reasons: normalized.rejectionReasons,
        missingFields: normalized.missingFields,
        nullRate: normalized.nullRate
      };
    }

    this.inferenceSamples.push(normalized.sample);
    this.ingestionStats.acceptedInference += 1;
    this.ingestionStats.acceptedNullRateSum += Number(normalized.sample.quality.nullRate || 0);
    this.trimBuffers();

    return {
      accepted: true,
      nullRate: normalized.sample.quality.nullRate
    };
  }

  recordGroundTruth(payload = {}) {
    if (!this.config.enabled) {
      return {
        accepted: false,
        message: 'model governance is disabled'
      };
    }

    const predictedProbability = clamp(payload.predictedProbability, 0, 1);
    const incidentOccurred = Boolean(payload.incidentOccurred);

    const sample = {
      timestamp: payload.timestamp || new Date().toISOString(),
      traceId: String(payload.traceId || '').trim(),
      modelVersion: String(payload.modelVersion || 'unknown').trim(),
      sourceMode: String(payload.sourceMode || 'unknown').trim(),
      predictedProbability,
      incidentOccurred,
      labelSource: String(payload.labelSource || 'manual').trim()
    };

    this.labelSamples.push(sample);
    this.trimBuffers();

    this.logger.info('governance.label_recorded', {
      modelVersion: sample.modelVersion,
      sourceMode: sample.sourceMode,
      labelSource: sample.labelSource
    });

    return {
      accepted: true,
      totalLabels: this.labelSamples.length
    };
  }

  computeSliceMetrics() {
    const labelLookup = new Map();
    for (const sample of this.labelSamples) {
      const traceId = String(sample.traceId || '').trim();
      if (!traceId) continue;
      if (!labelLookup.has(traceId)) {
        labelLookup.set(traceId, []);
      }
      labelLookup.get(traceId).push(Boolean(sample.incidentOccurred));
    }

    function groupSamples(records, keySelector) {
      const grouped = new Map();

      for (const item of records) {
        const key = normalizeText(keySelector(item), 'unknown', 64).toLowerCase();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
      }

      const summary = {};
      const keys = Array.from(grouped.keys()).sort();
      for (const key of keys) {
        summary[key] = summarizeSliceSamples(grouped.get(key), labelLookup);
      }
      return summary;
    }

    return {
      hourBucket: groupSamples(this.inferenceSamples, (item) => item.inputSummary && item.inputSummary.hourBucket),
      areaType: groupSamples(this.inferenceSamples, (item) => item.inputSummary && item.inputSummary.areaType),
      riskBucket: groupSamples(this.inferenceSamples, (item) => item.riskBucket)
    };
  }

  computeFreshness() {
    const now = Date.now();
    const latestInference = this.inferenceSamples.length > 0
      ? this.inferenceSamples[this.inferenceSamples.length - 1]
      : null;
    const latestLabel = this.labelSamples.length > 0
      ? this.labelSamples[this.labelSamples.length - 1]
      : null;

    const inferenceTs = latestInference ? Date.parse(latestInference.timestamp) : NaN;
    const labelTs = latestLabel ? Date.parse(latestLabel.timestamp) : NaN;

    const inferenceAgeHours = Number.isFinite(inferenceTs)
      ? (now - inferenceTs) / (60 * 60 * 1000)
      : null;
    const labelAgeHours = Number.isFinite(labelTs)
      ? (now - labelTs) / (60 * 60 * 1000)
      : null;

    return {
      lastInferenceAt: latestInference ? latestInference.timestamp : null,
      lastLabelAt: latestLabel ? latestLabel.timestamp : null,
      inferenceAgeHours: inferenceAgeHours === null ? null : round(inferenceAgeHours, 3),
      labelAgeHours: labelAgeHours === null ? null : round(labelAgeHours, 3),
      inferenceStale: inferenceAgeHours !== null && inferenceAgeHours > this.config.staleInferenceHours,
      labelStale: labelAgeHours !== null && labelAgeHours > this.config.staleLabelHours,
      staleInferenceThresholdHours: this.config.staleInferenceHours,
      staleLabelThresholdHours: this.config.staleLabelHours,
      hasInferenceData: this.inferenceSamples.length > 0,
      hasLabelData: this.labelSamples.length > 0
    };
  }

  computeIngestionQuality() {
    const accepted = this.ingestionStats.acceptedInference;
    const rejected = this.ingestionStats.rejectedInference;
    const total = accepted + rejected;

    return {
      acceptedInference: accepted,
      rejectedInference: rejected,
      rejectionRate: total > 0 ? round(rejected / total, 5) : 0,
      maxNullRate: this.config.maxNullRate,
      meanAcceptedNullRate: accepted > 0
        ? round(this.ingestionStats.acceptedNullRateSum / accepted, 5)
        : 0,
      rejectedByReason: {
        ...this.ingestionStats.rejectedByReason
      },
      lastRejectedAt: this.ingestionStats.lastRejectedAt,
      lastRejectedReasons: this.ingestionStats.lastRejectedReasons.slice()
    };
  }

  persistDailySnapshot(report) {
    if (!this.config.historyEnabled) return;

    const generatedAt = toIsoTimestamp(report.generatedAt, new Date().toISOString());
    const date = generatedAt.slice(0, 10);
    const maxDriftPsi = Math.max(
      ...Object.values(report.drift || {}).map((item) => Number(item.psi || 0))
    );

    const snapshot = {
      date,
      generatedAt,
      status: report.status,
      severity: report.severity,
      maxDriftPsi: round(maxDriftPsi, 5),
      brierScore: report.calibration && report.calibration.brierScore !== null
        ? Number(report.calibration.brierScore)
        : null,
      inferenceSamples: report.sampleCounts && report.sampleCounts.inference
        ? Number(report.sampleCounts.inference)
        : 0,
      labelSamples: report.sampleCounts && report.sampleCounts.labels
        ? Number(report.sampleCounts.labels)
        : 0,
      inferenceStale: Boolean(report.freshness && report.freshness.inferenceStale)
    };

    const index = this.history.findIndex((entry) => entry.date === date);
    if (index >= 0) {
      this.history[index] = snapshot;
    } else {
      this.history.push(snapshot);
    }

    this.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (this.history.length > this.config.maxHistoryDays) {
      this.history.splice(0, this.history.length - this.config.maxHistoryDays);
    }

    try {
      fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
      fs.writeFileSync(this.historyPath, JSON.stringify({
        updatedAt: new Date().toISOString(),
        entries: this.history
      }, null, 2));
    } catch (err) {
      this.logger.error('governance.history_write_failed', {
        path: this.historyPath,
        error: err
      });
    }
  }

  computeTrend() {
    const rolling7 = summarizeHistoryWindow(this.history, 7);
    const rolling30 = summarizeHistoryWindow(this.history, 30);

    const deltaDrift = (rolling7.avgMaxDriftPsi !== null && rolling30.avgMaxDriftPsi !== null)
      ? round(rolling7.avgMaxDriftPsi - rolling30.avgMaxDriftPsi, 5)
      : null;

    const deltaBrier = (rolling7.avgBrierScore !== null && rolling30.avgBrierScore !== null)
      ? round(rolling7.avgBrierScore - rolling30.avgBrierScore, 5)
      : null;

    return {
      historyEntries: this.history.length,
      rolling7,
      rolling30,
      delta: {
        maxDriftPsi: deltaDrift,
        brierScore: deltaBrier
      }
    };
  }

  computeDrift() {
    const metrics = {
      sceneRiskScore: this.inferenceSamples.map((item) => item.sceneRiskScore),
      detectionCount: this.inferenceSamples.map((item) => item.detectionCount),
      sceneConfidence: this.inferenceSamples.map((item) => item.sceneConfidence)
    };

    const drift = {};

    for (const metricName of Object.keys(metrics)) {
      const values = metrics[metricName];
      const bins = this.bins[metricName];
      const actualCounts = buildHistogram(values, bins);
      const actualDist = normalizeCounts(actualCounts);

      const expectedRaw = Array.isArray(this.baseline.metrics && this.baseline.metrics[metricName])
        ? this.baseline.metrics[metricName]
        : [0.2, 0.2, 0.2, 0.2, 0.2];
      const expectedDist = normalizeCounts(expectedRaw);

      const psi = computePsi(expectedDist, actualDist);
      const sampleSize = values.length;
      const hasEnoughSamples = sampleSize >= this.config.minSamplesForDrift;

      drift[metricName] = {
        psi: Number(psi.toFixed(5)),
        threshold: this.config.driftPsiThreshold,
        breached: hasEnoughSamples && psi >= this.config.driftPsiThreshold,
        sampleSize,
        minRequired: this.config.minSamplesForDrift,
        status: hasEnoughSamples ? 'evaluated' : 'insufficient_samples'
      };
    }

    return drift;
  }

  computeCalibration() {
    const sampleSize = this.labelSamples.length;
    const score = computeBrierScore(this.labelSamples);
    const discriminationReady = sampleSize >= this.config.minLabelsForDiscrimination;
    const auroc = discriminationReady ? computeAuroc(this.labelSamples) : null;
    const prAuc = discriminationReady ? computePrAuc(this.labelSamples) : null;
    const calibrationBins = computeCalibrationBins(this.labelSamples, this.config.calibrationBinCount);

    const positives = this.labelSamples.filter((item) => item.incidentOccurred).length;
    const negatives = sampleSize - positives;

    const discrimination = {
      status: discriminationReady
        ? ((auroc === null || prAuc === null) ? 'single_class' : 'evaluated')
        : 'insufficient_labels',
      minRequired: this.config.minLabelsForDiscrimination,
      sampleSize,
      positiveCount: positives,
      negativeCount: negatives,
      auroc,
      prAuc
    };

    if (sampleSize < this.config.minLabelsForCalibration || score === null) {
      return {
        sampleSize,
        minRequired: this.config.minLabelsForCalibration,
        brierScore: score,
        threshold: this.config.calibrationBrierThreshold,
        breached: false,
        status: 'insufficient_labels',
        discrimination,
        bins: calibrationBins
      };
    }

    return {
      sampleSize,
      minRequired: this.config.minLabelsForCalibration,
      brierScore: Number(score.toFixed(5)),
      threshold: this.config.calibrationBrierThreshold,
      breached: score >= this.config.calibrationBrierThreshold,
      status: 'evaluated',
      discrimination,
      bins: calibrationBins
    };
  }

  buildRecommendations(drift, calibration, freshness, ingestionQuality) {
    const recommendations = [];

    const breachedMetrics = Object.entries(drift)
      .filter(([, value]) => value.breached)
      .map(([name]) => name);

    if (breachedMetrics.length > 0) {
      recommendations.push(
        `Drift threshold breached for ${breachedMetrics.join(', ')}. Start data collection and retraining review.`
      );
    }

    if (calibration.status === 'insufficient_labels') {
      recommendations.push('Collect more labeled outcomes to compute reliable calibration metrics.');
    } else if (calibration.breached) {
      recommendations.push('Calibration threshold breached. Perform confidence recalibration before next promotion.');
    }

    if (freshness.inferenceStale) {
      recommendations.push('Inference telemetry stream is stale. Investigate pipeline ingestion and backend event flow.');
    }

    if (ingestionQuality.rejectionRate > 0.1) {
      recommendations.push('Inference schema rejection rate is above 10%. Investigate missing governance fields upstream.');
    }

    if (calibration.discrimination && calibration.discrimination.status === 'single_class') {
      recommendations.push('Label set currently has a single class. Capture both incident and non-incident outcomes for AUROC/PR-AUC.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Model governance indicators are within expected thresholds.');
    }

    return recommendations;
  }

  getStatusFromSignals(drift, calibration, freshness, ingestionQuality) {
    const hasDriftBreach = Object.values(drift).some((item) => item.breached);
    const hasDriftInsufficientSamples = Object.values(drift).some((item) => item.status === 'insufficient_samples');
    const hasCalibrationBreach = calibration.status === 'evaluated' && calibration.breached;

    const requiresAction = hasDriftBreach || hasCalibrationBreach || freshness.inferenceStale;
    if (requiresAction) {
      return {
        status: 'requires_action',
        severity: 'critical',
        incidentClass: freshness.inferenceStale
          ? 'data_pipeline_breakage'
          : (hasCalibrationBreach ? 'calibration_decay' : 'drift_spike')
      };
    }

    const monitoring = (
      calibration.status === 'insufficient_labels' ||
      hasDriftInsufficientSamples ||
      !freshness.hasInferenceData ||
      ingestionQuality.rejectionRate > 0.1
    );

    if (monitoring) {
      return {
        status: 'monitoring',
        severity: 'warning',
        incidentClass: 'watchlist'
      };
    }

    return {
      status: 'healthy',
      severity: 'info',
      incidentClass: 'none'
    };
  }

  getManifestMetadata() {
    const availableBaselines = [];

    try {
      if (fs.existsSync(this.baselineDir)) {
        const files = fs.readdirSync(this.baselineDir)
          .filter((fileName) => fileName.endsWith('.json') && fileName !== this.historyFileName && fileName !== this.manifestFileName)
          .sort();

        for (const fileName of files) {
          const fullPath = path.resolve(this.baselineDir, fileName);
          const baseline = loadBaseline(fullPath);
          availableBaselines.push({
            fileName,
            version: baseline.version,
            modelVersion: baseline.modelVersion,
            promotedAt: baseline.promotedAt
          });
        }
      }
    } catch (err) {
      this.logger.warn('governance.baseline_discovery_failed', {
        path: this.baselineDir,
        error: err
      });
    }

    return {
      model: this.manifest,
      baseline: {
        fileName: this.baselineFileName,
        version: this.baseline.version,
        promotedAt: this.baseline.promotedAt,
        modelVersion: this.baseline.modelVersion,
        notes: this.baseline.notes,
        available: availableBaselines
      }
    };
  }

  getReport() {
    const drift = this.computeDrift();
    const calibration = this.computeCalibration();
    const slices = this.computeSliceMetrics();
    const freshness = this.computeFreshness();
    const ingestionQuality = this.computeIngestionQuality();
    const statusInfo = this.getStatusFromSignals(drift, calibration, freshness, ingestionQuality);
    const recommendations = this.buildRecommendations(drift, calibration, freshness, ingestionQuality);

    const report = {
      status: statusInfo.status,
      severity: statusInfo.severity,
      incidentClass: statusInfo.incidentClass,
      startedAt: this.startedAt,
      generatedAt: new Date().toISOString(),
      sampleCounts: {
        inference: this.inferenceSamples.length,
        labels: this.labelSamples.length
      },
      metadata: this.getManifestMetadata(),
      ingestionQuality,
      freshness,
      drift,
      calibration,
      slices,
      trend: {
        historyEntries: this.history.length,
        rolling7: null,
        rolling30: null,
        delta: {
          maxDriftPsi: null,
          brierScore: null
        }
      },
      recommendations,
      recentInference: this.inferenceSamples.slice(-5),
      recentLabels: this.labelSamples.slice(-5)
    };

    this.persistDailySnapshot(report);
    report.trend = this.computeTrend();
    return report;
  }

  getManifest() {
    return this.getManifestMetadata();
  }
}

function createModelGovernance(config, logger) {
  return new ModelGovernance(config, logger);
}

module.exports = {
  createModelGovernance,
  ModelGovernance,
  buildHistogram,
  normalizeCounts,
  computePsi,
  computeBrierScore
};
