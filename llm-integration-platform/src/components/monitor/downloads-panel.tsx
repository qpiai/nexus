'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download, Monitor, Smartphone, Apple,
  Info, CheckCircle2, HardDrive,
} from 'lucide-react';

interface DownloadItem {
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
  instructions: string[];
}

const DOWNLOADS: DownloadItem[] = [
  {
    id: 'android-v7',
    platform: 'android',
    label: 'Android v7 (Latest)',
    description: 'Full-featured Android client with login/QR pairing, on-device agent system (ReAct + 9 tools), VLM chat, TFLite vision detection & segmentation, llama.cpp JNI, and offline mode.',
    filename: 'nexus-v7.apk',
    url: '/nexus-v7.apk',
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
    id: 'android-v4',
    platform: 'android',
    label: 'Android v4 (VLM + Vision OD/Seg)',
    description: 'Android app with VLM chat, on-device TFLite object detection & segmentation, server-side vision inference, and llama.cpp JNI.',
    filename: 'nexus-v4.apk',
    url: '/nexus-v4.apk',
    version: '4.0.0',
    sizeMB: 28,
    icon: <Smartphone className="h-6 w-6" />,
    color: 'text-emerald-400',
    instructions: [
      'Download the APK file to your Android device',
      'Open Settings > Security > Enable "Install from Unknown Sources"',
      'Open the downloaded APK and tap Install',
      'Launch Nexus, enter your server URL and connect',
      'For VLM: select a VLM model, attach images via the clip button, and chat',
      'For Vision: open Vision tab, download a TFLite model, and run detection or segmentation',
    ],
  },
  {
    id: 'windows',
    platform: 'windows',
    label: 'Windows (Portable)',
    description: 'Portable Windows desktop client with login support. No installation required — extract and run.',
    filename: 'nexus-desktop-windows.tar.gz',
    url: '/nexus-desktop-windows.tar.gz',
    version: '1.1.0',
    sizeMB: 480,
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
    url: '/nexus-desktop-linux.AppImage',
    version: '1.1.0',
    sizeMB: 462,
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
    url: '/nexus-desktop-macos-arm64.zip',
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
    url: '/nexus-desktop-macos-x64.zip',
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
    url: '/nexus-ios-llama.zip',
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
    url: '/nexus-ios-mlx.zip',
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

export function DownloadsPanel() {
  const [detectedPlatform, setDetectedPlatform] = useState<string>('unknown');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setDetectedPlatform(detectPlatform());
  }, []);

  const recommended = DOWNLOADS.find(d => d.platform === detectedPlatform);
  const otherDownloads = DOWNLOADS.filter(d => d.id !== recommended?.id);

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
              <a href={recommended.url} download>
                <Button size="lg" className="gap-2 shrink-0 nexus-gradient border-0 text-white shadow-md shadow-primary/20">
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </a>
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
                    <a href={item.url} download className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </a>
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

      {/* iOS / MLX Section */}
      <Card className="border-violet-500/20 bg-violet-500/5 relative overflow-hidden animate-fade-in-up">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-violet-500 to-purple-500" />
        <CardContent className="p-6 md:p-7">
          <div className="flex items-start gap-4 mb-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center text-violet-400 shrink-0 shadow-sm shadow-violet-500/10">
              <Apple className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-base">iOS — Native On-Device Inference</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Two iOS apps for on-device LLM inference: <strong>Nexus</strong> (llama.cpp + GGUF models) and <strong>NexusChat</strong> (MLX framework).
                Both use Metal GPU acceleration — no server needed. Simulator builds available above; build from source for physical devices.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            <div className="p-4 rounded-xl bg-background/50 border border-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Build from Source (Physical Device)</p>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2"><span className="text-violet-400 font-medium shrink-0">1.</span>Clone the <code className="text-[10px] bg-accent px-1 rounded">nexus-ios</code> repo and run <code className="text-[10px] bg-accent px-1 rounded">xcodegen generate</code></li>
                <li className="flex gap-2"><span className="text-violet-400 font-medium shrink-0">2.</span>Open <code className="text-[10px] bg-accent px-1 rounded">Nexus.xcodeproj</code> in Xcode 16+ — dependencies resolve automatically</li>
                <li className="flex gap-2"><span className="text-violet-400 font-medium shrink-0">3.</span>Select your physical device and hit Cmd+R</li>
                <li className="flex gap-2"><span className="text-violet-400 font-medium shrink-0">4.</span>Models download from HuggingFace on first launch</li>
              </ol>
            </div>
            <div className="p-4 rounded-xl bg-background/50 border border-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Requirements</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />Xcode 16.0+ / Swift 6.0</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />iOS 18.0+ or macOS 15.0+</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />Apple Silicon device (M1+ Mac or A14+ iPhone/iPad)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />Dual mode: on-device inference or server SSE streaming</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer info */}
      <div className="text-center text-xs text-muted-foreground space-y-1 pb-8">
        <p>All desktop clients are v1.1.0 with email/password login and on-device inference.</p>
        <p>Built with Electron 33 &middot; Android v7 (Agent+VLM+Vision) &middot; iOS via llama.cpp + Apple MLX</p>
      </div>
    </div>
  );
}
