import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel } from '../src/ai/client.js';
import type { Bindings } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Meta Llama client', () => {
  it('uses the Meta endpoint, configured model, schema, and parses JSON output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"result":"supported"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { META_LLAMA_API_KEY: 'test-key' } as Bindings;

    await expect(callModel<{ result: string }>(env, 'llama-3.3-70b', [
      { role: 'user', content: 'Assess this evidence.' },
    ], { schema: { type: 'object', properties: { result: { type: 'string' } } } }))
      .resolves.toEqual({ result: 'supported' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.llama.com/compat/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
    const request = JSON.parse(String(init.body)) as {
      model: string;
      response_format: { json_schema: { schema: object } };
    };
    expect(request.model).toBe('Llama-3.3-70B-Instruct');
    expect(request.response_format.json_schema.schema).toEqual({
      type: 'object',
      properties: { result: { type: 'string' } },
    });
  });

  it('fails explicitly when the Meta key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(callModel({} as Bindings, 'llama-4-scout', [], { schema: {} }))
      .rejects.toThrow('Meta Llama API is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces provider errors without treating them as successful grades', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));

    await expect(callModel({ META_LLAMA_API_KEY: 'test-key' } as Bindings, 'llama-4-scout', [], { schema: {} }))
      .rejects.toThrow('Meta Llama API returned HTTP 503');
  });
});
