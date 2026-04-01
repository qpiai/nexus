'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NexusSelect } from '@/components/ui/nexus-select';
import { useNotifications } from '@/components/notifications';
import {
  Play, Loader2, ImagePlus, Layers, SlidersHorizontal,
  Eye, Rocket, ArrowRight,
} from 'lucide-react';

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

const CLASS_COLORS = [
  '#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
];

export function VisionInferencePanel() {
  const router = useRouter();
  const { addNotification } = useNotifications();

  // Model state
  const [exportedModels, setExportedModels] = useState<ExportedModel[]>([]);
  const [selectedExistingModel, setSelectedExistingModel] = useState('');
  const [activeModelDirName, setActiveModelDirName] = useState<string | null>(null);
  const [activeModelFile, setActiveModelFile] = useState<string | null>(null);
  const [activeModelTask, setActiveModelTask] = useState<string>('detect');
  const [activeModelFormat, setActiveModelFormat] = useState<string>('onnx');

  // Image state
  const [uploadedImageFilename, setUploadedImageFilename] = useState<string | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inference state
  const [confidence, setConfidence] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [inferring, setInferring] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [selectedPrecision] = useState('fp16');

  // Load exported models
  useEffect(() => {
    fetch('/api/vision/models')
      .then(r => r.json())
      .then(data => {
        const models = data.models || [];
        setExportedModels(models);
        // Auto-select most recent model if none selected
        if (models.length > 0 && !activeModelDirName) {
          const latest = models[models.length - 1];
          setSelectedExistingModel(latest.dirName);
          setActiveModelDirName(latest.dirName);
          setActiveModelFile(latest.modelFile);
          setActiveModelTask(latest.task);
          setActiveModelFormat(latest.format);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle model selection
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

  // ---- Handlers ----

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

  const canInfer = activeModelDirName && uploadedImageFilename && !inferring;

  const existingModelOptions = exportedModels.map(m => ({
    value: m.dirName,
    label: `${m.name} (${m.format.toUpperCase()} ${m.precision})`,
    description: `${m.sizeMB} MB — ${m.task}`,
  }));

  return (
    <>
      {/* Model selector for inference */}
      {exportedModels.length > 0 && !activeModelDirName && (
        <Card className="animate-fade-in-up relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-400 via-emerald-400/60 to-transparent" />
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
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-400 via-emerald-400/60 to-transparent" />
              <CardHeader className="border-b border-white/[0.06]">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-emerald-400/10 flex items-center justify-center">
                    <ImagePlus className="h-3.5 w-3.5 text-emerald-400" />
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
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? 'border-emerald-400 bg-emerald-400/5' : 'border-white/[0.06] hover:border-emerald-400/50 hover:bg-accent/30'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" onChange={handleFileChange} className="hidden" />
                  {uploading ? <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-2" /> : <ImagePlus className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />}
                  <p className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Drop an image here or click to upload'}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">JPG, PNG, WebP, BMP</p>
                </div>

                {uploadedImagePreview && (
                  <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                    <img src={uploadedImagePreview} alt="Preview" className="w-full h-auto max-h-48 object-contain bg-black/20" />
                  </div>
                )}

                {/* Sliders */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><SlidersHorizontal className="h-3 w-3" /> Confidence</label>
                    <span className="text-xs font-mono text-emerald-400">{confidence.toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={e => setConfidence(Number(e.target.value))} className="w-full accent-emerald-400" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><SlidersHorizontal className="h-3 w-3" /> IoU Threshold</label>
                    <span className="text-xs font-mono text-emerald-400">{iou.toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={iou} onChange={e => setIou(Number(e.target.value))} className="w-full accent-emerald-400" />
                </div>

                {/* Model selector */}
                {exportedModels.length > 0 && (
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2.5 block uppercase tracking-wider">Active Model</label>
                    <NexusSelect value={selectedExistingModel} onChange={v => setSelectedExistingModel(v)} icon={<Layers className="h-4 w-4" />} placeholder="Change model" options={existingModelOptions} maxHeight={200} />
                  </div>
                )}

                <Button size="lg" onClick={runInference} disabled={!canInfer} className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 border-0 text-white h-12">
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
                <Card className="animate-fade-in-up overflow-hidden border-emerald-400/20">
                  <div className="h-px w-full bg-gradient-to-r from-emerald-400 to-teal-400" />
                  <CardContent className="p-4">
                    <img src={`data:image/jpeg;base64,${inferenceResult.annotatedImage}`} alt="Detection result" className="w-full h-auto rounded-lg" />
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="default" className="bg-emerald-400/15 text-emerald-400 border-emerald-400/30">{inferenceResult.inferenceTimeMs}ms total</Badge>
                  <Badge variant="outline">Pre: {inferenceResult.preprocessMs}ms</Badge>
                  <Badge variant="outline">Infer: {inferenceResult.inferenceMs}ms</Badge>
                  <Badge variant="outline">Post: {inferenceResult.postprocessMs}ms</Badge>
                  <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{inferenceResult.detectionCount} detections</Badge>
                </div>

                {inferenceResult.detections.length > 0 && (
                  <Card className="animate-fade-in-up overflow-hidden">
                    <CardHeader className="border-b border-white/[0.06]">
                      <CardTitle className="text-sm">Detections</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 max-h-80 overflow-y-auto">
                      {[...inferenceResult.detections].sort((a, b) => b.confidence - a.confidence).map((det, i) => {
                        const uniqueClasses = Array.from(new Set(inferenceResult.detections.map(d => d.class)));
                        const classIndex = uniqueClasses.indexOf(det.class);
                        const color = CLASS_COLORS[classIndex % CLASS_COLORS.length];
                        const confPct = Math.round(det.confidence * 100);
                        return (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.03] last:border-0">
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
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 border-0 text-white"
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
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-400 via-emerald-400/60 to-transparent" />
                <CardContent className="p-8 md:p-10 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-400/5 shadow-sm shadow-emerald-400/10 flex items-center justify-center mx-auto mb-5">
                    <ImagePlus className="h-7 w-7 text-emerald-400" />
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
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-400 via-emerald-400/60 to-transparent" />
          <CardContent className="p-8 md:p-10 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-400/5 shadow-sm shadow-emerald-400/10 flex items-center justify-center mx-auto mb-5">
              <Eye className="h-7 w-7 text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold mb-2">No Model Selected</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              Export a model from the Export tab or select an existing model to start inference.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
