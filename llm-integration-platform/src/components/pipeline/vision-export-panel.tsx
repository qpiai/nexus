'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import { useNotifications } from '@/components/notifications';
import {
  Play, Loader2, CheckCircle2, AlertCircle, Eye, Layers, Cpu,
  RotateCcw, Download, Rocket, ArrowRight, Target,
} from 'lucide-react';
import { SUPPORTED_VISION_MODELS, VISION_EXPORT_FORMATS } from '@/lib/constants';
import type { VisionTask } from '@/lib/types';

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

interface VisionExportPanelProps {
  onSwitchTab?: (tab: string) => void;
  onModelExported?: (dirName: string, modelFile: string | null, task: string, format: string) => void;
}

export function VisionExportPanel({ onSwitchTab, onModelExported }: VisionExportPanelProps) {
  const router = useRouter();
  const { addNotification } = useNotifications();

  // Task filter
  const [taskFilter, setTaskFilter] = useState<VisionTask>('detect');

  // Export state
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

  // Active model for passing to inference
  const [activeModelDirName, setActiveModelDirName] = useState<string | null>(null);
  const [activeModelFile, setActiveModelFile] = useState<string | null>(null);
  const [activeModelTask, setActiveModelTask] = useState<string>('detect');
  const [activeModelFormat, setActiveModelFormat] = useState<string>('onnx');

  // Agent recommendation & finetuned model
  const [agentRec, setAgentRec] = useState<string | null>(null);
  const [finetunedInfo, setFinetunedInfo] = useState<{ path: string; model: string; runDir: string } | null>(null);

  // Load agent recommendation and finetuned model info
  useEffect(() => {
    const rec = sessionStorage.getItem('nexus-vision-recommendation');
    if (rec) {
      setAgentRec(rec);
      const parts = rec.split('|').map(s => s.trim());
      if (parts.length >= 4) {
        // Pre-select based on recommendation
        const modelName = parts[0];
        const task = parts[1] as VisionTask;
        const format = parts[2];
        const precision = parts[3];

        if (task === 'detect' || task === 'segment') setTaskFilter(task);
        const matchModel = SUPPORTED_VISION_MODELS.find(m => m.name === modelName);
        if (matchModel && !selectedModel) setSelectedModel(matchModel.modelId);
        const matchFormat = VISION_EXPORT_FORMATS.find(f => f.id === format);
        if (matchFormat) setSelectedFormat(format);
        if (precision) setSelectedPrecision(precision);
      }
    }

    const finetuned = sessionStorage.getItem('nexus-vision-finetuned');
    if (finetuned) {
      try { setFinetunedInfo(JSON.parse(finetuned)); } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load exported models
  useEffect(() => {
    fetch('/api/vision/models')
      .then(r => r.json())
      .then(data => setExportedModels(data.models || []))
      .catch(() => {});
  }, [exportDone]);

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
                  const pathParts = (data.output_path as string).split('/');
                  const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
                  setActiveModelDirName(dirName);
                  setActiveModelFile(null);
                  setActiveModelTask(selectedModel.includes('-seg') ? 'segment' : 'detect');
                  setActiveModelFormat(selectedFormat);
                  onModelExported?.(dirName, null, selectedModel.includes('-seg') ? 'segment' : 'detect', selectedFormat);
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
  }, [selectedModel, selectedFormat, selectedPrecision, imgSize, addNotification, onModelExported]);

  const canExport = selectedModel && selectedFormat && !exporting;

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

      {/* Finetuned Model Badge */}
      {finetunedInfo && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-pink-500/5 border border-pink-500/20 animate-fade-in-up">
          <CheckCircle2 className="h-4 w-4 text-pink-400 shrink-0" />
          <span className="text-xs text-pink-400 font-semibold">Finetuned model available:</span>
          <span className="text-xs text-muted-foreground">{finetunedInfo.model}</span>
        </div>
      )}

      {/* Configuration */}
      <div className="space-y-4 md:space-y-5">
        {/* Task Filter & Model */}
        <Card className="animate-fade-in-up relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-400 via-violet-400/60 to-transparent" />
          <CardHeader className="border-b border-white/[0.06]">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-400/10 flex items-center justify-center">
                <Eye className="h-3.5 w-3.5 text-violet-400" />
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
                        ? 'bg-violet-400/15 text-violet-400 border border-violet-400/30 shadow-sm'
                        : 'bg-accent/50 text-muted-foreground border border-white/[0.06] hover:bg-accent hover:border-white/[0.1]'
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
          <CardHeader className="border-b border-white/[0.06]">
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
                <input type="number" value={imgSize} onChange={e => setImgSize(Number(e.target.value))} min={128} max={1280} step={32} disabled={exporting} className="w-full h-10 rounded-xl border border-white/[0.06] bg-[var(--input-bg)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400/50 disabled:opacity-50" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Export Button */}
        {!exporting && !exportDone && (
          <Button size="lg" onClick={startExport} disabled={!canExport} className="w-full bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 border-0 text-white px-8 h-12">
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
          <Card className={`animate-fade-in-up overflow-hidden ${exportDone ? 'border-emerald-500/20' : exportError && !exportDone ? 'border-destructive/20' : 'border-violet-400/20'}`}>
            <div className={`h-px w-full ${exportDone ? 'bg-emerald-500' : exportError && !exportDone ? 'bg-destructive' : 'bg-gradient-to-r from-violet-400 to-purple-400'}`} />
            <CardHeader className="border-b border-white/[0.06]">
              <CardTitle className="text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {exporting && <div className="h-7 w-7 rounded-lg bg-violet-400/10 flex items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" /></div>}
                  {exportDone && <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /></div>}
                  {exportError && !exportDone && <div className="h-7 w-7 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-3.5 w-3.5 text-destructive" /></div>}
                  <span>Export Progress</span>
                </div>
                <span className={`text-lg font-bold ${exportDone ? 'text-emerald-400' : 'text-violet-400'}`}>{Math.round(exportProgress * 100)}%</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 md:p-7 pt-6 space-y-4">
              <div className={`w-full bg-muted rounded-full h-2.5 overflow-hidden ${exporting ? 'animate-progress-glow' : ''}`}>
                <div className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden" style={{ width: `${exportProgress * 100}%`, background: exportError && !exportDone ? 'var(--destructive)' : exportDone ? 'var(--success)' : 'linear-gradient(90deg, #8b5cf6, #a855f7)' }}>
                  {exporting && <div className="absolute inset-0 animate-shimmer" />}
                </div>
              </div>
              <div className="bg-accent/50 rounded-xl p-4 max-h-80 overflow-y-auto font-mono text-xs space-y-1 border border-white/[0.06]">
                {exportLogs.map((log, i) => (
                  <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'complete' ? 'text-emerald-400 font-semibold' : log.type === 'info' ? 'text-violet-400' : 'text-muted-foreground/80'}>
                    <span className="text-muted-foreground/40 mr-2 select-none">{log.progress !== undefined ? `[${Math.round(log.progress * 100)}%]` : '[---]'}</span>
                    {log.message}
                  </div>
                ))}
                {exporting && <div className="flex items-center gap-2 text-violet-400"><div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />Exporting...</div>}
              </div>
              {exportDone && (
                <div className="space-y-3 animate-celebrate">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 animate-success-ring" />
                    <div className="text-sm">
                      <span className="font-semibold text-emerald-400">Export Complete</span>
                      {exportedSize && <span className="text-muted-foreground ml-2">{exportedSize} MB</span>}
                    </div>
                  </div>
                  <Button
                    onClick={() => onSwitchTab?.('inference')}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 border-0 text-white"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Test with Inference
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="animate-fade-in-up relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-400 via-violet-400/60 to-transparent" />
            <CardContent className="p-8 md:p-10 text-center">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-400/20 to-violet-400/5 shadow-sm shadow-violet-400/10 flex items-center justify-center mx-auto mb-5">
                <Layers className="h-7 w-7 text-violet-400" />
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
              className="flex-1 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 border-0 text-white"
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
  );
}
