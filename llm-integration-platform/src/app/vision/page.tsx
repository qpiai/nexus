'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import { useNotifications } from '@/components/notifications';
import {
  Eye, Play, Loader2, CheckCircle2, AlertCircle, ImagePlus,
  Layers, Download, Rocket, ArrowRight, SlidersHorizontal,
  RotateCcw, Cpu, Upload, FolderOpen, Square,
  TrendingDown, Target, BarChart3, Settings2,
} from 'lucide-react';
import {
  SUPPORTED_VISION_MODELS, VISION_EXPORT_FORMATS,
  VISION_TRAIN_DEFAULTS, VISION_OPTIMIZER_OPTIONS,
  VISION_BATCH_OPTIONS, VISION_IMGSIZE_OPTIONS, VISION_EPOCH_OPTIONS,
} from '@/lib/constants';
import type { VisionTask } from '@/lib/types';

// ============================================================
// Types
// ============================================================

interface LogEntry {
  type: string;
  message: string;
  progress?: number;
}

interface ExportedModel {
  name: string;
  modelId: string;
  task: string;
  format: string;
  precision: string;
  imgSize: number;
  sizeMB: number;
  modelFile: string | null;
  dirName: string;
  classes?: string[];
}

interface Detection {
  bbox: [number, number, number, number];
  class: string;
  confidence: number;
}

interface InferenceResult {
  detections: Detection[];
  annotatedImage: string;
  inferenceTimeMs: number;
  preprocessMs: number;
  inferenceMs: number;
  postprocessMs: number;
  imageSize: [number, number];
  detectionCount: number;
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

const CLASS_COLORS = [
  '#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
];

type VisionTab = 'export' | 'finetune' | 'inference';

// ============================================================
// Component
// ============================================================

export default function VisionPage() {
  const router = useRouter();
  const { addNotification } = useNotifications();

  // Active tab
  const [activeTab, setActiveTab] = useState<VisionTab>('export');

  // Task filter
  const [taskFilter, setTaskFilter] = useState<VisionTask>('detect');

  // ---- Export State ----
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('onnx');
  const [selectedPrecision, setSelectedPrecision] = useState('fp16');
  const [imgSize, setImgSize] = useState(640);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLogs, setExportLogs] = useState<LogEntry[]>([]);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportedSize, setExportedSize] = useState<number | null>(null);
  const [exportedModels, setExportedModels] = useState<ExportedModel[]>([]);
  const [selectedExistingModel, setSelectedExistingModel] = useState('');

  // Active model for inference
  const [activeModelDirName, setActiveModelDirName] = useState<string | null>(null);
  const [activeModelFile, setActiveModelFile] = useState<string | null>(null);
  const [activeModelTask, setActiveModelTask] = useState<string>('detect');
  const [activeModelFormat, setActiveModelFormat] = useState<string>('onnx');

  // ---- Inference State ----
  const [uploadedImageFilename, setUploadedImageFilename] = useState<string | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [inferring, setInferring] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stopping, setStopping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Finetune State ----
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [trainModel, setTrainModel] = useState('');
  const [trainEpochs, setTrainEpochs] = useState(VISION_TRAIN_DEFAULTS.epochs);
  const [trainBatch, setTrainBatch] = useState(VISION_TRAIN_DEFAULTS.batchSize);
  const [trainImgSize, setTrainImgSize] = useState(VISION_TRAIN_DEFAULTS.imgSize);
  const [trainLR, setTrainLR] = useState(VISION_TRAIN_DEFAULTS.learningRate);
  const [trainOptimizer, setTrainOptimizer] = useState<string>(VISION_TRAIN_DEFAULTS.optimizer);
  const [trainFreeze, setTrainFreeze] = useState(VISION_TRAIN_DEFAULTS.freeze);
  const [trainAugment, setTrainAugment] = useState(VISION_TRAIN_DEFAULTS.augment);
  const [trainPatience, setTrainPatience] = useState(VISION_TRAIN_DEFAULTS.patience);

  const [datasetUploading, setDatasetUploading] = useState(false);
  const [datasetPreparing, setDatasetPreparing] = useState(false);
  const [datasetPrepareLogs, setDatasetPrepareLogs] = useState<LogEntry[]>([]);
  const [datasetPrepareError, setDatasetPrepareError] = useState<string | null>(null);

  const [training, setTraining] = useState(false);
  const [trainingDone, setTrainingDone] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingLogs, setTrainingLogs] = useState<LogEntry[]>([]);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [epochMetrics, setEpochMetrics] = useState<EpochMetrics[]>([]);
  const [trainResult, setTrainResult] = useState<Record<string, unknown> | null>(null);

  const [trainRuns, setTrainRuns] = useState<TrainRun[]>([]);
  const [datasetDragOver, setDatasetDragOver] = useState(false);
  const datasetFileRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // Effects
  // ============================================================

  // Load exported models
  useEffect(() => {
    fetch('/api/vision/models')
      .then(r => r.json())
      .then(data => setExportedModels(data.models || []))
      .catch(() => {});
  }, [exportDone]);

  // Load datasets
  useEffect(() => {
    fetch('/api/vision/dataset/list')
      .then(r => r.json())
      .then(data => setDatasets(data.datasets || []))
      .catch(() => {});
  }, [datasetPreparing]);

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
          if (data.running) {
            setActiveTab('finetune');
          }
        }
        if (data.running) {
          // Start polling with ref to prevent leaks
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

  // Update imgSize when model changes
  useEffect(() => {
    const model = SUPPORTED_VISION_MODELS.find(m => m.modelId === selectedModel);
    if (model) setImgSize(model.defaultImgSize);
  }, [selectedModel]);

  // Update precision when format changes
  useEffect(() => {
    const fmt = VISION_EXPORT_FORMATS.find(f => f.id === selectedFormat);
    if (fmt && !(fmt.precisions as readonly string[]).includes(selectedPrecision)) {
      setSelectedPrecision(fmt.precisions[0]);
    }
  }, [selectedFormat, selectedPrecision]);

  // Handle existing model selection
  useEffect(() => {
    if (!selectedExistingModel) return;
    const model = exportedModels.find(m => m.dirName === selectedExistingModel);
    if (model) {
      setActiveModelDirName(model.dirName);
      setActiveModelFile(model.modelFile);
      setActiveModelTask(model.task);
      setActiveModelFormat(model.format);
    }
  }, [selectedExistingModel, exportedModels]);

  // ============================================================
  // Export Handlers
  // ============================================================

  const filteredModels = SUPPORTED_VISION_MODELS.filter(m => m.task === taskFilter);
  const formatInfo = VISION_EXPORT_FORMATS.find(f => f.id === selectedFormat);
  const modelInfo = SUPPORTED_VISION_MODELS.find(m => m.modelId === selectedModel);

  const startExport = useCallback(() => {
    if (!selectedModel || !selectedFormat) return;
    setExporting(true);
    setExportDone(false);
    setExportError(null);
    setExportLogs([]);
    setExportProgress(0);
    setExportedPath(null);
    setExportedSize(null);

    addNotification('info', 'Vision Export Started', `Exporting ${selectedModel} to ${selectedFormat.toUpperCase()}`);

    fetch('/api/vision/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, format: selectedFormat, precision: selectedPrecision, imgSize }),
    }).then(async (res) => {
      if (!res.ok) {
        try { const err = await res.json(); setExportError(err.error || `Server error (${res.status})`); } catch { setExportError(`Server error (${res.status})`); }
        setExporting(false);
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
              if (eventType === 'progress') {
                setExportLogs(prev => [...prev.slice(-199), { type: 'progress', message: data.message, progress: data.progress }]);
                if (data.progress) setExportProgress(data.progress);
              } else if (eventType === 'complete') {
                setExportLogs(prev => [...prev.slice(-199), { type: 'complete', message: data.message, progress: 1.0 }]);
                setExportProgress(1.0);
                setExportDone(true);
                if (data.output_path) {
                  setExportedPath(data.output_path);
                  // Extract dirName from the output_path for model selection
                  const pathParts = (data.output_path as string).split('/');
                  const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
                  setActiveModelDirName(dirName);
                  setActiveModelFile(null);
                  setActiveModelTask(selectedModel.includes('-seg') ? 'segment' : 'detect');
                  setActiveModelFormat(selectedFormat);
                }
                if (data.size_mb) setExportedSize(data.size_mb);
                addNotification('success', 'Vision Export Complete', data.message);
              } else if (eventType === 'error') {
                setExportLogs(prev => [...prev.slice(-199), { type: 'error', message: data.message }]);
                setExportError(data.message);
                addNotification('error', 'Vision Export Error', data.message);
              } else if (eventType === 'log') {
                setExportLogs(prev => [...prev.slice(-199), { type: 'log', message: data.message }]);
              } else if (eventType === 'info') {
                setExportLogs(prev => [...prev.slice(-199), { type: 'info', message: data.message || `Exporting ${data.model}` }]);
              } else if (eventType === 'done') {
                setExporting(false);
              }
            } catch { /* skip */ }
          }
        }
      }
      setExporting(false);
    }).catch((err) => {
      setExportError(err.message);
      setExporting(false);
      addNotification('error', 'Vision Export Failed', err.message);
    });
  }, [selectedModel, selectedFormat, selectedPrecision, imgSize, addNotification]);

  // ============================================================
  // Inference Handlers
  // ============================================================

  const handleImageUpload = useCallback(async (file: File) => {
    setUploading(true);
    setInferenceError(null);
    try {
      const reader = new FileReader();
      reader.onload = (e) => setUploadedImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);

      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/vision/upload-image', { method: 'POST', body: formData });
      if (!res.ok) { const err = await res.json(); setInferenceError(err.error || 'Upload failed'); return; }
      const result = await res.json();
      setUploadedImageFilename(result.filename);
    } catch (err) {
      setInferenceError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleImageUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(jpg|jpeg|png|webp|bmp)$/i.test(file.name)) handleImageUpload(file);
  }, [handleImageUpload]);

  const runInference = useCallback(async () => {
    if (!activeModelDirName || !uploadedImageFilename) return;
    setInferring(true);
    setInferenceResult(null);
    setInferenceError(null);
    try {
      const res = await fetch('/api/vision/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageFilename: uploadedImageFilename,
          modelDirName: activeModelDirName,
          modelFile: activeModelFile,
          task: activeModelTask,
          conf: confidence,
          iou,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setInferenceError(data.error || 'Inference failed');
        addNotification('error', 'Inference Failed', data.error);
      } else {
        setInferenceResult(data);
        addNotification('success', 'Inference Complete', `${data.detectionCount} detections in ${data.inferenceTimeMs}ms`);
      }
    } catch (err) {
      setInferenceError((err as Error).message);
    } finally {
      setInferring(false);
    }
  }, [activeModelDirName, activeModelFile, uploadedImageFilename, activeModelTask, confidence, iou, addNotification]);

  // ============================================================
  // Finetune Handlers
  // ============================================================

  const handleDatasetUpload = useCallback(async (file: File) => {
    setDatasetUploading(true);
    setDatasetPrepareError(null);
    setDatasetPrepareLogs([]);

    const datasetName = file.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      // Step 1: Upload ZIP
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

      // Step 2: Prepare dataset (SSE) — send only the name, server reconstructs path
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
                // Auto-select the new dataset
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
                  if (existing) {
                    return prev.map(m => m.epoch === data.epoch ? { ...m, ...data } : m);
                  }
                  return [...prev, data];
                });
                setTrainingProgress(data.progress || 0);
                setTrainingLogs(prev => [...prev.slice(-199), { type: 'epoch', message: `Epoch ${data.epoch}/${data.totalEpochs} — box: ${data.boxLoss?.toFixed(4)}, cls: ${data.clsLoss?.toFixed(4)}`, progress: data.progress }]);
              } else if (eventType === 'val_metrics') {
                setEpochMetrics(prev => {
                  const existing = prev.find(m => m.epoch === data.epoch);
                  if (existing) {
                    return prev.map(m => m.epoch === data.epoch ? { ...m, ...data } : m);
                  }
                  return [...prev, data];
                });
                setTrainingLogs(prev => [...prev.slice(-199), { type: 'val', message: `Val Epoch ${data.epoch} — mAP50: ${data.mAP50?.toFixed(4)}, mAP50-95: ${data.mAP5095?.toFixed(4)}`, progress: data.progress }]);
              } else if (eventType === 'complete') {
                setTrainingLogs(prev => [...prev, { type: 'complete', message: data.message, progress: 1.0 }]);
                setTrainingProgress(1.0);
                setTrainingDone(true);
                setTrainResult(data);
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

  // ============================================================
  // Derived
  // ============================================================

  const canExport = selectedModel && selectedFormat && !exporting;
  const canInfer = activeModelDirName && uploadedImageFilename && !inferring;
  const canTrain = trainModel && selectedDataset && !training;

  const modelOptions = filteredModels.map(m => ({
    value: m.modelId,
    label: m.name,
    description: `${m.description} (${m.paramM}M params, mAP ${m.cocoMap}%)`,
  }));

  const formatOptions = VISION_EXPORT_FORMATS.map(f => ({
    value: f.id,
    label: f.name,
    description: f.description,
  }));

  const precisionOptions = (formatInfo?.precisions || ['fp16']).map(p => ({
    value: p,
    label: p.toUpperCase(),
  }));

  const existingModelOptions = exportedModels.map(m => ({
    value: m.dirName,
    label: `${m.name} (${m.format.toUpperCase()} ${m.precision})`,
    description: `${m.sizeMB} MB — ${m.task}`,
  }));

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

  // Latest metrics for display
  const latestMetrics = epochMetrics.length > 0 ? epochMetrics[epochMetrics.length - 1] : null;

  // ============================================================
  // Render
  // ============================================================

  return (
    <>
      <Header title="Vision" subtitle="YOLO object detection & segmentation" />
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-accent/50 rounded-xl border border-border/40 w-fit">
          {([
            { id: 'export' as const, label: 'Export', icon: Layers },
            { id: 'finetune' as const, label: 'Finetune', icon: Target },
            { id: 'inference' as const, label: 'Inference', icon: Eye },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? 'bg-card text-amber-400 shadow-sm border border-amber-400/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.id === 'finetune' && training && (
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          <Card className="animate-fade-in-up stagger-1 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 flex items-center justify-center shadow-sm shadow-amber-400/10 mb-3">
                  <Eye className="h-5 w-5 text-amber-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tab</p>
                <p className="text-sm font-bold tracking-tight mt-1 capitalize">{activeTab}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center shadow-sm shadow-violet-500/10 mb-3">
                  <Cpu className="h-5 w-5 text-violet-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Models</p>
                <p className="text-sm font-bold tracking-tight mt-1">{exportedModels.length} exported</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center shadow-sm shadow-emerald-500/10 mb-3">
                  <FolderOpen className="h-5 w-5 text-emerald-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Datasets</p>
                <p className="text-sm font-bold tracking-tight mt-1">{datasets.length} prepared</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm shadow-primary/10 mb-3">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Train Runs</p>
                <p className="text-sm font-bold tracking-tight mt-1">{trainRuns.length} completed</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ============================================================ */}
        {/* EXPORT TAB */}
        {/* ============================================================ */}
        {activeTab === 'export' && (
          <div className="space-y-4 md:space-y-5">
            {/* Configuration */}
            <div className="space-y-4 md:space-y-5">
              {/* Task Filter */}
              <Card className="animate-fade-in-up relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                <CardHeader className="border-b border-border/40">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center">
                      <Eye className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                    Task & Model
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Task Type</label>
                    <div className="flex gap-2">
                      {(['detect', 'segment'] as VisionTask[]).map(t => (
                        <button
                          key={t}
                          onClick={() => { setTaskFilter(t); setSelectedModel(''); }}
                          disabled={exporting}
                          className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                            taskFilter === t
                              ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30 shadow-sm'
                              : 'bg-accent/50 text-muted-foreground border border-border/50 hover:bg-accent hover:border-border/70'
                          } disabled:opacity-50`}
                        >
                          {t === 'detect' ? 'Detection' : 'Segmentation'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Model</label>
                    <NexusSelect value={selectedModel} onChange={v => setSelectedModel(v)} icon={<Cpu className="h-4 w-4" />} placeholder="Select a model" options={modelOptions} disabled={exporting} maxHeight={280} />
                    {modelInfo && (
                      <div className="flex gap-2 mt-3 flex-wrap">
                        <Badge variant="default">{modelInfo.paramM}M params</Badge>
                        <Badge variant="outline">mAP {modelInfo.cocoMap}%</Badge>
                        <Badge variant="outline">{modelInfo.defaultImgSize}px</Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Export Format */}
              <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
                <CardHeader className="border-b border-border/40">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    Export Format
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Format</label>
                    <NexusSelect value={selectedFormat} onChange={v => setSelectedFormat(v)} icon={<Layers className="h-4 w-4" />} options={formatOptions} disabled={exporting} maxHeight={280} />
                    {formatInfo?.badge && (
                      <div className="mt-2">
                        <Badge variant={formatInfo.badge === 'Recommended' ? 'success' : 'outline'} className="text-[9px]">{formatInfo.badge}</Badge>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Precision</label>
                      <NexusSelect value={selectedPrecision} onChange={v => setSelectedPrecision(v)} options={precisionOptions} disabled={exporting} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Image Size</label>
                      <input type="number" value={imgSize} onChange={e => setImgSize(Number(e.target.value))} min={128} max={1280} step={32} disabled={exporting} className="w-full h-10 rounded-xl border border-border/50 bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/50 disabled:opacity-50" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Export Button */}
              {!exporting && !exportDone && (
                <Button size="lg" onClick={startExport} disabled={!canExport} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 text-white px-8 h-12">
                  <Play className="h-4 w-4 mr-2" />
                  Export Model
                </Button>
              )}

              {/* Use existing model */}
              {exportedModels.length > 0 && (
                <Card className="animate-fade-in-up relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent" />
                  <CardContent className="p-6 md:p-7 space-y-3">
                    <label className="text-[10px] font-semibold text-muted-foreground block uppercase tracking-wider">Or use exported model</label>
                    <NexusSelect value={selectedExistingModel} onChange={v => setSelectedExistingModel(v)} icon={<Layers className="h-4 w-4" />} placeholder="Select an exported model" options={existingModelOptions} maxHeight={200} />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Export Progress */}
            <div className="space-y-4 md:space-y-5">
              {(exporting || exportDone || exportError) ? (
                <Card className={`animate-fade-in-up overflow-hidden ${exportDone ? 'border-emerald-500/20' : exportError && !exportDone ? 'border-destructive/20' : 'border-amber-400/20'}`}>
                  <div className={`h-px w-full ${exportDone ? 'bg-emerald-500' : exportError && !exportDone ? 'bg-destructive' : 'bg-gradient-to-r from-amber-400 to-orange-400'}`} />
                  <CardHeader className="border-b border-border/40">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {exporting && <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" /></div>}
                        {exportDone && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                        {exportError && !exportDone && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                        <span>Export Progress</span>
                      </div>
                      <span className={`text-lg font-bold ${exportDone ? 'text-emerald-400' : 'text-amber-400'}`}>{Math.round(exportProgress * 100)}%</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden" style={{ width: `${exportProgress * 100}%`, background: exportError && !exportDone ? 'var(--destructive)' : exportDone ? 'var(--success)' : 'linear-gradient(90deg, #f59e0b, #f97316)' }}>
                        {exporting && <div className="absolute inset-0 animate-shimmer" />}
                      </div>
                    </div>
                    <div className="bg-accent/50 rounded-xl p-4 max-h-80 overflow-y-auto font-mono text-xs space-y-1 border border-border/40">
                      {exportLogs.map((log, i) => (
                        <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : log.type === 'info' ? 'text-amber-400' : 'text-muted-foreground/80'}>
                          <span className="text-muted-foreground/40 mr-2 select-none">{log.progress !== undefined ? `[${Math.round(log.progress * 100)}%]` : '[---]'}</span>
                          {log.message}
                        </div>
                      ))}
                      {exporting && <div className="flex items-center gap-2 text-amber-400"><div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />Exporting...</div>}
                    </div>
                    {exportDone && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        <div className="text-sm">
                          <span className="font-semibold text-emerald-400">Export Complete</span>
                          {exportedSize && <span className="text-muted-foreground ml-2">{exportedSize} MB</span>}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="animate-fade-in-up relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                  <CardContent className="p-8 md:p-10 text-center">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 shadow-sm shadow-amber-400/10 flex items-center justify-center mx-auto mb-5">
                      <Eye className="h-7 w-7 text-amber-400" />
                    </div>
                    <h2 className="text-lg font-bold mb-2">Export & Deploy Vision Models</h2>
                    <p className="text-sm text-muted-foreground mb-4 leading-relaxed max-w-sm mx-auto">
                      Select a YOLO model and export format, then export for deployment. Test with inference before deploying.
                    </p>
                    {!selectedModel && <p className="text-[10px] text-muted-foreground/60">Select a model to get started</p>}
                  </CardContent>
                </Card>
              )}

              {exportError && !exportDone && !exporting && (
                <Card className="border-destructive/20 animate-scale-in overflow-hidden">
                  <div className="h-px w-full bg-destructive" />
                  <CardContent className="p-6 md:p-7 text-center">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 shadow-sm shadow-red-500/10 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                    </div>
                    <p className="text-sm text-destructive font-medium mb-1">Export Failed</p>
                    <p className="text-xs text-muted-foreground mb-5">{exportError}</p>
                    <Button onClick={startExport} disabled={!canExport}><RotateCcw className="h-4 w-4 mr-2" />Retry Export</Button>
                  </CardContent>
                </Card>
              )}

              {/* Deploy button */}
              {(exportDone || selectedExistingModel) && activeModelDirName && (
                <div className="flex flex-col sm:flex-row gap-2">
                  {exportedPath && (
                    <Button variant="outline" size="lg" className="flex-1"><Download className="h-4 w-4 mr-2" />Download Model</Button>
                  )}
                  <Button
                    size="lg"
                    className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 text-white"
                    onClick={() => {
                      sessionStorage.setItem('nexus-vision-model', JSON.stringify({ dirName: activeModelDirName, modelFile: activeModelFile, task: activeModelTask, format: activeModelFormat, precision: selectedPrecision }));
                      router.push('/deploy');
                    }}
                  >
                    <Rocket className="h-4 w-4 mr-2" />Deploy<ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* FINETUNE TAB */}
        {/* ============================================================ */}
        {activeTab === 'finetune' && (
          <div className="space-y-4 md:space-y-5">
            {/* Dataset & Config */}
            <div className="space-y-4 md:space-y-5">
              {/* Dataset Upload */}
              <Card className="animate-fade-in-up relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                <CardHeader className="border-b border-border/40">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center">
                      <Upload className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                    Dataset
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                  {/* Upload zone */}
                  <div
                    onClick={() => datasetFileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDatasetDragOver(true); }}
                    onDragLeave={() => setDatasetDragOver(false)}
                    onDrop={handleDatasetDrop}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                      datasetDragOver
                        ? 'border-amber-400 bg-amber-400/5'
                        : 'border-border/50 hover:border-amber-400/50 hover:bg-accent/30'
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

                  {/* Prepare logs */}
                  {datasetPrepareLogs.length > 0 && (
                    <div className="bg-accent/50 rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-0.5 border border-border/40">
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
                      <div className="p-3 rounded-xl bg-accent/50 border border-border/40 space-y-1">
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
              <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
                <CardHeader className="border-b border-border/40">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <Settings2 className="h-3.5 w-3.5 text-violet-400" />
                    </div>
                    Training Config
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                  {/* Base model */}
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Base Model</label>
                    <NexusSelect value={trainModel} onChange={v => setTrainModel(v)} icon={<Cpu className="h-4 w-4" />} placeholder="Select base model" options={trainModelOptions} disabled={training} maxHeight={280} />
                  </div>

                  {/* Epochs + Batch */}
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

                  {/* Image Size + Optimizer */}
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

                  {/* Learning Rate */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Learning Rate</label>
                      <span className="text-xs font-mono text-amber-400">{trainLR}</span>
                    </div>
                    <input type="range" min={0.0001} max={0.05} step={0.0001} value={trainLR} onChange={e => setTrainLR(Number(e.target.value))} disabled={training} className="w-full accent-amber-400" />
                  </div>

                  {/* Freeze + Patience */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Freeze Layers</label>
                      <input type="number" value={trainFreeze} onChange={e => setTrainFreeze(Number(e.target.value))} min={0} max={24} disabled={training} className="w-full h-10 rounded-xl border border-border/50 bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/50 disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Early Stop</label>
                      <input type="number" value={trainPatience} onChange={e => setTrainPatience(Number(e.target.value))} min={0} max={100} disabled={training} className="w-full h-10 rounded-xl border border-border/50 bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/50 disabled:opacity-50" />
                    </div>
                  </div>

                  {/* Augment toggle */}
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
                <Button size="lg" onClick={startTraining} disabled={!canTrain} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 text-white h-12">
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
                    <div className={`h-px w-full ${trainingDone ? 'bg-emerald-500' : trainingError && !trainingDone ? 'bg-destructive' : 'bg-gradient-to-r from-amber-400 to-orange-400'}`} />
                    <CardHeader className="border-b border-border/40">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {training && <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" /></div>}
                          {trainingDone && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                          {trainingError && !trainingDone && !training && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                          <span>Training Progress</span>
                        </div>
                        <span className={`text-lg font-bold ${trainingDone ? 'text-emerald-400' : 'text-amber-400'}`}>{Math.round(trainingProgress * 100)}%</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                      {/* Progress bar */}
                      <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden" style={{ width: `${trainingProgress * 100}%`, background: trainingError && !trainingDone ? 'var(--destructive)' : trainingDone ? 'var(--success)' : 'linear-gradient(90deg, #f59e0b, #f97316)' }}>
                          {training && <div className="absolute inset-0 animate-shimmer" />}
                        </div>
                      </div>

                      {/* Live metrics badges */}
                      {latestMetrics && (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="default" className="bg-amber-400/15 text-amber-400 border-amber-400/30">Epoch {latestMetrics.epoch}/{latestMetrics.totalEpochs}</Badge>
                          {latestMetrics.mAP50 > 0 && <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">mAP50: {latestMetrics.mAP50.toFixed(3)}</Badge>}
                          {latestMetrics.mAP5095 > 0 && <Badge variant="outline">mAP50-95: {latestMetrics.mAP5095.toFixed(3)}</Badge>}
                          {latestMetrics.boxLoss > 0 && <Badge variant="outline">Box: {latestMetrics.boxLoss.toFixed(4)}</Badge>}
                          {latestMetrics.precision > 0 && <Badge variant="outline">P: {latestMetrics.precision.toFixed(3)}</Badge>}
                          {latestMetrics.recall > 0 && <Badge variant="outline">R: {latestMetrics.recall.toFixed(3)}</Badge>}
                        </div>
                      )}

                      {trainingDone && trainResult && (
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                          <div className="text-sm">
                            <span className="font-semibold text-emerald-400">Training Complete</span>
                            <span className="text-muted-foreground ml-2">{trainResult.message as string}</span>
                          </div>
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
                      <CardHeader className="border-b border-border/40">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                            <TrendingDown className="h-3.5 w-3.5 text-violet-400" />
                          </div>
                          Training Metrics
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 md:p-7 pt-6">
                        {/* Simple CSS chart — loss curves */}
                        <div className="space-y-4">
                          {/* Loss chart */}
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Loss (Box + Cls + DFL)</p>
                            <div className="h-32 flex items-end gap-px bg-accent/30 rounded-lg p-2 overflow-hidden">
                              {epochMetrics.filter(m => m.boxLoss > 0).map((m, i, arr) => {
                                const totalLoss = m.boxLoss + m.clsLoss + m.dflLoss;
                                const maxLoss = Math.max(...arr.map(x => x.boxLoss + x.clsLoss + x.dflLoss));
                                const height = maxLoss > 0 ? (totalLoss / maxLoss) * 100 : 0;
                                return (
                                  <div key={m.epoch} className="flex-1 flex flex-col justify-end min-w-[3px]" title={`Epoch ${m.epoch}: ${totalLoss.toFixed(4)}`}>
                                    <div
                                      className="rounded-t-sm transition-all duration-300"
                                      style={{
                                        height: `${height}%`,
                                        background: i === arr.length - 1 ? '#f59e0b' : 'rgba(245, 158, 11, 0.4)',
                                        minHeight: '2px',
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* mAP chart */}
                          {epochMetrics.some(m => m.mAP50 > 0) && (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">mAP50 / mAP50-95</p>
                              <div className="h-32 flex items-end gap-px bg-accent/30 rounded-lg p-2 overflow-hidden">
                                {epochMetrics.filter(m => m.mAP50 > 0).map((m, i, arr) => (
                                  <div key={m.epoch} className="flex-1 flex flex-col justify-end gap-px min-w-[3px]" title={`Epoch ${m.epoch}: mAP50=${m.mAP50.toFixed(3)}, mAP50-95=${m.mAP5095.toFixed(3)}`}>
                                    <div
                                      className="rounded-t-sm transition-all duration-300"
                                      style={{
                                        height: `${m.mAP50 * 100}%`,
                                        background: i === arr.length - 1 ? '#10b981' : 'rgba(16, 185, 129, 0.4)',
                                        minHeight: '2px',
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Epoch table */}
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
                                <tr key={m.epoch} className="border-t border-border/20">
                                  <td className="py-1 px-1 text-amber-400">{m.epoch}</td>
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
                    <CardHeader className="border-b border-border/40">
                      <CardTitle className="text-sm">Training Logs</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="bg-accent/50 rounded-xl p-4 max-h-60 overflow-y-auto font-mono text-xs space-y-0.5 border border-border/40">
                        {trainingLogs.map((log, i) => (
                          <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : log.type === 'epoch' ? 'text-amber-400/80' : log.type === 'val' ? 'text-emerald-400/80' : 'text-muted-foreground/80'}>
                            {log.message}
                          </div>
                        ))}
                        {training && <div className="flex items-center gap-2 text-amber-400"><div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />Training...</div>}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <>
                  {/* Empty state */}
                  <Card className="animate-fade-in-up relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                    <CardContent className="p-8 md:p-10 text-center">
                      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 shadow-sm shadow-amber-400/10 flex items-center justify-center mx-auto mb-5">
                        <Target className="h-7 w-7 text-amber-400" />
                      </div>
                      <h2 className="text-lg font-bold mb-2">Finetune Vision Models</h2>
                      <p className="text-sm text-muted-foreground mb-4 leading-relaxed max-w-sm mx-auto">
                        Upload a dataset (YOLO or COCO format), configure training parameters, and train a custom YOLO model with live metrics.
                      </p>
                      <div className="flex flex-wrap gap-2 justify-center text-[10px] text-muted-foreground/60">
                        <span>1. Upload dataset ZIP</span>
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
                      <CardHeader className="border-b border-border/40">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                            <BarChart3 className="h-3.5 w-3.5 text-violet-400" />
                          </div>
                          Previous Training Runs
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 max-h-80 overflow-y-auto">
                        {trainRuns.map((run, i) => (
                          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/20 last:border-0 hover:bg-accent/30 transition-colors">
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
        )}

        {/* ============================================================ */}
        {/* INFERENCE TAB */}
        {/* ============================================================ */}
        {activeTab === 'inference' && (
          <>
            {/* Model selector for inference */}
            {exportedModels.length > 0 && !activeModelDirName && (
              <Card className="animate-fade-in-up relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                <CardContent className="p-6 md:p-7 space-y-3">
                  <label className="text-[10px] font-semibold text-muted-foreground block uppercase tracking-wider">Select a model for inference</label>
                  <NexusSelect
                    value={selectedExistingModel}
                    onChange={v => setSelectedExistingModel(v)}
                    icon={<Layers className="h-4 w-4" />}
                    placeholder="Select an exported or finetuned model"
                    options={existingModelOptions}
                    maxHeight={200}
                  />
                </CardContent>
              </Card>
            )}

            {activeModelDirName ? (
              <div className="space-y-4 md:space-y-5">
                {/* Image Input */}
                <div className="space-y-4 md:space-y-5">
                  <Card className="animate-fade-in-up relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                    <CardHeader className="border-b border-border/40">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-amber-400/10 flex items-center justify-center">
                          <ImagePlus className="h-3.5 w-3.5 text-amber-400" />
                        </div>
                        Inference Playground
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 md:p-7 pt-6 space-y-4">
                      {/* Drop zone */}
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-border/50 hover:border-amber-400/50 hover:bg-accent/30'}`}
                      >
                        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" onChange={handleFileChange} className="hidden" />
                        {uploading ? <Loader2 className="h-8 w-8 text-amber-400 animate-spin mx-auto mb-2" /> : <ImagePlus className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />}
                        <p className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Drop an image here or click to upload'}</p>
                        <p className="text-[10px] text-muted-foreground/50 mt-1">JPG, PNG, WebP, BMP</p>
                      </div>

                      {uploadedImagePreview && (
                        <div className="rounded-xl overflow-hidden border border-border/40">
                          <img src={uploadedImagePreview} alt="Preview" className="w-full h-auto max-h-48 object-contain bg-black/20" />
                        </div>
                      )}

                      {/* Sliders */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><SlidersHorizontal className="h-3 w-3" /> Confidence</label>
                          <span className="text-xs font-mono text-amber-400">{confidence.toFixed(2)}</span>
                        </div>
                        <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={e => setConfidence(Number(e.target.value))} className="w-full accent-amber-400" />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><SlidersHorizontal className="h-3 w-3" /> IoU Threshold</label>
                          <span className="text-xs font-mono text-amber-400">{iou.toFixed(2)}</span>
                        </div>
                        <input type="range" min={0} max={1} step={0.05} value={iou} onChange={e => setIou(Number(e.target.value))} className="w-full accent-amber-400" />
                      </div>

                      {/* Model selector */}
                      {exportedModels.length > 0 && (
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Active Model</label>
                          <NexusSelect value={selectedExistingModel} onChange={v => setSelectedExistingModel(v)} icon={<Layers className="h-4 w-4" />} placeholder="Change model" options={existingModelOptions} maxHeight={200} />
                        </div>
                      )}

                      <Button size="lg" onClick={runInference} disabled={!canInfer} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 text-white h-12">
                        {inferring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                        {inferring ? 'Running...' : 'Run Inference'}
                      </Button>

                      {inferenceError && <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">{inferenceError}</div>}
                    </CardContent>
                  </Card>
                </div>

                {/* Results */}
                <div className="space-y-4 md:space-y-5">
                  {inferenceResult ? (
                    <>
                      <Card className="animate-fade-in-up overflow-hidden border-amber-400/20">
                        <div className="h-px w-full bg-gradient-to-r from-amber-400 to-orange-400" />
                        <CardContent className="p-4">
                          <img src={`data:image/jpeg;base64,${inferenceResult.annotatedImage}`} alt="Detection result" className="w-full h-auto rounded-lg" />
                        </CardContent>
                      </Card>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="default" className="bg-amber-400/15 text-amber-400 border-amber-400/30">{inferenceResult.inferenceTimeMs}ms total</Badge>
                        <Badge variant="outline">Pre: {inferenceResult.preprocessMs}ms</Badge>
                        <Badge variant="outline">Infer: {inferenceResult.inferenceMs}ms</Badge>
                        <Badge variant="outline">Post: {inferenceResult.postprocessMs}ms</Badge>
                        <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{inferenceResult.detectionCount} detections</Badge>
                      </div>

                      {inferenceResult.detections.length > 0 && (
                        <Card className="animate-fade-in-up overflow-hidden">
                          <CardHeader className="border-b border-border/40">
                            <CardTitle className="text-sm">Detections</CardTitle>
                          </CardHeader>
                          <CardContent className="p-0 max-h-80 overflow-y-auto">
                            {[...inferenceResult.detections].sort((a, b) => b.confidence - a.confidence).map((det, i) => {
                              const uniqueClasses = Array.from(new Set(inferenceResult.detections.map(d => d.class)));
                              const classIndex = uniqueClasses.indexOf(det.class);
                              const color = CLASS_COLORS[classIndex % CLASS_COLORS.length];
                              const confPct = Math.round(det.confidence * 100);
                              return (
                                <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0">
                                  <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                  <span className="text-sm font-semibold min-w-[80px]">{det.class}</span>
                                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all" style={{ width: `${confPct}%`, background: confPct > 70 ? 'var(--success)' : confPct > 40 ? '#f59e0b' : 'var(--destructive)' }} />
                                  </div>
                                  <span className="text-xs font-mono text-muted-foreground min-w-[36px] text-right">{confPct}%</span>
                                  <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:block">[{det.bbox.map(v => Math.round(v)).join(', ')}]</span>
                                </div>
                              );
                            })}
                          </CardContent>
                        </Card>
                      )}

                      {/* Deploy */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          size="lg"
                          className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0 text-white"
                          onClick={() => {
                            sessionStorage.setItem('nexus-vision-model', JSON.stringify({ dirName: activeModelDirName, modelFile: activeModelFile, task: activeModelTask, format: activeModelFormat, precision: selectedPrecision }));
                            router.push('/deploy');
                          }}
                        >
                          <Rocket className="h-4 w-4 mr-2" />Deploy<ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Card className="animate-fade-in-up relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                      <CardContent className="p-8 md:p-10 text-center">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 shadow-sm shadow-amber-400/10 flex items-center justify-center mx-auto mb-5">
                          <ImagePlus className="h-7 w-7 text-amber-400" />
                        </div>
                        <h2 className="text-lg font-bold mb-2">Test Your Model</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                          Upload an image and run inference to see detections and segmentation masks in real-time.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            ) : (
              <Card className="animate-fade-in-up relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 via-amber-400/60 to-transparent" />
                <CardContent className="p-8 md:p-10 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 shadow-sm shadow-amber-400/10 flex items-center justify-center mx-auto mb-5">
                    <Eye className="h-7 w-7 text-amber-400" />
                  </div>
                  <h2 className="text-lg font-bold mb-2">No Model Selected</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                    Export a model from the Export tab or select an existing model to start inference.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
