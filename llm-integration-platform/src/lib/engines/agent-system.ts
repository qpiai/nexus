import { AgentRole, AgentMessage, AgentWorkflow, DeviceInput } from '../types';
import { generateId } from '../utils';
import { callGemini } from './gemini';
import { searchTavily } from './tavily';
import { getModelNameListAnnotated, RAM_SAFETY_FACTOR } from '../constants';

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
async function runResearchAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
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

  const systemPrompt = `You are a Research Agent specializing in LLM quantization and edge deployment. Your role is to analyze hardware capabilities and research the best quantized model options. Be specific about model names, quantization methods (GGUF, AWQ, FP16, or MLX), and bit precisions (2-bit, 3-bit, 4-bit, 5-bit, 8-bit, or 16-bit FP16 for no quantization). IMPORTANT: Prefer the LATEST version of each model family — e.g., Qwen 3.5 over Qwen 3, Gemma 3n/3 over Gemma 2, SmolLM3 over SmolLM2. Newer models have better performance per parameter. For Apple Silicon devices (macOS arm64, iPhone, iPad), strongly prefer MLX — it uses unified memory and Metal GPU for optimal performance on M-series and A-series chips. IMPORTANT: MLX is ONLY available on Apple Silicon devices — NEVER recommend MLX for Linux, Windows, or non-Apple hardware. FP16 (full precision, no quantization) is a good choice for small models (under ~2B params) when the device has plenty of RAM — it provides maximum quality. IMPORTANT: Only ${Math.round(RAM_SAFETY_FACTOR * 100)}% of device RAM is usable for the model — the rest is reserved for OS and background processes. If the user mentions vision, images, camera, or visual understanding, recommend a VLM (Vision-Language Model) like Qwen 2.5 VL, SmolVLM, or Gemma 3 Vision. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}

${searchContext}${priorContext}${feedbackContext}

${iteration === 1
    ? 'Analyze this device and research which quantized LLMs would be the best fit. Consider RAM constraints, GPU availability, and device type.'
    : 'Refine your analysis based on prior discussion. Focus on the most viable specific model and quantization approach.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Reasoning Agent (Gemini) ----
async function runReasoningAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');
  const modelList = getModelNameListAnnotated().join(', ');

  const systemPrompt = `You are a Reasoning Agent that proposes specific quantization strategies. Given device specs and research findings, you must propose a SPECIFIC model name from this list: ${modelList}. When multiple versions of the same model family exist (e.g., Gemma 2 vs Gemma 3, Qwen 2.5 vs Qwen 3.5, SmolLM2 vs SmolLM3), ALWAYS prefer the NEWEST version as they have better performance per parameter. Models marked "(latest)" are the preferred choice within their family. Choose a SPECIFIC quantization method (AWQ, GGUF, FP16, or MLX) and bit precision (GGUF: 2, 3, 4, 5, 8 bit; AWQ: 4 or 8 bit; FP16: 16 bit — no quantization, full precision; MLX: 4 or 8 bit). For Apple Silicon (macOS arm64, iPhone, iPad), strongly prefer MLX — it leverages unified memory and Metal GPU for best performance. IMPORTANT: MLX is ONLY available on Apple Silicon — NEVER recommend MLX for Linux, Windows, or non-Apple hardware. FP16 (16-bit, no quantization) provides maximum quality — recommend it for small models (under ~2B params) when the device has plenty of RAM. CRITICAL: The model must fit within ${Math.round(RAM_SAFETY_FACTOR * 100)}% of the device's total RAM (safety margin for OS/background processes). Use this formula: model RAM ≈ (params_billions × bits) / 8 + 15% overhead. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}

Prior agent messages:
${priorContext}${feedbackContext}

${iteration === 1
    ? 'Based on the research, propose a specific model + quantization method + bit precision. Justify why it fits this device.'
    : 'Refine your recommendation based on the critic\'s feedback. Be very specific about the final choice.'
  }`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Critic Agent (Gemini) ----
async function runCriticAgent(device: DeviceInput, iteration: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');

  const systemPrompt = `You are a Critic Agent that evaluates quantization proposals for feasibility. Check: (1) Will the model fit within ${Math.round(RAM_SAFETY_FACTOR * 100)}% of the device's RAM? (the remaining ${Math.round((1 - RAM_SAFETY_FACTOR) * 100)}% is reserved for OS and other processes — this safety margin is mandatory). (2) Is the quantization method appropriate for the device type? For Apple Silicon devices, MLX is preferred over GGUF/AWQ. For non-Apple devices (Linux, Windows), MLX is NOT available — reject any MLX recommendation for non-Apple hardware. FP16 is valid for any platform but only practical for small models. (3) Are the performance estimates realistic? Use: model RAM ≈ (params_billions × bits) / 8 + 15% overhead. If FP16 (16-bit, no quantization) is proposed, verify the full-size model truly fits with safety margin. Be constructive but thorough. Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/2. ${deviceSummary(device)}

Prior agent messages:
${priorContext}${feedbackContext}

Evaluate the reasoning agent's proposal. Does the model fit within ${(device.ramGB * RAM_SAFETY_FACTOR).toFixed(1)}GB usable RAM (${Math.round(RAM_SAFETY_FACTOR * 100)}% of ${device.ramGB}GB total, with ${Math.round((1 - RAM_SAFETY_FACTOR) * 100)}% safety margin)? Is the method (GGUF vs AWQ vs MLX) appropriate for ${device.deviceType}?${isAppleSilicon(device) ? ' This is an Apple Silicon device — MLX should be preferred.' : ''}`;

  return callGemini(systemPrompt, userPrompt);
}

// ---- Orchestrator Agent (Gemini) ----
async function runOrchestratorAgent(device: DeviceInput, iteration: number, maxIterations: number, priorMessages: AgentMessage[], feedback?: string): Promise<string> {
  const priorContext = priorMessages.map(m => `[${m.agent}]: ${m.content}`).join('\n');
  const modelList = getModelNameListAnnotated().join(', ');

  const isFinal = iteration === maxIterations;

  const systemPrompt = `You are the Orchestrator Agent that synthesizes all agent outputs into a final decision. When multiple versions of the same model family exist, ALWAYS prefer the NEWEST version (e.g., Qwen 3.5 over Qwen 3, Gemma 3n/3 over Gemma 2, SmolLM3 over SmolLM2). ${isFinal
    ? `This is the FINAL iteration. You MUST output a concrete recommendation line in exactly this format: RECOMMENDATION: [bits]-bit [method] [model name]. For example: "RECOMMENDATION: 4-bit GGUF Qwen 3 0.6B" or "RECOMMENDATION: 4-bit MLX Qwen 3 0.6B" or "RECOMMENDATION: 16-bit FP16 SmolLM2 135M" (FP16 = no quantization, full quality). Choose from these models: ${modelList}. Methods: GGUF, AWQ, FP16, or MLX. Bits for GGUF: 2, 3, 4, 5, 8. Bits for AWQ: 4 or 8. Bits for FP16: 16 (always — it means full precision). Bits for MLX: 4 or 8. IMPORTANT: MLX is ONLY for Apple Silicon devices (M1/M2/M3/M4, Mac, iPhone, iPad) — NEVER recommend MLX for Linux or Windows. FP16 works on any platform but only practical for small models that fit in RAM at full size. The model must fit within ${Math.round(RAM_SAFETY_FACTOR * 100)}% of the device's RAM (safety margin).`
    : 'Summarize the current state and guide the next iteration.'
  } Keep responses concise (3-5 sentences).`;

  const feedbackContext = feedback ? `\n\nUser feedback from previous run: ${feedback}` : '';

  const userPrompt = `Iteration ${iteration}/${maxIterations}. ${deviceSummary(device)}

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
            content = await runResearchAgent(device, iter, allMessages, feedback);
            break;
          case 'reasoning':
            content = await runReasoningAgent(device, iter, allMessages, feedback);
            break;
          case 'critic':
            content = await runCriticAgent(device, iter, allMessages, feedback);
            break;
          case 'orchestrator':
            content = await runOrchestratorAgent(device, iter, maxIterations, allMessages, feedback);
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
