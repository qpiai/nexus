// ============================================================
// Shared Telemetry Types, Alert System, and Device Metrics Store
// ============================================================

import { DEFAULT_THRESHOLDS } from './constants';

// --- Shared MetricPoint (used across telemetry routes) ---
export interface MetricPoint {
  timestamp: number;
  deploymentId: string;
  tokensPerSec: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  gpuTemp: number;
  powerDraw: number;
  requestsPerMin: number;
}

// --- Alert System ---
export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
  deviceId: string;
  message: string;
}

// --- Global Alert Store (in-memory, max 500) ---
const MAX_ALERTS = 500;

const g = globalThis as Record<string, unknown>;
if (!g.__nexus_alert_store) {
  g.__nexus_alert_store = [] as Alert[];
}
const alertStore = g.__nexus_alert_store as Alert[];

// --- Global Per-Device Metrics History (max 100 per device) ---
const MAX_DEVICE_METRICS = 100;

if (!g.__nexus_device_metrics_history) {
  g.__nexus_device_metrics_history = new Map<string, MetricPoint[]>();
}
const deviceMetricsHistory = g.__nexus_device_metrics_history as Map<string, MetricPoint[]>;

// --- Threshold Checking ---

function generateAlertId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

/**
 * Check a metric point against DEFAULT_THRESHOLDS and return any new alerts.
 *
 * For cpuUsage, memoryUsage, gpuTemp, latencyMs: higher is worse.
 * For tokensPerSec: lower is worse (inverted logic).
 */
export function checkThresholds(
  metrics: MetricPoint,
  thresholds: typeof DEFAULT_THRESHOLDS,
  sourceId: string
): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  // cpuUsage - higher is worse
  if (metrics.cpuUsage >= thresholds.cpuUsage.critical) {
    alerts.push({
      id: generateAlertId(),
      severity: 'critical',
      metric: 'cpuUsage',
      value: parseFloat(metrics.cpuUsage.toFixed(1)),
      threshold: thresholds.cpuUsage.critical,
      timestamp: now,
      deviceId: sourceId,
      message: `CPU usage at ${metrics.cpuUsage.toFixed(1)}% exceeds critical threshold of ${thresholds.cpuUsage.critical}%`,
    });
  } else if (metrics.cpuUsage >= thresholds.cpuUsage.warning) {
    alerts.push({
      id: generateAlertId(),
      severity: 'warning',
      metric: 'cpuUsage',
      value: parseFloat(metrics.cpuUsage.toFixed(1)),
      threshold: thresholds.cpuUsage.warning,
      timestamp: now,
      deviceId: sourceId,
      message: `CPU usage at ${metrics.cpuUsage.toFixed(1)}% exceeds warning threshold of ${thresholds.cpuUsage.warning}%`,
    });
  }

  // memoryUsage - higher is worse
  if (metrics.memoryUsage >= thresholds.memoryUsage.critical) {
    alerts.push({
      id: generateAlertId(),
      severity: 'critical',
      metric: 'memoryUsage',
      value: parseFloat(metrics.memoryUsage.toFixed(1)),
      threshold: thresholds.memoryUsage.critical,
      timestamp: now,
      deviceId: sourceId,
      message: `Memory usage at ${metrics.memoryUsage.toFixed(1)}% exceeds critical threshold of ${thresholds.memoryUsage.critical}%`,
    });
  } else if (metrics.memoryUsage >= thresholds.memoryUsage.warning) {
    alerts.push({
      id: generateAlertId(),
      severity: 'warning',
      metric: 'memoryUsage',
      value: parseFloat(metrics.memoryUsage.toFixed(1)),
      threshold: thresholds.memoryUsage.warning,
      timestamp: now,
      deviceId: sourceId,
      message: `Memory usage at ${metrics.memoryUsage.toFixed(1)}% exceeds warning threshold of ${thresholds.memoryUsage.warning}%`,
    });
  }

  // gpuTemp - higher is worse
  if (metrics.gpuTemp >= thresholds.gpuTemp.critical) {
    alerts.push({
      id: generateAlertId(),
      severity: 'critical',
      metric: 'gpuTemp',
      value: parseFloat(metrics.gpuTemp.toFixed(1)),
      threshold: thresholds.gpuTemp.critical,
      timestamp: now,
      deviceId: sourceId,
      message: `GPU temperature at ${metrics.gpuTemp.toFixed(1)}C exceeds critical threshold of ${thresholds.gpuTemp.critical}C`,
    });
  } else if (metrics.gpuTemp >= thresholds.gpuTemp.warning) {
    alerts.push({
      id: generateAlertId(),
      severity: 'warning',
      metric: 'gpuTemp',
      value: parseFloat(metrics.gpuTemp.toFixed(1)),
      threshold: thresholds.gpuTemp.warning,
      timestamp: now,
      deviceId: sourceId,
      message: `GPU temperature at ${metrics.gpuTemp.toFixed(1)}C exceeds warning threshold of ${thresholds.gpuTemp.warning}C`,
    });
  }

  // tokensPerSec - lower is worse (inverted)
  // Only check if tokensPerSec > 0 (skip idle/system metrics)
  if (metrics.tokensPerSec > 0) {
    if (metrics.tokensPerSec <= thresholds.tokensPerSec.critical) {
      alerts.push({
        id: generateAlertId(),
        severity: 'critical',
        metric: 'tokensPerSec',
        value: parseFloat(metrics.tokensPerSec.toFixed(1)),
        threshold: thresholds.tokensPerSec.critical,
        timestamp: now,
        deviceId: sourceId,
        message: `Tokens/sec at ${metrics.tokensPerSec.toFixed(1)} below critical threshold of ${thresholds.tokensPerSec.critical}`,
      });
    } else if (metrics.tokensPerSec <= thresholds.tokensPerSec.warning) {
      alerts.push({
        id: generateAlertId(),
        severity: 'warning',
        metric: 'tokensPerSec',
        value: parseFloat(metrics.tokensPerSec.toFixed(1)),
        threshold: thresholds.tokensPerSec.warning,
        timestamp: now,
        deviceId: sourceId,
        message: `Tokens/sec at ${metrics.tokensPerSec.toFixed(1)} below warning threshold of ${thresholds.tokensPerSec.warning}`,
      });
    }
  }

  // latencyMs - higher is worse
  if (metrics.latencyMs > 0) {
    if (metrics.latencyMs >= thresholds.latencyMs.critical) {
      alerts.push({
        id: generateAlertId(),
        severity: 'critical',
        metric: 'latencyMs',
        value: parseFloat(metrics.latencyMs.toFixed(1)),
        threshold: thresholds.latencyMs.critical,
        timestamp: now,
        deviceId: sourceId,
        message: `Latency at ${metrics.latencyMs.toFixed(1)}ms exceeds critical threshold of ${thresholds.latencyMs.critical}ms`,
      });
    } else if (metrics.latencyMs >= thresholds.latencyMs.warning) {
      alerts.push({
        id: generateAlertId(),
        severity: 'warning',
        metric: 'latencyMs',
        value: parseFloat(metrics.latencyMs.toFixed(1)),
        threshold: thresholds.latencyMs.warning,
        timestamp: now,
        deviceId: sourceId,
        message: `Latency at ${metrics.latencyMs.toFixed(1)}ms exceeds warning threshold of ${thresholds.latencyMs.warning}ms`,
      });
    }
  }

  // Store new alerts in the global alert store
  for (const alert of alerts) {
    alertStore.push(alert);
  }
  // Trim to max alerts
  while (alertStore.length > MAX_ALERTS) {
    alertStore.shift();
  }

  return alerts;
}

// --- Device Metrics History Helpers ---

export function addDeviceMetrics(deviceId: string, metrics: MetricPoint): void {
  if (!deviceMetricsHistory.has(deviceId)) {
    deviceMetricsHistory.set(deviceId, []);
  }
  const history = deviceMetricsHistory.get(deviceId)!;
  history.push(metrics);
  // Trim to max per device
  while (history.length > MAX_DEVICE_METRICS) {
    history.shift();
  }
}

export function getDeviceMetrics(deviceId: string): MetricPoint[] {
  return deviceMetricsHistory.get(deviceId) || [];
}

export function getAllDeviceMetrics(): Map<string, MetricPoint[]> {
  return deviceMetricsHistory;
}

// --- Alert Store Helpers ---

export function getAlerts(minutes?: number): Alert[] {
  if (!minutes) {
    return [...alertStore];
  }
  const cutoff = Date.now() - minutes * 60 * 1000;
  return alertStore.filter(a => a.timestamp >= cutoff);
}

export { DEFAULT_THRESHOLDS };
