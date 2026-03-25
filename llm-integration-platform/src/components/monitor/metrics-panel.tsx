'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Activity, Zap, Clock, Cpu, MemoryStick, Thermometer,
  BatteryCharging, BarChart3, TrendingUp, Loader2,
  Download, Pause, Play, AlertTriangle, Bell,
  CircleDot, ShieldAlert, ChevronRight,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts';

interface MetricPoint {
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

interface ChartData {
  time: string;
  timestamp: number;
  tokensPerSec: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  gpuTemp: number;
  powerDraw: number;
  requestsPerMin: number;
}

interface AlertData {
  id: string;
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
  deviceId: string;
  message: string;
}

const THRESHOLDS = {
  cpuUsage: { warning: 75, critical: 90 },
  memoryUsage: { warning: 80, critical: 95 },
  gpuTemp: { warning: 75, critical: 85 },
  latencyMs: { warning: 200, critical: 500 },
  tokensPerSec: { warning: 10, critical: 5 },
} as const;

const METRIC_CONFIGS = [
  { key: 'tokensPerSec', label: 'Tokens/sec', color: '#6366f1', icon: Zap, unit: 'tok/s', gradient: 'from-indigo-500/20 to-indigo-600/5' },
  { key: 'latencyMs', label: 'Latency', color: '#f59e0b', icon: Clock, unit: 'ms', gradient: 'from-amber-500/20 to-amber-600/5' },
  { key: 'cpuUsage', label: 'CPU Usage', color: '#3b82f6', icon: Cpu, unit: '%', gradient: 'from-blue-500/20 to-blue-600/5' },
  { key: 'memoryUsage', label: 'Memory', color: '#8b5cf6', icon: MemoryStick, unit: '%', gradient: 'from-violet-500/20 to-violet-600/5' },
  { key: 'gpuUsage', label: 'GPU Usage', color: '#10b981', icon: Activity, unit: '%', gradient: 'from-emerald-500/20 to-emerald-600/5' },
  { key: 'gpuTemp', label: 'GPU Temp', color: '#ef4444', icon: Thermometer, unit: '\u00B0C', gradient: 'from-red-500/20 to-red-600/5' },
  { key: 'powerDraw', label: 'Power', color: '#f97316', icon: BatteryCharging, unit: 'W', gradient: 'from-orange-500/20 to-orange-600/5' },
  { key: 'requestsPerMin', label: 'Requests/min', color: '#06b6d4', icon: BarChart3, unit: 'req/m', gradient: 'from-cyan-500/20 to-cyan-600/5' },
] as const;

const TIME_RANGES = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getMetricSeverity(key: string, value: number): 'warning' | 'critical' | null {
  const t = THRESHOLDS[key as keyof typeof THRESHOLDS];
  if (!t) return null;

  if (key === 'tokensPerSec') {
    if (value > 0 && value <= t.critical) return 'critical';
    if (value > 0 && value <= t.warning) return 'warning';
    return null;
  }

  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return null;
}

function getCardBorderClass(severity: 'warning' | 'critical' | null): string {
  if (severity === 'critical') return 'border-red-500/60';
  if (severity === 'warning') return 'border-amber-500/60';
  return '';
}

export function MetricsPanel() {
  const [data, setData] = useState<ChartData[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    'tokensPerSec', 'cpuUsage', 'gpuUsage', 'latencyMs',
  ]);
  const [timeRange, setTimeRange] = useState('30');
  const eventSourceRef = useRef<EventSource | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<MetricPoint | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/telemetry/history?minutes=${timeRange}`);
      const json = await res.json();
      const chartData: ChartData[] = (json.metrics || []).map((m: MetricPoint) => ({
        time: formatTime(m.timestamp),
        timestamp: m.timestamp,
        tokensPerSec: parseFloat(m.tokensPerSec.toFixed(1)),
        latencyMs: parseFloat(m.latencyMs.toFixed(1)),
        cpuUsage: parseFloat(m.cpuUsage.toFixed(1)),
        memoryUsage: parseFloat(m.memoryUsage.toFixed(1)),
        gpuUsage: parseFloat(m.gpuUsage.toFixed(1)),
        gpuTemp: parseFloat(m.gpuTemp.toFixed(1)),
        powerDraw: parseFloat(m.powerDraw.toFixed(1)),
        requestsPerMin: parseFloat(m.requestsPerMin.toFixed(1)),
      }));
      setData(chartData);
    } catch {
      // Use empty data
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetch('/api/telemetry/alerts?minutes=30')
      .then(res => res.json())
      .then(json => {
        if (json.alerts) {
          setAlerts(json.alerts.slice(0, 50));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!live) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    const es = new EventSource('/api/telemetry/live');
    eventSourceRef.current = es;

    es.addEventListener('metrics', (event) => {
      try {
        const m: MetricPoint = JSON.parse(event.data);
        if (m.deploymentId === 'system' || m.deploymentId) {
          setLatestMetrics(m);
          const point: ChartData = {
            time: formatTime(m.timestamp),
            timestamp: m.timestamp,
            tokensPerSec: parseFloat(m.tokensPerSec.toFixed(1)),
            latencyMs: parseFloat(m.latencyMs.toFixed(1)),
            cpuUsage: parseFloat(m.cpuUsage.toFixed(1)),
            memoryUsage: parseFloat(m.memoryUsage.toFixed(1)),
            gpuUsage: parseFloat(m.gpuUsage.toFixed(1)),
            gpuTemp: parseFloat(m.gpuTemp.toFixed(1)),
            powerDraw: parseFloat(m.powerDraw.toFixed(1)),
            requestsPerMin: parseFloat(m.requestsPerMin.toFixed(1)),
          };
          setData(prev => {
            const next = [...prev, point];
            return next.length > 200 ? next.slice(-200) : next;
          });
        }
      } catch {
        // skip
      }
    });

    es.addEventListener('alert', (event) => {
      try {
        const alert: AlertData = JSON.parse(event.data);
        setAlerts(prev => {
          const next = [alert, ...prev];
          return next.length > 50 ? next.slice(0, 50) : next;
        });
      } catch {
        // skip
      }
    });

    es.onerror = () => {
      es.close();
      setTimeout(() => {
        if (live) {
          eventSourceRef.current = new EventSource('/api/telemetry/live');
        }
      }, 3000);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [live]);

  const toggleMetric = (key: string) => {
    setSelectedMetrics(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  };

  const exportData = () => {
    const csv = [
      ['timestamp', ...METRIC_CONFIGS.map(m => m.key)].join(','),
      ...data.map(d => [
        d.timestamp,
        ...METRIC_CONFIGS.map(m => d[m.key as keyof ChartData]),
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recentAlerts = alerts.slice(0, 10);
  const alertCount = alerts.length;

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">

      {/* Live Status Bar */}
      <div className="flex items-center justify-between opacity-0 animate-fade-in-up stagger-1">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System Overview</h2>
          {live && (
            <Badge variant="success" className="text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5 inline-block" />
              LIVE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {data.length} data points
            </span>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
        {METRIC_CONFIGS.slice(0, 4).map((cfg, idx) => {
          const Icon = cfg.icon;
          const rawValue = latestMetrics
            ? (latestMetrics[cfg.key as keyof MetricPoint] as number)
            : null;
          const value = rawValue !== null ? rawValue.toFixed(1) : '\u2014';
          const severity = rawValue !== null ? getMetricSeverity(cfg.key, rawValue) : null;
          const borderClass = getCardBorderClass(severity);
          return (
            <div
              key={cfg.key}
              className={`opacity-0 animate-fade-in-up stagger-${idx + 1}`}
            >
              <Card className={`relative overflow-hidden ${borderClass || ''}`}>
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{ background: `linear-gradient(90deg, ${cfg.color}80, ${cfg.color}20)` }}
                />
                <div className={`absolute inset-0 bg-gradient-to-br ${cfg.gradient} pointer-events-none`} />
                <CardContent className="p-6 md:p-7 relative">
                  <div className="flex flex-col items-center text-center">
                    <div
                      className="h-12 w-12 rounded-xl flex items-center justify-center ring-1 ring-white/5 mb-3"
                      style={{ backgroundColor: `${cfg.color}15` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: cfg.color }} />
                    </div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{cfg.label}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-2xl font-bold tabular-nums">
                        {value}
                      </p>
                      <span className="text-[11px] font-normal text-muted-foreground">{cfg.unit}</span>
                      {severity === 'critical' && (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 animate-pulse" />
                      )}
                      {severity === 'warning' && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      {/* Active Alerts Panel */}
      <div className="opacity-0 animate-fade-in-up stagger-5">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-red-500/60 via-amber-500/40 to-transparent" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-red-500/10 flex items-center justify-center">
                <Bell className="h-3.5 w-3.5 text-red-400" />
              </div>
              <span>Active Alerts</span>
              {alertCount > 0 && (
                <Badge variant="destructive" className="text-[10px] ml-1">
                  {alertCount}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <div className="flex items-center gap-3 py-4 px-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <ShieldAlert className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-xs text-emerald-400/80">No recent alerts. All metrics within normal range.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-xl text-xs transition-colors ${
                      alert.severity === 'critical'
                        ? 'bg-red-500/5 border-l-2 border-red-500'
                        : 'bg-amber-500/5 border-l-2 border-amber-500'
                    }`}
                  >
                    <div className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                      alert.severity === 'critical' ? 'bg-red-500/15' : 'bg-amber-500/15'
                    }`}>
                      <AlertTriangle className={`h-3 w-3 ${
                        alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={alert.severity === 'critical' ? 'destructive' : 'warning'}
                          className="text-[9px] shrink-0"
                        >
                          {alert.severity}
                        </Badge>
                        <span className="font-semibold">{alert.metric}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                        <span className="text-muted-foreground font-mono">
                          {alert.value} <span className="opacity-50">vs</span> {alert.threshold}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                        <CircleDot className="h-2.5 w-2.5" />
                        <span>{alert.deviceId}</span>
                        <span className="opacity-40">|</span>
                        <span>{formatRelativeTime(alert.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Controls Section */}
      <div className="space-y-4 opacity-0 animate-fade-in-up stagger-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chart Controls
        </h2>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            {METRIC_CONFIGS.map(cfg => (
              <button
                key={cfg.key}
                onClick={() => toggleMetric(cfg.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                  selectedMetrics.includes(cfg.key)
                    ? 'text-white shadow-md'
                    : 'border border-border/60 bg-transparent text-muted-foreground hover:bg-accent hover:border-border'
                }`}
                style={selectedMetrics.includes(cfg.key)
                  ? { backgroundColor: `${cfg.color}30`, color: cfg.color, boxShadow: `0 0 12px ${cfg.color}15`, border: `1px solid ${cfg.color}40` }
                  : undefined
                }
              >
                <div
                  className="h-2 w-2 rounded-full transition-transform"
                  style={{
                    backgroundColor: cfg.color,
                    transform: selectedMetrics.includes(cfg.key) ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
                {cfg.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-muted/50 rounded-full p-0.5 border border-border/30">
              {TIME_RANGES.map(tr => (
                <button
                  key={tr.value}
                  onClick={() => { setTimeRange(tr.value); loadHistory(); }}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all duration-200 ${
                    timeRange === tr.value
                      ? 'bg-primary/20 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tr.label}
                </button>
              ))}
            </div>

            <Button
              variant={live ? 'success' : 'outline'}
              size="sm"
              onClick={() => setLive(!live)}
              className="rounded-full"
            >
              {live ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {live ? 'Live' : 'Paused'}
            </Button>

            <Button variant="outline" size="sm" onClick={exportData} className="rounded-full">
              <Download className="h-3 w-3 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="opacity-0 animate-scale-in stagger-7">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary/60 via-secondary/40 to-transparent" />
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <span className="text-gradient font-semibold">Performance Metrics</span>
                <p className="text-[11px] text-muted-foreground font-normal mt-0.5">
                  {selectedMetrics.length} metrics selected
                </p>
              </div>
              {live && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Live</span>
                  </div>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col items-center justify-center h-80 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading telemetry data...</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250} className="md:!h-[350px] 2xl:!h-[450px]">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis
                    dataKey="time"
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      boxShadow: '0 8px 32px var(--shadow-color)',
                    }}
                  />
                  {METRIC_CONFIGS.filter(c => selectedMetrics.includes(c.key)).map(cfg => (
                    <Line
                      key={cfg.key}
                      type="monotone"
                      dataKey={cfg.key}
                      stroke={cfg.color}
                      strokeWidth={2}
                      dot={false}
                      name={cfg.label}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Individual Metric Charts */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 opacity-0 animate-fade-in-up stagger-8">
          Detailed Breakdown
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4 md:gap-5">
          {METRIC_CONFIGS.filter(c => selectedMetrics.includes(c.key)).slice(0, 4).map((cfg, idx) => {
            const Icon = cfg.icon;
            const rawValue = latestMetrics
              ? (latestMetrics[cfg.key as keyof MetricPoint] as number)
              : null;
            const severity = rawValue !== null ? getMetricSeverity(cfg.key, rawValue) : null;
            return (
              <div
                key={cfg.key}
                className={`opacity-0 animate-scale-in stagger-${9 + idx}`}
              >
                <Card className="relative overflow-hidden group transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                  <div
                    className="absolute top-0 left-0 right-0 h-px transition-opacity duration-300"
                    style={{ background: `linear-gradient(90deg, ${cfg.color}80, ${cfg.color}10)` }}
                  />
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{ boxShadow: `inset 0 0 40px ${cfg.color}08` }}
                  />
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2.5">
                      <div
                        className="h-7 w-7 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${cfg.color}15` }}
                      >
                        <Icon className="h-3.5 w-3.5" style={{ color: cfg.color }} />
                      </div>
                      <span className="font-semibold">{cfg.label}</span>
                      {severity && (
                        <Badge
                          variant={severity === 'critical' ? 'destructive' : 'warning'}
                          className="text-[9px] ml-1"
                        >
                          {severity}
                        </Badge>
                      )}
                      {latestMetrics && (
                        <span className="ml-auto font-bold text-sm tabular-nums" style={{ color: cfg.color }}>
                          {(latestMetrics[cfg.key as keyof MetricPoint] as number)?.toFixed(1)}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">{cfg.unit}</span>
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={120} className="sm:!h-[150px]">
                      <AreaChart data={data.slice(-60)}>
                        <defs>
                          <linearGradient id={`grad-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={cfg.color} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={cfg.color} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" hide />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '10px',
                            fontSize: '11px',
                            boxShadow: '0 4px 16px var(--shadow-color)',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey={cfg.key}
                          stroke={cfg.color}
                          fill={`url(#grad-${cfg.key})`}
                          strokeWidth={1.5}
                          dot={false}
                          name={cfg.label}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
