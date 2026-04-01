import { callGemini, callGeminiStream } from './gemini';
import { AgentAction, AgentActionResult, AgentChatMessage } from '../types';
import { getModelNameList, METHOD_BITS } from '../constants';
import { COOKIE_NAME } from '../auth';

// ---- Tool Definitions ----

interface ToolDef {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'DELETE' | 'FRONTEND';
  endpoint: string;
  params: Record<string, string>;
  sseStream?: boolean;
  statusEndpoint?: string;
}

const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'list_models',
    description: 'List all quantized/downloaded models available for chat inference',
    method: 'GET',
    endpoint: '/api/chat/models',
    params: {},
  },
  {
    name: 'quantize',
    description: 'Start quantizing a model. This is a long-running operation.',
    method: 'POST',
    endpoint: '/api/quantization/run',
    params: {
      model: 'Model name from catalog (e.g. "SmolLM2 135M", "SmolLM3 3B", "Qwen 3 0.6B", "Gemma 3 1B")',
      method: 'Quantization method: GGUF, AWQ, GPTQ, BitNet, MLX, or FP16',
      bits: 'Bit precision: 2, 3, 4, 5, 8, or 16',
    },
    sseStream: true,
    statusEndpoint: '/api/quantization/status',
  },
  {
    name: 'quantize_status',
    description: 'Get current quantization job status and progress',
    method: 'GET',
    endpoint: '/api/quantization/status',
    params: {},
  },
  {
    name: 'stop_quantize',
    description: 'Stop the currently running quantization job',
    method: 'POST',
    endpoint: '/api/quantization/stop',
    params: {},
  },
  {
    name: 'start_finetune',
    description: 'Start fine-tuning a model with a dataset',
    method: 'POST',
    endpoint: '/api/finetune/run',
    params: {
      model: 'HuggingFace model ID (e.g. "Qwen/Qwen2.5-0.5B-Instruct")',
      dataset: 'Dataset name (e.g. "yahma/alpaca-cleaned")',
      config: 'Optional config: {finetuningType: "qlora"|"lora"|"full", epochs: number, learningRate: number, batchSize: number}. Defaults are fine for most cases.',
    },
    sseStream: true,
    statusEndpoint: '/api/finetune/status',
  },
  {
    name: 'finetune_status',
    description: 'Get current fine-tuning job status and progress',
    method: 'GET',
    endpoint: '/api/finetune/status',
    params: {},
  },
  {
    name: 'stop_finetune',
    description: 'Stop the currently running fine-tuning job',
    method: 'POST',
    endpoint: '/api/finetune/stop',
    params: {},
  },
  {
    name: 'list_datasets',
    description: 'List uploaded training datasets',
    method: 'GET',
    endpoint: '/api/finetune/datasets',
    params: {},
  },
  {
    name: 'list_finetune_models',
    description: 'List trained LoRA models from fine-tuning',
    method: 'GET',
    endpoint: '/api/finetune/models',
    params: {},
  },
  {
    name: 'start_deployment',
    description: 'Deploy a model for serving',
    method: 'POST',
    endpoint: '/api/deploy/start',
    params: {
      modelName: 'Model to deploy',
      target: 'Deployment target: "cloud", "edge", or "mobile"',
    },
  },
  {
    name: 'list_deployments',
    description: 'List all active and past deployments',
    method: 'GET',
    endpoint: '/api/deploy/list',
    params: {},
  },
  {
    name: 'deployment_status',
    description: 'Get status of a specific deployment',
    method: 'GET',
    endpoint: '/api/deploy/status',
    params: { id: 'Deployment ID' },
  },
  {
    name: 'stop_deployment',
    description: 'Stop an active deployment',
    method: 'DELETE',
    endpoint: '/api/deploy/status',
    params: { id: 'Deployment ID' },
  },
  {
    name: 'vision_train',
    description: 'Start YOLO vision model training. Use list_vision_datasets first to find dataset paths.',
    method: 'POST',
    endpoint: '/api/vision/train',
    params: {
      model: 'YOLO model ID (e.g. "yolo26n.pt", "yolo26s.pt", "yolo11n.pt", "yolo26n-seg.pt", "yolo11n-seg.pt")',
      dataset: 'Full path to prepared dataset YAML (get from list_vision_datasets)',
      epochs: 'Training epochs (default: 50)',
    },
    sseStream: true,
    statusEndpoint: '/api/vision/train',
  },
  {
    name: 'list_vision_datasets',
    description: 'List prepared vision datasets',
    method: 'GET',
    endpoint: '/api/vision/dataset/list',
    params: {},
  },
  {
    name: 'list_vision_models',
    description: 'List trained/exported vision models',
    method: 'GET',
    endpoint: '/api/vision/models',
    params: {},
  },
  {
    name: 'vision_export',
    description: 'Export a trained vision model to a deployment format',
    method: 'POST',
    endpoint: '/api/vision/export',
    params: {
      runDir: 'Training run directory',
      format: 'Export format: onnx, engine, coreml, tflite, openvino, ncnn',
    },
  },
  {
    name: 'list_devices',
    description: 'List connected mobile/edge devices',
    method: 'GET',
    endpoint: '/api/mobile/register',
    params: {},
  },
  {
    name: 'active_tasks',
    description: 'Get all currently running tasks (quantization, finetune, agent, vision)',
    method: 'GET',
    endpoint: '/api/tasks/active',
    params: {},
  },
  {
    name: 'navigate',
    description: 'Navigate the user to a page in Nexus',
    method: 'FRONTEND',
    endpoint: '',
    params: {
      path: 'Page path: /, /pipeline, /pipeline?tab=quantize, /pipeline?tab=finetune, /pipeline?tab=agent, /chat, /vision, /deploy, /monitor',
    },
  },
];

// ---- System Prompt ----

function buildSystemPrompt(): string {
  const modelNames = getModelNameList();
  const toolDocs = TOOL_DEFINITIONS.map(t => {
    const paramList = Object.entries(t.params)
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join('\n');
    return `- **${t.name}**: ${t.description}${paramList ? '\n  Parameters:\n' + paramList : ''}`;
  }).join('\n');

  const methodBits = Object.entries(METHOD_BITS)
    .map(([m, bits]) => `- ${m}: ${(bits as number[]).join(', ')}-bit`)
    .join('\n');

  return `You are the Nexus Agent, an AI copilot for the QpiAI Nexus platform — an edge intelligence platform for optimizing, quantizing, fine-tuning, and deploying large language models across heterogeneous devices.

## Action Format
To execute a platform action, include EXACTLY this format in your response:
[ACTION:tool_name]{"param1":"value1","param2":"value2"}[/ACTION]

To navigate the user to a page:
[NAVIGATE:/page-path]

## Available Tools
${toolDocs}

## Quantization Methods & Valid Bits
${methodBits}

## Model Catalog (${modelNames.length} models)
${modelNames.join(', ')}

## Rules
1. Be concise. Keep responses to 2-4 sentences unless asked for detail.
2. Include [ACTION:...] blocks ONLY when the user wants to DO something. For knowledge questions, answer directly.
3. After starting a long-running action (quantize, start_finetune, vision_train), include [NAVIGATE:...] so the user can see progress.
4. If the user's request is ambiguous (e.g. "quantize a model" without specifying which), ask for clarification.
5. Use exact model names from the catalog above.
6. For multi-step requests, execute the first step and explain next steps.
7. Never fabricate data. If you don't know current state, use a list/status tool first.
8. Keep action params as JSON. Use string values for all params.
9. For SSE streaming tools (quantize, start_finetune, vision_train), the action starts the job and returns immediately. Always follow up with [NAVIGATE:...] so the user can see real-time progress on the relevant page.
10. Before starting quantization, verify the model name matches the catalog exactly. Common names: "SmolLM2 135M", "Qwen 3 0.6B", "Gemma 3 1B".
11. For vision_train, you need a dataset YAML path. Use list_vision_datasets first to find available datasets.`;
}

// ---- Action Parser ----

export function parseActions(text: string): { cleanText: string; actions: AgentAction[] } {
  const actions: AgentAction[] = [];
  const cleanText = text.replace(
    /\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/g,
    (_, tool, paramsStr) => {
      try {
        const params = JSON.parse(paramsStr.trim());
        actions.push({ tool, params });
      } catch {
        // Invalid JSON, skip
      }
      return '';
    }
  ).trim();
  return { cleanText, actions };
}

export function parseNavigations(text: string): { cleanText: string; paths: string[] } {
  const paths: string[] = [];
  const cleanText = text.replace(
    /\[NAVIGATE:(\/[^\]]*)\]/g,
    (_, path) => {
      paths.push(path);
      return '';
    }
  ).trim();
  return { cleanText, paths };
}

// ---- Action Executor ----

const PORT = process.env.PORT || '6001';
const BASE_URL = `http://localhost:${PORT}`;

async function executeAction(
  action: AgentAction,
  cookies: string
): Promise<AgentActionResult> {
  const tool = TOOL_DEFINITIONS.find(t => t.name === action.tool);
  if (!tool) {
    return { tool: action.tool, params: action.params, success: false, result: `Unknown tool: ${action.tool}`, duration: 0 };
  }

  if (tool.method === 'FRONTEND') {
    return { tool: action.tool, params: action.params, success: true, result: { navigated: action.params.path }, duration: 0 };
  }

  const start = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cookie': cookies,
  };

  // Extract auth token and pass as Bearer header — more reliable than
  // raw Cookie forwarding for server-side fetch to localhost
  const tokenMatch = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (tokenMatch) {
    headers['Authorization'] = `Bearer ${tokenMatch[1]}`;
  }

  try {
    let url = `${BASE_URL}${tool.endpoint}`;
    const fetchOpts: RequestInit = { headers };

    if (tool.method === 'GET') {
      const qs = new URLSearchParams(action.params as Record<string, string>).toString();
      if (qs) url += `?${qs}`;
      fetchOpts.method = 'GET';
    } else if (tool.method === 'DELETE') {
      const qs = new URLSearchParams(action.params as Record<string, string>).toString();
      if (qs) url += `?${qs}`;
      fetchOpts.method = 'DELETE';
    } else {
      fetchOpts.method = 'POST';
      fetchOpts.body = JSON.stringify(action.params);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    fetchOpts.signal = controller.signal;

    const res = await fetch(url, fetchOpts);
    clearTimeout(timeout);

    if (tool.sseStream) {
      // Fire-and-forget: confirm job started (HTTP 200), don't consume the stream
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { tool: action.tool, params: action.params, success: false, result: err.error || `Failed with status ${res.status}`, duration: Date.now() - start };
      }

      // Don't read or cancel the stream body — the backend child process runs
      // independently in-memory. Let the response be garbage collected naturally.
      // (Reading/canceling can trigger cancel() handlers that kill the process.)

      // Poll the corresponding status endpoint to get actual state
      if (tool.statusEndpoint) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const statusRes = await fetch(`${BASE_URL}${tool.statusEndpoint}`, { headers });
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.error) {
              return { tool: action.tool, params: action.params, success: false, result: status.error, duration: Date.now() - start };
            }
            const summary = status.running
              ? `Job started successfully.${status.model ? ` Model: ${status.model}.` : ''}${status.progress > 0 ? ` Progress: ${Math.round(status.progress * 100)}%.` : ''} Navigate to the page to monitor progress.`
              : status.done
                ? 'Job completed!'
                : 'Job submitted.';
            return { tool: action.tool, params: action.params, success: true, result: summary, duration: Date.now() - start };
          }
        } catch { /* fall through */ }
      }

      return { tool: action.tool, params: action.params, success: true, result: 'Job started. Navigate to the page to monitor progress.', duration: Date.now() - start };
    }

    // Standard JSON response
    const data = await res.json();
    return {
      tool: action.tool,
      params: action.params,
      success: res.ok,
      result: data,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      tool: action.tool,
      params: action.params,
      success: false,
      result: error instanceof Error ? error.message : 'Action failed',
      duration: Date.now() - start,
    };
  }
}

// ---- Main Orchestrator ----

const SYSTEM_PROMPT = buildSystemPrompt();

export async function* runNexusAgent(
  messages: AgentChatMessage[],
  pageContext: string,
  cookies: string
): AsyncGenerator<{ type: string; data: unknown }> {
  // Build conversation for Gemini
  const recentMessages = messages.slice(-20);
  const conversationText = recentMessages
    .filter(m => m.role !== 'action')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = `${conversationText}\n\n[Current page: ${pageContext}]\n\nRespond to the user's latest message. If they want you to perform an action, include the appropriate [ACTION:...] blocks. If they're asking a question, answer directly.`;

  // Stream Gemini response
  let fullResponse = '';
  try {
    for await (const chunk of callGeminiStream(SYSTEM_PROMPT, userPrompt)) {
      fullResponse += chunk;
      yield { type: 'token', data: { text: chunk } };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Agent failed';
    yield { type: 'error', data: { error: msg } };
    return;
  }

  // Parse actions and navigations from the full response
  const { actions } = parseActions(fullResponse);
  const { paths } = parseNavigations(fullResponse);

  // Execute actions
  const results: AgentActionResult[] = [];
  for (const action of actions) {
    yield { type: 'action_start', data: { tool: action.tool, params: action.params } };
    const result = await executeAction(action, cookies);
    results.push(result);
    yield { type: 'action_result', data: result };
  }

  // Emit navigations
  for (const path of paths) {
    yield { type: 'navigate', data: { path } };
  }

  // If actions were executed, summarize results
  if (results.length > 0) {
    const summaryPrompt = `You just executed these actions:\n${results.map(r =>
      `- ${r.tool}: ${r.success ? 'SUCCESS' : 'FAILED'} — ${JSON.stringify(r.result).slice(0, 200)}`
    ).join('\n')}\n\nGive a brief (1-2 sentence) summary of what happened. Be specific about any errors.`;

    try {
      const summary = await callGemini(SYSTEM_PROMPT, summaryPrompt);
      yield { type: 'summary', data: { text: '\n\n' + summary } };
    } catch {
      // Summary is nice-to-have, not critical
    }
  }
}
