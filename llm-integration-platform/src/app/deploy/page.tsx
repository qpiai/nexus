'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import {
  Rocket, Smartphone, Cpu, Layers, Download,
  AlertCircle, Loader2, Square, Server, Monitor, Apple,
  Activity, Clock, Zap, Send, HardDrive, MemoryStick,
  WifiOff, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, ExternalLink,
} from 'lucide-react';
import { formatTimestamp } from '@/lib/utils';
import { useNotifications } from '@/components/notifications';

interface MobileModel {
  id: string;
  name: string;
  file: string;
  size_mb: number;
  method: string;
  quantization: string;
  download_url: string;
  mobile_compatible: boolean;
  is_vlm?: boolean;
}

interface ConnectedDevice {
  id: string;
  name: string;
  platform: string;
  status: 'online' | 'offline' | 'busy';
  hardware: {
    cpuModel?: string;
    cpuCores: number;
    ramGB: number;
    storageGB: number;
  };
  deployedModels: string[];
  lastSeen?: number;
  metrics?: {
    cpuUsage: number;
    memoryUsage: number;
    temperature: number;
    batteryLevel: number;
    tokensPerSec?: number;
    activeModel?: string;
    engineType?: string;
  };
}

interface DeploymentInfo {
  id: string;
  model: string;
  method: string;
  target: string;
  status: string;
  createdAt: number;
  port?: number;
}

interface ClientDownload {
  id: string;
  platform: string;
  label: string;
  description: string;
  filename: string;
  url: string;
  version: string;
  sizeMB: number;
  icon: React.ReactNode;
  color: string;
}

const CLIENTS: ClientDownload[] = [
  { id: 'android-v7', platform: 'android', label: 'Android v7', description: 'Agent + VLM + Vision + QR login', filename: 'nexus-v7.apk', url: '/nexus-v7.apk', version: '7.0.0', sizeMB: 28, icon: <Smartphone className="h-5 w-5" />, color: 'text-emerald-400' },
  { id: 'android-v4', platform: 'android', label: 'Android v4', description: 'VLM + OD/Seg + TFLite on-device', filename: 'nexus-v4.apk', url: '/nexus-v4.apk', version: '4.0.0', sizeMB: 28, icon: <Smartphone className="h-5 w-5" />, color: 'text-emerald-400' },
  { id: 'windows', platform: 'windows', label: 'Windows', description: 'Portable desktop client', filename: 'nexus-desktop-windows.tar.gz', url: '/nexus-desktop-windows.tar.gz', version: '1.1.0', sizeMB: 111, icon: <Monitor className="h-5 w-5" />, color: 'text-blue-400' },
  { id: 'linux', platform: 'linux', label: 'Linux', description: 'AppImage for all distros', filename: 'nexus-desktop-linux.AppImage', url: '/nexus-desktop-linux.AppImage', version: '1.1.0', sizeMB: 104, icon: <HardDrive className="h-5 w-5" />, color: 'text-orange-400' },
  { id: 'macos-arm64', platform: 'macos', label: 'macOS (Apple Silicon)', description: 'M1-M4 + Metal + MLX', filename: 'nexus-desktop-macos-arm64.zip', url: '/nexus-desktop-macos-arm64.zip', version: '1.1.0', sizeMB: 91, icon: <Apple className="h-5 w-5" />, color: 'text-gray-300' },
  { id: 'macos-x64', platform: 'macos', label: 'macOS (Intel)', description: 'Pre-2020 Intel Macs', filename: 'nexus-desktop-macos-x64.zip', url: '/nexus-desktop-macos-x64.zip', version: '1.1.0', sizeMB: 96, icon: <Apple className="h-5 w-5" />, color: 'text-gray-300' },
  { id: 'ios-llama', platform: 'ios', label: 'iOS (llama.cpp)', description: 'GGUF + Metal GPU', filename: 'nexus-ios-llama.zip', url: '/nexus-ios-llama.zip', version: '1.0.0', sizeMB: 3.6, icon: <Apple className="h-5 w-5" />, color: 'text-violet-400' },
  { id: 'ios-mlx', platform: 'ios', label: 'iOS (MLX)', description: 'Apple MLX framework', filename: 'nexus-ios-mlx.zip', url: '/nexus-ios-mlx.zip', version: '1.0.0', sizeMB: 7.5, icon: <Apple className="h-5 w-5" />, color: 'text-violet-400' },
];

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function formatSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export default function DeployPage() {
  const { addNotification } = useNotifications();
  const pendingModelRef = useRef<string | null>(null);

  const [models, setModels] = useState<MobileModel[]>([]);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightModel, setHighlightModel] = useState<string | null>(null);

  // Device deploy state
  const [pushingTo, setPushingTo] = useState<string | null>(null);
  const [pushModel, setPushModel] = useState<Record<string, string>>({});

  // Client downloads
  const [detectedPlatform, setDetectedPlatform] = useState('unknown');
  const [showAllClients, setShowAllClients] = useState(false);


  useEffect(() => {
    setDetectedPlatform(detectPlatform());

    try {
      const pending = sessionStorage.getItem('nexus-deploy-model');
      if (pending) {
        const parsed = JSON.parse(pending);
        if (parsed.file) {
          pendingModelRef.current = parsed.file;
          setHighlightModel(parsed.file);
        }
        sessionStorage.removeItem('nexus-deploy-model');
      }
    } catch {}
  }, []);

  // Load models
  useEffect(() => {
    fetch('/api/mobile/models')
      .then(res => res.json())
      .then(data => {
        const loaded: MobileModel[] = data.models || [];
        const pending = pendingModelRef.current;
        if (pending) {
          const idx = loaded.findIndex(m => m.file === pending || m.file.includes(pending));
          if (idx > 0) {
            const [item] = loaded.splice(idx, 1);
            loaded.unshift(item);
          }
        }
        setModels(loaded);
        pendingModelRef.current = null;
      })
      .catch(() => setError('Failed to load models'))
      .finally(() => setLoadingModels(false));
  }, []);

  // Load devices
  const loadDevices = useCallback(() => {
    fetch('/api/mobile/register')
      .then(res => res.json())
      .then(data => setDevices(data.devices || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 10000);
    return () => clearInterval(interval);
  }, [loadDevices]);

  // Load deployments
  const loadDeployments = useCallback(() => {
    fetch('/api/deploy/list')
      .then(res => res.json())
      .then(data => setDeployments(data.deployments || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadDeployments();
    const interval = setInterval(loadDeployments, 5000);
    return () => clearInterval(interval);
  }, [loadDeployments]);

  const pushToDevice = async (deviceId: string, modelFile: string) => {
    if (!modelFile) return;
    setPushingTo(deviceId);
    try {
      const res = await fetch('/api/mobile/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, model: modelFile }),
      });
      if (!res.ok) throw new Error('Push failed');
      const data = await res.json();
      if (data.delivered) {
        addNotification('success', 'Model Push Sent', data.message);
      } else {
        addNotification('warning', 'Model Queued', data.message);
      }
      loadDevices();
    } catch (err) {
      addNotification('error', 'Push Failed', (err as Error).message);
    } finally {
      setPushingTo(null);
    }
  };

  const stopDeployment = async (id: string) => {
    try {
      await fetch(`/api/deploy/status?id=${id}`, { method: 'DELETE' });
      loadDeployments();
      addNotification('warning', 'Deployment Stopped', `Deployment ${id.slice(0, 8)} stopped`);
    } catch {}
  };

  const onlineDevices = devices.filter(d => d.status === 'online');
  const recommendedClient = CLIENTS.find(c => c.platform === detectedPlatform);
  const visibleClients = showAllClients ? CLIENTS : CLIENTS.slice(0, 4);

  return (
    <>
      <Header title="Deploy" subtitle="Models, clients, and devices" />
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <Card className="animate-fade-in-up stagger-1 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 mb-3">
                  <Layers className="h-5 w-5 text-primary" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Models</p>
                <p className="text-3xl font-bold tracking-tight mt-1">{models.length}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-400 via-cyan-400/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-400/20 to-cyan-400/5 flex items-center justify-center shadow-sm shadow-cyan-400/10 mb-3">
                  <Smartphone className="h-5 w-5 text-cyan-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Devices</p>
                <p className="text-3xl font-bold tracking-tight text-cyan-400 mt-1">{onlineDevices.length}<span className="text-lg text-muted-foreground font-normal">/{devices.length}</span></p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center shadow-sm shadow-emerald-500/10 mb-3">
                  <Server className="h-5 w-5 text-emerald-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active</p>
                <p className="text-3xl font-bold tracking-tight text-emerald-400 mt-1">{deployments.filter(d => d.status === 'running').length}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center shadow-sm shadow-violet-500/10 mb-3">
                  <Download className="h-5 w-5 text-violet-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clients</p>
                <p className="text-3xl font-bold tracking-tight mt-1">{CLIENTS.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ──── SECTION 1: Your Models ──── */}
        <Card className="animate-fade-in-up relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-primary" />
              </div>
              Your Models
              <Badge variant="outline" className="ml-auto">{models.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6">
            {loadingModels ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading models...</p>
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-8">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center mx-auto mb-4">
                  <Layers className="h-6 w-6 text-primary/40" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">No models ready</p>
                <p className="text-xs text-muted-foreground/60 mb-4">Quantize or fine-tune a model from the Pipeline page</p>
                <Link href="/pipeline">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Rocket className="h-3.5 w-3.5" /> Go to Pipeline
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {models.map(m => (
                  <div
                    key={m.id}
                    className={`p-4 rounded-xl border transition-all hover:border-white/[0.1] ${
                      highlightModel && (m.file === highlightModel || m.file.includes(highlightModel))
                        ? 'border-primary/40 bg-primary/5 shadow-sm'
                        : 'bg-accent/20 border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shrink-0">
                        <Cpu className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{m.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{m.method}</Badge>
                          {m.quantization !== 'unknown' && <Badge variant="outline" className="text-[9px] px-1.5 py-0">{m.quantization}</Badge>}
                          {m.is_vlm && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-violet-400 border-violet-500/30">VLM</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{formatSize(m.size_mb)}</span>
                      {m.download_url ? (
                        <a href={m.download_url} download>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                            <Download className="h-3 w-3" />
                            Download
                          </Button>
                        </a>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">Server only</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ──── SECTION 2: Download Clients ──── */}
        <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Download className="h-3.5 w-3.5 text-violet-400" />
              </div>
              Download Client Apps
              <span className="text-[10px] text-muted-foreground font-normal ml-1 hidden sm:inline">Install on your device to run models locally</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6">
            {/* Recommended client */}
            {recommendedClient && (
              <div className="flex items-center gap-4 p-4 rounded-xl border border-primary/20 bg-primary/5 mb-5">
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Recommended
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{recommendedClient.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{recommendedClient.description}</span>
                </div>
                <a href={recommendedClient.url} download>
                  <Button size="sm" className="gap-1.5 nexus-gradient border-0 text-white">
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                </a>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {visibleClients.filter(c => c.id !== recommendedClient?.id).map(c => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-accent/20 border border-white/[0.06] hover:border-white/[0.1] transition-all">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${c.color}`}
                    style={{ background: 'var(--accent)' }}>
                    {c.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{c.label}</p>
                    <p className="text-[10px] text-muted-foreground">{formatSize(c.sizeMB)} &middot; v{c.version}</p>
                  </div>
                  <a href={c.url} download>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              ))}
            </div>

            {CLIENTS.length > 4 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllClients(!showAllClients)}
                className="w-full mt-3 text-xs text-muted-foreground gap-1.5"
              >
                {showAllClients ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAllClients ? 'Show less' : `Show all ${CLIENTS.length} clients`}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ──── SECTION 3: Connected Devices & Deploy ──── */}
        <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-400 via-cyan-400/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-cyan-400/10 flex items-center justify-center">
                <Smartphone className="h-3.5 w-3.5 text-cyan-400" />
              </div>
              Connected Devices
              <Badge variant="outline" className="ml-auto">{onlineDevices.length} online</Badge>
              <Button variant="ghost" size="sm" onClick={loadDevices} className="h-7 w-7 p-0">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6">
            {devices.length === 0 ? (
              <div className="text-center py-6">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-400/15 to-cyan-400/5 flex items-center justify-center mx-auto mb-4">
                  <Smartphone className="h-6 w-6 text-cyan-400/40" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">No devices connected</p>
                <p className="text-xs text-muted-foreground/60 mb-4">Clients connect by logging in with their Nexus credentials.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map(device => {
                  const isOnline = device.status === 'online';
                  const selectedPushModel = pushModel[device.id] || models[0]?.file || '';

                  return (
                    <div key={device.id} className={`p-4 rounded-xl border transition-all ${
                      isOnline ? 'bg-accent/20 border-white/[0.06] hover:border-white/[0.1]' : 'bg-accent/10 border-white/[0.04] opacity-50'
                    }`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="relative shrink-0">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                              isOnline ? 'bg-gradient-to-br from-cyan-400/20 to-cyan-400/5' : 'bg-accent/40'
                            }`}>
                              <Smartphone className={`h-5 w-5 ${isOnline ? 'text-cyan-400' : 'text-muted-foreground'}`} />
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
                              isOnline ? 'bg-emerald-400' : 'bg-muted-foreground'
                            }`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold truncate">{device.name}</p>
                              {isOnline ? (
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                                </span>
                              ) : (
                                <WifiOff className="h-3 w-3 text-muted-foreground/50" />
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                              <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{device.hardware.cpuCores}C</span>
                              <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" />{device.hardware.ramGB}GB</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0">{device.platform}</Badge>
                              {device.metrics?.activeModel && (
                                <span className="flex items-center gap-1 text-primary">
                                  <Activity className="h-3 w-3" />
                                  {device.metrics.activeModel}
                                </span>
                              )}
                              {device.metrics?.tokensPerSec !== undefined && device.metrics.tokensPerSec > 0 && (
                                <span className="flex items-center gap-1 font-semibold text-primary">
                                  <Zap className="h-3 w-3" />
                                  {device.metrics.tokensPerSec.toFixed(1)} tok/s
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Push model controls */}
                        {isOnline && models.length > 0 && (
                          <div className="flex items-center gap-2 shrink-0">
                            {device.deployedModels.length > 0 && (
                              <Badge variant="success" className="text-[10px] hidden sm:inline-flex">{device.deployedModels.length} deployed</Badge>
                            )}
                            <NexusSelect
                              value={selectedPushModel}
                              onChange={v => setPushModel(prev => ({ ...prev, [device.id]: v }))}
                              size="sm"
                              className="w-40"
                              maxHeight={180}
                              options={models.map(m => ({
                                value: m.file,
                                label: m.name,
                                description: formatSize(m.size_mb),
                              }))}
                            />
                            <Button
                              size="sm"
                              onClick={() => pushToDevice(device.id, selectedPushModel)}
                              disabled={pushingTo === device.id || !selectedPushModel}
                              className="bg-cyan-500 hover:bg-cyan-600 text-white border-0 gap-1.5"
                            >
                              {pushingTo === device.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              Push
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Inline metrics bar for online devices */}
                      {isOnline && device.metrics && (
                        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/[0.04] text-[10px] text-muted-foreground">
                          <span>CPU: <span className={device.metrics.cpuUsage > 80 ? 'text-amber-400 font-semibold' : ''}>{device.metrics.cpuUsage}%</span></span>
                          <span>RAM: <span className={device.metrics.memoryUsage > 85 ? 'text-amber-400 font-semibold' : ''}>{device.metrics.memoryUsage}%</span></span>
                          <span>Temp: {device.metrics.temperature}&deg;C</span>
                          {device.metrics.batteryLevel > 0 && <span>Battery: {device.metrics.batteryLevel}%</span>}
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}
          </CardContent>
        </Card>

        {/* ──── SECTION 4: Live Status ──── */}
        <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              Live Status
              <Badge variant="outline" className="ml-auto">
                {deployments.filter(d => d.status === 'running').length} active
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6">
            {deployments.length === 0 && onlineDevices.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No active deployments</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Push a model to a connected device to start</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Active deployments */}
                {deployments.length > 0 && (
                  <div className="space-y-2">
                    {deployments.map(dep => (
                      <div key={dep.id} className="flex items-center gap-4 p-3 rounded-xl bg-accent/20 border border-white/[0.06]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold truncate">{dep.model}</p>
                            <Badge variant={dep.status === 'running' ? 'success' : dep.status === 'error' ? 'destructive' : 'outline'} className="text-[10px]">
                              {dep.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1"><Server className="h-3 w-3" />{dep.target}</span>
                            {dep.port && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />:{dep.port}</span>}
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTimestamp(dep.createdAt)}</span>
                          </div>
                        </div>
                        {dep.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => stopDeployment(dep.id)}
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Link to full monitor */}
                <div className="flex justify-center pt-2">
                  <Link href="/monitor">
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1.5">
                      <ExternalLink className="h-3 w-3" />
                      View Full Monitor
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-destructive/20 animate-fade-in-up overflow-hidden">
            <div className="h-px w-full bg-destructive" />
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shrink-0">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-medium text-destructive">{error}</p>
                <p className="text-[10px] text-destructive/60 mt-0.5">Check your connection and try again</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
