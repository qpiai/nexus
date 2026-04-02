'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Cpu, Layers, Play, Download, Loader2, CheckCircle2, AlertCircle, MessageSquare, ArrowRight, Sparkles, RotateCcw, Brain, HardDrive, Rocket, Square } from 'lucide-react';
import { DeviceInput } from '@/lib/types';
import { estimateModelRAM, findModelByName } from '@/lib/constants';
import { useNotifications } from '@/components/notifications';
import { confettiMedium } from '@/lib/confetti';
import { ProgressRing } from '@/components/ui/progress-ring';
import { AnimatedCheck } from '@/components/ui/animated-check';

const QUANT_DESCRIPTIONS: Record<number, string> = {
  2: 'Extreme compression — fastest, lowest quality. Best for edge/IoT devices.',
  3: 'Heavy compression — fast, moderate quality loss. Good for mobile.',
  4: 'Balanced — recommended default. Good quality with 4x size reduction.',
  5: 'Mild compression — near-lossless quality with 3x size reduction.',
  8: 'Light compression — minimal quality loss, 2x size reduction.',
  16: 'No quantization — full precision FP16 download.',
};

interface LogEntry {
  type: string;
  message: string;
  progress?: number;
}

interface FinetunedInfo {
  path: string;
  model: string;
  method: string;
}

function parseRecommendation(rec: string): { bits: number; method: string; model: string } {
  const match = rec.match(/(\d+)-bit\s+(GGUF|AWQ|GPTQ|BitNet|MLX|FP16)\s+(.+)/i);
  if (match) {
    return { bits: parseInt(match[1]), method: match[2].toUpperCase(), model: match[3].trim() };
  }
  return { bits: 4, method: 'GGUF', model: rec };
}

interface QuantizePanelProps {
  onSwitchTab?: (tab: string) => void;
}

export function QuantizePanel({ onSwitchTab }: QuantizePanelProps) {
  const router = useRouter();
  const { addNotification } = useNotifications();
  const [device, setDevice] = useState<DeviceInput | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [finetuned, setFinetuned] = useState<FinetunedInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [outputFile, setOutputFile] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    const storedDevice = sessionStorage.getItem('nexus-device');
    const storedRec = sessionStorage.getItem('nexus-recommendation');
    const storedFt = sessionStorage.getItem('nexus-finetuned');
    if (storedDevice) setDevice(JSON.parse(storedDevice));
    if (storedFt) {
      try {
        const ft = JSON.parse(storedFt) as FinetunedInfo;
        setFinetuned(ft);
        // Always override recommendation with finetuned model name (the stored recommendation may be stale from the agent)
        const modelName = ft.model.split('/').pop() || ft.model;
        const recBits = storedRec ? parseRecommendation(storedRec).bits : 4;
        const recMethod = storedRec ? parseRecommendation(storedRec).method : 'GGUF';
        setRecommendation(`${recBits}-bit ${recMethod} ${modelName}`);
        if (!storedDevice) {
          setDevice({ deviceName: 'Server', ramGB: 64, gpuInfo: 'GPU', storageGB: 500, deviceType: 'server' });
        }
      } catch { /* ignore */ }
    } else if (storedRec) {
      setRecommendation(storedRec);
    }

    // Check if a previous quantization output already exists
    let recToCheck = storedRec;
    if (storedFt) {
      try {
        const ft = JSON.parse(storedFt) as FinetunedInfo;
        const modelName = ft.model.split('/').pop() || ft.model;
        const bits = storedRec ? parseRecommendation(storedRec).bits : 4;
        const method = storedRec ? parseRecommendation(storedRec).method : 'GGUF';
        recToCheck = `${bits}-bit ${method} ${modelName}`;
      } catch { /* ignore */ }
    }
    if (recToCheck) {
      const parsed = parseRecommendation(recToCheck);
      fetch(`/api/quantization/check?model=${encodeURIComponent(parsed.model)}&method=${encodeURIComponent(parsed.method)}&bits=${parsed.bits}`)
        .then(r => r.json())
        .then(data => {
          if (data.exists) {
            setDone(true);
            setFromCache(true);
            setOutputFile(data.file);
            setProgress(1.0);
            autoStartedRef.current = true; // Prevent auto-start
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Poll server for quantization state on mount (survives navigation)
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/quantization/status');
        if (!res.ok) return;
        const data = await res.json();

        if (data.running || data.done || data.logs?.length > 0) {
          setLogs(data.logs || []);
          setProgress(data.progress || 0);
          setError(data.error || null);
          setDone(data.done || false);
          setRunning(data.running || false);
          setOutputFile(data.outputFile || null);
        }
      } catch {
        // ignore
      }
    }

    fetchStatus().then(() => {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/quantization/status');
          if (!res.ok) return;
          const data = await res.json();
          setLogs(data.logs || []);
          setProgress(data.progress || 0);
          setError(data.error || null);
          setDone(data.done || false);
          setRunning(data.running || false);
          setOutputFile(data.outputFile || null);

          if (!data.running && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        } catch {
          // ignore
        }
      }, 2000);
    });

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopQuantization = useCallback(async () => {
    try {
      const res = await fetch('/api/quantization/stop', { method: 'POST' });
      if (res.ok) {
        setRunning(false);
        setError('Stopped by user');
        addNotification('info', 'Quantization Stopped', 'The quantization process was stopped');
      }
    } catch {
      // ignore
    }
  }, [addNotification]);

  const startQuantization = () => {
    if (!recommendation) return;

    const parsed = parseRecommendation(recommendation);
    setRunning(true);
    setDone(false);
    setError(null);
    setLogs([]);
    setProgress(0);
    setOutputFile(null);

    const isFP16 = parsed.bits === 16 || parsed.method === 'FP16';
    addNotification('info', isFP16 ? 'Download Started' : 'Quantization Started',
      isFP16 ? `Downloading ${parsed.model} (FP16)` : `${parsed.method} ${parsed.bits}-bit on ${parsed.model}`);

    const requestBody: Record<string, unknown> = {
      model: parsed.model,
      method: parsed.method,
      bits: parsed.bits,
    };
    if (finetuned?.path) {
      requestBody.localModelPath = finetuned.path;
    }

    // Clear finetuned info after incorporating it — prevents stale re-population on revisit
    sessionStorage.removeItem('nexus-finetuned');

    fetch('/api/quantization/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }).then(async (res) => {
      if (!res.ok) {
        try {
          const errBody = await res.json();
          setError(errBody.error || `Server error (${res.status})`);
        } catch {
          setError(`Server error (${res.status})`);
        }
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'progress') {
                setLogs(prev => [...prev, { type: 'progress', message: data.message, progress: data.progress }]);
                if (data.progress) setProgress(data.progress);
              } else if (eventType === 'complete') {
                setLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                setProgress(1.0);
                setDone(true);
                if (data.file) {
                  setOutputFile(data.file);
                } else {
                  const fileMatch = data.message?.match(/(\S+\.gguf)/);
                  if (fileMatch) setOutputFile(fileMatch[1]);
                }
                addNotification('success',
                  parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download Complete' : 'Quantization Complete',
                  data.message || 'Model ready');
                confettiMedium();
              } else if (eventType === 'error') {
                setLogs(prev => [...prev, { type: 'error', message: data.message }]);
                setError(data.message);
                addNotification('error',
                  parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download Error' : 'Quantization Error',
                  data.message);
              } else if (eventType === 'log') {
                setLogs(prev => [...prev, { type: 'log', message: data.message }]);
              } else if (eventType === 'info') {
                setLogs(prev => [...prev, { type: 'info', message: `Starting ${data.method} quantization: ${data.repoId} → ${data.bits}-bit` }]);
              } else if (eventType === 'done') {
                setRunning(false);
              }
            } catch {
              // skip
            }
          }
        }
      }
      setRunning(false);
    }).catch((err) => {
      setError(err.message);
      setRunning(false);
      addNotification('error',
        parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download Failed' : 'Quantization Failed',
        err.message);
    });
  };

  useEffect(() => {
    if (recommendation && device && !running && !done && !error && !autoStartedRef.current) {
      const autoStart = sessionStorage.getItem('nexus-autostart-quantize');
      if (autoStart) {
        sessionStorage.removeItem('nexus-autostart-quantize');
        autoStartedRef.current = true;
        const timer = setTimeout(() => startQuantization(), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [recommendation, device, running, done, error]);

  const parsed = recommendation ? parseRecommendation(recommendation) : null;

  const goToAgents = () => {
    if (onSwitchTab) {
      onSwitchTab('agent');
    } else {
      router.push('/agents');
    }
  };

  if (!device || !recommendation) {
    return (
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full animate-scale-in">
          <CardContent className="p-8 md:p-10 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 shadow-sm shadow-violet-500/10 flex items-center justify-center mx-auto mb-5">
              <Layers className="h-7 w-7 text-violet-400" />
            </div>
            <h2 className="text-lg font-bold mb-2">No Recommendation Yet</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Run the AI agent analysis first to get an optimized model recommendation for your device.
            </p>
            <Button size="lg" onClick={goToAgents}>
              Go to Agent Workspace
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <Card className="animate-fade-in-up relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 mb-3">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target Device</p>
              <p className="text-lg font-bold tracking-tight mt-1">{device.deviceName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {device.ramGB}GB RAM &middot; {device.storageGB}GB Storage
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-2 relative overflow-hidden border-primary/20">
          <div className="absolute top-0 left-0 right-0 h-px nexus-gradient" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl nexus-gradient flex items-center justify-center shadow-md shadow-primary/20 mb-3">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Recommendation</p>
              <p className="text-lg font-bold tracking-tight mt-1">{recommendation}</p>
              {parsed && (
                <div className="flex gap-1.5 mt-2 flex-wrap justify-center">
                  <Badge>{parsed.method}</Badge>
                  <Badge variant="secondary">{parsed.bits === 16 ? 'FP16 (No Quantization)' : `${parsed.bits}-bit`}</Badge>
                  {finetuned && (
                    <Badge variant="success" className="gap-1">
                      <Brain className="h-3 w-3" />
                      Finetuned
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Start Button */}
      {!running && !done && !error && (
        <Card className="animate-fade-in-up stagger-3">
          <CardContent className="p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 shadow-sm shadow-violet-500/10 flex items-center justify-center mx-auto mb-5">
              <Layers className="h-8 w-8 text-violet-400" />
            </div>

            {/* Quant level description */}
            {parsed && QUANT_DESCRIPTIONS[parsed.bits] && (
              <p className="text-xs text-muted-foreground/70 mb-3 max-w-sm mx-auto">
                <span className="font-semibold text-foreground/80">{parsed.bits}-bit:</span>{' '}
                {QUANT_DESCRIPTIONS[parsed.bits]}
              </p>
            )}

            {/* VRAM estimation */}
            {parsed && (() => {
              const modelMeta = findModelByName(parsed.model);
              if (!modelMeta?.paramB) return null;
              const estimatedGB = estimateModelRAM(modelMeta.paramB, parsed.bits);
              return (
                <div className="flex items-center justify-center gap-4 mb-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    ~{estimatedGB.toFixed(1)} GB estimated
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {modelMeta.paramB}B params
                  </span>
                </div>
              );
            })()}

            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto leading-relaxed">
              {parsed?.bits === 16
                ? 'This will download the model from HuggingFace without quantization (full FP16 quality).'
                : 'This will download the model from HuggingFace and quantize it on the server. The process may take several minutes depending on model size.'
              }
            </p>
            <Button size="lg" onClick={startQuantization} className="nexus-gradient border-0 text-white px-8">
              <Play className="h-4 w-4 mr-2" />
              {parsed?.bits === 16 ? 'Start Download' : 'Start Quantization'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {(running || done || error) && (
        <Card className={`animate-fade-in-up overflow-hidden ${done ? 'border-emerald-500/20' : error && !done ? 'border-destructive/20' : 'border-primary/20'}`}>
          <div className={`h-px w-full ${done ? 'bg-emerald-500' : error && !done ? 'bg-destructive' : 'nexus-gradient'}`} />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                {running && <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /></div>}
                {done && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                {error && !done && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                <span>{parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download' : 'Quantization'} Progress</span>
              </div>
              <div className="flex items-center gap-3">
                {running && (
                  <Button variant="outline" size="sm" onClick={stopQuantization} className="h-7 px-2.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
                    <Square className="h-3 w-3 mr-1.5 fill-current" />
                    Stop
                  </Button>
                )}
                <span className={`text-lg font-bold ${done ? 'text-emerald-400' : 'text-primary'}`}>
                  {Math.round(progress * 100)}%
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="flex items-start gap-4">
            <ProgressRing
              value={progress * 100}
              status={done ? 'complete' : error && !done ? 'error' : 'running'}
              size={72}
              label={parsed?.method}
            />
            <div className="flex-1 space-y-4">
            {/* Progress bar */}
            <div className={`w-full bg-muted rounded-full h-2.5 overflow-hidden ${running ? 'animate-progress-glow' : ''}`}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                style={{
                  width: `${progress * 100}%`,
                  background: error && !done
                    ? 'var(--destructive)'
                    : done
                      ? 'var(--success)'
                      : 'linear-gradient(90deg, var(--primary), #a78bfa)',
                }}
              >
                {running && <div className="absolute inset-0 animate-shimmer" />}
              </div>
            </div>

            {/* Log output */}
            <div className="bg-accent/50 rounded-xl p-4 max-h-80 overflow-y-auto font-mono text-xs space-y-1 border border-white/[0.06]">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.type === 'error'
                      ? 'text-red-400'
                      : log.type === 'complete'
                      ? 'text-emerald-400 font-semibold'
                      : log.type === 'info'
                      ? 'text-primary'
                      : 'text-muted-foreground/80'
                  }
                >
                  <span className="text-muted-foreground/40 mr-2 select-none">
                    {log.progress !== undefined ? `[${Math.round(log.progress * 100)}%]` : '[---]'}
                  </span>
                  {log.message}
                </div>
              ))}
              {running && (
                <div className="flex items-center gap-2 text-primary">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Processing...
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
            </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completion */}
      {done && (
        <Card className="border-emerald-500/20 animate-celebrate overflow-hidden">
          <div className="h-px w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <AnimatedCheck size={48} delay={200} />
                <div>
                  <p className="text-sm font-bold text-emerald-400">
                    {parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download Complete' : 'Quantization Complete'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fromCache ? 'Previously quantized model found' : 'Your optimized model is ready to use'}
                  </p>
                </div>
              </div>
              {outputFile && (
                <div className="flex flex-wrap gap-2 justify-end">
                  <a href={`/api/quantization/download?file=${encodeURIComponent(outputFile)}`}>
                    <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-md shadow-emerald-500/20">
                      <Download className="h-4 w-4 mr-2" />
                      Download Model
                    </Button>
                  </a>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      sessionStorage.setItem('nexus-deploy-model', JSON.stringify({ file: outputFile, method: parsed?.method || 'GGUF' }));
                      router.push('/deploy');
                    }}
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Deploy to Device
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      const method = parsed?.method || 'GGUF';
                      sessionStorage.setItem('nexus-chat-model', JSON.stringify({ file: outputFile, method }));
                      router.push('/chat');
                    }}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Chat with Model
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setDone(false);
                      setFromCache(false);
                      setOutputFile(null);
                      setError(null);
                      setLogs([]);
                      setProgress(0);
                      startQuantization();
                    }}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Re-quantize
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && !done && !running && (
        <Card className="border-destructive/20 animate-scale-in overflow-hidden">
          <div className="h-px w-full bg-destructive" />
          <CardContent className="p-6 md:p-7 text-center">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 shadow-sm shadow-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-sm text-destructive font-medium mb-1">
              {parsed && (parsed.bits === 16 || parsed.method === 'FP16') ? 'Download Failed' : 'Quantization Failed'}
            </p>
            <p className="text-xs text-muted-foreground mb-5">{error}</p>
            <Button onClick={startQuantization}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry Quantization
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
