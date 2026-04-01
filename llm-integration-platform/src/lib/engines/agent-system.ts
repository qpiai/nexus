import { AgentRole, AgentMessage, AgentWorkflow, DeviceInput } from '../types';
import { generateId } from '../utils';
import { callGemini } from './gemini';
import { searchTavily } from './tavily';
import { getModelNameListAnnotated, RAM_SAFETY_FACTOR } from '../constants';
import { scoreAllModels, formatScoredModelsForPrompt } from '../model-scoring';

const TYPE_MAP: Record<AgentRole, AgentMessage['type']> = {
  research: 'analysis',
  reasoning: 'recommendation',
  critic: 'critique',
  orchestrator: 'decision',
};

function isAppleSilicon(device: DeviceInput): boolean {
  const name = (device.deviceName + ' ' + (device.gpuInfo || '')).toLowerCase();
  return /\b(m[1-9]\b|m\d+ (pro|max|ultra)|apple silicon|mac|macbook|imac|mac mini|mac pro|mac studio|iphone|ipad)\b/i.test(name);
}

function deviceSummary(device: DeviceInput): string {
  const usableRAM = (device.ramGB * RAM_SAFETY_FACTOR).toFixed(1);
  const appleSilicon = isAppleSilicon(device);
  return `Device: ${device.deviceName}, RAM: ${device.ramGB}GB (usable for model: ${usableRAM}GB after ${Math.round((1 - RAM_SAFETY_FACTOR) * 100)}% safety margin), GPU: ${device.gpuInfo || 'None'}, Storage: ${device.storageGB}GB, Type: ${device.deviceType}${appleSilicon ? ', Platform: Apple Silicon (MLX-compatible)' : ''}`;
}

// ---- Research Agent (Tavily + Gemini) ----
async function runResearchAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string, scoredContext?: string): Promise<string> {
  const appleSilicon = isAppleSilicon(device);
  const queries = [
    `best quantized LLM for ${device.deviceName} ${device.ramGB}GB RAM ${device.deviceType}`,
    `LLM quantization GGUF AWQ${appleSilicon ? ' MLX' : ''} performance ${device.ramGB}GB RAM ${device.gpuInfo || 'CPU only'} 2025 2026`,
    appleSilicon
      ? `MLX Apple Silicon on-device LLM inference ${device.deviceName} ${device.ramGB}GB 2025`
      : `small language model ${device.deviceType} device ${device.ramGB}GB memory recommendation`,
  ];

  // Only search on first iteration
  let searchContext = '';
  if (iteration === 1) {
    const allResults = [];
    for (const q of queries) {
      try {
        const results = await searchTavily(q, 3);
        allResults.push(...results);
      } catch {
        // Continue with other queries if one fails
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

  const systemPrompt = `You are a Research Agent specializing in LLM quantization and edge deployment. Your role is to analyze hardware capabilities and research the best quantized model options. Be specific about model names, quantization methods (GGUF, AWQ, FP16, or MLX), and bit precisions (2-bit, 3-bit, 4-bit, 5-bit, 8-bit, or 16-bit FP16 for no quantization). IMPORTANT: Prefer the LATEST version of each model family — e.g., Qwen 3.5 over Qwen 3, Gemma 3n/3 over Gemma 2, SmolLM3 over SmolLM2. Newer models have better performance per parameter. For Apple Silicon devices (macOS arm64, iPhone, iPad), strongly prefer MLX — it uses unified memory and Metal GPU for optimal performance on M-series and A-series chips. IMPORTANT: MLX is ONLY available on Apple Silicon devices — NEVER recommend MLX for Linux, Windows, or non-Apple hardware. FP16 (full precision, no quantization) is a good choice for small models (under ~2B params) when the device has plenty of RAM — it provides maximum quality. IMPORTANT: Only ${Math.round(RAM_SAFETY_FACTOR * 100)}% of device RAM is usable for the model — the rest is reserved for OS and background processes. If the user mentions vision, images, camera, or visual understanding, recommend a VLM (Vision-Language Model) like Qwen 2.5 VL, SmolVLM, or Gemma 3 Vision. You have access to PRE-COMPUTED model fit scores below. These are deterministic calculations based on the device's actual hardware — use them as ground truth for memory fit and speed estimates. Your role is to VALIDATE and ENRICH these scores with web search context (newer benchmarks, known issues, community feedback). Do not contradict the memory calculations. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const scoredSection = scoredContext ? `\n\n${scoredContext}\n` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}
${scoredSection}
${searchContext}${priorContext}${feedbackContext}

${iteration === 1
    ? 'Analyze this device and research which quantized LLMs would be the best fit. Consider RAM constraints, GPU availability, and device type. Use the pre-computed scores as ground truth.'
    : 'Refine your analysis based on prior discussion. Focus on the most viable specific model and quantization approach.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Reasoning Agent (Gemini) ----
async function runReasoningAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string, scoredContext?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');
  const modelList = getModelNameListAnnotated().join(', ');

  const systemPrompt = `You are a Reasoning Agent. You have PRE-COMPUTED model rankings below, ordered by composite score. These scores account for memory fit, estimated speed, model quality, and context length — all calculated from actual hardware specs. Your job: pick the BEST model from the top candidates, considering any nuances the scoring doesn't capture (e.g., specific task suitability, known quantization quality issues, community benchmarks from the Research Agent's findings). Prefer models with 'perfect' or 'good' fit levels. If the top-scored model is clearly best, recommend it. If multiple models are close, explain the trade-off. Output a SPECIFIC model + method + bits. When multiple versions exist, prefer the NEWEST. Models marked "(latest)" are preferred. Available models: ${modelList}. For Apple Silicon, prefer MLX. MLX is ONLY for Apple Silicon. CRITICAL: Model must fit within ${Math.round(RAM_SAFETY_FACTOR * 100)}% of device RAM. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';
  const scoredSection = scoredContext ? `\n${scoredContext}\n` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}
${scoredSection}
Prior agent messages:
${priorContext}${feedbackContext}

${iteration === 1
    ? 'Based on the pre-computed scores and research, propose a specific model + quantization method + bit precision. Justify why it fits this device.'
    : 'Refine your recommendation based on the critic\'s feedback. Be very specific about the final choice.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Critic Agent (Gemini) ----
async function runCriticAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string, scoredContext?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');

  const systemPrompt = `You are a Critic Agent. You have the SAME pre-computed model scores as the other agents. Your job: verify the Reasoning Agent's recommendation against the computed data. Check: (1) Does the recommended model appear in the scored list? What's its fit level and score? (2) Is there a HIGHER-scored model that the Reasoning Agent overlooked? (3) Are the memory estimates consistent? (The pre-computed scores use: mem = params × bpp + KV_cache + 0.5GB overhead, with ${Math.round(RAM_SAFETY_FACTOR * 100)}% RAM safety margin.) (4) Is the method appropriate for the platform? (MLX only on Apple Silicon.) If the recommendation aligns with the top-scored models, approve it. If not, explain why a different choice would be better. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';
  const scoredSection = scoredContext ? `\n${scoredContext}\n` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}
${scoredSection}
Prior agent messages:
${priorContext}${feedbackContext}

Evaluate the reasoning agent's proposal against the pre-computed scores. Does the model fit within ${(device.ramGB * RAM_SAFETY_FACTOR).toFixed(1)}GB usable RAM? Is the method appropriate for ${device.deviceType}?${isAppleSilicon(device) ? ' This is an Apple Silicon device — MLX should be preferred.' : ''}`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Orchestrator Agent (Gemini) ----
async function runOrchestratorAgent(device: DeviceInput, iteration: number, maxIterations: number, priorMessages: AgentMessage[], feedback?: string, scoredContext?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');
  const modelList = getModelNameListAnnotated().join(', ');

  const isFinal = iteration === maxIterations;

  const systemPrompt = `You are the Orchestrator Agent that synthesizes all agent outputs into a final decision. You have pre-computed model rankings. When multiple versions of the same model family exist, ALWAYS prefer the NEWEST version (e.g., Qwen 3.5 over Qwen 3, Gemma 3n/3 over Gemma 2, SmolLM3 over SmolLM2). ${isFinal
    ? `FINAL ITERATION. Pick the BEST model from the top of the ranked list unless agents have identified a compelling reason to deviate. You MUST output a concrete recommendation line in exactly this format: RECOMMENDATION: [bits]-bit [method] [model name]. For example: "RECOMMENDATION: 4-bit GGUF Qwen 3 0.6B" or "RECOMMENDATION: 4-bit MLX Qwen 3 0.6B" or "RECOMMENDATION: 16-bit FP16 SmolLM2 135M" (FP16 = no quantization, full quality). Choose from these models: ${modelList}. Methods: GGUF, AWQ, FP16, or MLX. Bits for GGUF: 2, 3, 4, 5, 8. Bits for AWQ: 4 or 8. Bits for FP16: 16 (always — it means full precision). Bits for MLX: 2, 3, 4, 5, 6, or 8. IMPORTANT: MLX is ONLY for Apple Silicon devices (M1/M2/M3/M4, Mac, iPhone, iPad) — NEVER recommend MLX for Linux or Windows. FP16 works on any platform but only practical for small models that fit in RAM at full size. The model must fit within ${Math.round(RAM_SAFETY_FACTOR * 100)}% of the device's RAM (safety margin).`
    : 'Summarize the current state and guide the next iteration.'
  } Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';
  const scoredSection = scoredContext ? `\n${scoredContext}\n` : '';

  const userPrompt = `Iteration ${iteration}/${maxIterations}. ${deviceSummary(device)}
${scoredSection}
All agent messages this iteration:
${priorContext}${feedbackContext}

${isFinal
    ? 'Synthesize everything and output your FINAL recommendation. You MUST include a line starting with "RECOMMENDATION:" followed by the bits, method, and model name.'
    : 'Summarize the current consensus and identify what needs refining in the next iteration.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Main Workflow Runner ----
export async function* runAgentWorkflow(
  device: DeviceInput,
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

  // Pre-compute model scores for this device
  const scoredModels = scoreAllModels(device, 'general');
  const scoredContext = formatScoredModelsForPrompt(scoredModels, 15);

  yield { type: 'workflow', data: { ...wf } };

  const agentOrder: AgentRole[] = ['research', 'reasoning', 'critic', 'orchestrator'];
  const allMessages: AgentMessage[] = options?.previousMessages ? [...options.previousMessages] : [];

  for (let iter = 1; iter <= maxIterations; iter++) {
    wf.currentIteration = iter;

    for (const agent of agentOrder) {
      // Set agent to thinking
      wf.agents[agent] = 'thinking';
      yield { type: 'status', data: { ...wf } };

      let content: string;
      try {
        switch (agent) {
          case 'research':
            content = await runResearchAgent(device, iter, allMessages, feedback, scoredContext);
            break;
          case 'reasoning':
            content = await runReasoningAgent(device, iter, allMessages, feedback, scoredContext);
            break;
          case 'critic':
            content = await runCriticAgent(device, iter, allMessages, feedback, scoredContext);
            break;
          case 'orchestrator':
            content = await runOrchestratorAgent(device, iter, maxIterations, allMessages, feedback, scoredContext);
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

  // Converge
  wf.status = 'converged';
  wf.completedAt = Date.now();
  yield { type: 'complete', data: { ...wf } };
}
