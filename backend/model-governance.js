'use strict';

const fs = require('fs');
const path = require('path');

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

function loadBaseline(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        metrics: {
          sceneRiskScore: [0.1, 0.2, 0.35, 0.25, 0.1],
          detectionCount: [0.25, 0.35, 0.25, 0.1, 0.05],
          sceneConfidence: [0.05, 0.15, 0.35, 0.3, 0.15]
        }
      };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { metrics: {} };
  } catch (err) {
    return {
      metrics: {
        sceneRiskScore: [0.1, 0.2, 0.35, 0.25, 0.1],
        detectionCount: [0.25, 0.35, 0.25, 0.1, 0.05],
        sceneConfidence: [0.05, 0.15, 0.35, 0.3, 0.15]
      }
    };
  }
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
      maxLabelSamples: Number(config.maxLabelSamples || 2000)
    };

    this.logger = logger || {
      info() {},
      warn() {},
      error() {}
    };
    this.startedAt = new Date().toISOString();
    this.inferenceSamples = [];
    this.labelSamples = [];

    this.bins = {
      sceneRiskScore: [0, 20, 40, 60, 80, 100],
      detectionCount: [0, 5, 10, 20, 40, 100],
      sceneConfidence: [0, 0.2, 0.4, 0.6, 0.8, 1]
    };

    const baselinePath = path.resolve(__dirname, 'model-baselines', 'default-baseline.json');
    this.baseline = loadBaseline(baselinePath);
  }

  trimBuffers() {
    if (this.inferenceSamples.length > this.config.maxInferenceSamples) {
      this.inferenceSamples.splice(0, this.inferenceSamples.length - this.config.maxInferenceSamples);
    }

    if (this.labelSamples.length > this.config.maxLabelSamples) {
      this.labelSamples.splice(0, this.labelSamples.length - this.config.maxLabelSamples);
    }
  }

  recordInference(sample = {}) {
    if (!this.config.enabled) return;

    const normalized = {
      timestamp: sample.timestamp || new Date().toISOString(),
      traceId: sample.traceId || '',
      modelVersion: String(sample.modelVersion || 'unknown'),
      sourceMode: String(sample.sourceMode || 'unknown'),
      sceneRiskScore: clamp(sample.sceneRiskScore, 0, 100),
      detectionCount: clamp(sample.detectionCount, 0, 100),
      sceneConfidence: clamp(sample.sceneConfidence, 0, 1)
    };

    this.inferenceSamples.push(normalized);
    this.trimBuffers();
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

      const expectedDist = Array.isArray(this.baseline.metrics && this.baseline.metrics[metricName])
        ? this.baseline.metrics[metricName]
        : [0.2, 0.2, 0.2, 0.2, 0.2];

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

    if (sampleSize < this.config.minLabelsForCalibration || score === null) {
      return {
        sampleSize,
        minRequired: this.config.minLabelsForCalibration,
        brierScore: score,
        threshold: this.config.calibrationBrierThreshold,
        breached: false,
        status: 'insufficient_labels'
      };
    }

    return {
      sampleSize,
      minRequired: this.config.minLabelsForCalibration,
      brierScore: Number(score.toFixed(5)),
      threshold: this.config.calibrationBrierThreshold,
      breached: score >= this.config.calibrationBrierThreshold,
      status: 'evaluated'
    };
  }

  buildRecommendations(drift, calibration) {
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

    if (recommendations.length === 0) {
      recommendations.push('Model governance indicators are within expected thresholds.');
    }

    return recommendations;
  }

  getReport() {
    const drift = this.computeDrift();
    const calibration = this.computeCalibration();
    const recommendations = this.buildRecommendations(drift, calibration);

    const hasDriftBreach = Object.values(drift).some((item) => item.breached);
    const hasDriftInsufficientSamples = Object.values(drift).some((item) => item.status === 'insufficient_samples');
    const hasCalibrationBreach = calibration.status === 'evaluated' && calibration.breached;

    const status = hasDriftBreach || hasCalibrationBreach
      ? 'requires_action'
      : (calibration.status === 'insufficient_labels' || hasDriftInsufficientSamples)
        ? 'monitoring'
        : 'healthy';

    return {
      status,
      startedAt: this.startedAt,
      generatedAt: new Date().toISOString(),
      sampleCounts: {
        inference: this.inferenceSamples.length,
        labels: this.labelSamples.length
      },
      drift,
      calibration,
      recommendations,
      recentInference: this.inferenceSamples.slice(-5),
      recentLabels: this.labelSamples.slice(-5)
    };
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
