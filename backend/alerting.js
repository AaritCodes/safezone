'use strict';

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

class AlertManager {
  constructor(config = {}, logger) {
    this.config = {
      enabled: Boolean(config.enabled),
      webhookUrl: String(config.webhookUrl || '').trim(),
      authToken: String(config.authToken || '').trim(),
      windowMs: Number(config.windowMs || 60000),
      minRequestCount: Number(config.minRequestCount || 20),
      errorRateThreshold: Number(config.errorRateThreshold || 0.05),
      p95LatencyMsThreshold: Number(config.p95LatencyMsThreshold || 800),
      cooldownMs: Number(config.cooldownMs || 300000)
    };

    this.logger = logger || {
      info() {},
      warn() {},
      error() {}
    };
    this.events = [];
    this.lastSent = {
      high_error_rate: 0,
      high_latency_p95: 0
    };
    this.lastDeliveryError = null;
    this.lastSentAt = null;
    this.activeAlerts = [];
  }

  prune(now) {
    const cutoff = now - this.config.windowMs;
    while (this.events.length > 0 && this.events[0].timestamp < cutoff) {
      this.events.shift();
    }
  }

  async observeRequest(event) {
    const now = Date.now();

    this.events.push({
      timestamp: now,
      statusCode: Number(event.statusCode || 0),
      durationMs: Number(event.durationMs || 0),
      route: String(event.route || 'unmatched')
    });

    this.prune(now);
    await this.evaluate(now);
  }

  computeWindowStats() {
    const durations = this.events.map((item) => item.durationMs).filter((value) => Number.isFinite(value));
    const total = this.events.length;
    const errorCount = this.events.filter((item) => item.statusCode >= 500).length;

    return {
      sampleSize: total,
      errorCount,
      errorRate: total > 0 ? errorCount / total : 0,
      p95LatencyMs: percentile(durations, 95)
    };
  }

  buildPayload(type, stats) {
    return {
      type,
      service: 'safezone-backend',
      timestamp: new Date().toISOString(),
      stats,
      thresholds: {
        minRequestCount: this.config.minRequestCount,
        errorRateThreshold: this.config.errorRateThreshold,
        p95LatencyMsThreshold: this.config.p95LatencyMsThreshold
      }
    };
  }

  async dispatch(type, stats, now) {
    this.activeAlerts = this.activeAlerts.filter((item) => item.type !== type);
    this.activeAlerts.push({
      type,
      triggeredAt: new Date(now).toISOString(),
      stats
    });

    this.lastSent[type] = now;
    this.lastSentAt = new Date(now).toISOString();

    const payload = this.buildPayload(type, stats);

    if (!this.config.enabled || !this.config.webhookUrl) {
      this.logger.warn('alert.triggered', payload);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(`Alert webhook failed with status ${response.status}`);
        this.lastDeliveryError = {
          at: new Date(now).toISOString(),
          message: error.message
        };
        this.logger.error('alert.delivery_failed', {
          type,
          statusCode: response.status
        });
      } else {
        this.lastDeliveryError = null;
        this.logger.warn('alert.dispatched', {
          type,
          webhookStatusCode: response.status
        });
      }
    } catch (err) {
      this.lastDeliveryError = {
        at: new Date(now).toISOString(),
        message: err && err.message ? err.message : 'unknown_error'
      };
      this.logger.error('alert.dispatch_error', {
        type,
        error: err
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async evaluate(now = Date.now()) {
    const stats = this.computeWindowStats();
    if (stats.sampleSize < this.config.minRequestCount) {
      return;
    }

    const checks = [
      {
        type: 'high_error_rate',
        isTriggered: stats.errorRate >= this.config.errorRateThreshold
      },
      {
        type: 'high_latency_p95',
        isTriggered: stats.p95LatencyMs >= this.config.p95LatencyMsThreshold
      }
    ];

    for (const check of checks) {
      if (!check.isTriggered) continue;

      const lastSentAt = Number(this.lastSent[check.type] || 0);
      if (now - lastSentAt < this.config.cooldownMs) {
        continue;
      }

      await this.dispatch(check.type, stats, now);
    }
  }

  getStatus() {
    const stats = this.computeWindowStats();
    return {
      config: {
        enabled: this.config.enabled,
        webhookConfigured: this.config.webhookUrl.length > 0,
        windowMs: this.config.windowMs,
        minRequestCount: this.config.minRequestCount,
        errorRateThreshold: this.config.errorRateThreshold,
        p95LatencyMsThreshold: this.config.p95LatencyMsThreshold,
        cooldownMs: this.config.cooldownMs
      },
      windowStats: stats,
      lastSentAt: this.lastSentAt,
      lastDeliveryError: this.lastDeliveryError,
      activeAlerts: this.activeAlerts.slice()
    };
  }
}

function createAlertManager(config, logger) {
  return new AlertManager(config, logger);
}

module.exports = {
  createAlertManager,
  AlertManager,
  percentile
};
