'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NexusSelect } from '@/components/ui/nexus-select';
import {
  Sparkles, Loader2, CheckCircle2, AlertCircle,
  Trash2, Download, Save, ArrowLeft, ArrowRight,
  X, Pencil, Check, RotateCcw, Wand2, FileJson,
} from 'lucide-react';
import {
  SYNTHETIC_DATA_PRESETS, SYNTHETIC_SAMPLE_COUNTS, SYNTHETIC_FORMATS,
} from '@/lib/constants';
import type { AlpacaSample, ShareGPTSample, SyntheticSample, SyntheticFormat } from '@/lib/types';
import { useNotifications } from '@/components/notifications';

type WizardStep = 'configure' | 'generating' | 'review';

interface SyntheticDataEditorProps {
  onSave: (datasetPath: string, name: string, format: string, samples: number) => void;
  onClose: () => void;
}

// Type guard
function isAlpacaSample(s: SyntheticSample): s is AlpacaSample {
  return 'instruction' in s;
}

export function SyntheticDataEditor({ onSave, onClose }: SyntheticDataEditorProps) {
  const { addNotification } = useNotifications();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('configure');

  // Config state
  const [preset, setPreset] = useState('general-assistant');
  const [topic, setTopic] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [format, setFormat] = useState<SyntheticFormat>('alpaca');
  const [count, setCount] = useState(25);
  const [datasetName, setDatasetName] = useState('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [genError, setGenError] = useState<string | null>(null);

  // Review state
  const [samples, setSamples] = useState<SyntheticSample[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Auto-fill topic from preset
  useEffect(() => {
    const p = SYNTHETIC_DATA_PRESETS.find(p => p.id === preset);
    if (p && p.id !== 'custom') {
      setTopic(p.name);
    }
  }, [preset]);

  // Focus edit textarea
  useEffect(() => {
    if (editingCell && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingCell]);

  const startGeneration = useCallback(async () => {
    const effectiveTopic = preset === 'custom'
      ? customPrompt || topic
      : `${SYNTHETIC_DATA_PRESETS.find(p => p.id === preset)?.systemPrompt || ''}\n\nSpecific topic: ${topic}`;

    if (!effectiveTopic.trim()) return;

    setStep('generating');
    setGenerating(true);
    setProgress(0);
    setProgressMsg('Starting generation...');
    setGenError(null);
    setSamples([]);

    try {
      const res = await fetch('/api/finetune/generate-synthetic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            topic: effectiveTopic,
            format,
            count,
            preset: preset !== 'custom' ? preset : undefined,
            customPrompt: preset === 'custom' ? customPrompt : undefined,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error (${res.status})`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collected: SyntheticSample[] = [];
      let errorOccurred = false;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'sample') {
                collected.push(data.sample);
                setSamples([...collected]);
              } else if (eventType === 'progress') {
                setProgress(data.progress || 0);
                setProgressMsg(data.message || '');
              } else if (eventType === 'complete') {
                setProgress(1);
                setProgressMsg(data.message || 'Generation complete');
              } else if (eventType === 'error') {
                errorOccurred = true;
                setGenError(data.message || 'Generation failed');
              }
            } catch {
              // skip unparseable SSE data lines
            }
          }
        }
      }

      if (collected.length > 0) {
        setSamples(collected);
        setStep('review');
        addNotification('success', 'Data Generated', `${collected.length} samples ready for review`);
      } else if (!errorOccurred) {
        setGenError('No samples were generated. Try adjusting your prompt.');
      }
    } catch (err) {
      setGenError((err as Error).message);
      addNotification('error', 'Generation Failed', (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [preset, topic, customPrompt, format, count, genError, addNotification]);

  const startEdit = (row: number, field: string) => {
    const sample = samples[row];
    let value = '';
    if (isAlpacaSample(sample)) {
      value = (sample as unknown as Record<string, string>)[field] || '';
    } else {
      const conv = (sample as ShareGPTSample).conversations;
      const turnIdx = parseInt(field.replace('turn-', ''));
      value = conv[turnIdx]?.value || '';
    }
    setEditingCell({ row, field });
    setEditValue(value);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { row, field } = editingCell;

    setSamples(prev => {
      const next = [...prev];
      const sample = { ...next[row] };
      if (isAlpacaSample(sample as SyntheticSample) && field !== 'turn-0') {
        (sample as Record<string, string>)[field] = editValue;
      } else {
        const s = sample as ShareGPTSample;
        const turnIdx = parseInt(field.replace('turn-', ''));
        const convs = [...s.conversations];
        convs[turnIdx] = { ...convs[turnIdx], value: editValue };
        (sample as ShareGPTSample).conversations = convs;
      }
      next[row] = sample as SyntheticSample;
      return next;
    });
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === samples.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(samples.map((_, i) => i)));
    }
  };

  const deleteSelected = () => {
    setSamples(prev => prev.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };

  const deleteSample = (idx: number) => {
    setSamples(prev => prev.filter((_, i) => i !== idx));
    setSelected(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  };

  const exportData = (type: 'json' | 'jsonl') => {
    let content: string;
    if (type === 'jsonl') {
      content = samples.map(s => JSON.stringify(s)).join('\n');
    } else {
      content = JSON.stringify(samples, null, 2);
    }
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${datasetName || 'synthetic_data'}.${type}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveDataset = async () => {
    if (samples.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/finetune/save-synthetic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples,
          format,
          name: datasetName || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }

      const result = await res.json();
      addNotification('success', 'Dataset Saved', `${result.name} — ${result.samples} samples`);
      onSave(result.path, result.name, result.format, result.samples);
    } catch (err) {
      addNotification('error', 'Save Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // -------- CONFIGURE STEP --------
  if (step === 'configure') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center">
              <Wand2 className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Generate Synthetic Data</h3>
              <p className="text-[10px] text-muted-foreground">Use AI to create training samples</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Preset Selection */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06] py-3">
            <CardTitle className="text-xs">Template</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {SYNTHETIC_DATA_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`text-left p-3 rounded-xl border transition-all duration-200 ${
                    preset === p.id
                      ? 'border-violet-500/30 bg-violet-500/5'
                      : 'border-white/[0.06] hover:border-white/[0.1] hover:bg-accent/50'
                  }`}
                >
                  <p className={`text-xs font-semibold ${preset === p.id ? 'text-violet-400' : 'text-foreground'}`}>{p.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{p.description}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Topic & Custom Prompt */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06] py-3">
            <CardTitle className="text-xs">Details</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                Topic / Description
              </label>
              <Input
                placeholder="e.g. Python data science, customer support, medical Q&A..."
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>
            {preset === 'custom' && (
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                  Custom System Prompt
                </label>
                <Textarea
                  placeholder="Describe exactly what kind of training data you want generated..."
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">Format</label>
                <NexusSelect
                  value={format}
                  onChange={v => setFormat(v as SyntheticFormat)}
                  options={SYNTHETIC_FORMATS.map(f => ({
                    value: f.id,
                    label: f.name,
                    description: f.description,
                  }))}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">Sample Count</label>
                <NexusSelect
                  value={String(count)}
                  onChange={v => setCount(Number(v))}
                  options={SYNTHETIC_SAMPLE_COUNTS.map(n => ({
                    value: String(n),
                    label: String(n),
                    description: n <= 25 ? 'Quick' : n <= 100 ? 'Standard' : 'Large batch',
                  }))}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                Dataset Name <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">optional</span>
              </label>
              <Input
                placeholder={`synthetic_${format}_${count}`}
                value={datasetName}
                onChange={e => setDatasetName(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Button
          size="lg"
          className="w-full nexus-gradient border-0 text-white h-11"
          onClick={startGeneration}
          disabled={!topic.trim() && preset !== 'custom'}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate {count} Samples
        </Button>
      </div>
    );
  }

  // -------- GENERATING STEP --------
  if (step === 'generating') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center">
            {generating ? (
              <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
            ) : genError ? (
              <AlertCircle className="h-4 w-4 text-red-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold">
              {generating ? 'Generating...' : genError ? 'Generation Failed' : 'Complete'}
            </h3>
            <p className="text-[10px] text-muted-foreground">{progressMsg}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.max(progress * 100, generating ? 5 : 0)}%`,
              background: genError
                ? 'var(--destructive)'
                : 'linear-gradient(90deg, var(--primary), #a78bfa)',
            }}
          />
        </div>

        {/* Live sample count */}
        <div className="text-center text-sm text-muted-foreground">
          {samples.length} / {count} samples generated
        </div>

        {/* Preview of latest samples */}
        {samples.length > 0 && (
          <div className="bg-accent/50 rounded-xl p-3 max-h-48 overflow-y-auto border border-white/[0.06] space-y-2">
            {samples.slice(-3).map((s, i) => (
              <div key={i} className="text-xs text-muted-foreground border-b border-white/[0.04] pb-2 last:border-0 last:pb-0">
                {isAlpacaSample(s) ? (
                  <p className="line-clamp-2"><span className="text-primary font-medium">Q:</span> {s.instruction}</p>
                ) : (
                  <p className="line-clamp-2"><span className="text-primary font-medium">Human:</span> {s.conversations[0]?.value}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {genError && (
          <Card className="border-destructive/20">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-destructive mb-3">{genError}</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => { setStep('configure'); setGenError(null); }}>
                  <ArrowLeft className="h-3 w-3 mr-1" /> Back
                </Button>
                <Button size="sm" onClick={() => { setGenError(null); startGeneration(); }}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!generating && !genError && samples.length > 0 && (
          <Button className="w-full" onClick={() => setStep('review')}>
            Review & Edit <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    );
  }

  // -------- REVIEW STEP --------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center">
            <FileJson className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Review & Edit</h3>
            <p className="text-[10px] text-muted-foreground">
              {samples.length} samples — {format === 'alpaca' ? 'Alpaca' : 'ShareGPT'} format
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep('configure')}>
            <ArrowLeft className="h-3 w-3 mr-1" /> Back
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleSelectAll}
          className="text-xs"
        >
          {selected.size === samples.length ? 'Deselect All' : 'Select All'}
        </Button>
        {selected.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={deleteSelected}
            className="text-xs text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete {selected.size}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => exportData('json')} className="text-xs">
          <Download className="h-3 w-3 mr-1" /> JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportData('jsonl')} className="text-xs">
          <Download className="h-3 w-3 mr-1" /> JSONL
        </Button>
      </div>

      {/* Table */}
      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card border-b border-white/[0.06]">
              <tr>
                <th className="w-8 p-2 text-center">
                  <input
                    type="checkbox"
                    checked={selected.size === samples.length && samples.length > 0}
                    onChange={toggleSelectAll}
                    className="h-3 w-3 rounded border-border accent-primary"
                  />
                </th>
                <th className="w-8 p-2 text-center text-muted-foreground font-medium">#</th>
                {format === 'alpaca' ? (
                  <>
                    <th className="p-2 text-left text-muted-foreground font-medium">Instruction</th>
                    <th className="p-2 text-left text-muted-foreground font-medium w-[15%]">Input</th>
                    <th className="p-2 text-left text-muted-foreground font-medium">Output</th>
                  </>
                ) : (
                  <th className="p-2 text-left text-muted-foreground font-medium">Conversation</th>
                )}
                <th className="w-16 p-2 text-center text-muted-foreground font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-white/[0.04] last:border-0 transition-colors ${
                    selected.has(idx) ? 'bg-primary/5' : 'hover:bg-accent/30'
                  }`}
                >
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(idx)}
                      onChange={() => toggleSelect(idx)}
                      className="h-3 w-3 rounded border-border accent-primary"
                    />
                  </td>
                  <td className="p-2 text-center text-muted-foreground/50">{idx + 1}</td>

                  {isAlpacaSample(sample) ? (
                    <>
                      {(['instruction', 'input', 'output'] as const).map(field => (
                        <td key={field} className="p-2">
                          {editingCell?.row === idx && editingCell.field === field ? (
                            <div className="flex flex-col gap-1">
                              <textarea
                                ref={editRef}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Escape') cancelEdit();
                                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
                                }}
                                className="w-full bg-accent/60 rounded-lg p-2 text-xs text-foreground border border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y min-h-[60px]"
                              />
                              <div className="flex gap-1">
                                <button onClick={commitEdit} className="text-emerald-400 hover:text-emerald-300 p-0.5">
                                  <Check className="h-3 w-3" />
                                </button>
                                <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-0.5">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={() => startEdit(idx, field)}
                              className="cursor-pointer group/cell relative"
                            >
                              <p className="line-clamp-3 text-muted-foreground group-hover/cell:text-foreground transition-colors">
                                {sample[field] || <span className="italic text-muted-foreground/40">empty</span>}
                              </p>
                              <Pencil className="h-2.5 w-2.5 absolute top-0 right-0 opacity-0 group-hover/cell:opacity-50 text-muted-foreground" />
                            </div>
                          )}
                        </td>
                      ))}
                    </>
                  ) : (
                    <td className="p-2">
                      <div className="space-y-1">
                        {(sample as ShareGPTSample).conversations.map((turn, tIdx) => {
                          const fieldKey = `turn-${tIdx}`;
                          const isEditing = editingCell?.row === idx && editingCell.field === fieldKey;
                          return (
                            <div key={tIdx} className="flex gap-1.5 items-start">
                              <Badge
                                variant="outline"
                                className={`text-[8px] px-1 py-0 shrink-0 mt-0.5 ${
                                  turn.from === 'human' ? 'text-primary border-primary/30' : 'text-emerald-400 border-emerald-500/30'
                                }`}
                              >
                                {turn.from}
                              </Badge>
                              {isEditing ? (
                                <div className="flex-1 flex flex-col gap-1">
                                  <textarea
                                    ref={editRef}
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') cancelEdit();
                                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
                                    }}
                                    className="w-full bg-accent/60 rounded-lg p-2 text-xs text-foreground border border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y min-h-[40px]"
                                  />
                                  <div className="flex gap-1">
                                    <button onClick={commitEdit} className="text-emerald-400 hover:text-emerald-300 p-0.5">
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-0.5">
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p
                                  onClick={() => startEdit(idx, fieldKey)}
                                  className="flex-1 line-clamp-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                                >
                                  {turn.value}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  )}

                  <td className="p-2 text-center">
                    <button
                      onClick={() => deleteSample(idx)}
                      className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{samples.length} samples</span>
        <span className="text-muted-foreground/30">|</span>
        <span>{format === 'alpaca' ? 'Alpaca' : 'ShareGPT'} format</span>
        {selected.size > 0 && (
          <>
            <span className="text-muted-foreground/30">|</span>
            <span className="text-primary">{selected.size} selected</span>
          </>
        )}
      </div>

      {/* Save button */}
      <Button
        size="lg"
        className="w-full nexus-gradient border-0 text-white h-11"
        onClick={saveDataset}
        disabled={saving || samples.length === 0}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {saving ? 'Saving...' : `Save Dataset (${samples.length} samples)`}
      </Button>
    </div>
  );
}
