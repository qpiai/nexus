'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import {
  Smartphone, Wifi, WifiOff, Cpu, MemoryStick, Thermometer,
  Battery, Upload, Loader2, AlertCircle, Server,
  RefreshCw, Download, AlertTriangle, Zap, Activity, Monitor,
  HardDrive, Signal, Trash2,
} from 'lucide-react';

interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  hardware: {
    cpuModel: string;
    cpuCores: number;
    ramGB: number;
    storageGB: number;
    gpuModel?: string;
  };
  status: 'online' | 'offline' | 'busy';
  registeredAt: number;
  lastSeen: number;
  deployedModels: string[];
  metrics?: {
    cpuUsage: number;
    memoryUsage: number;
    temperature: number;
    batteryLevel: number;
    tokensPerSec?: number;
    activeModel?: string;
    totalInferences?: number;
    totalTokens?: number;
    engineType?: string;
  };
}

interface ModelInfo {
  name: string;
  file: string;
  method: 'GGUF' | 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX';
  sizeMB: number;
}

const METRIC_THRESHOLDS = {
  cpuUsage: { warning: 75, critical: 90 },
  memoryUsage: { warning: 80, critical: 95 },
  temperature: { warning: 75, critical: 85 },
} as const;

type ThresholdMetric = keyof typeof METRIC_THRESHOLDS;

function getMetricSeverity(metric: ThresholdMetric, value: number): 'warning' | 'critical' | null {
  const t = METRIC_THRESHOLDS[metric];
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return null;
}

function getMetricBarColor(severity: 'warning' | 'critical' | null): string {
  if (severity === 'critical') return 'bg-red-500';
  if (severity === 'warning') return 'bg-amber-500';
  return 'bg-primary';
}

function getMetricTextColor(severity: 'warning' | 'critical' | null): string {
  if (severity === 'critical') return 'text-red-400';
  if (severity === 'warning') return 'text-amber-400';
  return 'text-muted-foreground';
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function MetricBar({ label, value, unit, icon: Icon, severity }: {
  label: string;
  value: number;
  unit: string;
  icon: React.ElementType;
  severity: 'warning' | 'critical' | null;
}) {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3 w-3 ${getMetricTextColor(severity)}`} />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          {severity && <AlertTriangle className={`h-2.5 w-2.5 ${getMetricTextColor(severity)}`} />}
          <span className={`text-xs font-semibold ${severity ? getMetricTextColor(severity) : 'text-foreground'}`}>
            {value}{unit}
          </span>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getMetricBarColor(severity)}`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
}

function DeviceCard({ device, models, onDeploy, onRevoke, index }: {
  device: DeviceInfo;
  models: ModelInfo[];
  onDeploy: (deviceId: string, model: string) => void;
  onRevoke: (deviceId: string) => void;
  index: number;
}) {
  const [selectedModel, setSelectedModel] = useState(models[0]?.file || '');
  const [deploying, setDeploying] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const isOnline = device.status === 'online';

  const handleDeploy = async () => {
    if (!selectedModel) return;
    setDeploying(true);
    await onDeploy(device.id, selectedModel);
    setDeploying(false);
  };

  const handleRevoke = async () => {
    setRevoking(true);
    await onRevoke(device.id);
    setRevoking(false);
  };

  const cpuSeverity = device.metrics ? getMetricSeverity('cpuUsage', device.metrics.cpuUsage) : null;
  const memorySeverity = device.metrics ? getMetricSeverity('memoryUsage', device.metrics.memoryUsage) : null;
  const tempSeverity = device.metrics ? getMetricSeverity('temperature', device.metrics.temperature) : null;

  const staggerClass = `stagger-${Math.min(index + 1, 6)}`;

  return (
    <Card className={`animate-fade-in-up ${staggerClass} glass-hover relative overflow-hidden ${!isOnline ? 'opacity-60' : ''}`}>
      {isOnline && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-primary to-emerald-500" />
      )}

      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-300 ${
              isOnline
                ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 shadow-sm shadow-emerald-500/10'
                : 'bg-muted/60'
            }`}>
              <Smartphone className={`h-5 w-5 ${
                isOnline ? 'text-emerald-400' : 'text-muted-foreground'
              }`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold tracking-tight">{device.name}</p>
                <Badge variant={isOnline ? 'success' : 'outline'} className="text-[10px]">
                  {isOnline && (
                    <span className="relative mr-1.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                  )}
                  {isOnline ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {device.platform}
                <span className="mx-1.5 opacity-40">|</span>
                <span>{formatRelativeTime(device.lastSeen)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <div className="relative">
                <Signal className="h-4 w-4 text-emerald-400" />
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            ) : (
              <WifiOff className="h-4 w-4 text-muted-foreground/50" />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevoke}
              disabled={revoking}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Revoke device"
            >
              {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Hardware specs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
            <Cpu className="h-3.5 w-3.5 text-primary/60" />
            <span className="truncate">{device.hardware.cpuModel} ({device.hardware.cpuCores}C)</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
            <MemoryStick className="h-3.5 w-3.5 text-primary/60" />
            <span>{device.hardware.ramGB} GB RAM</span>
          </div>
        </div>

        {/* Live metrics */}
        {device.metrics && isOnline && (
          <div className="space-y-2.5 p-3 rounded-xl bg-muted/20 border border-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Live Metrics</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <MetricBar label="CPU" value={device.metrics.cpuUsage} unit="%" icon={Cpu} severity={cpuSeverity} />
              <MetricBar label="Memory" value={device.metrics.memoryUsage} unit="%" icon={MemoryStick} severity={memorySeverity} />
              <MetricBar label="Temp" value={device.metrics.temperature} unit={'\u00B0C'} icon={Thermometer} severity={tempSeverity} />
              <MetricBar label="Battery" value={device.metrics.batteryLevel} unit="%" icon={Battery} severity={null} />
            </div>
          </div>
        )}

        {/* Inference metrics */}
        {device.metrics && isOnline && (device.metrics.tokensPerSec !== undefined || device.metrics.activeModel) && (
          <div className="space-y-2">
            <div className="flex items-center flex-wrap gap-2 text-xs p-3 rounded-xl bg-primary/5 border border-primary/10">
              {device.metrics.tokensPerSec !== undefined && device.metrics.tokensPerSec > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10">
                  <Zap className="h-3 w-3 text-primary" />
                  <span className="font-semibold text-primary">{device.metrics.tokensPerSec.toFixed(1)} tok/s</span>
                </div>
              )}
              {device.metrics.activeModel && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Activity className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-muted-foreground truncate max-w-[140px]">{device.metrics.activeModel}</span>
                </div>
              )}
              {device.metrics.engineType && (
                <Badge variant="secondary" className="text-[9px] ml-auto">
                  {device.metrics.engineType}
                </Badge>
              )}
            </div>
            {(device.metrics.totalInferences !== undefined && device.metrics.totalInferences > 0) && (
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-1">
                <span>{device.metrics.totalInferences} inferences</span>
                <span className="opacity-40">|</span>
                <span>{device.metrics.totalTokens?.toLocaleString() ?? 0} tokens generated</span>
              </div>
            )}
          </div>
        )}

        {/* Deployed models */}
        {device.deployedModels.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Deployed Models</p>
            <div className="flex flex-wrap gap-1.5">
              {device.deployedModels.map(m => (
                <Badge key={m} variant="outline" className="text-[10px]">
                  <HardDrive className="h-2.5 w-2.5 mr-1 opacity-60" />
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {isOnline && models.length > 0 && (
          <div className="flex gap-2 pt-1 border-t border-white/[0.06]">
            <NexusSelect
              value={selectedModel}
              onChange={setSelectedModel}
              size="sm"
              className="flex-1"
              maxHeight={180}
              options={models.map(m => ({
                value: m.file,
                label: m.name,
                description: `${m.sizeMB} MB`,
              }))}
            />
            <Button size="sm" onClick={handleDeploy} disabled={deploying || !selectedModel}>
              {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(() => {
    fetch('/api/mobile/register')
      .then(res => res.json())
      .then(data => setDevices(data.devices || []))
      .catch(() => setError('Failed to load devices'));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/mobile/register').then(r => r.json()),
      fetch('/api/chat/models').then(r => r.json()),
    ])
      .then(([devData, modData]) => {
        setDevices(devData.devices || []);
        setModels(modData.models || []);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));

    const interval = setInterval(loadDevices, 10000);
    return () => clearInterval(interval);
  }, [loadDevices]);

  const handleDeploy = async (deviceId: string, model: string) => {
    try {
      const res = await fetch('/api/mobile/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, model }),
      });
      if (!res.ok) throw new Error('Deploy failed');
      loadDevices();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    try {
      const res = await fetch('/api/mobile/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Revoke failed');
      }
      loadDevices();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onlineCount = devices.filter(d => d.status === 'online').length;
  const totalInferences = devices.reduce((sum, d) => sum + (d.metrics?.totalInferences || 0), 0);

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <Card className="animate-fade-in-up stagger-1 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 mb-3">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Devices</p>
              <p className="text-3xl font-bold tracking-tight mt-1">{devices.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center shadow-sm shadow-emerald-500/10 mb-3">
                <Wifi className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Online</p>
              <p className="text-3xl font-bold tracking-tight text-emerald-400 mt-1">{onlineCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center shadow-sm shadow-violet-500/10 mb-3">
                <Server className="h-5 w-5 text-violet-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Models</p>
              <p className="text-3xl font-bold tracking-tight mt-1">{models.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-500 via-amber-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center shadow-sm shadow-amber-500/10 mb-3">
                <Zap className="h-5 w-5 text-amber-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Inferences</p>
              <p className="text-3xl font-bold tracking-tight mt-1">{totalInferences.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Refresh Bar */}
      <div className="flex items-center justify-between animate-fade-in-up stagger-5">
        <p className="text-xs text-muted-foreground">
          {devices.length > 0 && (
            <>Showing {devices.length} device{devices.length !== 1 ? 's' : ''} &middot; auto-refreshing every 10s</>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={loadDevices} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-destructive/30 bg-destructive/5 animate-scale-in">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-medium text-destructive">{error}</p>
              <p className="text-xs text-destructive/60 mt-0.5">Check your connection and try again</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Device List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 animate-fade-in">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Discovering devices...</p>
        </div>
      ) : devices.length === 0 ? (
        <Card className="animate-scale-in overflow-hidden">
          <div className="h-px w-full nexus-gradient" />
          <CardContent className="p-10 md:p-16 text-center">
            <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 mb-6 shadow-lg shadow-primary/10">
              <Smartphone className="h-10 w-10 text-primary/60" />
            </div>
            <h2 className="text-xl font-bold tracking-tight mb-2">No Devices Connected</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
              Clients connect by logging in with their credentials.
            </p>

            <div className="max-w-lg mx-auto space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Android</p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <a href="/nexus-v7.apk" download>
                    <Button size="sm" className="gap-2 rounded-xl px-4 nexus-gradient border-0 text-white">
                      <Download className="h-4 w-4" />
                      Android v7 APK
                    </Button>
                  </a>
                </div>
              </div>

              <div className="h-px bg-border/30" />

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Desktop</p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <a href="/nexus-desktop-windows.tar.gz" download>
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl px-4">
                      <Monitor className="h-4 w-4" />
                      Windows (Portable)
                    </Button>
                  </a>
                  <a href="/nexus-desktop-linux.AppImage" download>
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl px-4">
                      <Monitor className="h-4 w-4" />
                      Linux (AppImage)
                    </Button>
                  </a>
                </div>
              </div>

              <div className="h-px bg-border/30" />

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">macOS</p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <a href="/nexus-desktop-macos-arm64.zip" download>
                    <Button size="sm" className="gap-2 rounded-xl px-4">
                      <Monitor className="h-4 w-4" />
                      Apple Silicon (M1/M2/M3/M4)
                    </Button>
                  </a>
                  <a href="/nexus-desktop-macos-x64.zip" download>
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl px-4">
                      <Monitor className="h-4 w-4" />
                      Intel Mac
                    </Button>
                  </a>
                </div>
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  Unsigned app &mdash; right-click &rarr; Open on first launch to bypass Gatekeeper
                </p>
              </div>

              <div className="h-px bg-border/30" />

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">iOS (Simulator Builds)</p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <a href="/nexus-ios-llama.zip" download>
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl px-4">
                      <Download className="h-4 w-4" />
                      Nexus (llama.cpp)
                    </Button>
                  </a>
                  <a href="/nexus-ios-mlx.zip" download>
                    <Button variant="outline" size="sm" className="gap-2 rounded-xl px-4">
                      <Download className="h-4 w-4" />
                      NexusChat (MLX)
                    </Button>
                  </a>
                </div>
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  Simulator builds &mdash; build from source with Xcode 16+ for physical devices
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
          {devices.map((device, index) => (
            <DeviceCard
              key={device.id}
              device={device}
              models={models}
              onDeploy={handleDeploy}
              onRevoke={handleRevoke}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
