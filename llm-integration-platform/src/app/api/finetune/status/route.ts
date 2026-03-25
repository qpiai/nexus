import { NextRequest } from 'next/server';
import { getFinetuneState } from '@/lib/finetune-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const state = getFinetuneState(userId);

  return Response.json({
    running: state.running,
    model: state.model,
    dataset: state.dataset,
    finetuningType: state.finetuningType,
    trainingMode: state.trainingMode,
    progress: state.progress,
    logs: state.logs,
    lossData: state.lossData,
    error: state.error,
    done: state.done,
    outputDir: state.outputDir,
    finalResult: state.finalResult,
  });
}
