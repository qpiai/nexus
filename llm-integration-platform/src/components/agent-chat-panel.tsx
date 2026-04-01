'use client';

import {
  createContext, useContext, useState, useRef, useCallback, useEffect,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bot, X, Send, Trash2, Loader2, CheckCircle2, XCircle,
  Zap, Brain, Rocket, Activity, Eye, ArrowRight, List, Square,
  Sparkles, Database, Cpu, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { generateId } from '@/lib/utils';
import type { AgentChatMessage, AgentActionResult } from '@/lib/types';

// ---- Context ----

interface AgentChatContextType {
  isOpen: boolean;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

const AgentChatContext = createContext<AgentChatContextType>({
  isOpen: false,
  togglePanel: () => {},
  openPanel: () => {},
  closePanel: () => {},
});

export function useAgentChat() {
  return useContext(AgentChatContext);
}

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('nexus-agent-open');
    if (stored === 'true') setIsOpen(true);
  }, []);

  const togglePanel = useCallback(() => {
    setIsOpen(prev => {
      sessionStorage.setItem('nexus-agent-open', String(!prev));
      return !prev;
    });
  }, []);

  const openPanel = useCallback(() => {
    setIsOpen(true);
    sessionStorage.setItem('nexus-agent-open', 'true');
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    sessionStorage.setItem('nexus-agent-open', 'false');
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        togglePanel();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePanel]);

  return (
    <AgentChatContext.Provider value={{ isOpen, togglePanel, openPanel, closePanel }}>
      {children}
    </AgentChatContext.Provider>
  );
}

// ---- Quick Actions ----

const QUICK_ACTIONS: { text: string; icon: ReactNode }[] = [
  { text: 'What models are available?', icon: <Brain className="h-3 w-3" /> },
  { text: 'Help me quantize a model', icon: <Zap className="h-3 w-3" /> },
  { text: 'Check deployment status', icon: <Rocket className="h-3 w-3" /> },
  { text: 'Show running tasks', icon: <Activity className="h-3 w-3" /> },
];

const PAGE_SUGGESTIONS: Record<string, { text: string; icon: ReactNode }[]> = {
  '/pipeline': [
    { text: 'Help me quantize a model', icon: <Zap className="h-3 w-3" /> },
    { text: 'Start fine-tuning', icon: <Brain className="h-3 w-3" /> },
  ],
  '/deploy': [
    { text: 'List deployments', icon: <Rocket className="h-3 w-3" /> },
    { text: 'Help me deploy a model', icon: <Rocket className="h-3 w-3" /> },
  ],
  '/vision': [
    { text: 'List vision datasets', icon: <Activity className="h-3 w-3" /> },
    { text: 'Help me train a vision model', icon: <Brain className="h-3 w-3" /> },
  ],
};

// ---- Tool Display Helpers ----

const TOOL_ICONS: Record<string, React.ReactNode> = {
  quantize: <Zap className="h-3.5 w-3.5 text-violet-400" />,
  quantize_status: <Activity className="h-3.5 w-3.5 text-violet-400" />,
  stop_quantize: <Square className="h-3.5 w-3.5 text-red-400" />,
  start_finetune: <Brain className="h-3.5 w-3.5 text-emerald-400" />,
  finetune_status: <Activity className="h-3.5 w-3.5 text-emerald-400" />,
  stop_finetune: <Square className="h-3.5 w-3.5 text-red-400" />,
  vision_train: <Eye className="h-3.5 w-3.5 text-pink-400" />,
  vision_export: <Layers className="h-3.5 w-3.5 text-purple-400" />,
  navigate: <ArrowRight className="h-3.5 w-3.5 text-primary" />,
  list_models: <List className="h-3.5 w-3.5 text-primary" />,
  list_datasets: <Database className="h-3.5 w-3.5 text-primary" />,
  list_finetune_models: <List className="h-3.5 w-3.5 text-primary" />,
  list_vision_datasets: <List className="h-3.5 w-3.5 text-pink-400" />,
  list_vision_models: <List className="h-3.5 w-3.5 text-pink-400" />,
  list_devices: <Cpu className="h-3.5 w-3.5 text-primary" />,
  list_deployments: <Rocket className="h-3.5 w-3.5 text-primary" />,
  start_deployment: <Rocket className="h-3.5 w-3.5 text-primary" />,
  deployment_status: <Activity className="h-3.5 w-3.5 text-primary" />,
  active_tasks: <Activity className="h-3.5 w-3.5 text-amber-400" />,
};

const TOOL_NAMES: Record<string, string> = {
  quantize: 'Quantize Model',
  quantize_status: 'Quantization Status',
  stop_quantize: 'Stop Quantization',
  start_finetune: 'Start Fine-tuning',
  finetune_status: 'Fine-tune Status',
  stop_finetune: 'Stop Fine-tuning',
  vision_train: 'Vision Training',
  vision_export: 'Vision Export',
  navigate: 'Navigate',
  list_models: 'List Models',
  list_datasets: 'List Datasets',
  list_finetune_models: 'List Finetuned Models',
  list_vision_datasets: 'List Vision Datasets',
  list_vision_models: 'List Vision Models',
  list_devices: 'List Devices',
  list_deployments: 'List Deployments',
  start_deployment: 'Deploy Model',
  deployment_status: 'Deployment Status',
  stop_deployment: 'Stop Deployment',
  active_tasks: 'Active Tasks',
};

const LONG_RUNNING_TOOLS = ['quantize', 'start_finetune', 'vision_train'];

function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' | ');
}

// ---- Action Card ----

function ActionCard({ action }: { action: AgentActionResult }) {
  const resultStr = typeof action.result === 'string'
    ? action.result
    : JSON.stringify(action.result);
  const displayResult = resultStr.length > 150 ? resultStr.slice(0, 150) + '...' : resultStr;
  const isExecuting = action.result === 'Executing...';
  const isLongRunning = LONG_RUNNING_TOOLS.includes(action.tool);

  return (
    <div className="my-2 rounded-xl border border-white/[0.06] bg-accent/20 p-3 text-xs overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-0.5 nexus-gradient" />
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          {TOOL_ICONS[action.tool] || <Zap className="h-3.5 w-3.5 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-foreground">{TOOL_NAMES[action.tool] || action.tool}</span>
          {action.params && Object.keys(action.params).length > 0 && (
            <span className="text-[10px] text-muted-foreground block truncate">{formatParams(action.params)}</span>
          )}
        </div>
        {isExecuting ? (
          <div className="flex items-center gap-1 text-primary shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[10px]">Running</span>
          </div>
        ) : action.success ? (
          <Badge variant="success" className="text-[10px] px-1.5 py-0 h-4 animate-scale-in shrink-0">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            Done
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
            <XCircle className="h-2.5 w-2.5 mr-0.5" />
            Error
          </Badge>
        )}
      </div>
      {!isExecuting && displayResult && (
        <div className="mt-2 text-muted-foreground leading-relaxed bg-accent/30 rounded-lg p-2 break-all">
          {displayResult}
        </div>
      )}
      {isLongRunning && action.success && !isExecuting && (
        <div className="mt-2 flex items-center gap-1.5 text-emerald-400 text-[10px] animate-celebrate">
          <Sparkles className="h-3 w-3" />
          Job started! Check the page for live progress.
        </div>
      )}
      {action.duration > 0 && !isExecuting && (
        <span className="text-[9px] text-muted-foreground/50 mt-1.5 block">{action.duration}ms</span>
      )}
    </div>
  );
}

// ---- Panel Component ----

export function AgentChatPanel() {
  const { isOpen, closePanel } = useAgentChat();
  const pathname = usePathname();
  const router = useRouter();

  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore messages from sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('nexus-agent-messages');
      if (stored) {
        const parsed = JSON.parse(stored) as AgentChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  // Persist messages
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem('nexus-agent-messages', JSON.stringify(messages.slice(-100)));
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionStorage.removeItem('nexus-agent-messages');
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: AgentChatMessage = {
      id: generateId(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const assistantMsg: AgentChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      actions: [],
    };

    const allMessages = [...messages, userMsg];
    setMessages([...allMessages, assistantMsg]);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, pageContext: pathname }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            last.content = err.error || 'Something went wrong.';
          }
          return [...updated];
        });
        setStreaming(false);
        return;
      }

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

              if (eventType === 'token') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += data.text || '';
                  }
                  return [...updated];
                });
              } else if (eventType === 'action_start') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    if (!last.actions) last.actions = [];
                    last.actions.push({
                      tool: data.tool,
                      params: data.params,
                      success: false,
                      result: 'Executing...',
                      duration: 0,
                    });
                  }
                  return [...updated];
                });
              } else if (eventType === 'action_result') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant' && last.actions && last.actions.length > 0) {
                    const lastAction = last.actions[last.actions.length - 1];
                    lastAction.success = data.success;
                    lastAction.result = data.result;
                    lastAction.duration = data.duration;
                  }
                  return [...updated];
                });
              } else if (eventType === 'navigate') {
                const path = data.path as string;
                if (path) {
                  // Handle pipeline tab navigation
                  if (path.includes('?tab=')) {
                    const [base, query] = path.split('?');
                    const tab = new URLSearchParams(query).get('tab');
                    if (tab) sessionStorage.setItem('nexus-pipeline-tab', tab);
                    router.push(base);
                  } else {
                    router.push(path);
                  }
                }
              } else if (eventType === 'summary') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += data.text || '';
                  }
                  return [...updated];
                });
              } else if (eventType === 'error') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += `\n\nError: ${data.error}`;
                  }
                  return [...updated];
                });
              } else if (eventType === 'done') {
                // Stream complete
              }
            } catch {
              // skip malformed data
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            last.content = last.content || 'Agent is temporarily busy, please try again.';
          }
          return [...updated];
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, pathname, router]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  }, [input, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  // Clean action tags from displayed text
  function cleanDisplayText(text: string): string {
    return text
      .replace(/\[ACTION:\w+\][\s\S]*?\[\/ACTION\]/g, '')
      .replace(/\[NAVIGATE:\/[^\]]*\]/g, '')
      .trim();
  }

  const suggestions = PAGE_SUGGESTIONS[pathname] || QUICK_ACTIONS;

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 md:hidden animate-fade-in"
        onClick={closePanel}
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-screen flex flex-col',
          'bg-card/95 backdrop-blur-xl border-l border-white/[0.06] shadow-2xl',
          'w-full sm:w-80 md:w-80',
          'animate-slide-in-right'
        )}
      >
        {/* Header */}
        <div className="relative flex h-14 items-center justify-between px-4 border-b border-white/[0.04] shrink-0">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg nexus-gradient flex items-center justify-center shadow-md shadow-primary/20">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-foreground">Nexus Agent</span>
              <span className="text-[10px] text-muted-foreground block -mt-0.5">AI Copilot</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearMessages}
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={closePanel}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center gap-4 text-center p-4 pt-8">
              <div className="h-14 w-14 rounded-2xl nexus-gradient flex items-center justify-center shadow-lg shadow-primary/20">
                <Bot className="h-7 w-7 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Nexus Agent</p>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
                  Your AI copilot for model optimization.
                </p>
              </div>
              <div className="w-full space-y-1 text-left px-2">
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1.5">What I can do</p>
                {[
                  { icon: <Zap className="h-3 w-3 text-violet-400" />, text: 'Quantize & compress models' },
                  { icon: <Brain className="h-3 w-3 text-emerald-400" />, text: 'Fine-tune with LoRA/QLoRA' },
                  { icon: <Eye className="h-3 w-3 text-pink-400" />, text: 'Train vision models (YOLO)' },
                  { icon: <Rocket className="h-3 w-3 text-primary" />, text: 'Deploy & manage models' },
                ].map(cap => (
                  <div key={cap.text} className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5">
                    {cap.icon}
                    {cap.text}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                {suggestions.map(q => (
                  <button
                    key={q.text}
                    onClick={() => sendMessage(q.text)}
                    className="flex items-center gap-1.5 text-[11px] bg-accent/50 hover:bg-accent border border-white/[0.06] text-muted-foreground hover:text-foreground rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    {q.icon}
                    {q.text}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-2">
                Ctrl+. to toggle
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="h-6 w-6 rounded-md nexus-gradient flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3 w-3 text-white" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary/10 border border-primary/20 text-foreground'
                    : 'bg-accent/30 border border-white/[0.04] text-foreground'
                )}
              >
                {msg.role === 'assistant' ? (
                  <>
                    <div className="whitespace-pre-wrap break-words text-[13px]">
                      {cleanDisplayText(msg.content)}
                      {streaming && messages[messages.length - 1]?.id === msg.id && !msg.content && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          Thinking...
                        </span>
                      )}
                      {streaming && messages[messages.length - 1]?.id === msg.id && msg.content && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse ml-1 align-middle" />
                      )}
                    </div>
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-1">
                        {msg.actions.map((action, i) => (
                          <ActionCard key={`${msg.id}-action-${i}`} action={action} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="whitespace-pre-wrap break-words text-[13px]">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-white/[0.04] p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-white/[0.06] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[40px] max-h-[120px]"
              disabled={streaming}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || streaming}
              className="h-[40px] w-[40px] nexus-gradient border-0 text-white shrink-0 disabled:opacity-40"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
