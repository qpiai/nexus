'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Bot, Brain, ShieldAlert, Compass, Loader2, CheckCircle2, ArrowRight, Cpu, Pencil, RefreshCw, Check, Sparkles, Play, Layers, Settings2, SkipForward } from 'lucide-react';
import { NexusSelect } from '@/components/ui/nexus-select';
import { AgentMessage, AgentRole, AgentWorkflow, DeviceInput } from '@/lib/types';
import { AGENT_COLORS, SUPPORTED_MODELS, METHOD_BITS } from '@/lib/constants';
import { useNotifications } from '@/components/notifications';

const AGENT_ICONS: Record<AgentRole, React.ElementType> = {
  research: Bot,
  reasoning: Brain,
  critic: ShieldAlert,
  orchestrator: Compass,
};

const AGENT_LABELS: Record<AgentRole, string> = {
  research: 'Research',
  reasoning: 'Reasoning',
  critic: 'Critic',
  orchestrator: 'Orchestrator',
};

function parseRecommendation(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i].content.match(/RECOMMENDATION:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

type ActionMode = null | 'override' | 'refine' | 'accepted';

interface AgentPanelProps {
  onSwitchTab?: (tab: string) => void;
}

export function AgentPanel({ onSwitchTab }: AgentPanelProps) {
  const router = useRouter();
  const { addNotification } = useNotifications();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [workflow, setWorkflow] = useState<AgentWorkflow | null>(null);
  const [running, setRunning] = useState(false);
  const [device, setDevice] = useState<DeviceInput | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Override state
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [overrideModel, setOverrideModel] = useState(SUPPORTED_MODELS[0].name);
  const [overrideMethod, setOverrideMethod] = useState<string>('GGUF');
  const [overrideBits, setOverrideBits] = useState<number>(4);

  // Auto-start tracking
  const autoStartedRef = useRef(false);

  // Refine state
  const [feedbackText, setFeedbackText] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem('nexus-device');
    if (stored) {
      setDevice(JSON.parse(stored));
    }
  }, []);

  // Auto-start research when coming from Home page "Find Optimal Model"
  useEffect(() => {
    if (device && !running && !workflow && !autoStartedRef.current && messages.length === 0) {
      const fromHome = sessionStorage.getItem('nexus-auto-start');
      if (fromHome) {
        sessionStorage.removeItem('nexus-auto-start');
        autoStartedRef.current = true;
        const timer = setTimeout(() => startWorkflow(), 500);
        return () => clearTimeout(timer);
      }
    }
  }, [device, running, workflow, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll server for agent state on mount (survives navigation)
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/agents/status');
        if (!res.ok) return;
        const data = await res.json();

        if (data.running || data.done || data.events?.length > 0) {
          // Replay events to reconstruct messages and workflow state
          const restoredMessages: AgentMessage[] = [];
          let restoredWorkflow: AgentWorkflow | null = null;

          for (const evt of data.events) {
            if (evt.type === 'message') {
              restoredMessages.push(evt.data as unknown as AgentMessage);
            } else if (evt.type === 'status' || evt.type === 'workflow' || evt.type === 'complete') {
              restoredWorkflow = evt.data as unknown as AgentWorkflow;
            }
          }

          if (restoredMessages.length > 0) setMessages(restoredMessages);
          if (restoredWorkflow) setWorkflow(restoredWorkflow);
          setRunning(data.running || false);

          // Restore recommendation from replayed messages
          const rec = parseRecommendation(restoredMessages);
          if (rec) {
            setRecommendation(rec);
            sessionStorage.setItem('nexus-recommendation', rec);
          }
        }
      } catch {
        // ignore
      }
    }

    fetchStatus().then(() => {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/agents/status');
          if (!res.ok) return;
          const data = await res.json();

          if (data.running || data.done || data.events?.length > 0) {
            const restoredMessages: AgentMessage[] = [];
            let restoredWorkflow: AgentWorkflow | null = null;

            for (const evt of data.events) {
              if (evt.type === 'message') {
                restoredMessages.push(evt.data as unknown as AgentMessage);
              } else if (evt.type === 'status' || evt.type === 'workflow' || evt.type === 'complete') {
                restoredWorkflow = evt.data as unknown as AgentWorkflow;
              }
            }

            if (restoredMessages.length > 0) setMessages(restoredMessages);
            if (restoredWorkflow) setWorkflow(restoredWorkflow);
            setRunning(data.running || false);

            const rec = parseRecommendation(restoredMessages);
            if (rec) {
              setRecommendation(rec);
              sessionStorage.setItem('nexus-recommendation', rec);
            }
          }

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

  const availableMethods = useMemo(() => {
    const meta = SUPPORTED_MODELS.find(m => m.name === overrideModel);
    return meta?.methods || ['GGUF'];
  }, [overrideModel]);

  useEffect(() => {
    if (!availableMethods.includes(overrideMethod as 'GGUF' | 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX')) {
      setOverrideMethod(availableMethods[0]);
    }
  }, [overrideModel, availableMethods, overrideMethod]);

  useEffect(() => {
    const validBits = METHOD_BITS[overrideMethod] || [4];
    if (!validBits.includes(overrideBits)) {
      setOverrideBits(validBits[0]);
    }
  }, [overrideMethod, overrideBits]);

  const processSSEStream = useCallback(async (res: Response) => {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
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
            if (eventType === 'message') {
              setMessages(prev => {
                const next = [...prev, data];
                const rec = parseRecommendation(next);
                if (rec) {
                  setRecommendation(rec);
                  sessionStorage.setItem('nexus-recommendation', rec);
                }
                return next;
              });
            } else if (eventType === 'status' || eventType === 'workflow' || eventType === 'complete') {
              setWorkflow(data);
            }
            if (eventType === 'done' || eventType === 'complete') {
              setRunning(false);
              if (data.status === 'converged') {
                addNotification('success', 'Analysis Complete', 'AI agents have converged on a recommendation');
              }
            }
          } catch {
            // skip malformed data
          }
        }
      }
    }
    setRunning(false);
  }, [addNotification]);

  const startWorkflow = () => {
    if (!device) return;
    setRunning(true);
    setMessages([]);
    setWorkflow(null);
    setRecommendation(null);
    setActionMode(null);

    addNotification('info', 'Agent Analysis Started', `Analyzing ${device.deviceName} (${device.ramGB}GB RAM)`);

    fetch('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
    })
      .then(processSSEStream)
      .catch(() => {
        setRunning(false);
        addNotification('error', 'Agent Analysis Failed', 'Could not complete the analysis');
      });
  };

  const goToQuantize = () => {
    if (onSwitchTab) {
      onSwitchTab('quantize');
    } else {
      router.push('/quantize');
    }
  };

  const goToFinetune = () => {
    if (onSwitchTab) {
      onSwitchTab('finetune');
    } else {
      router.push('/finetune');
    }
  };

  const handleAccept = () => {
    setActionMode('accepted');
  };

  const handleOverrideProceed = () => {
    const rec = `${overrideBits}-bit ${overrideMethod} ${overrideModel}`;
    setRecommendation(rec);
    sessionStorage.setItem('nexus-recommendation', rec);
    setActionMode('accepted');
  };

  const handleRefineSubmit = () => {
    if (!device || !feedbackText.trim()) return;
    setRunning(true);
    setWorkflow(null);
    setRecommendation(null);
    setActionMode(null);

    const previousMessages = [...messages];

    fetch('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device,
        feedback: feedbackText.trim(),
        previousMessages,
      }),
    })
      .then(processSSEStream)
      .catch(() => setRunning(false));

    setFeedbackText('');
  };

  const currentIteration = workflow?.currentIteration || 0;
  const isConverged = workflow?.status === 'converged';

  if (!device) {
    return (
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full animate-scale-in">
          <CardContent className="p-8 md:p-10 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 shadow-sm shadow-primary/10 flex items-center justify-center mx-auto mb-5">
              <Cpu className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-lg font-bold mb-2">No Device Configured</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Enter your device specifications on the home page first so our AI agents can analyze the best model for you.
            </p>
            <Button size="lg" onClick={() => router.push('/')}>
              Go to Home
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">
      {/* Device Summary + Start Button */}
      <Card className="animate-fade-in-up overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-violet-400 to-primary" />
        <CardContent className="p-6 md:p-7">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 shadow-sm shadow-primary/10 flex items-center justify-center">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-base font-bold">{device.deviceName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {device.ramGB}GB RAM &middot; {device.storageGB}GB Storage &middot; {device.gpuInfo || 'No GPU'} &middot; {device.deviceType}
                </p>
              </div>
            </div>
            {!running && !isConverged && (
              <Button size="lg" onClick={startWorkflow} className="nexus-gradient border-0 text-white shrink-0">
                <Play className="h-4 w-4 mr-2" />
                Start Research
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Agent Status Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
        {(['research', 'reasoning', 'critic', 'orchestrator'] as AgentRole[]).map((agent, i) => {
          const Icon = AGENT_ICONS[agent];
          const status = workflow?.agents[agent] || 'idle';
          const isActive = status === 'thinking';
          const isDone = status === 'complete';
          return (
            <Card key={agent} className={`animate-fade-in-up stagger-${i + 1} relative overflow-hidden ${isActive ? 'border-primary/30 animate-glow-pulse' : isDone ? 'border-emerald-500/20' : ''}`}>
              <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, ${AGENT_COLORS[agent]}80, ${AGENT_COLORS[agent]}20)` }} />
              <CardContent className="p-5 md:p-6">
                <div className="flex flex-col items-center text-center">
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center mb-3 transition-all ${isActive ? 'animate-pulse' : ''}`}
                    style={{ background: `linear-gradient(to bottom right, ${AGENT_COLORS[agent]}20, ${AGENT_COLORS[agent]}05)`, boxShadow: `0 1px 3px ${AGENT_COLORS[agent]}10` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: AGENT_COLORS[agent] }} />
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{AGENT_LABELS[agent]}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {isActive && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                    {isDone && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                    <span className={`text-sm font-bold capitalize ${isActive ? 'text-primary' : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>{status}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Message Stream */}
      <Card className="min-h-[400px] flex flex-col animate-fade-in-up">
        <CardHeader className="border-b border-border/40">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center"><Sparkles className="h-3.5 w-3.5 text-primary" /></div>
              <span>Agent Communication</span>
            </div>
            <div className="flex items-center gap-2">
              {running && (
                <div className="flex items-center gap-1.5 text-xs text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing...</span>
                </div>
              )}
              {currentIteration > 0 && <Badge variant="outline">Iter {currentIteration}/{workflow?.maxIterations}</Badge>}
              {isConverged && <Badge variant="success">Converged</Badge>}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-4 pt-5 max-h-[600px]">
          {messages.length === 0 && !running && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center mb-4"><Bot className="h-7 w-7 text-primary/40" /></div>
              <p className="text-sm">Click &quot;Start Research&quot; to begin analysis</p>
              <p className="text-xs mt-1 opacity-60">4 AI agents will analyze your device</p>
            </div>
          )}
          {messages.length === 0 && running && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="h-12 w-12 rounded-2xl nexus-gradient flex items-center justify-center mb-4 animate-pulse">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <p className="text-sm font-medium">Starting analysis...</p>
              <p className="text-xs mt-1 opacity-60">Starting multi-agent analysis</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const Icon = AGENT_ICONS[msg.agent];
            return (
              <div
                key={msg.id}
                className="flex gap-3 animate-fade-in-up group"
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                <div className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: `${AGENT_COLORS[msg.agent]}12`, border: `1px solid ${AGENT_COLORS[msg.agent]}20` }}>
                  <Icon className="h-3.5 w-3.5" style={{ color: AGENT_COLORS[msg.agent] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold" style={{ color: AGENT_COLORS[msg.agent] }}>
                      {AGENT_LABELS[msg.agent]}
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">Iter {msg.iteration}</Badge>
                    {msg.confidence && (
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        {(msg.confidence * 100).toFixed(0)}% confidence
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground/90 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </CardContent>
      </Card>

      {/* Recommendation Card */}
      {isConverged && recommendation && (
        <Card className="border-primary/20 animate-scale-in overflow-hidden">
          <div className="h-px w-full nexus-gradient" />
          <CardContent className="p-6 md:p-7 space-y-5">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-2xl nexus-gradient flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-1">AI Recommendation</p>
                <p className="text-xl font-bold">{recommendation}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Optimized for {device.deviceName} &middot; {device.ramGB}GB RAM
                </p>
              </div>
            </div>

            {/* Action buttons — hidden once accepted */}
            {actionMode !== 'accepted' && (
              <div className="flex flex-wrap gap-2">
                <Button size="lg" onClick={handleAccept} className="nexus-gradient border-0 text-white">
                  <Check className="h-4 w-4 mr-2" />
                  Accept
                </Button>
                <Button
                  size="lg"
                  variant={actionMode === 'override' ? 'secondary' : 'outline'}
                  onClick={() => setActionMode(actionMode === 'override' ? null : 'override')}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Override
                </Button>
                <Button
                  size="lg"
                  variant={actionMode === 'refine' ? 'secondary' : 'outline'}
                  onClick={() => setActionMode(actionMode === 'refine' ? null : 'refine')}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refine
                </Button>
              </div>
            )}

            {/* Override Panel */}
            {actionMode === 'override' && (
              <div className="rounded-xl border border-border/60 p-5 space-y-4 bg-accent/30 animate-fade-in-up">
                <p className="text-sm font-semibold">Custom Configuration</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5">
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-2 block font-semibold uppercase tracking-wider">Model</label>
                    <NexusSelect
                      value={overrideModel}
                      onChange={setOverrideModel}
                      icon={<Cpu className="h-3.5 w-3.5" />}
                      options={SUPPORTED_MODELS.map(m => ({
                        value: m.name,
                        label: m.name,
                        description: m.methods?.join(', '),
                      }))}
                      maxHeight={200}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-2 block font-semibold uppercase tracking-wider">Method</label>
                    <NexusSelect
                      value={overrideMethod}
                      onChange={setOverrideMethod}
                      icon={<Layers className="h-3.5 w-3.5" />}
                      options={availableMethods.map(m => ({
                        value: m,
                        label: m,
                      }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground mb-2 block font-semibold uppercase tracking-wider">Bits</label>
                    <NexusSelect
                      value={String(overrideBits)}
                      onChange={v => setOverrideBits(Number(v))}
                      icon={<Settings2 className="h-3.5 w-3.5" />}
                      options={(METHOD_BITS[overrideMethod] || [4]).map(b => ({
                        value: String(b),
                        label: b === 16 ? '16-bit (FP16 — No Quantization)' : `${b}-bit`,
                      }))}
                    />
                  </div>
                </div>
                <Button onClick={handleOverrideProceed}>
                  Proceed with Override
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}

            {/* Refine Panel */}
            {actionMode === 'refine' && (
              <div className="rounded-xl border border-border/60 p-5 space-y-3 bg-accent/30 animate-fade-in-up">
                <p className="text-sm font-semibold">Give the agents feedback</p>
                <Textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder='e.g. "I need a smaller model", "Use AWQ instead", "Try a Qwen model"'
                  className="min-h-[80px] rounded-xl"
                />
                <Button
                  onClick={handleRefineSubmit}
                  disabled={!feedbackText.trim()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Send Feedback
                </Button>
              </div>
            )}

            {/* Next Step — Finetune or Quantize */}
            {actionMode === 'accepted' && (
              <div className="space-y-4 animate-fade-in-up">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-400">Recommendation accepted</p>
                </div>
                <p className="text-sm text-muted-foreground">Choose your next step:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Finetune Option */}
                  <button
                    onClick={goToFinetune}
                    className="group relative rounded-xl border border-border/60 p-5 text-left hover:border-pink-500/40 hover:bg-pink-500/5 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl bg-pink-500/10 flex items-center justify-center group-hover:bg-pink-500/20 transition-colors">
                        <Brain className="h-5 w-5 text-pink-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Finetune First</p>
                        <Badge variant="outline" className="text-[9px] mt-0.5">Optional</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Train the model on your own data before quantizing. Improves quality for specific tasks.
                    </p>
                    <ArrowRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-hover:text-pink-400 transition-colors" />
                  </button>

                  {/* Quantize Option */}
                  <button
                    onClick={goToQuantize}
                    className="group relative rounded-xl border border-border/60 p-5 text-left hover:border-violet-500/40 hover:bg-violet-500/5 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20 transition-colors">
                        <Layers className="h-5 w-5 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Quantize Now</p>
                        <Badge variant="outline" className="text-[9px] mt-0.5">
                          <SkipForward className="h-2.5 w-2.5 mr-0.5" />
                          Skip finetune
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Compress the base model directly. Fastest path to deployment on your device.
                    </p>
                    <ArrowRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-hover:text-violet-400 transition-colors" />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
