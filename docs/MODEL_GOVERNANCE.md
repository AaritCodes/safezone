# SafeZone Model Governance Loop

## Objectives

The governance loop ensures inference telemetry quality, model calibration, and drift behavior remain within approved promotion limits.

## Runtime Endpoints

- `GET /api/governance/report`
  - Returns governance status, severity, drift/calibration metrics, trend summaries, freshness, ingestion quality, and recommendations.
- `GET /api/governance/manifest`
  - Returns model metadata, baseline metadata, and available baseline files.
- `POST /api/governance/labels`
  - Ingests ground-truth labels for calibration and discrimination metrics.

Required label payload:
- `predictedProbability` (number from 0 to 1)
- `incidentOccurred` (boolean)

Optional label metadata:
- `traceId`
- `modelVersion`
- `sourceMode`
- `labelSource`
- `timestamp`

## Inference Event Schema

Inference events are recorded from `/api/safety/analyze` with strict schema validation before entering governance buffers.

Required quality fields:
- `modelVersion`
- `sourceMode`
- `sceneRiskScore`
- `sceneConfidence`
- `predictedProbability`
- `inferenceLatencyMs`

Additional tracked fields:
- `traceId`
- `predictionScore`
- `detectionCount`
- `inputSummary.hour`
- `inputSummary.areaType`
- `inputSummary.areaCategory`
- `inputSummary.serviceCount`
- `inputSummary.cameraCount`
- `inputSummary.publicRiskSignals`

If null/missing density exceeds `SAFEZONE_GOVERNANCE_MAX_NULL_RATE`, the event is rejected and excluded from governance calculations.

## Metrics and Thresholds

Drift signals:
- `sceneRiskScore`
- `detectionCount`
- `sceneConfidence`

Calibration and discrimination:
- Brier Score
- Calibration bins
- AUROC (if label class diversity exists)
- PR-AUC (if label class diversity exists)

Slice analytics:
- Hour bucket (`night`, `morning`, `afternoon`, `evening`)
- Area type
- Risk bucket (`low`, `medium`, `high`)

Trend analytics:
- Rolling 7-day summary
- Rolling 30-day summary
- Delta between 7-day and 30-day drift/calibration means

Configurable thresholds:
- Drift threshold: `SAFEZONE_GOVERNANCE_PSI_THRESHOLD` (default `0.2`)
- Minimum drift samples: `SAFEZONE_GOVERNANCE_MIN_DRIFT_SAMPLES` (default `100`)
- Calibration threshold: `SAFEZONE_GOVERNANCE_BRIER_THRESHOLD` (default `0.22`)
- Minimum labels for calibration: `SAFEZONE_GOVERNANCE_MIN_LABELS` (default `50`)
- Stale inference threshold: `SAFEZONE_GOVERNANCE_STALE_INFERENCE_HOURS` (default `24`)

## Governance States and Incident Classes

- `healthy` (`info`): drift/calibration/freshness are within limits.
- `monitoring` (`warning`): insufficient labels/samples, elevated ingestion rejection rate, or low-data watchlist.
- `requires_action` (`critical`): drift breach, calibration breach, or stale inference telemetry.

Incident class mapping:
- Drift breach: `drift_spike`
- Calibration breach: `calibration_decay`
- Stale inference stream: `data_pipeline_breakage`

## Promotion Gate Policy

Production promotion must be blocked when:
- governance status is `requires_action`, or
- inference freshness is stale.

Production promotion can continue when:
- status is `healthy`, or
- status is `monitoring` with model-owner approval documented in release notes.

## Baseline and Manifest Management

Baseline metadata is loaded from `backend/model-baselines/default-baseline.json` (or configured baseline file):
- baseline version
- promoted timestamp
- associated model version

Model metadata is loaded from `backend/model-baselines/model-manifest.json`:
- owner
- training window
- intended use
- limitations
- approval record

Version and file controls:
- `SAFEZONE_GOVERNANCE_BASELINE_FILE`
- `SAFEZONE_GOVERNANCE_MANIFEST_FILE`

## Operational Loop

1. Collect inference telemetry through `/api/safety/analyze`.
2. Reject low-quality telemetry at ingestion and track rejection reasons.
3. Ingest labels through `/api/governance/labels`.
4. Evaluate `/api/governance/report` for status, freshness, and trend shifts.
5. Trigger remediation for `requires_action`:
   - retraining
   - confidence recalibration
   - telemetry pipeline recovery
   - rollback to previous approved model baseline
6. Record owner decision in release notes.

## Scheduled Evaluation

Use `.github/workflows/model-governance.yml` for scheduled checks.

The workflow now:
- skips cleanly when governance secrets are not configured
- fails on stale inference telemetry
- fails on `requires_action`
- emits warning annotations for `monitoring`
