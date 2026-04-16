# SafeZone Model Governance Loop

## Objectives

The governance loop ensures CV risk outputs remain calibrated and free from unacceptable drift before promotion.

## Runtime Endpoints

- `GET /api/governance/report`
  - Returns drift metrics, calibration status, recommendations, and recent samples.
- `POST /api/governance/labels`
  - Ingests ground-truth labels for calibration evaluation.

Required label payload:
- `predictedProbability` (number from 0 to 1)
- `incidentOccurred` (boolean)

Optional metadata:
- `traceId`
- `modelVersion`
- `sourceMode`
- `labelSource`
- `timestamp`

## Metrics and Thresholds

Configurable thresholds:
- Drift threshold: `SAFEZONE_GOVERNANCE_PSI_THRESHOLD` (default `0.2`)
- Minimum drift samples: `SAFEZONE_GOVERNANCE_MIN_DRIFT_SAMPLES` (default `100`)
- Calibration threshold: `SAFEZONE_GOVERNANCE_BRIER_THRESHOLD` (default `0.22`)
- Minimum labels for calibration: `SAFEZONE_GOVERNANCE_MIN_LABELS` (default `50`)

Drift signals:
- `sceneRiskScore`
- `detectionCount`
- `sceneConfidence`

Calibration metric:
- Brier Score over labeled predictions.

## Governance States

- `healthy`: no drift/calibration breach.
- `monitoring`: insufficient labels for calibration.
- `requires_action`: at least one threshold breached.

## Promotion Gate Policy

Promotion to production must be blocked when:
- governance report status is `requires_action`, or
- calibration is `insufficient_labels` for more than one release cycle.

Promotion can continue when:
- status is `healthy`, or
- status is `monitoring` with explicit approval from model owner.

## Operational Loop

1. Collect inference telemetry through `/api/safety/analyze`.
2. Ingest outcomes via `/api/governance/labels`.
3. Evaluate report from `/api/governance/report`.
4. Trigger remediation when status is `requires_action`:
   - retraining
   - confidence recalibration
   - rollback to previous model image
5. Record decision and model version in release notes.

## Scheduled Evaluation

Use workflow `.github/workflows/model-governance.yml` to run scheduled checks and attach governance reports as artifacts.
