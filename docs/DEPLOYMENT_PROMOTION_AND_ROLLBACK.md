# SafeZone CI/CD Promotion and Rollback

## Workflows

- `.github/workflows/ci-cd.yml`
  - Runs tests and audit checks.
  - Builds Docker image artifact.
  - Executes staging smoke tests.
  - Promotes to production after staging succeeds.
- `.github/workflows/rollback.yml`
  - Manual rollback workflow.
  - Calls rollback deployment webhook with target image tag.

## Required GitHub Secrets

- `SAFEZONE_DEPLOY_WEBHOOK_URL`
- `SAFEZONE_ROLLBACK_WEBHOOK_URL`
- `SAFEZONE_DEPLOY_WEBHOOK_TOKEN` (optional)

For governance monitoring workflow:
- `SAFEZONE_BACKEND_URL`
- `SAFEZONE_API_KEY`

## Promotion Flow

1. Open PR to `main`.
2. CI validates:
   - `npm ci`
   - `npm test`
   - `npm audit --audit-level=high`
3. Merge to `main`.
4. Workflow builds Docker image and runs smoke checks in staging.
5. Production promotion executes only after staging success.
6. If `SAFEZONE_BACKEND_URL` and `SAFEZONE_API_KEY` are configured as secrets, the pipeline enforces a governance gate using `/api/governance/report` before deployment.

## Rollback Flow

When a release causes SLO regressions:
1. Open Actions and run `SafeZone Rollback`.
2. Provide:
   - `image_tag` (previous known-good image)
   - `environment` (`staging` or `production`)
   - `reason`
3. Workflow calls rollback webhook and records audit metadata.
4. Validate system health and SLO recovery:
   - `/api/health`
   - `/api/readiness`
   - `/api/ops/slo`

## Promotion Safety Gates

Recommended production gate decisions:
- Block release on failed test, audit, or smoke checks.
- Block release when governance report status is `requires_action`.
- Block release when p95 latency exceeds threshold during smoke tests.

## Audit Requirements

Every deployment and rollback should record:
- commit SHA
- image tag
- environment
- actor
- timestamp
- reason (for rollback)
