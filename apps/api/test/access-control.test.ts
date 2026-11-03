import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('workers-og', () => ({ ImageResponse: class ImageResponse {} }));

import worker from '../src/index.js';
import type { Bindings } from '../src/types.js';

afterEach(() => vi.restoreAllMocks());

describe('evidence deletion access control', () => {
  it('rejects public profile-link deletion attempts without touching user data', async () => {
    const prepare = vi.fn();
    const list = vi.fn();
    const env = {
      DB: { prepare },
      ARTIFACTS: { list, delete: vi.fn() },
    } as unknown as Bindings;
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const deletion = await worker.fetch(
      new Request('https://attests.vaultio.tech/api/cli/wipe', { method: 'DELETE' }),
      env,
      context,
    );
    const profileMutation = await worker.fetch(
      new Request('https://attests.vaultio.tech/api/evidence/dev', { method: 'DELETE' }),
      env,
      context,
    );

    expect(deletion.status).toBe(401);
    expect(await deletion.json()).toEqual({ error: 'authentication_required' });
    expect(profileMutation.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
