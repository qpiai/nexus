'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from '@/components/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  MessageSquare, Send, Loader2, Bot, User, Trash2, Zap,
  Clock, Hash, AlertCircle, Sparkles, Cpu, HardDrive, Brain, ChevronRight,
  ImagePlus, X,
} from 'lucide-react';
import { NexusSelect, NexusSelectOption } from '@/components/ui/nexus-select';
import { generateId } from '@/lib/utils';

interface ModelInfo {
  name: string;
  file: string;
  method: 'GGUF' | 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX' | 'Finetune' | 'FP16';
  sizeMB: number;
  isVLM?: boolean;
}

function parseThinkBlocks(content: string): { thinking: string | null; response: string } {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const response = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinking, response };
  }
  // Partial thinking block (still streaming)
  const openMatch = content.match(/<think>([\s\S]*)/);
  if (openMatch && !content.includes('</think>')) {
    return { thinking: openMatch[1].trim(), response: '' };
  }
  return { thinking: null, response: content };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imagePreview?: string;
  metrics?: {
    tokens_generated: number;
    time_ms: number;
    tokens_per_sec: number;
  };
}

export default function ChatPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Load models on mount with retry for auto-selection
  useEffect(() => {
    const stored = sessionStorage.getItem('nexus-chat-model');
    let target: { file: string; method?: string } | null = null;
    if (stored) {
      try { target = JSON.parse(stored); } catch { /* ignore */ }
      sessionStorage.removeItem('nexus-chat-model');
    }

    async function load(attempt = 0) {
      try {
        const res = await fetch('/api/chat/models');
        const data = await res.json();
        const list: ModelInfo[] = data.models || [];
        setModels(list);

        if (target?.file) {
          const match = list.find(m => m.file === target!.file);
          if (match) {
            setSelectedModel(match.file);
          } else if (attempt < 2) {
            // File may not be visible yet after quantization — retry
            setTimeout(() => load(attempt + 1), 1500);
            return;
          } else if (list.length > 0) {
            setSelectedModel(list[0].file);
          }
        } else if (list.length > 0) {
          setSelectedModel(list[0].file);
        }
      } catch {
        setError('Failed to load models');
      } finally {
        setLoadingModels(false);
      }
    }
    load();
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getSelectedModelInfo = useCallback((): ModelInfo | undefined => {
    return models.find(m => m.file === selectedModel);
  }, [models, selectedModel]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || !selectedModel) return;

    const modelInfo = getSelectedModelInfo();
    if (!modelInfo) return;

    // Warn if attaching image to non-VLM model
    if (imageFile && !modelInfo.isVLM) {
      setError(`${modelInfo.method} models don't support image input. Use an FP16/VLM model for vision tasks.`);
      return;
    }

    // Convert image to base64 if present
    let imageBase64: string | undefined;
    let msgImagePreview: string | undefined;
    if (imageFile) {
      const buf = await imageFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      imageBase64 = btoa(binary);
      msgImagePreview = imagePreview || undefined;
      setImageFile(null);
      setImagePreview(null);
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      ...(msgImagePreview ? { imagePreview: msgImagePreview } : {}),
    };

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    setError(null);
    setStatusMessage(null);

    // Build message history for context
    const allMessages = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelInfo.file,
          method: modelInfo.method,
          messages: allMessages,
          maxTokens: 512,
          ...(imageBase64 ? { image: imageBase64 } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Server error (${res.status})`);
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
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + (data.text || ''),
                    };
                  }
                  return updated;
                });
              } else if (eventType === 'metrics') {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      metrics: {
                        tokens_generated: data.tokens_generated,
                        time_ms: data.time_ms,
                        tokens_per_sec: data.tokens_per_sec,
                      },
                    };
                  }
                  return updated;
                });
              } else if (eventType === 'status') {
                setStatusMessage(data.message);
              } else if (eventType === 'error') {
                setError(data.message);
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setStreaming(false);
      setStatusMessage(null);
      abortRef.current = null;
    }
  }, [input, streaming, selectedModel, messages, getSelectedModelInfo, imageFile, imagePreview]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setStatusMessage(null);
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  const modelInfo = getSelectedModelInfo();

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <Header title="Chat" subtitle="Talk to your model" />
      <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)]">
        {/* Top bar with gradient accent */}
        <div className="relative border-b border-white/[0.04]">
          <div className="nexus-gradient absolute inset-x-0 top-0 h-px overflow-hidden" />
          <div className="px-4 py-3 md:px-6 md:py-4 flex items-center gap-3 md:gap-4 flex-wrap">
            {/* Model selector */}
            <div className="flex items-center gap-3 flex-1 min-w-0 w-full md:w-auto">
              <div className="flex-1 md:max-w-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 block mb-1.5">
                  Model
                </span>
                {loadingModels ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground h-10">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span>Loading models...</span>
                  </div>
                ) : models.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/70 h-10">
                    <AlertCircle className="h-4 w-4" />
                    <span>No quantized models found. Quantize a model first.</span>
                  </div>
                ) : (
                  <NexusSelect
                    value={selectedModel}
                    onChange={setSelectedModel}
                    placeholder="Select a model"
                    icon={<Cpu className="h-4 w-4" />}
                    searchable={models.length > 5}
                    maxHeight={320}
                    filterGroups={(() => {
                      const methods = Array.from(new Set(models.map(m => m.method)));
                      if (methods.length <= 1) return undefined;
                      return [{
                        label: 'Type',
                        options: methods.map(m => ({
                          value: m,
                          label: m,
                        })),
                      }];
                    })()}
                    options={models.map((m): NexusSelectOption => ({
                      value: m.file,
                      label: m.name,
                      description: `${m.sizeMB} MB`,
                      tags: [m.method, ...(m.isVLM ? ['VLM'] : [])],
                      badge: (
                        <Badge
                          variant={m.method === 'GGUF' ? 'default' : m.method === 'MLX' ? 'secondary' : m.method === 'Finetune' ? 'outline' : m.method === 'FP16' ? 'secondary' : 'success'}
                          className="shrink-0 text-[10px]"
                        >
                          {m.method}{m.isVLM ? ' VLM' : ''}
                        </Badge>
                      ),
                    }))}
                  />
                )}
              </div>
            </div>

            {/* Active model badges */}
            {modelInfo && (
              <div className="hidden md:flex items-center gap-2 animate-fade-in">
                <Badge variant={modelInfo.method === 'GGUF' ? 'default' : modelInfo.method === 'MLX' || modelInfo.method === 'FP16' ? 'secondary' : modelInfo.method === 'Finetune' ? 'outline' : 'success'}>
                  {modelInfo.method}
                </Badge>
                {modelInfo.isVLM && (
                  <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[10px]">VLM</Badge>
                )}
                <Badge variant="outline">
                  <HardDrive className="h-3 w-3 mr-1" />
                  {modelInfo.sizeMB} MB
                </Badge>
              </div>
            )}

            {/* Clear chat */}
            <Button
              variant="ghost"
              size="icon"
              onClick={clearChat}
              disabled={messages.length === 0 && !streaming}
              className="shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-3xl 2xl:max-w-4xl mx-auto space-y-5">
            {/* Empty state */}
            {messages.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center animate-fade-in-up">
                <div className="relative mb-6">
                  <div className="h-20 w-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-float">
                    <MessageSquare className="h-10 w-10 text-primary/70" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-lg bg-accent border border-white/[0.06] flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-secondary" />
                  </div>
                </div>
                <h2 className="text-xl font-bold text-gradient mb-2">
                  Chat with your model
                </h2>
                <p className="text-[10px] text-muted-foreground/30 mb-3 font-medium tracking-wider uppercase">Powered by QpiAI Nexus</p>
                <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                  {models.length > 0
                    ? 'Select a quantized model above and start chatting. Responses are generated locally using your model.'
                    : 'No models available. Go to the Quantize page to create a model first.'}
                </p>
                {models.length > 0 && (
                  <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground/50">
                    <span className="h-px w-8 bg-border" />
                    Enter to send, Shift+Enter for newline
                    <span className="h-px w-8 bg-border" />
                  </div>
                )}
              </div>
            )}

            {/* Message list */}
            {messages.map((msg, idx) => (
              <div
                key={msg.id}
                className={`flex gap-3 animate-fade-in-up ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
                style={{ animationDelay: `${Math.min(idx * 0.03, 0.15)}s` }}
              >
                {/* Bot avatar */}
                {msg.role === 'assistant' && (
                  <div className="shrink-0 h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mt-1">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={`max-w-[85%] md:max-w-[75%] ${
                    msg.role === 'user'
                      ? 'bg-primary/10 border border-primary/20 rounded-2xl rounded-br-md px-4 py-3'
                      : 'bg-accent/50 border border-white/[0.04] rounded-2xl rounded-bl-md px-4 py-3'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <>
                      {msg.imagePreview && (
                        <div className="mb-2">
                          <img
                            src={msg.imagePreview}
                            alt="Attached"
                            className="max-h-40 rounded-lg border border-white/[0.04] object-cover"
                          />
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
                        {formatTime(msg.timestamp)}
                      </p>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const { thinking, response } = parseThinkBlocks(msg.content);
                        const isLastMsg = messages[messages.length - 1]?.id === msg.id;
                        const isThinkingExpanded = expandedThinking.has(msg.id);
                        return (
                          <>
                            {/* Thinking block */}
                            {thinking && (
                              <div className="mb-2">
                                <button
                                  onClick={() => {
                                    setExpandedThinking(prev => {
                                      const next = new Set(prev);
                                      if (next.has(msg.id)) next.delete(msg.id);
                                      else next.add(msg.id);
                                      return next;
                                    });
                                  }}
                                  className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors mb-1"
                                >
                                  <Brain className="h-3 w-3" />
                                  <span>Thinking</span>
                                  <ChevronRight className={`h-3 w-3 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
                                  {streaming && isLastMsg && !response && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                  )}
                                </button>
                                {isThinkingExpanded && (
                                  <div className="text-xs text-muted-foreground/50 leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-white/[0.04] max-h-[200px] overflow-y-auto">
                                    {thinking}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Response text */}
                            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                              {response}
                              {streaming && isLastMsg && (
                                <span className="inline-flex items-center ml-1 align-middle">
                                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                </span>
                              )}
                            </p>
                          </>
                        );
                      })()}

                      {/* Metrics as badges */}
                      {msg.metrics && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap animate-fade-in">
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Hash className="h-3 w-3" />
                            {msg.metrics.tokens_generated} tokens
                          </Badge>
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Clock className="h-3 w-3" />
                            {(msg.metrics.time_ms / 1000).toFixed(1)}s
                          </Badge>
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Zap className="h-3 w-3" />
                            {msg.metrics.tokens_per_sec} tok/s
                          </Badge>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* User avatar */}
                {msg.role === 'user' && (
                  <div className="shrink-0 h-8 w-8 rounded-xl bg-accent border border-white/[0.06] flex items-center justify-center mt-1">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {/* Status / loading message */}
            {statusMessage && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground animate-fade-in pl-11">
                <div className="flex items-center gap-2 glass rounded-xl px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>{statusMessage}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 md:mx-6 mb-2 max-w-3xl md:mx-auto animate-scale-in">
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Input area with glass card and border-glow */}
        <div className="border-t border-white/[0.03] bg-background/80 backdrop-blur-xl px-4 py-3 md:px-6 md:py-4 lg:px-8">
          <div className="max-w-3xl 2xl:max-w-4xl mx-auto">
            <div className="glass border-glow rounded-2xl p-3 transition-all duration-300 focus-within:glow-sm">
              {/* Image preview */}
              {imagePreview && (
                <div className="mb-2 relative inline-block">
                  <img src={imagePreview} alt="Upload" className="h-20 rounded-lg border border-white/[0.06] object-cover" />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null); }}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center text-xs hover:bg-destructive/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex gap-3 items-end">
                {/* Image upload button */}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setImageFile(file);
                      const reader = new FileReader();
                      reader.onload = () => setImagePreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={streaming || models.length === 0 || (modelInfo && !modelInfo.isVLM)}
                  className={`shrink-0 rounded-xl h-10 w-10 transition-colors ${
                    modelInfo?.isVLM
                      ? 'text-primary hover:text-primary/80 hover:bg-primary/10'
                      : 'text-muted-foreground/30 cursor-not-allowed'
                  }`}
                  title={modelInfo?.isVLM ? 'Attach image for VLM' : 'Select a VLM model to attach images'}
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <div className="flex-1 relative">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      models.length === 0
                        ? 'No models available...'
                        : streaming
                        ? 'Waiting for response...'
                        : 'Type a message...'
                    }
                    disabled={models.length === 0 || streaming}
                    className="min-h-[44px] max-h-[200px] resize-none bg-transparent border-none focus:ring-0 focus:outline-none p-1 text-sm"
                    rows={1}
                  />
                </div>
                {streaming ? (
                  <Button
                    variant="destructive"
                    size="md"
                    onClick={stopGeneration}
                    className="shrink-0 rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-sm bg-white animate-pulse" />
                      Stop
                    </div>
                  </Button>
                ) : (
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim() || models.length === 0}
                    size="icon"
                    className="shrink-0 rounded-xl h-10 w-10"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5 px-1">
                <span className="text-[10px] text-muted-foreground/40">
                  Enter to send, Shift+Enter for newline
                </span>
                {modelInfo && (
                  <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {modelInfo.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
