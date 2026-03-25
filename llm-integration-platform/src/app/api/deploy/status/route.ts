import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface DeploymentRecord {
  id: string;
  userId?: string;
  model: string;
  method: string;
  target: string;
  status: string;
  createdAt: number;
  logs: { timestamp: number; message: string; level: string }[];
  config: Record<string, unknown>;
  port?: number;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, DeploymentRecord> | undefined;

  if (!deployments) {
    return NextResponse.json({ error: 'No deployments found' }, { status: 404 });
  }

  if (id) {
    const dep = deployments.get(id);
    if (!dep || (dep.userId && dep.userId !== userId)) {
      return NextResponse.json({ error: `Deployment ${id} not found` }, { status: 404 });
    }
    return NextResponse.json(dep);
  }

  // Return user's deployments
  const all = Array.from(deployments.values())
    .filter(d => !d.userId || d.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ deployments: all });
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing deployment id' }, { status: 400 });
  }

  const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, DeploymentRecord> | undefined;

  if (!deployments) {
    return NextResponse.json({ error: 'No deployments found' }, { status: 404 });
  }

  const dep = deployments.get(id);
  if (!dep || (dep.userId && dep.userId !== userId)) {
    return NextResponse.json({ error: `Deployment ${id} not found` }, { status: 404 });
  }

  dep.status = 'stopped';
  dep.logs.push({
    timestamp: Date.now(),
    message: 'Deployment stopped by user',
    level: 'info',
  });

  return NextResponse.json({ message: `Deployment ${id} stopped` });
}
