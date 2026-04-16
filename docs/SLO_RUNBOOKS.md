# SafeZone SLOs and Runbooks

## SLOs

SafeZone backend exposes live SLI values at `/api/ops/slo`.

Current objectives:
- Availability SLO: >= 99.5% successful API responses in the rolling alert window.
- Latency SLO: p95 API latency <= 800 ms in the rolling alert window.
- Validation quality SLO: payload validation failures should remain < 2% of total request volume.

SLI sources:
- `errorRate`, `availability`, and `p95LatencyMs` from `/api/ops/slo`.
- Counters and latency histogram from `/api/metrics`.
- Active alerts and dispatch status from `/api/ops/alerts`.

## Alert Conditions

Alert conditions are configured through environment variables:
- `SAFEZONE_ALERTING_ERROR_RATE_THRESHOLD` (default: `0.05`)
- `SAFEZONE_ALERTING_P95_LATENCY_MS_THRESHOLD` (default: `800`)
- `SAFEZONE_ALERTING_MIN_REQUEST_COUNT` (default: `20`)
- `SAFEZONE_ALERTING_WINDOW_MS` (default: `60000`)
- `SAFEZONE_ALERTING_COOLDOWN_MS` (default: `300000`)

Alert types:
- `high_error_rate`
- `high_latency_p95`
- `governance_model_requires_action`
- `governance_data_pipeline_breakage`
- `governance_monitoring`

## Incident Runbook: High Error Rate

Trigger:
- `high_error_rate` alert or availability below 99.5%.

Response steps:
1. Check readiness and health:
   - `GET /api/readiness`
   - `GET /api/health`
2. Inspect recent errors in logs by `requestId` and `traceId`.
3. Inspect `/api/metrics` for spikes in:
   - `safezone_internal_error_total`
   - `safezone_auth_rejected_total`
   - `safezone_validation_failed_total`
4. If errors correlate with remote CV inference, force safe fallback:
   - `SAFEZONE_CV_MODE=simulation`
   - `SAFEZONE_CV_FALLBACK_TO_SIMULATION=true`
5. Re-check `/api/ops/slo` after mitigation.
6. If unresolved in 15 minutes, run rollback workflow (`rollback.yml`).

## Incident Runbook: High p95 Latency

Trigger:
- `high_latency_p95` alert or p95 latency over threshold.

Response steps:
1. Confirm if only inference paths are impacted:
   - Compare latency for `/api/safety/analyze` vs health endpoints.
2. Validate CV provider behavior:
   - check `inference.degraded` and `inference.fallbackReason` in API responses.
3. Reduce remote provider timeout if saturation is detected:
   - `SAFEZONE_CV_TIMEOUT_MS`
4. Temporarily route to simulation mode if remote model is unstable.
5. If platform-wide latency remains high, scale replicas or rollback to previous image.

## Incident Runbook: Governance Drift Spike

Trigger:
- Governance status `requires_action` with incident class `drift_spike`.

Response steps:
1. Fetch governance report:
   - `GET /api/governance/report`
2. Identify breached metrics in `report.drift`.
3. Compare rolling 7-day vs 30-day trend values.
4. Validate upstream feature distribution changes (camera density, public risk density, area slices).
5. Freeze promotion and start retraining data review.
6. If impact is user-facing, roll back to previous approved baseline/model.

## Incident Runbook: Calibration Decay

Trigger:
- Governance status `requires_action` with incident class `calibration_decay`.

Response steps:
1. Inspect `report.calibration.brierScore` and calibration bins.
2. Validate label freshness and class balance.
3. Check discrimination metrics (`auroc`, `prAuc`) for degradation.
4. Run recalibration workflow (temperature scaling or threshold tuning).
5. Re-evaluate governance before promotion.

## Incident Runbook: Data Pipeline Breakage

Trigger:
- Governance status `requires_action` with incident class `data_pipeline_breakage`.
- `report.freshness.inferenceStale` is true.

Response steps:
1. Validate `/api/safety/analyze` throughput and governance ingestion counters:
   - `safezone_governance_inference_accepted_total`
   - `safezone_governance_inference_rejected_total`
2. Confirm schema rejection reasons in governance report ingestion quality block.
3. Inspect tracing IDs to ensure inference events are emitted from request flow.
4. Fix event schema mapping or upstream payload contract regressions.
5. Keep promotion blocked until freshness recovers and status exits `requires_action`.

## Trace-Driven Debugging

Each request includes:
- `X-Request-Id`
- `X-Trace-Id`
- `traceparent`

Use these identifiers to correlate:
- API logs (`request.start`, `request.complete`, `request.failed`)
- upstream inference logs
- alert webhook payloads

## Post-Incident Checklist

1. Document root cause and impacted SLO window.
2. Record mitigation timeline and resolution duration.
3. Update alert thresholds only if noise was validated for multiple incidents.
4. Update this runbook if new failure modes were observed.

## Governance Review Cadence

1. Weekly model review:
   - Drift trend, calibration trend, ingestion rejection rate, stale data checks.
2. Monthly governance audit:
   - Model manifest owner/approval, baseline version freshness, release gate decisions, and rollback readiness.
