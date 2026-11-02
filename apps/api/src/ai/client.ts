import type { Bindings } from '../types.js';

export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type JsonSchema = Record<string, unknown>;

const META_LLAMA_MODELS: Record<string, string> = {
  'llama-3.3-70b': 'Llama-3.3-70B-Instruct',
  'llama-4-scout': 'Llama-4-Scout-17B-16E-Instruct',
};

export async function callModel<T>(
  env: Bindings,
  model: string,
  messages: ModelMessage[],
  options: { schema: JsonSchema },
): Promise<T> {
  if (!env.META_LLAMA_API_KEY) {
    throw new Error('Meta Llama API is not configured. Set META_LLAMA_API_KEY as a Worker secret.');
  }
  const response = await fetch('https://api.llama.com/compat/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.META_LLAMA_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: META_LLAMA_MODELS[model] ?? model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'attest_response', strict: true, schema: options.schema },
      },
    }),
  });
  if (!response.ok) throw new Error(`Meta Llama API returned HTTP ${response.status}`);
  const body = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>();
  const result: unknown = body.choices?.[0]?.message?.content;
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as T;
    } catch (error) {
      throw new Error(`Meta Llama returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof result === 'object' && result !== null) return result as T;
  throw new Error('Meta Llama returned an empty or non-JSON response.');
}
