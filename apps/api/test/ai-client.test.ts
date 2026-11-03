import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel } from '../src/ai/client.js';
import type { Bindings } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Meta Model API client', () => {
  it('uses the current Meta Model API endpoint and Muse Spark with schema-constrained JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"result":"supported"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const env = { META_API_KEY: 'test-key' } as Bindings;

    await expect(callModel<{ result: string }>(env, 'meta-muse-spark', [
      { role: 'user', content: 'Assess this evidence.' },
    ], { schema: { type: 'object', properties: { result: { type: 'string' } } } }))
      .resolves.toEqual({ result: 'supported' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
    const request = JSON.parse(String(init.body)) as {
      model: string;
      response_format: { json_schema: { schema: object } };
    };
    expect(request.model).toBe('muse-spark-1.3');
    expect(request.response_format.json_schema.schema).toEqual({
      type: 'object',
      properties: { result: { type: 'string' } },
    });

  });

  it('uses Muse Wonder for the independent second grading pass', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"result":"reviewed"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await callModel({ META_API_KEY: 'test-key' } as Bindings, 'meta-muse-wonder', [], { schema: {} });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe('muse-wonder-1.0');
  });

  it('fails explicitly when the Meta key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(callModel({} as Bindings, 'meta-muse-wonder', [], { schema: {} }))
      .rejects.toThrow('Meta Model API is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces provider errors without treating them as successful grades', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Model is not enabled for this API key.' },
    }), { status: 403 })));

    await expect(callModel({ META_API_KEY: 'test-key' } as Bindings, 'meta-muse-wonder', [], { schema: {} }))
      .rejects.toThrow('Meta Model API returned HTTP 403: Model is not enabled for this API key.');
  });
});
