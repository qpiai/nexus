'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download, Monitor, Smartphone, Apple,
  Info, CheckCircle2, HardDrive,
} from 'lucide-react';
import { QRMobileLogin } from '@/components/qr-mobile-login';

// Default to the public GitHub Release that hosts our pre-built client binaries.
// Override per-deployment with NEXT_PUBLIC_RELEASES_BASE in .env (point at any
// HTTPS host that serves the same filenames — your own GH/GL release, R2, S3…).
const RELEASES_BASE =
  process.env.NEXT_PUBLIC_RELEASES_BASE ||
  'https://github.com/pavancshekar-dev/nexus-clients/releases/download/clients-v1';

interface DownloadItem {
  id: string;
  platform: string;
  label: string;
  description: string;
  filename: string;
  version: string;
  sizeMB: number;
  icon: React.ReactNode;
  color: string;
  instructions: string[];
}

const DOWNLOADS: DownloadItem[] = [
  {
    id: 'android-v7',
    platform: 'android',
    label: 'Android v7 (Latest)',
    description: 'Full-featured Android client with login/QR pairing, on-device agent system (ReAct + 9 tools), VLM chat, TFLite vision detection & segmentation, llama.cpp JNI, and offline mode.',
    filename: 'nexus-v7.apk',
    version: '7.0.0',
    sizeMB: 28,
    icon: <Smartphone className="h-6 w-6" />,
    color: 'text-emerald-400',
    instructions: [
      'Download the APK file to your Android device',
      'Open Settings > Security > Enable "Install from Unknown Sources"',
      'Open the downloaded APK and tap Install',
      'Sign in with your email/password, scan a QR code, or continue offline',
      'Download a GGUF model and start chatting — toggle Agent mode for tool-augmented reasoning',
      'For Vision: open Vision tab, download a TFLite model, and run detection or segmentation',
    ],
  },
  {
    id: 'windows',
    platform: 'windows',
    label: 'Windows (Portable)',
    description: 'Portable Windows desktop client with login support. No installation required — extract and run.',
    filename: 'nexus-desktop-windows.tar.gz',
    version: '1.2.0',
    sizeMB: 123,
    icon: <Monitor className="h-6 w-6" />,
    color: 'text-blue-400',
    instructions: [
      'Download and extract the .tar.gz archive',
      'Open the win-unpacked folder and run "QpiAI Nexus.exe"',
      'Enter your Nexus server URL, then log in with your dashboard credentials',
      'Download models and start local inference or use server mode',
    ],
  },
  {
    id: 'linux',
    platform: 'linux',
    label: 'Linux (AppImage)',
    description: 'Universal Linux package with login support. Works on Ubuntu, Fedora, Arch, and most distributions.',
    filename: 'nexus-desktop-linux.AppImage',
    version: '1.2.0',
    sizeMB: 115,
    icon: <HardDrive className="h-6 w-6" />,
    color: 'text-orange-400',
    instructions: [
      'Download the AppImage file',
      'Make it executable: chmod +x nexus-desktop-linux.AppImage',
      'Double-click or run ./nexus-desktop-linux.AppImage',
      'Enter your Nexus server URL, then log in with your dashboard credentials',
    ],
  },
  {
    id: 'macos-arm64',
    platform: 'macos',
    label: 'macOS (Apple Silicon)',
    description: 'Native build for M1/M2/M3/M4 Macs. Supports Metal GPU acceleration and MLX on-device inference.',
    filename: 'nexus-desktop-macos-arm64.zip',
    version: '1.1.0',
    sizeMB: 91,
    icon: <Apple className="h-6 w-6" />,
    color: 'text-gray-300',
    instructions: [
      'Download and extract the .zip archive',
      'Move "Nexus Client.app" to your Applications folder',
      'Right-click > Open (first launch only, to bypass Gatekeeper)',
      'The app supports Metal GPU acceleration and MLX for local on-device inference',
    ],
  },
  {
    id: 'macos-x64',
    platform: 'macos',
    label: 'macOS (Intel)',
    description: 'Build for Intel-based Macs (pre-2020 models).',
    filename: 'nexus-desktop-macos-x64.zip',
    version: '1.1.0',
    sizeMB: 96,
    icon: <Apple className="h-6 w-6" />,
    color: 'text-gray-300',
    instructions: [
      'Download and extract the .zip archive',
      'Move "Nexus Client.app" to your Applications folder',
      'Right-click > Open (first launch only, to bypass Gatekeeper)',
      'Enter your Nexus server URL to connect',
    ],
  },
  {
    id: 'ios-llama',
    platform: 'ios',
    label: 'iOS — Nexus (llama.cpp)',
    description: 'On-device LLM inference using llama.cpp with Metal GPU acceleration. Runs GGUF quantized models locally.',
    filename: 'nexus-ios-llama.zip',
    version: '1.0.0',
    sizeMB: 3.6,
    icon: <Apple className="h-6 w-6" />,
    color: 'text-violet-400',
    instructions: [
      'Download the .zip — this is a Simulator build (requires Xcode)',
      'Extract and drag Nexus.app into an open iOS Simulator',
      'For device builds: clone the repo and build with Xcode 16+ on a physical device',
      'Supports on-device GGUF inference via llama.cpp + Metal',
    ],
  },
  {
    id: 'ios-mlx',
    platform: 'ios',
    label: 'iOS — NexusChat (MLX)',
    description: 'On-device inference using Apple MLX framework. Supports Qwen 3.5, Gemma 3, LFM and more via HuggingFace.',
    filename: 'nexus-ios-mlx.zip',
    version: '1.0.0',
    sizeMB: 7.5,
    icon: <Apple className="h-6 w-6" />,
    color: 'text-violet-400',
    instructions: [
      'Download the .zip — this is a Simulator build (requires Xcode)',
      'Extract and drag NexusChat.app into an open iOS Simulator',
      'For device builds: clone the repo and build with Xcode 16+ on a physical device',
      'Models download from HuggingFace on first launch — supports MLX on Apple Silicon',
    ],
  },
];

function downloadUrl(item: DownloadItem): string {
  return `${RELEASES_BASE}/${item.filename}`;
}

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
  return `${mb} MB`;
}

/**
 * Probes each release URL with HEAD to find which binaries are actually
 * uploaded. Missing builds (e.g. iOS still pending) get greyed out with a
 * tooltip instead of giving the user a 404.
 */
function useAvailability(items: DownloadItem[]) {
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        items.map(async (item) => {
          try {
            // 'no-cors' ⇒ opaque response; we only need the network round-trip
            // not to throw. GitHub Releases serve via 302 → S3, both succeed
            // for existing files and fail for missing ones.
            const res = await fetch(downloadUrl(item), {
              method: 'HEAD',
              redirect: 'follow',
              mode: 'cors',
            });
            return [item.id, res.ok] as const;
          } catch {
            return [item.id, false] as const;
          }
        }),
      );
      if (cancelled) return;
      setAvailable(new Set(results.filter(([, ok]) => ok).map(([id]) => id)));
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { available, checked };
}

export function DownloadsPanel() {
  const [detectedPlatform, setDetectedPlatform] = useState<string>('unknown');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { available, checked } = useAvailability(DOWNLOADS);

  useEffect(() => {
    setDetectedPlatform(detectPlatform());
  }, []);

  const recommended = DOWNLOADS.find(d => d.platform === detectedPlatform);
  const otherDownloads = DOWNLOADS.filter(d => d.id !== recommended?.id);
  const isAvailable = (id: string) => !checked || available.has(id);

  const renderDownloadButton = (item: DownloadItem, large: boolean) => {
    const ok = isAvailable(item.id);
    const url = downloadUrl(item);
    if (!ok) {
      return (
        <Button
          variant={large ? 'default' : 'outline'}
          size={large ? 'lg' : 'sm'}
          className={`gap-2 shrink-0 ${large ? '' : 'w-full text-xs'}`}
          disabled
          title="Build pending — this binary hasn't been uploaded to the release yet."
        >
          <Download className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          Build pending
        </Button>
      );
    }
    return (
      <a href={url} download className={large ? '' : 'flex-1'}>
        <Button
          variant={large ? 'default' : 'outline'}
          size={large ? 'lg' : 'sm'}
          className={
            large
              ? 'gap-2 shrink-0 nexus-gradient border-0 text-white shadow-md shadow-primary/20'
              : 'w-full gap-2 text-xs'
          }
        >
          <Download className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          Download
        </Button>
      </a>
    );
  };

  return (
    <div className="page-container px-4 md:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
      {/* Hero Section */}
      <div className="text-center space-y-4 py-4 md:py-6">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium text-primary mb-2">
          <Download className="h-3 w-3" />
          Available for all platforms
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          <span className="text-gradient">Nexus</span> Client Downloads
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Download the Nexus client for your platform. Run LLM inference locally on your devices
          or connect to your Nexus server for cloud-powered AI.
        </p>
      </div>

      {/* Recommended Download */}
      {recommended && (
        <Card className="border-primary/30 bg-primary/5 relative overflow-hidden animate-fade-in-up">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          <CardContent className="p-6 md:p-7">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Recommended for your platform</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className={`h-14 w-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 shrink-0 ${recommended.color}`}>
                {recommended.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold">{recommended.label}</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{recommended.description}</p>
                <div className="flex items-center gap-3 mt-2.5">
                  <Badge variant="secondary" className="text-xs">v{recommended.version}</Badge>
                  <span className="text-xs text-muted-foreground">{formatSize(recommended.sizeMB)}</span>
                  <span className="text-xs text-muted-foreground">{recommended.filename}</span>
                </div>
              </div>
              {renderDownloadButton(recommended, true)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Downloads Grid */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">All Platforms</h2>
        <div className="grid gap-4 md:gap-5 sm:grid-cols-2">
          {(recommended ? otherDownloads : DOWNLOADS).map((item, idx) => {
            const colorHex = item.color === 'text-emerald-400' ? '#34d399'
              : item.color === 'text-blue-400' ? '#60a5fa'
              : item.color === 'text-orange-400' ? '#fb923c'
              : item.color === 'text-gray-300' ? '#9ca3af'
              : item.color === 'text-violet-400' ? '#a78bfa'
              : '#6366f1';
            return (
              <Card key={item.id} className={`relative overflow-hidden animate-fade-in-up stagger-${(idx % 4) + 1}`}>
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{ background: `linear-gradient(90deg, ${colorHex}80, ${colorHex}20)` }}
                />
                <CardContent className="p-6 md:p-7">
                  <div className="flex items-start gap-4">
                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}
                      style={{ background: `linear-gradient(to bottom right, ${colorHex}20, ${colorHex}05)`, boxShadow: `0 1px 3px ${colorHex}10` }}
                    >
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm">{item.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{item.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">v{item.version}</Badge>
                        <span className="text-[10px] text-muted-foreground">{formatSize(item.sizeMB)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-5">
                    {renderDownloadButton(item, false)}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1"
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    >
                      <Info className="h-3.5 w-3.5" />
                      Setup
                    </Button>
                  </div>

                  {expandedId === item.id && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Installation Steps:</p>
                      <ol className="space-y-1.5">
                        {item.instructions.map((step, i) => (
                          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* QR Mobile Sign-in */}
      <QRMobileLogin />

      {/* Footer info */}
      <div className="text-center text-xs text-muted-foreground space-y-1 pb-8">
        <p>All desktop clients are v1.2.0 with email/password login and on-device inference.</p>
        <p>Built with Electron 33 &middot; Android v7 (Agent+VLM+Vision) &middot; iOS via llama.cpp + Apple MLX</p>
        <p>Hosted on <a className="underline hover:text-foreground" href={RELEASES_BASE} target="_blank" rel="noopener noreferrer">GitHub Releases</a> &middot; configurable via <code className="text-[10px]">NEXT_PUBLIC_RELEASES_BASE</code></p>
      </div>
    </div>
  );
}
