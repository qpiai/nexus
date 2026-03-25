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
  port?: number;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';

  const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, DeploymentRecord> | undefined;

  if (!deployments) {
    return NextResponse.json({ deployments: [] });
  }

  const all = Array.from(deployments.values())
    .filter(d => !d.userId || d.userId === userId)
    .map(d => ({
      id: d.id,
      model: d.model,
      method: d.method,
      target: d.target,
      status: d.status,
      createdAt: d.createdAt,
      port: d.port,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({ deployments: all });
}
