import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSessionKeypair, genesisPrevHashFromNonce, verifyChain, verifyHashSignature } from '@vault-verify/core/node';
import { appendChainRecord, loadChainRecords } from '../src/chainstore.js';

const NONCE = 'cc'.repeat(16);

describe('chainstore', () => {
  it('appends sequenced, linked, signed records and reloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vv-chain-'));
    const file = join(dir, 'chain.jsonl');
    const keys = generateSessionKeypair();
    for (const kind of ['repo_snapshot', 'test_run', 'repo_snapshot']) {
      await appendChainRecord({ file, sessionNonce: NONCE, privateKeyHex: keys.privateKey, kind, payload: { k: kind } });
    }
    const records = await loadChainRecords(file);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.event.seq)).toEqual([0, 1, 2]);
    expect(records[0].event.prevHash).toBe(genesisPrevHashFromNonce(NONCE));
    expect(records[1].event.prevHash).toBe(records[0].event.hash);
    for (const r of records) {
      expect(verifyHashSignature(keys.publicKey, r.event.hash, r.event.sig)).toBe(true);
    }
    const check = verifyChain(records.map((r) => r.event), keys.publicKey, {
      expectedGenesisPrevHash: genesisPrevHashFromNonce(NONCE),
    });
    expect(check).toEqual({ ok: true, count: 3 });
  });

  it('returns [] for a missing file and rejects bad kinds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vv-chain-'));
    expect(await loadChainRecords(join(dir, 'nope.jsonl'))).toEqual([]);
    const keys = generateSessionKeypair();
    await expect(
      appendChainRecord({ file: join(dir, 'c.jsonl'), sessionNonce: NONCE, privateKeyHex: keys.privateKey, kind: 'bogus', payload: {} }),
    ).rejects.toThrow();
  });
});
