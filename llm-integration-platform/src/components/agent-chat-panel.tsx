'use client';

import {
  createContext, useContext, useState, useRef, useCallback, useEffect,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bot, X, Send, Trash2, Loader2, CheckCircle2, XCircle,
  Zap, Brain, Rocket, Activity,
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

// ---- Action Card ----

function ActionCard({ action }: { action: AgentActionResult }) {
  const resultStr = typeof action.result === 'string'
    ? action.result
    : JSON.stringify(action.result);
  const displayResult = resultStr.length > 120 ? resultStr.slice(0, 120) + '...' : resultStr;

  return (
    <div className="my-2 rounded-lg border border-border/50 bg-accent/30 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <Zap className="h-3 w-3 text-primary shrink-0" />
        <span className="font-medium text-foreground">{action.tool}</span>
        {action.success ? (
          <Badge variant="success" className="text-[10px] px-1.5 py-0 h-4">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            Success
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
            <XCircle className="h-2.5 w-2.5 mr-0.5" />
            Failed
          </Badge>
        )}
        {action.duration > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">{action.duration}ms</span>
        )}
      </div>
      {displayResult && (
        <div className="mt-1.5 text-muted-foreground break-all leading-relaxed">{displayResult}</div>
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
          'bg-card/95 backdrop-blur-xl border-l border-border/40 shadow-2xl',
          'w-full sm:w-80 md:w-80',
          'animate-slide-in-right'
        )}
      >
        {/* Header */}
        <div className="relative flex h-14 items-center justify-between px-4 border-b border-border/30 shrink-0">
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
            <div className="flex flex-col items-center gap-4 text-center p-4 pt-12">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Bot className="h-7 w-7 text-primary/60" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Nexus Agent</p>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
                  I can help you quantize models, fine-tune, deploy, and manage your platform.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                {suggestions.map(q => (
                  <button
                    key={q.text}
                    onClick={() => sendMessage(q.text)}
                    className="flex items-center gap-1.5 text-[11px] bg-accent/50 hover:bg-accent border border-border/40 text-muted-foreground hover:text-foreground rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    {q.icon}
                    {q.text}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-4">
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
                    : 'bg-accent/30 border border-border/30 text-foreground'
                )}
              >
                {msg.role === 'assistant' ? (
                  <>
                    <div className="whitespace-pre-wrap break-words text-[13px]">
                      {cleanDisplayText(msg.content)}
                      {streaming && messages[messages.length - 1]?.id === msg.id && (
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
        <form onSubmit={handleSubmit} className="border-t border-border/30 p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border/40 bg-[var(--input-bg)] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[40px] max-h-[120px]"
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
