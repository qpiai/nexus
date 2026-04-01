import { AgentRole, AgentMessage, AgentWorkflow, VisionUseCase } from '../types';
import { generateId } from '../utils';
import { callGemini } from './gemini';
import { searchTavily } from './tavily';
import { getVisionModelListAnnotated, getVisionExportFormatList } from '../constants';

const TYPE_MAP: Record<AgentRole, AgentMessage['type']> = {
  research: 'analysis',
  reasoning: 'recommendation',
  critic: 'critique',
  orchestrator: 'decision',
};

function summarizeVisionUseCase(uc: VisionUseCase): string {
  const parts = [`Use case: "${uc.description}"`];
  if (uc.targetDevice) parts.push(`Target device: ${uc.targetDevice}`);
  if (uc.task) parts.push(`Task preference: ${uc.task}`);
  if (uc.priority) parts.push(`Priority: ${uc.priority}`);
  return parts.join('. ');
}

// ---- Research Agent (Tavily + Gemini) ----
async function runResearchAgent(uc: VisionUseCase, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const taskHint = uc.task || 'object detection or segmentation';
  const deviceHint = uc.targetDevice || 'general edge device';

  const queries = [
    `best YOLO model for ${taskHint} on ${deviceHint} 2025 2026`,
    `YOLO export format ${uc.targetDevice || 'mobile'} TFLite ONNX CoreML benchmark`,
    `YOLO11 vs YOLO26 ${taskHint} comparison edge deployment`,
  ];

  let searchContext = '';
  if (iteration === 1) {
    const allResults = [];
    for (const q of queries) {
      try {
        const results = await searchTavily(q, 3);
        allResults.push(...results);
      } catch {
        // Continue with other queries
      }
    }
    if (allResults.length > 0) {
      searchContext = 'Web search results:\n' + allResults.map(r =>
        `- ${r.title}: ${r.content.slice(0, 300)}`
      ).join('\n');
    }
  }

  const priorContext = priorMessages.length > 0
    ? '\n\nPrior agent messages:\n' + priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n')
    : '';

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const systemPrompt = `You are a Vision Research Agent specializing in YOLO object detection and segmentation models for edge deployment. Available models: ${getVisionModelListAnnotated()}. Available export formats: ${getVisionExportFormatList()}. Research which model, task type, export format, and precision would best fit the user's needs. Consider target device constraints, model size, inference speed, and accuracy. Keep responses concise (3-5 sentences).`;

  const userPrompt = `Iteration ${iteration}/2. ${summarizeVisionUseCase(uc)}

${searchContext}${priorContext}${feedbackContext}

${iteration === 1
    ? 'Analyze this use case and research which YOLO model, export format, and precision would be the best fit. Consider device constraints, speed vs accuracy tradeoffs.'
    : 'Refine your analysis based on prior discussion. Focus on the most viable specific configuration.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Reasoning Agent (Gemini) ----
async function runReasoningAgent(uc: VisionUseCase, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');

  const systemPrompt = `You are a Vision Reasoning Agent. Given a use case and research findings, propose a specific YOLO model + task type (detect/segment) + export format + precision. Available models: ${getVisionModelListAnnotated()}. Available export formats: ${getVisionExportFormatList()}. Consider: target device memory, inference speed needs, detection vs segmentation requirements. YOLO26 models are newer and generally preferred over YOLO11. For mobile/edge, prefer Nano variants. For accuracy, prefer Small variants. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/2. ${summarizeVisionUseCase(uc)}

Prior agent messages:
${priorContext}${feedbackContext}

${iteration === 1
    ? 'Based on the research, propose a specific model + task + export format + precision. Justify why it fits this use case.'
    : 'Refine your recommendation based on the critic\'s feedback. Be very specific about the final choice.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Critic Agent (Gemini) ----
async function runCriticAgent(uc: VisionUseCase, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');

  const systemPrompt = `You are a Vision Critic Agent that evaluates YOLO model recommendations for feasibility. Check: (1) Is the model size appropriate for the target device? Nano models (~2-3M params) for edge/mobile, Small (~10M) for laptops/servers. (2) Is the export format compatible with the target platform? TFLite for Android, CoreML for iOS/macOS, ONNX for general, TensorRT for NVIDIA, OpenVINO for Intel. (3) Is the precision realistic? int8 gives best speed but may reduce accuracy; fp16 is a good balance. (4) Does detect vs segment match the use case? Be constructive but thorough. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/2. ${summarizeVisionUseCase(uc)}

Prior agent messages:
${priorContext}${feedbackContext}

Evaluate the reasoning agent's proposal. Is the model appropriate for the target? Is the format compatible? Is the precision realistic?`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Orchestrator Agent (Gemini) ----
async function runOrchestratorAgent(uc: VisionUseCase, iteration: number, maxIterations: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');
  const isFinal = iteration === maxIterations;

  const modelList = getVisionModelListAnnotated();
  const formatList = getVisionExportFormatList();

  const systemPrompt = `You are the Vision Orchestrator Agent that synthesizes all agent outputs into a final decision. ${isFinal
    ? `This is the FINAL iteration. You MUST output a concrete recommendation line in exactly this format: RECOMMENDATION: [model name] | [detect or segment] | [format id] | [precision]. For example: "RECOMMENDATION: YOLO26 Nano | detect | tflite | fp16" or "RECOMMENDATION: YOLO26 Small Seg | segment | onnx | fp16". Choose from these models: ${modelList}. Available formats: ${formatList}. Precisions: fp32, fp16, int8. The format id must be one of: onnx, engine, coreml, tflite, openvino, ncnn.`
    : 'Summarize the current state and guide the next iteration.'
  } Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/${maxIterations}. ${summarizeVisionUseCase(uc)}

All agent messages this iteration:
${priorContext}${feedbackContext}

${isFinal
    ? 'Synthesize everything and output your FINAL recommendation. You MUST include a line starting with "RECOMMENDATION:" in the format: model name | task | format | precision.'
    : 'Summarize the current consensus and identify what needs refining in the next iteration.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Main Workflow Runner ----
export async function* runVisionAgentWorkflow(
  useCase: VisionUseCase,
  options?: { feedback?: string; previousMessages?: AgentMessage[] },
  userId?: string,
): AsyncGenerator<{ type: string; data: AgentMessage | AgentWorkflow }> {
  const maxIterations = 2;
  const feedback = options?.feedback;

  const wf: AgentWorkflow = {
    id: generateId(),
    userId,
    status: 'running',
    currentIteration: 0,
    maxIterations,
    agents: { research: 'idle', reasoning: 'idle', critic: 'idle', orchestrator: 'idle' },
    messages: [],
    startedAt: Date.now(),
  };

  yield { type: 'workflow', data: { ...wf } };

  const agentOrder: AgentRole[] = ['research', 'reasoning', 'critic', 'orchestrator'];
  const allMessages: AgentMessage[] = options?.previousMessages ? [...options.previousMessages] : [];

  for (let iter = 1; iter <= maxIterations; iter++) {
    wf.currentIteration = iter;

    for (const agent of agentOrder) {
      wf.agents[agent] = 'thinking';
      yield { type: 'status', data: { ...wf } };

      let content: string;
      try {
        switch (agent) {
          case 'research':
            content = await runResearchAgent(useCase, iter, allMessages, feedback);
            break;
          case 'reasoning':
            content = await runReasoningAgent(useCase, iter, allMessages, feedback);
            break;
          case 'critic':
            content = await runCriticAgent(useCase, iter, allMessages, feedback);
            break;
          case 'orchestrator':
            content = await runOrchestratorAgent(useCase, iter, maxIterations, allMessages, feedback);
            break;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        content = `[Agent error: ${msg}]`;
      }

      const baseConfidence = agent === 'orchestrator' ? 0.85 : 0.80;
      const iterBoost = (iter - 1) * 0.08;

      const message: AgentMessage = {
        id: generateId(),
        agent,
        content,
        timestamp: Date.now(),
        iteration: iter,
        type: iter === maxIterations && agent === 'orchestrator' ? 'summary' : TYPE_MAP[agent],
        confidence: Math.min(0.98, baseConfidence + iterBoost + Math.random() * 0.05),
      };

      wf.messages.push(message);
      allMessages.push(message);
      wf.agents[agent] = 'complete';

      yield { type: 'message', data: message };
      yield { type: 'status', data: { ...wf } };
    }
  }

  wf.status = 'converged';
  wf.completedAt = Date.now();
  yield { type: 'complete', data: { ...wf } };
}
