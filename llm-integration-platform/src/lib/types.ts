// ============================================================
// Core Types for LLM Integration Platform
// ============================================================

// --- User Types ---
export interface NexusUser {
  id: string;
  email: string;
  name: string;
  provider: 'local' | 'google';
  role: 'admin' | 'user';
  avatar?: string;
}

// --- Device Input (Nexus) ---
export interface DeviceInput {
  deviceName: string;
  ramGB: number;
  gpuInfo: string;
  storageGB: number;
  deviceType: 'mobile' | 'laptop' | 'desktop' | 'edge' | 'server';
  gpuVRAMGB?: number;
  cpuCores?: number;
}

// --- Hardware Types ---
export type DeviceClass = 'edge' | 'mobile' | 'laptop' | 'cloud';

export interface HardwareSpec {
  id: string;
  name: string;
  deviceClass: DeviceClass;
  cpu: {
    model: string;
    cores: number;
    threads: number;
    clockSpeed: number; // GHz
    architecture: string;
  };
  memory: {
    total: number; // GB
    type: string;
    bandwidth: number; // GB/s
  };
  gpu?: {
    model: string;
    vram: number; // GB
    computeUnits: number;
    tensorCores?: number;
  };
  storage: {
    type: string;
    capacity: number; // GB
    readSpeed: number; // MB/s
  };
  power: {
    tdp: number; // Watts
    batteryCapacity?: number; // mAh
  };
  networkBandwidth: number; // Mbps
  performanceScore: number; // 0-100
}

export interface HardwareAnalysis {
  spec: HardwareSpec;
  classification: DeviceClass;
  recommendedModels: string[];
  maxModelSize: number; // GB
  estimatedTokensPerSec: number;
  constraints: string[];
  optimizations: string[];
}

// --- Agent Types ---
export type AgentRole = 'research' | 'reasoning' | 'critic' | 'orchestrator';
export type AgentStatus = 'idle' | 'thinking' | 'complete' | 'error';

export interface AgentMessage {
  id: string;
  agent: AgentRole;
  content: string;
  timestamp: number;
  iteration: number;
  type: 'analysis' | 'recommendation' | 'critique' | 'decision' | 'summary';
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentWorkflow {
  id: string;
  userId?: string;
  status: 'pending' | 'running' | 'converged' | 'failed';
  currentIteration: number;
  maxIterations: number;
  agents: Record<AgentRole, AgentStatus>;
  messages: AgentMessage[];
  hardwareSpec?: HardwareSpec;
  targetModel?: string;
  finalRecommendation?: QuantizationConfig;
  startedAt?: number;
  completedAt?: number;
  scoredModels?: Array<{
    modelName: string;
    compositeScore: number;
    fitLevel: string;
    estimatedTPS: number;
    method: string;
    bitsPerWeight: number;
    estimatedMemoryGB: number;
  }>;
}

// --- Agent Run Request ---
export interface AgentRunRequest {
  device: DeviceInput;
  feedback?: string;
  previousMessages?: AgentMessage[];
}

// --- Quantization Types ---
export type QuantizationMethod = 'AWQ' | 'GGUF' | 'GPTQ' | 'VPTQ' | 'MLX';
export type PrecisionLevel = 'FP16' | 'INT8' | 'INT4' | 'INT3' | 'INT2' | 'MIXED';

export interface QuantizationConfig {
  id: string;
  method: QuantizationMethod;
  precision: PrecisionLevel;
  bitsPerWeight: number;
  groupSize: number;
  mixedPrecision: boolean;
  layerConfigs?: LayerConfig[];
  calibrationDataset?: string;
  targetDevice: DeviceClass;
}

export interface LayerConfig {
  layerName: string;
  layerType: string;
  precision: PrecisionLevel;
  bitsPerWeight: number;
}

export interface QuantizationEstimate {
  originalSize: number; // GB
  quantizedSize: number; // GB
  compressionRatio: number;
  estimatedQualityLoss: number; // percentage
  estimatedSpeedup: number; // multiplier
  memoryRequirement: number; // GB
  tokensPerSecEstimate: number;
}

export interface QuantizationPreset {
  id: string;
  name: string;
  description: string;
  method: QuantizationMethod;
  precision: PrecisionLevel;
  bitsPerWeight: number;
  groupSize: number;
  targetDevice: DeviceClass;
  tradeoff: 'quality' | 'balanced' | 'speed';
}

// --- Deployment Types ---
export type DeploymentStatus = 'pending' | 'building' | 'deploying' | 'running' | 'stopped' | 'error';

export interface Deployment {
  id: string;
  name: string;
  modelName: string;
  modelSize: number; // GB
  quantizationConfig: QuantizationConfig;
  hardwareSpec: HardwareSpec;
  status: DeploymentStatus;
  containerImage?: string;
  port?: number;
  createdAt: number;
  updatedAt: number;
  metrics?: DeploymentMetrics;
  logs: DeploymentLog[];
}

export interface DeploymentLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: string;
}

export interface DeploymentMetrics {
  tokensPerSec: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage?: number;
  gpuTemp?: number;
  powerDraw: number;
  uptime: number;
  requestsProcessed: number;
}

// --- Monitoring Types ---
export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  deploymentId: string;
  tokensPerSec: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  gpuTemp: number;
  powerDraw: number;
  requestsPerMin: number;
}

export interface Alert {
  id: string;
  deploymentId: string;
  type: 'warning' | 'critical' | 'info';
  metric: string;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface MonitoringThresholds {
  cpuUsage: { warning: number; critical: number };
  memoryUsage: { warning: number; critical: number };
  gpuTemp: { warning: number; critical: number };
  latencyMs: { warning: number; critical: number };
  tokensPerSec: { warning: number; critical: number };
}

// --- Playground Types ---
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metrics?: {
    tokensGenerated: number;
    generationTimeMs: number;
    tokensPerSec: number;
    promptTokens: number;
  };
}

// --- Finetuning Types ---
export type FinetuneType = 'lora' | 'qlora' | 'full';
export type DatasetFormat = 'alpaca' | 'sharegpt' | 'custom';
export type TrainingMode = 'sft' | 'grpo';
export type GRPORewardType = 'length' | 'correctness' | 'format' | 'custom';

export interface FinetuneConfig {
  id: string;
  model: string;
  finetuningType: FinetuneType;
  dataset: string;
  datasetFormat: DatasetFormat;
  epochs: number;
  batchSize: number;
  learningRate: number;
  loraRank: number;
  loraAlpha: number;
  maxSeqLength: number;
  mergeAdapters: boolean;
  trainingMode: TrainingMode;
  rewardType: GRPORewardType;
  numGenerations: number;
  grpoBeta: number;
}

export interface FinetuneProgress {
  epoch: number;
  totalEpochs: number;
  step: number;
  totalSteps: number;
  loss: number;
  learningRate: number;
  progress: number;
}

export interface FinetuneResult {
  modelPath: string;
  adapterPath?: string;
  baseModel: string;
  finetuningType: FinetuneType;
  dataset: string;
  finalLoss: number;
  totalTime: number;
  merged: boolean;
}

export interface DatasetInfo {
  name: string;
  path: string;
  format: DatasetFormat;
  samples: number;
  description?: string;
}

// --- System Types ---
export interface SystemOverview {
  totalDeployments: number;
  activeDeployments: number;
  totalModels: number;
  avgTokensPerSec: number;
  avgCpuUsage: number;
  avgMemoryUsage: number;
  totalAlerts: number;
  criticalAlerts: number;
  agentWorkflowsCompleted: number;
  uptime: number;
}

// ===== VISION TYPES =====
export type VisionTask = 'detect' | 'segment';
export type VisionExportFormat = 'onnx' | 'engine' | 'coreml' | 'tflite' | 'openvino' | 'ncnn';
export type VisionPrecision = 'fp32' | 'fp16' | 'int8';

export interface VisionModel {
  name: string;
  modelId: string;
  task: VisionTask;
  paramM: number;
  defaultImgSize: number;
  cocoMap?: number;
  description: string;
}

export interface DetectionResult {
  bbox: [number, number, number, number];
  class: string;
  confidence: number;
}

export interface VisionInferenceResult {
  detections: DetectionResult[];
  annotatedImage: string;
  inferenceTimeMs: number;
  preprocessMs: number;
  inferenceMs: number;
  postprocessMs: number;
  imageSize: [number, number];
  detectionCount: number;
}

// ===== VISION FINETUNING TYPES =====
export interface VisionDatasetInfo {
  name: string;
  path: string;
  format: 'yolo' | 'coco';
  numImages: number;
  numClasses: number;
  classes: string[];
  splits: { train: number; val: number; test?: number };
  yamlPath: string;
  preparedAt: string;
}

export interface VisionTrainConfig {
  model: string;         // e.g. "yolo26n.pt"
  dataset: string;       // path to data.yaml
  epochs: number;
  batchSize: number;
  imgSize: number;
  learningRate: number;
  optimizer: 'SGD' | 'Adam' | 'AdamW' | 'auto';
  freeze: number;        // number of layers to freeze (0 = none)
  augment: boolean;
  patience: number;      // early stopping patience (0 = disabled)
  resume: boolean;
}

export interface VisionTrainMetrics {
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

export interface VisionTrainResult {
  bestModelPath: string;
  lastModelPath: string;
  runDir: string;
  epochs: number;
  bestEpoch: number;
  bestMap50: number;
  bestMap5095: number;
  totalTime: number;
  classes: string[];
}

// --- Vision Agent Types ---
export interface VisionUseCase {
  description: string;          // "Detect cars in parking lot footage"
  targetDevice?: string;        // "Raspberry Pi", "iPhone 15", "NVIDIA Jetson"
  task?: VisionTask;            // Optional pre-filter: 'detect' | 'segment'
  priority?: 'speed' | 'accuracy' | 'balance';
}

export interface VisionAgentRunRequest {
  useCase: VisionUseCase;
  feedback?: string;
  previousMessages?: AgentMessage[];
}

// --- Nexus Agent Copilot Types ---

export type AgentChatRole = 'user' | 'assistant' | 'action';

export interface AgentChatMessage {
  id: string;
  role: AgentChatRole;
  content: string;
  timestamp: number;
  actions?: AgentActionResult[];
}

export interface AgentAction {
  tool: string;
  params: Record<string, unknown>;
}

export interface AgentActionResult {
  tool: string;
  params: Record<string, unknown>;
  success: boolean;
  result: unknown;
  duration: number;
}

// --- HuggingFace Dataset Metadata ---
export interface HFDatasetMeta {
  id: string;
  description: string;
  downloads: number;
  splits: Record<string, number>;
  features: string[];
  hasImages: boolean;
}

// --- Synthetic Data Generation Types ---
export type SyntheticFormat = 'alpaca' | 'sharegpt';

export interface AlpacaSample {
  instruction: string;
  input: string;
  output: string;
}

export interface ShareGPTMessage {
  from: 'human' | 'gpt';
  value: string;
}

export interface ShareGPTSample {
  conversations: ShareGPTMessage[];
}

export type SyntheticSample = AlpacaSample | ShareGPTSample;

export interface SyntheticDataConfig {
  topic: string;
  format: SyntheticFormat;
  count: number;
  preset?: string;
  customPrompt?: string;
}
