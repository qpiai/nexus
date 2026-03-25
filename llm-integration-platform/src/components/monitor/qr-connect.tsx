'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Copy, Check, RefreshCw, Loader2, Timer } from 'lucide-react';

export function QRConnect({ compact = false }: { compact?: boolean }) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(300);
  const expiresAtRef = useRef<number>(0);

  const fetchQR = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mobile/qr');
      if (!res.ok) throw new Error('Failed to fetch QR');
      const data = await res.json();
      setQrData(data.qr);
      setServerUrl(data.url);
      const expiresIn = data.expiresIn || 300;
      expiresAtRef.current = Date.now() + expiresIn * 1000;
      setSecondsLeft(expiresIn);
    } catch {
      setError('Could not generate QR code');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQR();
    // Auto-refresh every 4 minutes (token expires in 5)
    const interval = setInterval(fetchQR, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchQR]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      if (expiresAtRef.current > 0) {
        const remaining = Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
        setSecondsLeft(remaining);
        if (remaining === 0) {
          fetchQR(); // Auto-refresh when expired
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchQR]);

  const copyUrl = async () => {
    if (!serverUrl) return;
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = serverUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        {loading ? (
          <div className="h-32 w-32 rounded-xl bg-muted/30 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-xs text-muted-foreground">{error}</div>
        ) : qrData ? (
          <>
            <img src={qrData} alt="QR Code" className="h-32 w-32 rounded-xl" />
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Timer className="h-3 w-3" />
              <span>{formatTime(secondsLeft)}</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded max-w-[200px] truncate">
                {serverUrl}
              </code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyUrl}>
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="animate-scale-in overflow-hidden border-primary/20">
      <div className="h-px w-full nexus-gradient" />
      <CardContent className="p-6 md:p-8">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-lg shadow-primary/10">
            <QrCode className="h-7 w-7 text-primary" />
          </div>

          <div>
            <h3 className="text-lg font-bold tracking-tight mb-1">Scan to Connect</h3>
            <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
              Scan this QR code with a Nexus mobile app to connect your device.
              The code includes a secure pairing token linked to your account.
            </p>
          </div>

          {loading ? (
            <div className="h-[200px] w-[200px] rounded-2xl bg-muted/20 border border-border/40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchQR} className="gap-1.5">
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          ) : qrData ? (
            <>
              <div className="p-3 rounded-2xl bg-muted/10 border border-border/40 shadow-inner">
                <img src={qrData} alt="QR Code" className="h-[200px] w-[200px]" />
              </div>

              {/* Countdown timer */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <Timer className="h-3.5 w-3.5" />
                <span>Expires in {formatTime(secondsLeft)}</span>
                {secondsLeft < 60 && (
                  <span className="text-amber-500 font-medium">— refreshing soon</span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full max-w-md">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/40 min-w-0">
                  <code className="text-xs text-muted-foreground truncate flex-1">{serverUrl}</code>
                </div>
                <Button variant="outline" size="sm" onClick={copyUrl} className="gap-1.5 shrink-0">
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy URL
                    </>
                  )}
                </Button>
                <Button variant="ghost" size="icon" onClick={fetchQR} className="shrink-0 h-8 w-8">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
