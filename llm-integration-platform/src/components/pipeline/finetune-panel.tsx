'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NexusSelect } from '@/components/ui/nexus-select';
import {
  Sparkles, Play, Loader2, CheckCircle2, AlertCircle,
  ArrowRight, RotateCcw, Upload, Database, Cpu, Settings2,
  Layers, Brain, ChevronDown, ChevronUp, Rocket, Zap, Square, Wand2,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SUPPORTED_MODELS, FINETUNE_TYPES, POPULAR_DATASETS, FINETUNE_DEFAULTS, TRAINING_MODES, GRPO_REWARD_TYPES, VLM_DATASETS, VLM_FINETUNE_DEFAULTS } from '@/lib/constants';
import type { HFDatasetMeta } from '@/lib/types';
import { useNotifications } from '@/components/notifications';
import { SyntheticDataEditor } from '@/components/pipeline/synthetic-data-editor';

interface LogEntry {
  type: string;
  message: string;
  progress?: number;
}

interface LossPoint {
  step: number;
  loss: number;
}

interface FinetunePanelProps {
  onSwitchTab?: (tab: string) => void;
}

export function FinetunePanel({ onSwitchTab }: FinetunePanelProps) {
  const router = useRouter();
  const { addNotification } = useNotifications();

  // Model & dataset
  const [selectedModel, setSelectedModel] = useState('');
  const [finetuneType, setFinetuneType] = useState<string>(FINETUNE_DEFAULTS.finetuningType);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [uploadedDatasets, setUploadedDatasets] = useState<{ id: string; name: string; format: string; samples: number }[]>([]);

  // Training mode (SFT / GRPO)
  const [trainingMode, setTrainingMode] = useState<string>(FINETUNE_DEFAULTS.trainingMode);
  const [rewardType, setRewardType] = useState<string>(FINETUNE_DEFAULTS.rewardType);
  const [numGenerations, setNumGenerations] = useState(FINETUNE_DEFAULTS.numGenerations);
  const [grpoBeta, setGrpoBeta] = useState(FINETUNE_DEFAULTS.grpoBeta);

  // Advanced config
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [epochs, setEpochs] = useState(FINETUNE_DEFAULTS.epochs);
  const [batchSize, setBatchSize] = useState(FINETUNE_DEFAULTS.batchSize);
  const [learningRate, setLearningRate] = useState(FINETUNE_DEFAULTS.learningRate);
  const [loraRank, setLoraRank] = useState(FINETUNE_DEFAULTS.loraRank);
  const [loraAlpha, setLoraAlpha] = useState(FINETUNE_DEFAULTS.loraAlpha);
  const [maxSeqLength, setMaxSeqLength] = useState(FINETUNE_DEFAULTS.maxSeqLength);
  const [mergeAdapters, setMergeAdapters] = useState(FINETUNE_DEFAULTS.mergeAdapters);

  // Progress state
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [lossData, setLossData] = useState<LossPoint[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<Record<string, unknown> | null>(null);

  // VLM state
  const [isVLM, setIsVLM] = useState(false);
  const [maxSamples, setMaxSamples] = useState(0);
  const [hfDatasetId, setHfDatasetId] = useState('');
  const [hfMeta, setHfMeta] = useState<HFDatasetMeta | null>(null);
  const [hfLoading, setHfLoading] = useState(false);
  const [hfError, setHfError] = useState('');

  // File upload
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synthetic data editor
  const [showSyntheticEditor, setShowSyntheticEditor] = useState(false);

  useEffect(() => {
    const storedRec = sessionStorage.getItem('nexus-recommendation');
    if (storedRec) {
      const lower = storedRec.toLowerCase();
      const match = SUPPORTED_MODELS.find(m => lower.includes(m.name.toLowerCase()));
      if (match) {
        setSelectedModel(match.repoId);
      }
    }
  }, []);

  useEffect(() => {
    fetch('/api/finetune/datasets')
      .then(res => res.json())
      .then(data => {
        if (data.datasets?.length > 0) {
          setUploadedDatasets(data.datasets);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/finetune/status');
        if (!res.ok) return;
        const data = await res.json();

        if (data.running || data.done || data.logs?.length > 0) {
          setLogs(data.logs || []);
          setLossData(data.lossData || []);
          setProgress(data.progress || 0);
          setError(data.error || null);
          setDone(data.done || false);
          setRunning(data.running || false);
          setOutputDir(data.outputDir || null);
          setFinalResult(data.finalResult || null);
          if (data.model) setSelectedModel(data.model);
          if (data.finetuningType) setFinetuneType(data.finetuningType);
        }
      } catch {
        // ignore
      }
    }

    fetchStatus().then(() => {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/finetune/status');
          if (!res.ok) return;
          const data = await res.json();
          setLogs(data.logs || []);
          setLossData(data.lossData || []);
          setProgress(data.progress || 0);
          setError(data.error || null);
          setDone(data.done || false);
          setRunning(data.running || false);
          setOutputDir(data.outputDir || null);
          setFinalResult(data.finalResult || null);

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

  const handleUploadDataset = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/finetune/upload-dataset', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Upload failed');
        return;
      }

      const result = await res.json();
      const newDataset = {
        id: result.path,
        name: result.name,
        format: result.format,
        samples: result.samples,
      };
      setUploadedDatasets(prev => [...prev, newDataset]);
      setSelectedDataset(result.path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const handleModelChange = useCallback((repoId: string) => {
    setSelectedModel(repoId);
    setDone(false);
    setError(null);
    const model = SUPPORTED_MODELS.find(m => m.repoId === repoId);
    const vlm = model?.modelType === 'VLM';
    setIsVLM(vlm);
    if (vlm) {
      setBatchSize(VLM_FINETUNE_DEFAULTS.batchSize);
      setLearningRate(VLM_FINETUNE_DEFAULTS.learningRate);
      setMaxSeqLength(VLM_FINETUNE_DEFAULTS.maxSeqLength);
      setMaxSamples(VLM_FINETUNE_DEFAULTS.maxSamples);
      setLoraAlpha(VLM_FINETUNE_DEFAULTS.loraAlpha);
      setSelectedDataset('');
    } else {
      setBatchSize(FINETUNE_DEFAULTS.batchSize);
      setLearningRate(FINETUNE_DEFAULTS.learningRate);
      setMaxSeqLength(FINETUNE_DEFAULTS.maxSeqLength);
      setLoraAlpha(FINETUNE_DEFAULTS.loraAlpha);
      setMaxSamples(0);
      setSelectedDataset('');
    }
  }, []);

  const fetchHFMetadata = useCallback(async () => {
    if (!hfDatasetId || !hfDatasetId.includes('/')) return;
    setHfLoading(true);
    setHfError('');
    try {
      const res = await fetch(`/api/finetune/hf-dataset?id=${encodeURIComponent(hfDatasetId)}`);
      const data = await res.json();
      if (data.error) { setHfError(data.error); setHfMeta(null); }
      else { setHfMeta(data); }
    } catch { setHfError('Failed to fetch dataset info'); }
    finally { setHfLoading(false); }
  }, [hfDatasetId]);

  const startFinetuning = useCallback(() => {
    if (!selectedModel || !selectedDataset) return;

    setRunning(true);
    setDone(false);
    setError(null);
    setLogs([]);
    setProgress(0);
    setLossData([]);
    setOutputDir(null);
    setFinalResult(null);

    const modelName = SUPPORTED_MODELS.find(m => m.repoId === selectedModel)?.name || selectedModel;
    const modeLabel = trainingMode === 'grpo' ? 'GRPO' : 'SFT';
    addNotification('info', 'Finetuning Started', `${modeLabel} training ${modelName} with ${finetuneType.toUpperCase()}`);

    const effectiveDataset = (selectedDataset === 'huggingface' && hfDatasetId) ? 'huggingface' : selectedDataset;

    fetch('/api/finetune/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        dataset: effectiveDataset,
        config: {
          epochs,
          batchSize,
          learningRate,
          loraRank,
          loraAlpha,
          maxSeqLength,
          finetuningType: finetuneType,
          mergeAdapters,
          trainingMode,
          rewardType,
          numGenerations,
          grpoBeta,
          isVLM,
          maxSamples: isVLM ? maxSamples : 0,
          hfDatasetId: selectedDataset === 'huggingface' ? hfDatasetId : '',
        },
      }),
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
              } else if (eventType === 'loss') {
                setLogs(prev => [...prev, { type: 'loss', message: data.message, progress: data.progress }]);
                if (data.progress) setProgress(data.progress);
                if (data.loss !== undefined && data.step !== undefined) {
                  setLossData(prev => [...prev, { step: data.step, loss: data.loss }]);
                }
              } else if (eventType === 'complete') {
                setLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                setProgress(1.0);
                setDone(true);
                if (data.output_dir) setOutputDir(data.output_dir);
                setFinalResult(data);
                addNotification('success', 'Finetuning Complete', data.message || 'Model training finished successfully');
              } else if (eventType === 'error') {
                setLogs(prev => [...prev, { type: 'error', message: data.message }]);
                setError(data.message);
                addNotification('error', 'Finetuning Error', data.message);
              } else if (eventType === 'warning') {
                setLogs(prev => [...prev, { type: 'warning', message: data.message }]);
              } else if (eventType === 'log') {
                setLogs(prev => [...prev, { type: 'log', message: data.message }]);
              } else if (eventType === 'info') {
                setLogs(prev => [...prev, { type: 'info', message: data.message || `Starting finetuning: ${data.model}` }]);
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
      addNotification('error', 'Finetuning Failed', err.message);
    });
  }, [selectedModel, selectedDataset, epochs, batchSize, learningRate, loraRank, loraAlpha, maxSeqLength, finetuneType, mergeAdapters, trainingMode, rewardType, numGenerations, grpoBeta, isVLM, maxSamples, hfDatasetId, addNotification]);

  const stopFinetuning = useCallback(async () => {
    try {
      const res = await fetch('/api/finetune/stop', { method: 'POST' });
      if (res.ok) {
        setRunning(false);
        setError('Training stopped by user');
        setLogs(prev => [...prev, { type: 'error', message: 'Training stopped by user' }]);
        addNotification('warning', 'Training Stopped', 'Finetuning job was stopped by user');
      }
    } catch {
      // ignore
    }
  }, [addNotification]);

  const goToQuantize = () => {
    if (onSwitchTab) {
      onSwitchTab('quantize');
    } else {
      router.push('/quantize');
    }
  };

  const selectedModelInfo = SUPPORTED_MODELS.find(m => m.repoId === selectedModel);
  const ftTypeInfo = FINETUNE_TYPES.find(t => t.id === finetuneType);
  const modeInfo = TRAINING_MODES.find(m => m.id === trainingMode);

  const datasetSource = isVLM ? VLM_DATASETS : POPULAR_DATASETS;
  const allDatasetOptions = [
    ...datasetSource.filter(d => d.id !== 'custom').map(d => ({
      value: d.id,
      label: d.name,
      description: d.samples > 0 ? `${d.description} (${d.samples.toLocaleString()} samples)` : d.description,
    })),
    ...uploadedDatasets.map(d => ({
      value: d.id,
      label: `${d.name} (uploaded)`,
      description: `${d.format} format, ${d.samples.toLocaleString()} samples`,
    })),
  ];

  const modelOptions = SUPPORTED_MODELS
    .filter(m => m.modelType === 'LLM' || m.modelType === 'VLM')
    .map(m => ({
      value: m.repoId,
      label: m.name,
      description: m.description || `${m.paramB}B params`,
      tags: [m.family, m.modelType],
    }));

  const canStart = selectedModel && selectedDataset && !running &&
    (selectedDataset !== 'huggingface' || (hfDatasetId && hfDatasetId.includes('/')));

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <Card className="animate-fade-in-up stagger-1 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center shadow-sm shadow-violet-500/10 mb-3">
                <Brain className="h-5 w-5 text-violet-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Model</p>
              <p className="text-sm font-bold tracking-tight mt-1 truncate max-w-full">
                {selectedModelInfo?.name || 'Not Selected'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center shadow-sm shadow-emerald-500/10 mb-3">
                <Sparkles className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Method</p>
              <p className="text-sm font-bold tracking-tight mt-1">{modeInfo?.name || 'SFT'} + {ftTypeInfo?.name || 'QLoRA'}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 mb-3">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dataset</p>
              <p className="text-sm font-bold tracking-tight mt-1 truncate max-w-full">
                {selectedDataset ? (POPULAR_DATASETS.find(d => d.id === selectedDataset)?.name || 'Custom') : 'Not Selected'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-500 via-amber-500/60 to-transparent" />
          <CardContent className="p-6 md:p-7">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center shadow-sm shadow-amber-500/10 mb-3">
                <Zap className="h-5 w-5 text-amber-400" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
              <p className="text-sm font-bold tracking-tight mt-1">
                {done ? <span className="text-emerald-400">Complete</span> :
                 running ? <span className="text-primary">{Math.round(progress * 100)}%</span> :
                 error ? <span className="text-red-400">Error</span> :
                 'Ready'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration + Progress Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-5">
        {/* Left: Configuration */}
        <div className="lg:col-span-2 space-y-4 md:space-y-5">
          {/* Model Selection */}
          <Card className="animate-fade-in-up relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
            <CardHeader className="border-b border-white/[0.06]">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Cpu className="h-3.5 w-3.5 text-violet-400" />
                </div>
                Model
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-7 pt-6 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Base Model</label>
                <NexusSelect
                  value={selectedModel}
                  onChange={handleModelChange}
                  icon={<Brain className="h-4 w-4" />}
                  placeholder="Select a model"
                  maxHeight={300}
                  searchable
                  options={modelOptions}
                  disabled={running}
                />
                {selectedModelInfo && (
                  <div className="flex gap-2 mt-3">
                    <Badge variant="default">{selectedModelInfo.paramB}B params</Badge>
                    <Badge variant="outline">{selectedModelInfo.methods.join(', ')}</Badge>
                    {isVLM && <Badge variant="secondary" className="bg-violet-500/15 text-violet-400 border-violet-500/30">VLM</Badge>}
                  </div>
                )}
                {isVLM && (
                  <p className="text-xs text-violet-400 mt-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    Vision-Language Model — image+text fine-tuning with QLoRA
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Training Mode (SFT / GRPO) — hidden for VLM (VLM always uses SFT) */}
          {!isVLM && <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-500 via-cyan-500/60 to-transparent" />
            <CardHeader className="border-b border-white/[0.06]">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                Training Mode
                <Badge variant="outline" className="ml-auto text-[9px] px-1.5 py-0">Unsloth</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-7 pt-6 space-y-3">
              {TRAINING_MODES.map(mode => {
                const isSelected = trainingMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setTrainingMode(mode.id)}
                    disabled={running}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left ${
                      isSelected
                        ? 'border-cyan-500/30 bg-cyan-500/5 shadow-sm'
                        : 'border-white/[0.06] hover:bg-accent/50 hover:border-white/[0.1]'
                    } disabled:opacity-50`}
                  >
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 shadow-sm' : 'bg-accent/60'}`}>
                      <Zap className={`h-4 w-4 ${isSelected ? 'text-cyan-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>{mode.name}</p>
                        {mode.badge && <Badge variant={mode.badge === 'Recommended' ? 'success' : 'outline'} className="text-[9px] px-1.5 py-0">{mode.badge}</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{mode.description}</p>
                    </div>
                  </button>
                );
              })}

              {/* GRPO Options -- shown when GRPO is selected */}
              {trainingMode === 'grpo' && (
                <div className="mt-4 space-y-3 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
                  <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">GRPO Settings</p>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Reward Type</label>
                    <NexusSelect
                      value={rewardType}
                      onChange={v => setRewardType(v)}
                      options={GRPO_REWARD_TYPES.map(r => ({
                        value: r.id,
                        label: r.name,
                        description: r.description,
                      }))}
                      disabled={running}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Generations</label>
                      <NexusSelect
                        value={String(numGenerations)}
                        onChange={v => setNumGenerations(Number(v))}
                        options={[2, 4, 6, 8].map(n => ({ value: String(n), label: String(n) }))}
                        disabled={running}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Beta</label>
                      <NexusSelect
                        value={String(grpoBeta)}
                        onChange={v => setGrpoBeta(Number(v))}
                        options={[
                          { value: '0.01', label: '0.01' },
                          { value: '0.05', label: '0.05' },
                          { value: '0.1', label: '0.1 (Default)' },
                          { value: '0.2', label: '0.2' },
                        ]}
                        disabled={running}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>}

          {/* Finetune Type */}
          <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
            <CardHeader className="border-b border-white/[0.06]">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                Finetuning Method
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-7 pt-6 space-y-3">
              {FINETUNE_TYPES.map(ft => {
                const isSelected = finetuneType === ft.id;
                return (
                  <button
                    key={ft.id}
                    onClick={() => { setFinetuneType(ft.id as typeof finetuneType); }}
                    disabled={running}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left ${
                      isSelected
                        ? 'border-primary/30 bg-primary/5 shadow-sm'
                        : 'border-white/[0.06] hover:bg-accent/50 hover:border-white/[0.1]'
                    } disabled:opacity-50`}
                  >
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 shadow-sm' : 'bg-accent/60'}`}>
                      <Sparkles className={`h-4 w-4 ${isSelected ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>{ft.name}</p>
                        {ft.badge && <Badge variant={ft.badge === 'Recommended' ? 'success' : 'outline'} className="text-[9px] px-1.5 py-0">{ft.badge}</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{ft.description}</p>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Dataset Selection */}
          <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
            <CardHeader className="border-b border-white/[0.06]">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Database className="h-3.5 w-3.5 text-primary" />
                </div>
                Dataset
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-7 pt-6 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Training Dataset</label>
                <NexusSelect
                  value={selectedDataset}
                  onChange={v => setSelectedDataset(v)}
                  icon={<Database className="h-4 w-4" />}
                  placeholder="Select a dataset"
                  maxHeight={280}
                  options={allDatasetOptions}
                  disabled={running}
                />
              </div>
              {/* HuggingFace Dataset ID input — shown when 'huggingface' selected */}
              {selectedDataset === 'huggingface' && (
                <div className="space-y-2.5">
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">HuggingFace Dataset ID</label>
                  <Input
                    placeholder="e.g. HuggingFaceH4/ultrachat_200k"
                    value={hfDatasetId}
                    onChange={(e) => setHfDatasetId(e.target.value)}
                    onBlur={() => fetchHFMetadata()}
                    disabled={running}
                    className="h-10"
                  />
                  {hfLoading && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Fetching dataset info...</p>}
                  {hfError && <p className="text-xs text-red-400">{hfError}</p>}
                  {hfMeta && (
                    <div className="text-xs text-muted-foreground p-3 rounded-xl bg-accent/30 border border-white/[0.06] space-y-1">
                      <p className="font-semibold text-foreground">{hfMeta.id}</p>
                      {hfMeta.description && <p className="line-clamp-2">{hfMeta.description.slice(0, 150)}</p>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{hfMeta.downloads.toLocaleString()} downloads</span>
                        {hfMeta.hasImages && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-violet-400 border-violet-500/30">Has Images</Badge>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Max Samples — shown for VLM models */}
              {isVLM && selectedDataset && selectedDataset !== 'custom' && (
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">
                    Max Samples
                    <span className="text-muted-foreground/50 normal-case tracking-normal ml-1 font-normal">0 = use all</span>
                  </label>
                  <Input
                    type="number"
                    value={maxSamples}
                    onChange={(e) => setMaxSamples(Number(e.target.value))}
                    min={0}
                    disabled={running}
                    className="h-10"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">
                  Or Upload Custom Dataset
                  <span className="text-muted-foreground/50 normal-case tracking-normal ml-1 font-normal">.json / .jsonl</span>
                </label>
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.jsonl"
                    onChange={handleUploadDataset}
                    className="hidden"
                    disabled={running}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={running || uploading}
                    className="flex-1"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    {uploading ? 'Uploading...' : 'Upload'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSyntheticEditor(true)}
                    disabled={running}
                    className="flex-1 text-violet-400 border-violet-500/20 hover:border-violet-500/40 hover:bg-violet-500/5"
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate with AI
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Synthetic Data Editor */}
          {showSyntheticEditor && (
            <Card className="animate-fade-in-up relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
              <CardContent className="p-5">
                <SyntheticDataEditor
                  onSave={(datasetPath, name, format, samples) => {
                    setUploadedDatasets(prev => [...prev, {
                      id: datasetPath,
                      name,
                      format,
                      samples,
                    }]);
                    setSelectedDataset(datasetPath);
                    setShowSyntheticEditor(false);
                  }}
                  onClose={() => setShowSyntheticEditor(false)}
                />
              </CardContent>
            </Card>
          )}

          {/* Advanced Config */}
          <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
            <CardHeader className="border-b border-white/[0.06]">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between"
              >
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center">
                    <Settings2 className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  Advanced Configuration
                </CardTitle>
                {showAdvanced ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
            </CardHeader>
            {showAdvanced && (
              <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Epochs</label>
                    <Input
                      type="number"
                      value={epochs}
                      onChange={e => setEpochs(Number(e.target.value))}
                      min={1}
                      max={100}
                      disabled={running}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Batch Size</label>
                    <NexusSelect
                      value={String(batchSize)}
                      onChange={v => setBatchSize(Number(v))}
                      options={[1, 2, 4, 8, 16].map(n => ({ value: String(n), label: String(n) }))}
                      disabled={running}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Learning Rate</label>
                  <NexusSelect
                    value={String(learningRate)}
                    onChange={v => setLearningRate(Number(v))}
                    options={[
                      { value: '1e-5', label: '1e-5 (Conservative)' },
                      { value: '5e-5', label: '5e-5' },
                      { value: '0.0001', label: '1e-4' },
                      { value: '0.0002', label: '2e-4 (Default)' },
                      { value: '0.0005', label: '5e-4' },
                      { value: '0.001', label: '1e-3 (Aggressive)' },
                    ]}
                    disabled={running}
                  />
                </div>
                {finetuneType !== 'full' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">LoRA Rank</label>
                      <NexusSelect
                        value={String(loraRank)}
                        onChange={v => setLoraRank(Number(v))}
                        options={[4, 8, 16, 32, 64, 128].map(n => ({ value: String(n), label: String(n) }))}
                        disabled={running}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">LoRA Alpha</label>
                      <NexusSelect
                        value={String(loraAlpha)}
                        onChange={v => setLoraAlpha(Number(v))}
                        options={[8, 16, 32, 64, 128].map(n => ({ value: String(n), label: String(n) }))}
                        disabled={running}
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Max Sequence Length</label>
                  <NexusSelect
                    value={String(maxSeqLength)}
                    onChange={v => setMaxSeqLength(Number(v))}
                    options={[
                      { value: '512', label: '512' },
                      { value: '1024', label: '1024' },
                      { value: '2048', label: '2048 (Default)' },
                      { value: '4096', label: '4096' },
                    ]}
                    disabled={running}
                  />
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-accent/30">
                  <input
                    type="checkbox"
                    id="merge-adapters-panel"
                    checked={mergeAdapters}
                    onChange={e => setMergeAdapters(e.target.checked)}
                    disabled={running || finetuneType === 'full'}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <label htmlFor="merge-adapters-panel" className="text-sm text-muted-foreground cursor-pointer">
                    Merge adapters into base model after training
                  </label>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Start / Stop Button */}
          {running ? (
            <Button
              size="lg"
              onClick={stopFinetuning}
              className="w-full bg-red-600 hover:bg-red-700 border-0 text-white px-8 h-12"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop Training
            </Button>
          ) : !done && (
            <Button
              size="lg"
              onClick={startFinetuning}
              disabled={!canStart}
              className="w-full nexus-gradient border-0 text-white px-8 h-12"
            >
              <Play className="h-4 w-4 mr-2" />
              Start Finetuning
            </Button>
          )}
        </div>

        {/* Right: Progress & Output */}
        <div className="lg:col-span-3 space-y-4 md:space-y-5">
          {/* Progress Card */}
          {(running || done || error) ? (
            <Card className={`animate-fade-in-up overflow-hidden ${done ? 'border-emerald-500/20' : error && !done ? 'border-destructive/20' : 'border-primary/20'}`}>
              <div className={`h-px w-full ${done ? 'bg-emerald-500' : error && !done ? 'bg-destructive' : 'nexus-gradient'}`} />
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {running && <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /></div>}
                    {done && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                    {error && !done && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                    <span>Training Progress</span>
                  </div>
                  <span className={`text-lg font-bold ${done ? 'text-emerald-400' : 'text-primary'}`}>
                    {Math.round(progress * 100)}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 md:p-7 pt-6 space-y-4">
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
                          : log.type === 'warning'
                          ? 'text-amber-400'
                          : log.type === 'info'
                          ? 'text-primary'
                          : log.type === 'loss'
                          ? 'text-amber-400'
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
                      Training...
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="animate-fade-in-up relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
              <CardContent className="p-8 md:p-10 text-center">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 shadow-sm shadow-violet-500/10 flex items-center justify-center mx-auto mb-5">
                  <Sparkles className="h-7 w-7 text-violet-400" />
                </div>
                <h2 className="text-lg font-bold mb-2">Configure & Start</h2>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed max-w-sm mx-auto">
                  Select a model and dataset, configure training parameters, then start finetuning.
                  Training progress, loss metrics, and logs will appear here in real-time.
                </p>
                {!selectedModel && (
                  <p className="text-[10px] text-muted-foreground/60">Select a model to get started</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Loss Chart */}
          {lossData.length > 1 && (
            <Card className="animate-fade-in-up overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  Training Loss
                  {lossData.length > 0 && (
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      Latest: {lossData[lossData.length - 1].loss.toFixed(4)}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 md:p-7 pt-6">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lossData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                      <XAxis
                        dataKey="step"
                        stroke="var(--muted-foreground)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          fontSize: '12px',
                          boxShadow: '0 4px 12px var(--shadow-color)',
                        }}
                        labelFormatter={(label) => `Step ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="loss"
                        stroke="var(--success)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: 'var(--success)' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completion Card */}
          {done && (
            <Card className="border-emerald-500/20 animate-celebrate overflow-hidden">
              <div className="h-px w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500" />
              <CardContent className="p-6 md:p-7">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 shadow-sm shadow-emerald-500/10 flex items-center justify-center shrink-0 animate-success-ring">
                      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-emerald-400">Finetuning Complete</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {finalResult?.total_time ? `${finalResult.total_time}s` : ''}{finalResult?.final_loss ? ` — Final loss: ${(finalResult.final_loss as number).toFixed(4)}` : ''}{finalResult?.size_mb ? ` — ${finalResult.size_mb} MB` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Merge warning — LoRA adapters can't be quantized directly */}
                  {!mergeAdapters && finetuneType !== 'full' && !finalResult?.merged && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-amber-500">LoRA adapters only — not quantizable</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          LoRA adapters are weight deltas, not a complete model. To quantize, re-run finetuning with &quot;Merge adapters&quot; enabled, or deploy the adapters directly.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    {(mergeAdapters || finetuneType === 'full' || finalResult?.merged) ? (
                      <Button
                        size="lg"
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-md shadow-emerald-500/20"
                        onClick={() => {
                          const mergedDir = finalResult?.merged_dir || outputDir;
                          if (mergedDir) {
                            sessionStorage.setItem('nexus-finetuned', JSON.stringify({
                              path: mergedDir,
                              model: selectedModel,
                              method: finetuneType,
                            }));
                          }
                          goToQuantize();
                        }}
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Quantize This Model
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setMergeAdapters(true);
                          setDone(false);
                          setError(null);
                          setLogs([]);
                          setProgress(0);
                          setLossData([]);
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Re-run with Merge
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={() => router.push('/deploy')}
                    >
                      <Rocket className="h-4 w-4 mr-2" />
                      Deploy Directly
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error Retry */}
          {error && !done && !running && (
            <Card className="border-destructive/20 animate-scale-in overflow-hidden">
              <div className="h-px w-full bg-destructive" />
              <CardContent className="p-6 md:p-7 text-center">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 shadow-sm shadow-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="h-6 w-6 text-destructive" />
                </div>
                <p className="text-sm text-destructive font-medium mb-1">Finetuning Failed</p>
                <p className="text-xs text-muted-foreground mb-5">{error}</p>
                <Button onClick={startFinetuning} disabled={!canStart}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry Finetuning
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
