import type { Bindings } from '../types.js';

export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type JsonSchema = Record<string, unknown>;

const META_MODELS: Record<string, string> = {
  'meta-muse-spark': 'muse-spark-1.3',
  'meta-muse-wonder': 'muse-wonder-1.0',
};

export async function callModel<T>(
  env: Bindings,
  model: string,
  messages: ModelMessage[],
  options: { schema: JsonSchema },
): Promise<T> {
  const apiKey = env.META_API_KEY ?? env.META_LLAMA_API_KEY;
  if (!apiKey) {
    throw new Error('Meta Model API is not configured. Set META_API_KEY as a Worker secret.');
  }
  const response = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: META_MODELS[model] ?? model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'attest_response', strict: true, schema: options.schema },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
      const providerMessage = typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error.message
        : typeof parsed.error === 'string' ? parsed.error : parsed.message;
      if (typeof providerMessage === 'string') detail = providerMessage.slice(0, 300);
    } catch {
      detail = body.slice(0, 300);
    }
    throw new Error(`Meta Model API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
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
