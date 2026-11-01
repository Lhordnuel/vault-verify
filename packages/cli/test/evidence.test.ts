import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { createChainHash, GENESIS_HASH } from '@attest/core';
import { scanRepository } from '../src/evidence.js';

describe('local git evidence scan', () => {
  let directory: string;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('creates a linked evidence record from the commit and redacts common credentials', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'attest-scan-'));
    const git = simpleGit(directory);
    await git.init();
    await git.addConfig('user.name', 'Local Developer');
    await git.addConfig('user.email', 'developer@example.test');
    const fakeCredential = ['ghp_', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'].join('');
    await writeFile(path.join(directory, 'test.ts'), `const credential = "${fakeCredential}";\n`);
    await git.add('test.ts');
    await git.commit('Add test coverage');

    const result = await scanRepository(directory, 10);
    expect(result.evidence).toHaveLength(1);
    const [item] = result.evidence;
    expect(item.claim_type).toBe('testing');
    expect(item.evidence_ref.files).toContain('test.ts');
    expect(item.evidence_ref.quote).toContain('[REDACTED]');
    expect(item.evidence_ref.quote).not.toContain('ghp_');
    expect(item.evidence_ref.previous_hash).toBe(GENESIS_HASH);
    const { chain_hash: _chainHash, previous_hash: _previousHash, ...reference } = item.evidence_ref;
    const { evidence_ref: _evidenceRef, ...base } = item;
    expect(item.evidence_ref.chain_hash).toBe(await createChainHash(GENESIS_HASH, base, reference));
  }, 20_000);
});
