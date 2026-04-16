'use strict';

const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

function escapeLabel(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

class MetricsStore {
  constructor() {
    this.startedAt = Date.now();
    this.requestCounters = new Map();
    this.errorCounters = {
      authRejectedTotal: 0,
      rateLimitedTotal: 0,
      validationFailedTotal: 0,
      internalErrorTotal: 0
    };
    this.durationSecondsSum = 0;
    this.durationSecondsCount = 0;
    this.durationBucketCounts = new Array(LATENCY_BUCKETS.length + 1).fill(0);
  }

  recordRequest({ method, route, statusCode, durationMs }) {
    const safeMethod = String(method || 'UNKNOWN').toUpperCase();
    const safeRoute = String(route || 'unmatched');
    const safeStatus = String(Number(statusCode || 0));
    const key = `${safeMethod}|${safeRoute}|${safeStatus}`;

    const current = Number(this.requestCounters.get(key) || 0);
    this.requestCounters.set(key, current + 1);

    const durationSeconds = Math.max(0, Number(durationMs || 0) / 1000);
    this.durationSecondsSum += durationSeconds;
    this.durationSecondsCount += 1;

    let bucketIndex = this.durationBucketCounts.length - 1;
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      if (durationSeconds <= LATENCY_BUCKETS[i]) {
        bucketIndex = i;
        break;
      }
    }

    this.durationBucketCounts[bucketIndex] += 1;
  }

  noteAuthRejected() {
    this.errorCounters.authRejectedTotal += 1;
  }

  noteRateLimited() {
    this.errorCounters.rateLimitedTotal += 1;
  }

  noteValidationFailed() {
    this.errorCounters.validationFailedTotal += 1;
  }

  noteInternalError() {
    this.errorCounters.internalErrorTotal += 1;
  }

  toPrometheus() {
    const lines = [];

    lines.push('# HELP safezone_http_requests_total Total HTTP requests handled by backend');
    lines.push('# TYPE safezone_http_requests_total counter');

    for (const [key, value] of this.requestCounters.entries()) {
      const [method, route, status] = key.split('|');
      lines.push(
        `safezone_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${value}`
      );
    }

    lines.push('# HELP safezone_http_request_duration_seconds API request latency histogram');
    lines.push('# TYPE safezone_http_request_duration_seconds histogram');

    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      cumulative += this.durationBucketCounts[i];
      lines.push(`safezone_http_request_duration_seconds_bucket{le="${LATENCY_BUCKETS[i]}"} ${cumulative}`);
    }

    cumulative += this.durationBucketCounts[this.durationBucketCounts.length - 1];
    lines.push(`safezone_http_request_duration_seconds_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`safezone_http_request_duration_seconds_sum ${this.durationSecondsSum.toFixed(6)}`);
    lines.push(`safezone_http_request_duration_seconds_count ${this.durationSecondsCount}`);

    lines.push('# HELP safezone_auth_rejected_total Requests rejected by API auth guard');
    lines.push('# TYPE safezone_auth_rejected_total counter');
    lines.push(`safezone_auth_rejected_total ${this.errorCounters.authRejectedTotal}`);

    lines.push('# HELP safezone_rate_limited_total Requests rejected by rate limiting');
    lines.push('# TYPE safezone_rate_limited_total counter');
    lines.push(`safezone_rate_limited_total ${this.errorCounters.rateLimitedTotal}`);

    lines.push('# HELP safezone_validation_failed_total Requests rejected by payload validation');
    lines.push('# TYPE safezone_validation_failed_total counter');
    lines.push(`safezone_validation_failed_total ${this.errorCounters.validationFailedTotal}`);

    lines.push('# HELP safezone_internal_error_total Internal server errors');
    lines.push('# TYPE safezone_internal_error_total counter');
    lines.push(`safezone_internal_error_total ${this.errorCounters.internalErrorTotal}`);

    lines.push('# HELP safezone_process_uptime_seconds Backend process uptime in seconds');
    lines.push('# TYPE safezone_process_uptime_seconds gauge');
    lines.push(`safezone_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);

    return `${lines.join('\n')}\n`;
  }

  snapshot() {
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      counters: {
        ...this.errorCounters,
        requestSeries: this.requestCounters.size,
        requestDurationSamples: this.durationSecondsCount
      }
    };
  }
}

function createMetricsStore() {
  return new MetricsStore();
}

module.exports = {
  createMetricsStore,
  LATENCY_BUCKETS
};
