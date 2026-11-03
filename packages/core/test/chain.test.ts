import { describe, expect, it } from 'vitest';
import { createChainHash, GENESIS_HASH, type CommitEvidence } from '../src/index.js';

describe('evidence chain hashes', () => {
  it('is deterministic and binds every quoted source fact', async () => {
    const node: Omit<CommitEvidence, 'evidence_ref'> = {
      id: '00000000-0000-0000-0000-000000000001',
      claim_type: 'testing',
      claim_value: 'testing behavior: add assertions',
      source: 'git',
      status: 'Supported',
      confidence: null,
      captured_at: 1_762_000_000_000,
    };
    const reference = {
      commit_hash: 'a'.repeat(40),
      parent_hashes: [],
      committed_at: new Date(node.captured_at).toISOString(),
      repository: 'sample',
      message: 'add assertions',
      files: ['test.ts'],
      quote: 'expect(true).toBe(true)',
    };
    const first = await createChainHash(GENESIS_HASH, node, reference);
    expect(await createChainHash(GENESIS_HASH, node, reference)).toBe(first);
    expect(await createChainHash(GENESIS_HASH, node, { ...reference, quote: 'different excerpt' })).not.toBe(first);
    expect(await createChainHash('1'.repeat(64), node, reference)).not.toBe(first);
  });
});
