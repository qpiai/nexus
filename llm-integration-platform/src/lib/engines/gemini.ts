/**
 * Backward-compat shim — all LLM logic now lives in `./llm`.
 * Existing imports (`import { callGemini } from '@/lib/engines/gemini'`)
 * keep working across every provider the new client supports.
 *
 * New code should import from `./llm` directly.
 */

export {
  callLLM as callGemini,
  callLLMStream as callGeminiStream,
  callLLMJSON as callGeminiJSON,
  SchemaType,
} from './llm';
export type { Schema } from './llm';
