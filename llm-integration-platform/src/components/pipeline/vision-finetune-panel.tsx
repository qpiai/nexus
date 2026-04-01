'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import { useNotifications } from '@/components/notifications';
import {
  Play, Loader2, CheckCircle2, AlertCircle, Upload, FolderOpen, Square,
  TrendingDown, Target, BarChart3, Settings2, Cpu, ArrowRight, Layers, Download,
} from 'lucide-react';
import {
  SUPPORTED_VISION_MODELS, VISION_TRAIN_DEFAULTS, VISION_OPTIMIZER_OPTIONS,
  VISION_BATCH_OPTIONS, VISION_IMGSIZE_OPTIONS, VISION_EPOCH_OPTIONS,
  SAMPLE_VISION_DATASETS,
} from '@/lib/constants';

interface LogEntry {
  type: string;
  message: string;
  progress?: number;
}

interface DatasetInfo {
  name: string;
  path: string;
  format: string;
  numImages: number;
  numClasses: number;
  classes: string[];
  splits: { train: number; val: number };
  yamlPath: string;
  preparedAt: string;
}

interface EpochMetrics {
  epoch: number;
  totalEpochs: number;
  boxLoss: number;
  clsLoss: number;
  dflLoss: number;
  mAP50: number;
  mAP5095: number;
  precision: number;
  recall: number;
  learningRate: number;
}

interface TrainRun {
  model: string;
  dataset: string;
  epochs: number;
  bestModelPath: string;
  runDir: string;
  bestMap50: number;
  bestMap5095: number;
  totalTime: number;
  classes: string[];
  completedAt: string;
  dirName: string;
}

interface VisionFinetunePanelProps {
  onSwitchTab?: (tab: string) => void;
}

export function VisionFinetunePanel({ onSwitchTab }: VisionFinetunePanelProps) {
  const { addNotification } = useNotifications();

  // Dataset state
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [datasetUploading, setDatasetUploading] = useState(false);
  const [datasetPreparing, setDatasetPreparing] = useState(false);
  const [datasetPrepareLogs, setDatasetPrepareLogs] = useState<LogEntry[]>([]);
  const [datasetPrepareError, setDatasetPrepareError] = useState<string | null>(null);
  const [datasetDragOver, setDatasetDragOver] = useState(false);
  const datasetFileRef = useRef<HTMLInputElement>(null);

  // Sample dataset state
  const [downloadingSample, setDownloadingSample] = useState<string | null>(null);
  const [sampleLogs, setSampleLogs] = useState<LogEntry[]>([]);

  // Training config state
  const [trainModel, setTrainModel] = useState('');
  const [trainEpochs, setTrainEpochs] = useState(VISION_TRAIN_DEFAULTS.epochs);
  const [trainBatch, setTrainBatch] = useState(VISION_TRAIN_DEFAULTS.batchSize);
  const [trainImgSize, setTrainImgSize] = useState(VISION_TRAIN_DEFAULTS.imgSize);
  const [trainLR, setTrainLR] = useState(VISION_TRAIN_DEFAULTS.learningRate);
  const [trainOptimizer, setTrainOptimizer] = useState<string>(VISION_TRAIN_DEFAULTS.optimizer);
  const [trainFreeze, setTrainFreeze] = useState(VISION_TRAIN_DEFAULTS.freeze);
  const [trainAugment, setTrainAugment] = useState(VISION_TRAIN_DEFAULTS.augment);
  const [trainPatience, setTrainPatience] = useState(VISION_TRAIN_DEFAULTS.patience);

  // Training progress state
  const [training, setTraining] = useState(false);
  const [trainingDone, setTrainingDone] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingLogs, setTrainingLogs] = useState<LogEntry[]>([]);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [epochMetrics, setEpochMetrics] = useState<EpochMetrics[]>([]);
  const [trainResult, setTrainResult] = useState<Record<string, unknown> | null>(null);
  const [trainRuns, setTrainRuns] = useState<TrainRun[]>([]);
  const [stopping, setStopping] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Agent recommendation
  const [agentRec, setAgentRec] = useState<string | null>(null);

  // Load recommendation from sessionStorage
  useEffect(() => {
    const rec = sessionStorage.getItem('nexus-vision-recommendation');
    if (rec) {
      setAgentRec(rec);
      // Try to pre-select model
      const parts = rec.split('|').map(s => s.trim());
      if (parts.length >= 1) {
        const modelName = parts[0];
        const match = SUPPORTED_VISION_MODELS.find(m => m.name === modelName);
        if (match && !trainModel) setTrainModel(match.modelId);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load datasets
  useEffect(() => {
    fetch('/api/vision/dataset/list')
      .then(r => r.json())
      .then(data => setDatasets(data.datasets || []))
      .catch(() => {});
  }, [datasetPreparing, downloadingSample]);

  // Load train runs
  useEffect(() => {
    fetch('/api/vision/train/runs')
      .then(r => r.json())
      .then(data => setTrainRuns(data.runs || []))
      .catch(() => {});
  }, [trainingDone]);

  // Restore training state on mount
  useEffect(() => {
    fetch('/api/vision/train')
      .then(r => r.json())
      .then(data => {
        if (data.running || data.done) {
          setTraining(data.running);
          setTrainingDone(data.done);
          setTrainingProgress(data.progress || 0);
          setTrainingLogs(data.logs || []);
          setEpochMetrics(data.epochMetrics || []);
          setTrainingError(data.error);
          setTrainResult(data.finalResult);
        }
        if (data.running) {
          pollIntervalRef.current = setInterval(() => {
            fetch('/api/vision/train')
              .then(r => r.json())
              .then(d => {
                setTraining(d.running);
                setTrainingDone(d.done);
                setTrainingProgress(d.progress || 0);
                setTrainingLogs(d.logs || []);
                setEpochMetrics(d.epochMetrics || []);
                setTrainingError(d.error);
                setTrainResult(d.finalResult);
                if (!d.running && pollIntervalRef.current) {
                  clearInterval(pollIntervalRef.current);
                  pollIntervalRef.current = null;
                }
              })
              .catch(() => {});
          }, 2000);
        }
      })
      .catch(() => {});

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Dataset Handlers ----

  const handleDatasetUpload = useCallback(async (file: File) => {
    setDatasetUploading(true);
    setDatasetPrepareError(null);
    setDatasetPrepareLogs([]);

    const datasetName = file.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', datasetName);

      const uploadRes = await fetch('/api/vision/dataset/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        setDatasetPrepareError(err.error || 'Upload failed');
        setDatasetUploading(false);
        return;
      }
      await uploadRes.json();
      setDatasetUploading(false);

      setDatasetPreparing(true);
      const prepRes = await fetch('/api/vision/dataset/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: datasetName }),
      });

      if (!prepRes.ok) {
        try { const err = await prepRes.json(); setDatasetPrepareError(err.error || 'Preparation failed'); } catch { setDatasetPrepareError('Preparation failed'); }
        setDatasetPreparing(false);
        return;
      }

      const reader = prepRes.body?.getReader();
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
          if (line.startsWith('event: ')) { eventType = line.slice(7); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress' || eventType === 'info' || eventType === 'log') {
                setDatasetPrepareLogs(prev => [...prev, { type: eventType, message: data.message, progress: data.progress }]);
              } else if (eventType === 'complete') {
                setDatasetPrepareLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                addNotification('success', 'Dataset Ready', data.message);
                if (data.yamlPath) setSelectedDataset(data.yamlPath);
              } else if (eventType === 'error') {
                setDatasetPrepareLogs(prev => [...prev, { type: 'error', message: data.message }]);
                setDatasetPrepareError(data.message);
                addNotification('error', 'Dataset Error', data.message);
              }
            } catch { /* skip */ }
          }
        }
      }
      setDatasetPreparing(false);
    } catch (err) {
      setDatasetPrepareError((err as Error).message);
      setDatasetUploading(false);
      setDatasetPreparing(false);
    }
  }, [addNotification]);

  const handleDatasetFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.zip')) handleDatasetUpload(file);
    if (datasetFileRef.current) datasetFileRef.current.value = '';
  }, [handleDatasetUpload]);

  const handleDatasetDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDatasetDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.zip')) handleDatasetUpload(file);
  }, [handleDatasetUpload]);

  // ---- Sample Dataset Download ----
  const downloadSampleDataset = useCallback(async (sampleId: string) => {
    setDownloadingSample(sampleId);
    setSampleLogs([]);
    setDatasetPrepareError(null);

    try {
      const res = await fetch('/api/vision/dataset/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sampleId }),
      });

      if (!res.ok) {
        try { const err = await res.json(); setDatasetPrepareError(err.error || 'Download failed'); } catch { setDatasetPrepareError('Download failed'); }
        setDownloadingSample(null);
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
          if (line.startsWith('event: ')) { eventType = line.slice(7); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress' || eventType === 'info' || eventType === 'log') {
                setSampleLogs(prev => [...prev, { type: eventType, message: data.message, progress: data.progress }]);
              } else if (eventType === 'complete') {
                setSampleLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                addNotification('success', 'Sample Dataset Ready', data.message);
                if (data.yamlPath) setSelectedDataset(data.yamlPath);
              } else if (eventType === 'error') {
                setSampleLogs(prev => [...prev, { type: 'error', message: data.message }]);
                setDatasetPrepareError(data.message);
                addNotification('error', 'Dataset Error', data.message);
              }
            } catch { /* skip */ }
          }
        }
      }
      setDownloadingSample(null);
    } catch (err) {
      setDatasetPrepareError((err as Error).message);
      setDownloadingSample(null);
    }
  }, [addNotification]);

  // ---- Training Handlers ----

  const startTraining = useCallback(() => {
    if (!trainModel || !selectedDataset) return;

    setTraining(true);
    setTrainingDone(false);
    setTrainingError(null);
    setTrainingLogs([]);
    setTrainingProgress(0);
    setEpochMetrics([]);
    setTrainResult(null);

    addNotification('info', 'Vision Training Started', `Training ${trainModel} for ${trainEpochs} epochs`);

    fetch('/api/vision/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: trainModel,
        dataset: selectedDataset,
        epochs: trainEpochs,
        batchSize: trainBatch,
        imgSize: trainImgSize,
        learningRate: trainLR,
        optimizer: trainOptimizer,
        freeze: trainFreeze,
        augment: trainAugment,
        patience: trainPatience,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        try { const err = await res.json(); setTrainingError(err.error || `Server error (${res.status})`); } catch { setTrainingError(`Server error (${res.status})`); }
        setTraining(false);
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
          if (line.startsWith('event: ')) { eventType = line.slice(7); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'epoch') {
                setEpochMetrics(prev => {
                  const existing = prev.find(m => m.epoch === data.epoch);
                  if (existing) return prev.map(m => m.epoch === data.epoch ? { ...m, ...data } : m);
                  return [...prev, data];
                });
                setTrainingProgress(data.progress || 0);
                setTrainingLogs(prev => [...prev.slice(-199), { type: 'epoch', message: `Epoch ${data.epoch}/${data.totalEpochs} — box: ${data.boxLoss?.toFixed(4)}, cls: ${data.clsLoss?.toFixed(4)}`, progress: data.progress }]);
              } else if (eventType === 'val_metrics') {
                setEpochMetrics(prev => {
                  const existing = prev.find(m => m.epoch === data.epoch);
                  if (existing) return prev.map(m => m.epoch === data.epoch ? { ...m, ...data } : m);
                  return [...prev, data];
                });
                setTrainingLogs(prev => [...prev.slice(-199), { type: 'val', message: `Val Epoch ${data.epoch} — mAP50: ${data.mAP50?.toFixed(4)}, mAP50-95: ${data.mAP5095?.toFixed(4)}`, progress: data.progress }]);
              } else if (eventType === 'complete') {
                setTrainingLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                setTrainingProgress(1.0);
                setTrainingDone(true);
                setTrainResult(data);
                // Store finetuned model info for export tab
                if (data.bestModelPath) {
                  sessionStorage.setItem('nexus-vision-finetuned', JSON.stringify({
                    path: data.bestModelPath,
                    model: trainModel,
                    runDir: data.runDir || '',
                  }));
                }
                addNotification('success', 'Training Complete', data.message);
              } else if (eventType === 'error') {
                setTrainingLogs(prev => [...prev, { type: 'error', message: data.message }]);
                setTrainingError(data.message);
                addNotification('error', 'Training Error', data.message);
              } else if (eventType === 'done') {
                setTraining(false);
              } else if (eventType === 'progress' || eventType === 'info' || eventType === 'log') {
                setTrainingLogs(prev => [...prev.slice(-199), { type: eventType, message: data.message, progress: data.progress }]);
                if (data.progress) setTrainingProgress(data.progress);
              }
            } catch { /* skip */ }
          }
        }
      }
      setTraining(false);
    }).catch((err) => {
      setTrainingError(err.message);
      setTraining(false);
      addNotification('error', 'Training Failed', err.message);
    });
  }, [trainModel, selectedDataset, trainEpochs, trainBatch, trainImgSize, trainLR, trainOptimizer, trainFreeze, trainAugment, trainPatience, addNotification]);

  const stopTraining = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await fetch('/api/vision/train/stop', { method: 'POST' });
      setTraining(false);
      setTrainingError('Training stopped by user');
      setTrainingLogs(prev => [...prev, { type: 'error', message: 'Training stopped by user' }]);
      addNotification('warning', 'Training Stopped', 'Vision training was stopped by user');
    } catch (err) {
      setTrainingError((err as Error).message);
    } finally {
      setStopping(false);
    }
  }, [addNotification, stopping]);

  // ---- Derived ----

  const canTrain = trainModel && selectedDataset && !training;
  const latestMetrics = epochMetrics.length > 0 ? epochMetrics[epochMetrics.length - 1] : null;

  const datasetOptions = datasets.map(d => ({
    value: d.yamlPath,
    label: d.name,
    description: `${d.numImages} images, ${d.numClasses} classes`,
  }));

  const trainModelOptions = SUPPORTED_VISION_MODELS.map(m => ({
    value: m.modelId,
    label: m.name,
    description: `${m.task} — ${m.paramM}M params`,
  }));

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Agent Recommendation Badge */}
      {agentRec && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 animate-fade-in-up">
          <Target className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-400 font-semibold">Agent recommended:</span>
          <span className="text-xs text-muted-foreground">{agentRec}</span>
        </div>
      )}

      {/* Dataset & Config */}
      <div className="space-y-4 md:space-y-5">
        {/* Sample Datasets */}
        <Card className="animate-fade-in-up relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-pink-400 via-pink-400/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-pink-400/10 flex items-center justify-center">
                <Download className="h-3.5 w-3.5 text-pink-400" />
              </div>
              Sample Datasets
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_VISION_DATASETS.map(sample => (
                <button
                  key={sample.id}
                  onClick={() => downloadSampleDataset(sample.id)}
                  disabled={!!downloadingSample || training}
                  className="p-4 rounded-xl border border-white/[0.06] hover:border-pink-400/30 hover:bg-pink-400/5 transition-all text-left disabled:opacity-50 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">{sample.name}</span>
                    <Badge variant="outline" className="text-[9px]">{sample.task}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">{sample.description}</p>
                  <div className="flex gap-1.5">
                    <Badge variant="default" className="text-[9px] bg-pink-400/15 text-pink-400 border-pink-400/30">{sample.numImages} img</Badge>
                    <Badge variant="outline" className="text-[9px]">{sample.numClasses} cls</Badge>
                  </div>
                  {downloadingSample === sample.id && (
                    <div className="mt-2 flex items-center gap-2 text-pink-400 text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin" />Downloading...
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Sample download logs */}
            {sampleLogs.length > 0 && (
              <div className="mt-3 bg-accent/50 rounded-xl p-3 max-h-32 overflow-y-auto font-mono text-xs space-y-0.5 border border-white/[0.06]">
                {sampleLogs.map((log, i) => (
                  <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : 'text-muted-foreground/80'}>
                    {log.message}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Custom Dataset Upload */}
        <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center">
                <Upload className="h-3.5 w-3.5 text-amber-400" />
              </div>
              Custom Dataset
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6 space-y-4">
            <div
              onClick={() => datasetFileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDatasetDragOver(true); }}
              onDragLeave={() => setDatasetDragOver(false)}
              onDrop={handleDatasetDrop}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                datasetDragOver
                  ? 'border-amber-400 bg-amber-400/5'
                  : 'border-white/[0.06] hover:border-amber-400/50 hover:bg-accent/30'
              }`}
            >
              <input ref={datasetFileRef} type="file" accept=".zip" onChange={handleDatasetFileChange} className="hidden" />
              {(datasetUploading || datasetPreparing) ? (
                <Loader2 className="h-8 w-8 text-amber-400 animate-spin mx-auto mb-2" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              )}
              <p className="text-sm text-muted-foreground">
                {datasetUploading ? 'Uploading...' : datasetPreparing ? 'Preparing...' : 'Drop a dataset ZIP here'}
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-1">YOLO or COCO format (auto-detected)</p>
            </div>

            {datasetPrepareLogs.length > 0 && (
              <div className="bg-accent/50 rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-0.5 border border-white/[0.06]">
                {datasetPrepareLogs.map((log, i) => (
                  <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : 'text-muted-foreground/80'}>
                    {log.message}
                  </div>
                ))}
              </div>
            )}

            {datasetPrepareError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">{datasetPrepareError}</div>
            )}

            {/* Select existing dataset */}
            {datasets.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Select Dataset</label>
                <NexusSelect
                  value={selectedDataset}
                  onChange={v => setSelectedDataset(v)}
                  icon={<FolderOpen className="h-4 w-4" />}
                  placeholder="Select a prepared dataset"
                  options={datasetOptions}
                  disabled={training}
                />
              </div>
            )}

            {/* Dataset info */}
            {selectedDataset && (() => {
              const ds = datasets.find(d => d.yamlPath === selectedDataset);
              if (!ds) return null;
              return (
                <div className="p-3 rounded-xl bg-accent/50 border border-white/[0.06] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{ds.name}</span>
                    <Badge variant="outline" className="text-[9px]">{ds.format}</Badge>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="default" className="text-[9px]">{ds.numImages} images</Badge>
                    <Badge variant="outline" className="text-[9px]">{ds.numClasses} classes</Badge>
                    <Badge variant="outline" className="text-[9px]">{ds.splits.train} train / {ds.splits.val} val</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{ds.classes.join(', ')}</p>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Training Config */}
        <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Settings2 className="h-3.5 w-3.5 text-violet-400" />
              </div>
              Training Config
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 md:p-7 pt-6 space-y-4">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Base Model</label>
              <NexusSelect value={trainModel} onChange={v => setTrainModel(v)} icon={<Cpu className="h-4 w-4" />} placeholder="Select base model" options={trainModelOptions} disabled={training} maxHeight={280} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Epochs</label>
                <NexusSelect value={String(trainEpochs)} onChange={v => setTrainEpochs(Number(v))} options={VISION_EPOCH_OPTIONS.map(e => ({ value: String(e), label: String(e) }))} disabled={training} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Batch Size</label>
                <NexusSelect value={String(trainBatch)} onChange={v => setTrainBatch(Number(v))} options={VISION_BATCH_OPTIONS.map(b => ({ value: String(b), label: String(b) }))} disabled={training} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Image Size</label>
                <NexusSelect value={String(trainImgSize)} onChange={v => setTrainImgSize(Number(v))} options={VISION_IMGSIZE_OPTIONS.map(s => ({ value: String(s), label: `${s}px` }))} disabled={training} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Optimizer</label>
                <NexusSelect value={trainOptimizer} onChange={v => setTrainOptimizer(v)} options={VISION_OPTIMIZER_OPTIONS.map(o => ({ value: o.value, label: o.label }))} disabled={training} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Learning Rate</label>
                <span className="text-xs font-mono text-amber-400">{trainLR}</span>
              </div>
              <input type="range" min={0.0001} max={0.05} step={0.0001} value={trainLR} onChange={e => setTrainLR(Number(e.target.value))} disabled={training} className="w-full accent-amber-400" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Freeze Layers</label>
                <input type="number" value={trainFreeze} onChange={e => setTrainFreeze(Number(e.target.value))} min={0} max={24} disabled={training} className="w-full h-10 rounded-xl border border-white/[0.06] bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/50 disabled:opacity-50" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Early Stop</label>
                <input type="number" value={trainPatience} onChange={e => setTrainPatience(Number(e.target.value))} min={0} max={100} disabled={training} className="w-full h-10 rounded-xl border border-white/[0.06] bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/50 disabled:opacity-50" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Data Augmentation</label>
              <button
                onClick={() => setTrainAugment(!trainAugment)}
                disabled={training}
                className={`relative h-6 w-11 rounded-full transition-colors ${trainAugment ? 'bg-amber-400' : 'bg-muted'} disabled:opacity-50`}
              >
                <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${trainAugment ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Train / Stop Button */}
        {training ? (
          <Button size="lg" onClick={stopTraining} disabled={stopping} className="w-full bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 border-0 text-white h-12">
            {stopping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
            {stopping ? 'Stopping...' : 'Stop Training'}
          </Button>
        ) : (
          <Button size="lg" onClick={startTraining} disabled={!canTrain} className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 border-0 text-white h-12">
            <Play className="h-4 w-4 mr-2" />
            Start Training
          </Button>
        )}
      </div>

      {/* Training Progress & Metrics */}
      <div className="space-y-4 md:space-y-5">
        {(training || trainingDone || trainingError) ? (
          <>
            {/* Progress Card */}
            <Card className={`animate-fade-in-up overflow-hidden ${trainingDone ? 'border-emerald-500/20' : trainingError && !trainingDone ? 'border-destructive/20' : 'border-amber-400/20'}`}>
              <div className={`h-px w-full ${trainingDone ? 'bg-emerald-500' : trainingError && !trainingDone ? 'bg-destructive' : 'bg-gradient-to-r from-pink-400 to-rose-400'}`} />
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {training && <div className="h-7 w-7 rounded-lg bg-pink-400/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-pink-400" /></div>}
                    {trainingDone && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                    {trainingError && !trainingDone && !training && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                    <span>Training Progress</span>
                  </div>
                  <span className={`text-lg font-bold ${trainingDone ? 'text-emerald-400' : 'text-pink-400'}`}>{Math.round(trainingProgress * 100)}%</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                <div className={`w-full bg-muted rounded-full h-2.5 overflow-hidden ${training ? 'animate-progress-glow' : ''}`}>
                  <div className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden" style={{ width: `${trainingProgress * 100}%`, background: trainingError && !trainingDone ? 'var(--destructive)' : trainingDone ? 'var(--success)' : 'linear-gradient(90deg, #ec4899, #f43f5e)' }}>
                    {training && <div className="absolute inset-0 animate-shimmer" />}
                  </div>
                </div>

                {latestMetrics && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="default" className="bg-pink-400/15 text-pink-400 border-pink-400/30">Epoch {latestMetrics.epoch}/{latestMetrics.totalEpochs}</Badge>
                    {latestMetrics.mAP50 > 0 && <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">mAP50: {latestMetrics.mAP50.toFixed(3)}</Badge>}
                    {latestMetrics.mAP5095 > 0 && <Badge variant="outline">mAP50-95: {latestMetrics.mAP5095.toFixed(3)}</Badge>}
                    {latestMetrics.boxLoss > 0 && <Badge variant="outline">Box: {latestMetrics.boxLoss.toFixed(4)}</Badge>}
                    {latestMetrics.precision > 0 && <Badge variant="outline">P: {latestMetrics.precision.toFixed(3)}</Badge>}
                    {latestMetrics.recall > 0 && <Badge variant="outline">R: {latestMetrics.recall.toFixed(3)}</Badge>}
                  </div>
                )}

                {trainingDone && trainResult && (
                  <div className="space-y-3 animate-celebrate">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 animate-success-ring" />
                      <div className="text-sm">
                        <span className="font-semibold text-emerald-400">Training Complete</span>
                        <span className="text-muted-foreground ml-2">{trainResult.message as string}</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => onSwitchTab?.('export')}
                      className="w-full bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 border-0 text-white"
                    >
                      <Layers className="h-4 w-4 mr-2" />
                      Export This Model
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}

                {trainingError && !training && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">{trainingError}</div>
                )}
              </CardContent>
            </Card>

            {/* Loss & mAP Chart */}
            {epochMetrics.length > 0 && (
              <Card className="animate-fade-in-up overflow-hidden">
                <div className="h-px w-full bg-gradient-to-r from-violet-500 to-violet-500/60" />
                <CardHeader className="border-b border-white/[0.06]">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <TrendingDown className="h-3.5 w-3.5 text-violet-400" />
                    </div>
                    Training Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-7 pt-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Loss (Box + Cls + DFL)</p>
                      <div className="h-32 flex items-end gap-px bg-accent/30 rounded-lg p-2 overflow-hidden">
                        {epochMetrics.filter(m => m.boxLoss > 0).map((m, i, arr) => {
                          const totalLoss = m.boxLoss + m.clsLoss + m.dflLoss;
                          const maxLoss = Math.max(...arr.map(x => x.boxLoss + x.clsLoss + x.dflLoss));
                          const height = maxLoss > 0 ? (totalLoss / maxLoss) * 100 : 0;
                          return (
                            <div key={m.epoch} className="flex-1 flex flex-col justify-end min-w-[3px]" title={`Epoch ${m.epoch}: ${totalLoss.toFixed(4)}`}>
                              <div className="rounded-t-sm transition-all duration-300" style={{ height: `${height}%`, background: i === arr.length - 1 ? '#ec4899' : 'rgba(236, 72, 153, 0.4)', minHeight: '2px' }} />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {epochMetrics.some(m => m.mAP50 > 0) && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">mAP50 / mAP50-95</p>
                        <div className="h-32 flex items-end gap-px bg-accent/30 rounded-lg p-2 overflow-hidden">
                          {epochMetrics.filter(m => m.mAP50 > 0).map((m, i, arr) => (
                            <div key={m.epoch} className="flex-1 flex flex-col justify-end gap-px min-w-[3px]" title={`Epoch ${m.epoch}: mAP50=${m.mAP50.toFixed(3)}, mAP50-95=${m.mAP5095.toFixed(3)}`}>
                              <div className="rounded-t-sm transition-all duration-300" style={{ height: `${m.mAP50 * 100}%`, background: i === arr.length - 1 ? '#10b981' : 'rgba(16, 185, 129, 0.4)', minHeight: '2px' }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground sticky top-0 bg-card">
                        <tr>
                          <th className="text-left py-1 px-1 font-semibold">Epoch</th>
                          <th className="text-right py-1 px-1 font-semibold">Box</th>
                          <th className="text-right py-1 px-1 font-semibold">Cls</th>
                          <th className="text-right py-1 px-1 font-semibold">mAP50</th>
                          <th className="text-right py-1 px-1 font-semibold">mAP50-95</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {epochMetrics.slice().reverse().map(m => (
                          <tr key={m.epoch} className="border-t border-white/[0.03]">
                            <td className="py-1 px-1 text-pink-400">{m.epoch}</td>
                            <td className="py-1 px-1 text-right">{m.boxLoss > 0 ? m.boxLoss.toFixed(4) : '-'}</td>
                            <td className="py-1 px-1 text-right">{m.clsLoss > 0 ? m.clsLoss.toFixed(4) : '-'}</td>
                            <td className="py-1 px-1 text-right text-emerald-400">{m.mAP50 > 0 ? m.mAP50.toFixed(3) : '-'}</td>
                            <td className="py-1 px-1 text-right">{m.mAP5095 > 0 ? m.mAP5095.toFixed(3) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Training logs */}
            <Card className="animate-fade-in-up overflow-hidden">
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-sm">Training Logs</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="bg-accent/50 rounded-xl p-4 max-h-60 overflow-y-auto font-mono text-xs space-y-0.5 border border-white/[0.06]">
                  {trainingLogs.map((log, i) => (
                    <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : log.type === 'epoch' ? 'text-pink-400/80' : log.type === 'val' ? 'text-emerald-400/80' : 'text-muted-foreground/80'}>
                      {log.message}
                    </div>
                  ))}
                  {training && <div className="flex items-center gap-2 text-pink-400"><div className="h-1.5 w-1.5 rounded-full bg-pink-400 animate-pulse" />Training...</div>}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className="animate-fade-in-up relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-pink-400 via-pink-400/60 to-transparent" />
              <CardContent className="p-8 md:p-10 text-center">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-pink-400/20 to-pink-400/5 shadow-sm shadow-pink-400/10 flex items-center justify-center mx-auto mb-5">
                  <Target className="h-7 w-7 text-pink-400" />
                </div>
                <h2 className="text-lg font-bold mb-2">Finetune Vision Models</h2>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed max-w-sm mx-auto">
                  Pick a sample dataset or upload your own, configure training parameters, and train a custom YOLO model with live metrics.
                </p>
                <div className="flex flex-wrap gap-2 justify-center text-[10px] text-muted-foreground/60">
                  <span>1. Select or upload dataset</span>
                  <span>-</span>
                  <span>2. Select base model</span>
                  <span>-</span>
                  <span>3. Configure & train</span>
                </div>
              </CardContent>
            </Card>

            {/* Previous training runs */}
            {trainRuns.length > 0 && (
              <Card className="animate-fade-in-up stagger-2 overflow-hidden">
                <div className="h-px w-full bg-gradient-to-r from-violet-500 to-violet-500/60" />
                <CardHeader className="border-b border-white/[0.06]">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <BarChart3 className="h-3.5 w-3.5 text-violet-400" />
                    </div>
                    Previous Training Runs
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 max-h-80 overflow-y-auto">
                  {trainRuns.map((run, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.03] last:border-0 hover:bg-accent/30 transition-colors">
                      <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{run.model}</p>
                        <p className="text-[10px] text-muted-foreground">{run.epochs} epochs — {Math.round(run.totalTime)}s</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-emerald-400">{run.bestMap50.toFixed(3)}</p>
                        <p className="text-[10px] text-muted-foreground">mAP50</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
