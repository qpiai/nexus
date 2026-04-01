'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, Smartphone, RefreshCw, Loader2, Timer, Copy, Check } from 'lucide-react';
import QRCodeLib from 'qrcode';

export function QRMobileLogin({ compact = false }: { compact?: boolean }) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [copied, setCopied] = useState(false);
  const expiresAtRef = useRef<number>(0);

  const fetchQR = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mobile/qr');
      if (!res.ok) throw new Error('Failed to generate QR');
      const data = await res.json();
      const dataUrl = await QRCodeLib.toDataURL(data.qrData, {
        width: 280,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setQrImage(dataUrl);
      setServerUrl(data.serverUrl);
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
    const interval = setInterval(fetchQR, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchQR]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (expiresAtRef.current > 0) {
        const remaining = Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
        setSecondsLeft(remaining);
        if (remaining === 0) fetchQR();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchQR]);

  const copyUrl = async () => {
    if (!serverUrl) return;
    try {
      await navigator.clipboard.writeText(serverUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = serverUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="h-3.5 w-3.5" />
          <span>Phone Sign-in</span>
        </div>

        {loading ? (
          <div className="h-36 w-36 rounded-2xl bg-muted/20 border border-white/[0.06] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button variant="ghost" size="sm" onClick={fetchQR} className="text-xs gap-1.5">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        ) : qrImage ? (
          <>
            <div className="p-2.5 rounded-2xl bg-white shadow-lg shadow-primary/10">
              <img src={qrImage} alt="QR Code" className="h-36 w-36 rounded-lg" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Timer className="h-3 w-3" />
              <span>{formatTime(secondsLeft)}</span>
              {secondsLeft < 60 && <span className="text-amber-500">refreshing soon</span>}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden animate-fade-in-up">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-400 via-primary to-violet-500" />
      <CardContent className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
          {/* QR Code */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            {loading ? (
              <div className="h-[200px] w-[200px] rounded-2xl bg-muted/20 border border-white/[0.06] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="h-[200px] w-[200px] rounded-2xl bg-muted/10 border border-white/[0.06] flex flex-col items-center justify-center gap-3">
                <QrCode className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchQR} className="gap-1.5 text-xs">
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              </div>
            ) : qrImage ? (
              <>
                <div className="p-3 rounded-2xl bg-white shadow-lg shadow-primary/10 transition-transform hover:scale-[1.02]">
                  <img src={qrImage} alt="QR Code" className="h-[180px] w-[180px]" />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                  <Timer className="h-3.5 w-3.5" />
                  <span>Expires in {formatTime(secondsLeft)}</span>
                  {secondsLeft < 60 && <span className="text-amber-500 font-medium">refreshing soon</span>}
                  <Button variant="ghost" size="sm" onClick={fetchQR} className="h-6 w-6 p-0 ml-1">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          {/* Info */}
          <div className="flex-1 text-center md:text-left space-y-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-semibold uppercase tracking-wider text-cyan-400 mb-3">
                <Smartphone className="h-3 w-3" />
                Phone Only
              </div>
              <h3 className="text-lg font-bold tracking-tight">Sign in on your Phone</h3>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-md">
                Scan this QR code with the Nexus Android app to sign in instantly.
                The code contains a secure token linked to your account.
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">1</div>
                <span>Open the Nexus app on your phone</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">2</div>
                <span>Tap &ldquo;Scan QR Code&rdquo; on the login screen</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">3</div>
                <span>Point your camera at this code</span>
              </div>
            </div>

            {/* Server URL */}
            {serverUrl && !loading && !error && (
              <div className="flex items-center gap-2 max-w-md">
                <div className="flex-1 flex items-center px-3 py-2 rounded-xl bg-muted/30 border border-white/[0.06] min-w-0">
                  <code className="text-[11px] text-muted-foreground truncate">{serverUrl}</code>
                </div>
                <Button variant="outline" size="sm" onClick={copyUrl} className="gap-1.5 shrink-0 text-xs">
                  {copied ? (
                    <><Check className="h-3 w-3 text-emerald-400" /> Copied</>
                  ) : (
                    <><Copy className="h-3 w-3" /> Copy</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
