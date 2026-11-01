import type { Bindings } from '../types.js';

export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type JsonSchema = Record<string, unknown>;

const META_LLAMA_MODELS: Record<string, string> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama-3.3-70B-Instruct',
  '@cf/meta/llama-4-scout-17b-16e-instruct': 'Llama-4-Scout-17B-16E-Instruct',
};

export async function callModel<T>(
  env: Bindings,
  model: string,
  messages: ModelMessage[],
  options: { schema: JsonSchema },
): Promise<T> {
  let result: unknown;
  if (env.META_LLAMA_API_KEY) {
    const response = await fetch('https://api.llama.com/compat/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.META_LLAMA_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: META_LLAMA_MODELS[model] ?? model,
        messages,
        response_format: { type: 'json_schema', json_schema: { name: 'attest_response', strict: true, schema: options.schema } },
      }),
    });
    if (!response.ok) throw new Error(`Meta Llama API returned HTTP ${response.status}`);
    const body = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>();
    result = body.choices?.[0]?.message?.content;
  } else if (env.AI_GATEWAY_BASE_URL) {
    const response = await fetch(`${env.AI_GATEWAY_BASE_URL.replace(/\/+$/, '')}/${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        ...(env.AI_GATEWAY_TOKEN ? { authorization: `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        response_format: { type: 'json_schema', json_schema: { name: 'attest_response', strict: true, schema: options.schema } },
      }),
    });
    if (!response.ok) throw new Error(`AI Gateway returned HTTP ${response.status}`);
    const body = await response.json<{ choices?: Array<{ message?: { content?: string } }> }>();
    result = body.choices?.[0]?.message?.content;
  } else {
    const response = await env.AI.run(model as Parameters<Ai['run']>[0], {
      messages,
      response_format: { type: 'json_schema', json_schema: { name: 'attest_response', strict: true, schema: options.schema } },
    } as never);
    result = typeof response === 'object' && response !== null && 'response' in response
      ? (response as { response: unknown }).response
      : response;
  }
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as T;
    } catch (error) {
      throw new Error(`Model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof result === 'object' && result !== null) return result as T;
  throw new Error('Model returned an empty or non-JSON response.');
}
