import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// In-memory deployment registry
interface DeploymentRecord {
  id: string;
  userId: string;
  model: string;
  method: string;
  target: string;
  status: 'building' | 'deploying' | 'running' | 'stopped' | 'error';
  createdAt: number;
  logs: { timestamp: number; message: string; level: string }[];
  config: Record<string, unknown>;
  port?: number;
}

// Global store (persists across requests in dev)
const deployments: Map<string, DeploymentRecord> = (
  (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, DeploymentRecord>
) || new Map();
(globalThis as Record<string, unknown>).__nexus_deployments = deployments;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { model, method, target, config = {} } = body;

  if (!model || !target) {
    return NextResponse.json(
      { error: 'Missing model or target' },
      { status: 400 }
    );
  }

  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';

  // Check user dir first, then legacy root
  const userOutputDir = path.resolve(process.cwd(), 'output', userId);
  const rootOutputDir = path.resolve(process.cwd(), 'output');
  let modelPath = path.join(userOutputDir, model);
  if (!fs.existsSync(modelPath)) {
    modelPath = path.join(rootOutputDir, model);
  }

  if (!fs.existsSync(modelPath)) {
    return NextResponse.json(
      { error: `Model not found: ${model}` },
      { status: 404 }
    );
  }

  const id = randomUUID().slice(0, 8);
  const port = 8080 + deployments.size;

  const deployment: DeploymentRecord = {
    id,
    userId,
    model,
    method: method || (model.endsWith('.gguf') ? 'GGUF' : model.includes('-mlx-') ? 'MLX' : model.includes('-gptq-') ? 'GPTQ' : model.includes('-bitnet-') ? 'BitNet' : 'AWQ'),
    target,
    status: 'building',
    createdAt: Date.now(),
    logs: [
      { timestamp: Date.now(), message: `Deployment ${id} initiated`, level: 'info' },
      { timestamp: Date.now(), message: `Target: ${target}`, level: 'info' },
      { timestamp: Date.now(), message: `Model: ${model}`, level: 'info' },
    ],
    config: {
      ...config,
      replicas: config.replicas || 1,
      maxConcurrent: config.maxConcurrent || 4,
      healthCheckInterval: config.healthCheckInterval || 30,
    },
    port,
  };

  deployments.set(id, deployment);

  // Simulate deployment lifecycle
  simulateDeployment(deployment);

  return NextResponse.json({
    id: deployment.id,
    status: deployment.status,
    port: deployment.port,
    message: `Deployment ${id} started for ${target}`,
  });
}

function simulateDeployment(dep: DeploymentRecord) {
  // Stage 1: Building (2s)
  setTimeout(() => {
    if (dep.status === 'building') {
      dep.logs.push({
        timestamp: Date.now(),
        message: 'Container image built successfully',
        level: 'info',
      });
      dep.status = 'deploying';
      dep.logs.push({
        timestamp: Date.now(),
        message: `Deploying to ${dep.target}...`,
        level: 'info',
      });
    }
  }, 2000);

  // Stage 2: Deploying -> Running (4s)
  setTimeout(() => {
    if (dep.status === 'deploying') {
      dep.logs.push({
        timestamp: Date.now(),
        message: 'Health check passed',
        level: 'info',
      });
      dep.logs.push({
        timestamp: Date.now(),
        message: `Service available on port ${dep.port}`,
        level: 'info',
      });
      dep.status = 'running';
    }
  }, 4000);
}
