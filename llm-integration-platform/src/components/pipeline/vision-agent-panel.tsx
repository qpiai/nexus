'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { NexusSelect } from '@/components/ui/nexus-select';
import {
  Bot, Brain, ShieldAlert, Compass, Loader2, CheckCircle2, ArrowRight,
  Play, Pencil, RefreshCw, Check, Sparkles, Eye, Layers,
} from 'lucide-react';
import { AgentMessage, AgentRole, AgentWorkflow } from '@/lib/types';
import { VISION_AGENT_COLORS, SUPPORTED_VISION_MODELS, VISION_EXPORT_FORMATS } from '@/lib/constants';
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

function parseVisionRecommendation(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i].content.match(/RECOMMENDATION:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

function parseRecommendationParts(rec: string): { model: string; task: string; format: string; precision: string } | null {
  const parts = rec.split('|').map(s => s.trim());
  if (parts.length >= 4) {
    return { model: parts[0], task: parts[1], format: parts[2], precision: parts[3] };
  }
  return null;
}

type ActionMode = null | 'override' | 'refine' | 'accepted';

interface VisionAgentPanelProps {
  onSwitchTab?: (tab: string) => void;
}

export function VisionAgentPanel({ onSwitchTab }: VisionAgentPanelProps) {
  const { addNotification } = useNotifications();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [workflow, setWorkflow] = useState<AgentWorkflow | null>(null);
  const [running, setRunning] = useState(false);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use case input
  const [description, setDescription] = useState('');
  const [targetDevice, setTargetDevice] = useState('');
  const [taskPref, setTaskPref] = useState<string>('');
  const [priority, setPriority] = useState<string>('balance');

  // Override state
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [overrideModel, setOverrideModel] = useState(SUPPORTED_VISION_MODELS[0].name);
  const [overrideTask, setOverrideTask] = useState<string>('detect');
  const [overrideFormat, setOverrideFormat] = useState<string>('onnx');
  const [overridePrecision, setOverridePrecision] = useState<string>('fp16');

  // Refine state
  const [feedbackText, setFeedbackText] = useState('');

  // Restore from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('nexus-vision-usecase');
    if (stored) {
      try {
        const uc = JSON.parse(stored);
        if (uc.description) setDescription(uc.description);
        if (uc.targetDevice) setTargetDevice(uc.targetDevice);
        if (uc.task) setTaskPref(uc.task);
        if (uc.priority) setPriority(uc.priority);
      } catch { /* ignore */ }
    }
    const storedRec = sessionStorage.getItem('nexus-vision-recommendation');
    if (storedRec) setRecommendation(storedRec);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startWorkflow = useCallback(async (feedback?: string) => {
    if (!description.trim()) return;

    setRunning(true);
    setMessages(feedback ? messages : []);
    setWorkflow(null);
    setRecommendation(null);
    setActionMode(null);

    // Store use case
    const useCase = {
      description: description.trim(),
      targetDevice: targetDevice.trim() || undefined,
      task: taskPref || undefined,
      priority: priority || undefined,
    };
    sessionStorage.setItem('nexus-vision-usecase', JSON.stringify(useCase));

    try {
      const res = await fetch('/api/vision/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          useCase,
          feedback: feedback || undefined,
          previousMessages: feedback ? messages : undefined,
        }),
      });

      if (!res.ok) {
        setRunning(false);
        addNotification('error', 'Agent Error', 'Failed to start vision agent workflow');
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
              if (eventType === 'message') {
                setMessages(prev => [...prev, data as AgentMessage]);
              } else if (eventType === 'status' || eventType === 'workflow') {
                setWorkflow(data as AgentWorkflow);
              } else if (eventType === 'complete') {
                setWorkflow(data as AgentWorkflow);
                const rec = parseVisionRecommendation((data as AgentWorkflow).messages || []);
                if (rec) {
                  setRecommendation(rec);
                  sessionStorage.setItem('nexus-vision-recommendation', rec);
                  addNotification('success', 'Vision Agent Complete', `Recommendation: ${rec}`);
                }
              } else if (eventType === 'done') {
                setRunning(false);
              }
            } catch { /* skip */ }
          }
        }
      }
      setRunning(false);

      // Check for recommendation in accumulated messages
      setMessages(prev => {
        const rec = parseVisionRecommendation(prev);
        if (rec && !recommendation) {
          setRecommendation(rec);
          sessionStorage.setItem('nexus-vision-recommendation', rec);
        }
        return prev;
      });
    } catch (err) {
      setRunning(false);
      addNotification('error', 'Agent Error', (err as Error).message);
    }
  }, [description, targetDevice, taskPref, priority, messages, recommendation, addNotification]);

  const handleAccept = useCallback(() => {
    setActionMode('accepted');
    if (recommendation) {
      sessionStorage.setItem('nexus-vision-recommendation', recommendation);
    }
    addNotification('success', 'Recommendation Accepted', 'Navigate to Finetune or Export to continue');
  }, [recommendation, addNotification]);

  const handleOverrideConfirm = useCallback(() => {
    const rec = `${overrideModel} | ${overrideTask} | ${overrideFormat} | ${overridePrecision}`;
    setRecommendation(rec);
    sessionStorage.setItem('nexus-vision-recommendation', rec);
    setActionMode('accepted');
    addNotification('info', 'Override Applied', rec);
  }, [overrideModel, overrideTask, overrideFormat, overridePrecision, addNotification]);

  const handleRefine = useCallback(() => {
    if (feedbackText.trim()) {
      startWorkflow(feedbackText.trim());
      setFeedbackText('');
    }
  }, [feedbackText, startWorkflow]);

  const recParts = recommendation ? parseRecommendationParts(recommendation) : null;

  const modelOptions = SUPPORTED_VISION_MODELS.map(m => ({ value: m.name, label: m.name, description: `${m.task} — ${m.paramM}M params` }));
  const formatOptions = VISION_EXPORT_FORMATS.map(f => ({ value: f.id, label: f.name, description: f.description }));
  const precisionOptions = [
    { value: 'fp32', label: 'FP32' },
    { value: 'fp16', label: 'FP16' },
    { value: 'int8', label: 'INT8' },
  ];

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Use Case Input */}
      <Card className="animate-fade-in-up relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400 via-blue-400/60 to-transparent" />
        <CardHeader className="border-b border-white/[0.06]">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-400/10 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            </div>
            Describe Your Vision Task
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 md:p-7 pt-6 space-y-4">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">What do you want to detect or segment?</label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Detect cars in parking lot footage, Segment defects on PCB boards, Count people in retail store..."
              rows={3}
              disabled={running}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Target Device (optional)</label>
              <input
                type="text"
                value={targetDevice}
                onChange={e => setTargetDevice(e.target.value)}
                placeholder="e.g. Raspberry Pi, iPhone 15"
                disabled={running}
                className="w-full h-10 rounded-xl border border-white/[0.06] bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Priority</label>
              <NexusSelect
                value={priority}
                onChange={v => setPriority(v)}
                options={[
                  { value: 'speed', label: 'Speed', description: 'Fastest inference' },
                  { value: 'balance', label: 'Balance', description: 'Speed + accuracy' },
                  { value: 'accuracy', label: 'Accuracy', description: 'Best detection quality' },
                ]}
                disabled={running}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Task Type (optional)</label>
            <div className="flex gap-2">
              {[
                { id: '', label: 'Auto' },
                { id: 'detect', label: 'Detection' },
                { id: 'segment', label: 'Segmentation' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTaskPref(t.id)}
                  disabled={running}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                    taskPref === t.id
                      ? 'bg-blue-400/15 text-blue-400 border border-blue-400/30 shadow-sm'
                      : 'bg-accent/50 text-muted-foreground border border-white/[0.06] hover:bg-accent hover:border-white/[0.1]'
                  } disabled:opacity-50`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            size="lg"
            onClick={() => startWorkflow()}
            disabled={running || !description.trim()}
            className="w-full bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-600 hover:to-violet-600 border-0 text-white h-12"
          >
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {running ? 'Agents Working...' : 'Find Optimal Configuration'}
          </Button>
        </CardContent>
      </Card>

      {/* Agent Status Bar */}
      {(running || workflow) && (
        <div className="grid grid-cols-4 gap-2 animate-fade-in-up">
          {(['research', 'reasoning', 'critic', 'orchestrator'] as AgentRole[]).map(role => {
            const status = workflow?.agents[role] || 'idle';
            const Icon = AGENT_ICONS[role];
            const color = VISION_AGENT_COLORS[role];
            return (
              <Card key={role} className={`relative overflow-hidden transition-all ${status === 'thinking' ? 'border-blue-400/30' : status === 'complete' ? 'border-emerald-500/20' : 'border-white/[0.04]'}`}>
                <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
                <CardContent className="p-3 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${status === 'thinking' ? 'animate-pulse' : ''}`} style={{ background: `${color}15` }}>
                      {status === 'thinking' ? (
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color }} />
                      ) : status === 'complete' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Icon className="h-4 w-4" style={{ color }} />
                      )}
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: status === 'complete' ? 'var(--success)' : color }}>
                      {AGENT_LABELS[role]}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Message Stream */}
      {messages.length > 0 && (
        <Card className="animate-fade-in-up overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Brain className="h-3.5 w-3.5 text-violet-400" />
              </div>
              Agent Analysis
              {workflow?.currentIteration && (
                <Badge variant="outline" className="text-[9px] ml-auto">Iteration {workflow.currentIteration}/{workflow.maxIterations}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 max-h-96 overflow-y-auto space-y-3">
            {messages.map(msg => {
              const color = VISION_AGENT_COLORS[msg.agent] || '#888';
              const Icon = AGENT_ICONS[msg.agent];
              return (
                <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${color}15` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold capitalize" style={{ color }}>{msg.agent}</span>
                      <span className="text-[9px] text-muted-foreground/50">iter {msg.iteration}</span>
                      {msg.confidence && <Badge variant="outline" className="text-[9px]">{Math.round(msg.confidence * 100)}%</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
            {running && (
              <div className="flex items-center gap-2 text-blue-400 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                Agents working...
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recommendation Card */}
      {recommendation && !running && (
        <Card className="animate-scale-in overflow-hidden border-emerald-500/20">
          <div className="h-px w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              Agent Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6 space-y-4">
            {recParts ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="default" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-sm px-3 py-1">{recParts.model}</Badge>
                <Badge variant="default" className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-sm px-3 py-1">{recParts.task}</Badge>
                <Badge variant="default" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-sm px-3 py-1">{recParts.format}</Badge>
                <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-sm px-3 py-1">{recParts.precision}</Badge>
              </div>
            ) : (
              <p className="text-sm font-mono text-muted-foreground">{recommendation}</p>
            )}

            {/* Action Buttons */}
            {actionMode === null && (
              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleAccept} className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 border-0 text-white">
                  <Check className="h-4 w-4 mr-2" />Accept
                </Button>
                <Button variant="outline" onClick={() => setActionMode('override')}>
                  <Pencil className="h-4 w-4 mr-2" />Override
                </Button>
                <Button variant="outline" onClick={() => setActionMode('refine')}>
                  <RefreshCw className="h-4 w-4 mr-2" />Refine
                </Button>
              </div>
            )}

            {/* Override Form */}
            {actionMode === 'override' && (
              <div className="space-y-3 p-4 rounded-xl bg-accent/30 border border-white/[0.06]">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">Model</label>
                    <NexusSelect value={overrideModel} onChange={v => setOverrideModel(v)} options={modelOptions} maxHeight={200} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">Task</label>
                    <NexusSelect value={overrideTask} onChange={v => setOverrideTask(v)} options={[
                      { value: 'detect', label: 'Detection' },
                      { value: 'segment', label: 'Segmentation' },
                    ]} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">Format</label>
                    <NexusSelect value={overrideFormat} onChange={v => setOverrideFormat(v)} options={formatOptions} maxHeight={200} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">Precision</label>
                    <NexusSelect value={overridePrecision} onChange={v => setOverridePrecision(v)} options={precisionOptions} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleOverrideConfirm} className="bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-600 hover:to-violet-600 border-0 text-white">
                    <Check className="h-4 w-4 mr-2" />Confirm Override
                  </Button>
                  <Button variant="outline" onClick={() => setActionMode(null)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Refine Form */}
            {actionMode === 'refine' && (
              <div className="space-y-3 p-4 rounded-xl bg-accent/30 border border-white/[0.06]">
                <Textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder="Tell the agents what to change... e.g. 'I need it to run on Android, use TFLite instead' or 'Use segmentation not detection'"
                  rows={3}
                  className="resize-none"
                />
                <div className="flex gap-2">
                  <Button onClick={handleRefine} disabled={!feedbackText.trim()} className="bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-600 hover:to-violet-600 border-0 text-white">
                    <RefreshCw className="h-4 w-4 mr-2" />Re-run Agents
                  </Button>
                  <Button variant="outline" onClick={() => setActionMode(null)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Next Steps */}
            {actionMode === 'accepted' && (
              <div className="space-y-3">
                <p className="text-sm text-emerald-400 font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Recommendation accepted! What would you like to do next?
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => onSwitchTab?.('finetune')}
                    variant="outline"
                    className="border-pink-400/30 text-pink-400 hover:bg-pink-400/10"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Finetune First
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                  <Button
                    onClick={() => onSwitchTab?.('export')}
                    className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 border-0 text-white"
                  >
                    <Layers className="h-4 w-4 mr-2" />
                    Export Now
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
