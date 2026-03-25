import { NextRequest } from 'next/server';
import { getQuantizeState } from '@/lib/quantize-state';
import { getFinetuneState } from '@/lib/finetune-state';
import { getAgentState } from '@/lib/agent-state';
import { getVisionTrainState } from '@/lib/vision-train-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ActiveTask {
  type: string;
  label: string;
  progress: number;
  tab: string;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const tasks: ActiveTask[] = [];

  // Quantization
  const qState = getQuantizeState(userId);
  if (qState.running) {
    const method = qState.method || 'GGUF';
    const bits = qState.bits || 4;
    tasks.push({
      type: 'quantization',
      label: `${method} ${bits}-bit`,
      progress: qState.progress,
      tab: 'quantize',
    });
  }

  // Finetuning
  const fState = getFinetuneState(userId);
  if (fState.running) {
    const model = fState.model ? fState.model.split('/').pop() || fState.model : 'Model';
    tasks.push({
      type: 'finetune',
      label: model,
      progress: fState.progress,
      tab: 'finetune',
    });
  }

  // Agent workflow
  const aState = getAgentState(userId);
  if (aState.running) {
    tasks.push({
      type: 'agent',
      label: 'AI Analysis',
      progress: -1, // indeterminate
      tab: 'agent',
    });
  }

  // Vision training
  const vState = getVisionTrainState(userId);
  if (vState.running) {
    tasks.push({
      type: 'vision',
      label: vState.model || 'Vision Training',
      progress: vState.progress,
      tab: 'vision',
    });
  }

  return Response.json({ tasks });
}
