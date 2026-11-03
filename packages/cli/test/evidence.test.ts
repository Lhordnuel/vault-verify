import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { createChainHash, GENESIS_HASH } from '@attest/core';
import { scanRepositories, scanRepository } from '../src/evidence.js';

describe('local git evidence scan', () => {
  let directory: string;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
  }, 60_000);

  it('combines nested repositories, skips empty repositories, and rechains the combined preview', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'attest-multi-scan-'));
    const repositories = [
      path.join(directory, 'first'),
      path.join(directory, 'nested', 'second'),
      path.join(directory, 'empty'),
    ];
    for (const [index, repository] of repositories.entries()) {
      await mkdir(repository, { recursive: true });
      const git = simpleGit(repository);
      await git.init();
      await git.addConfig('user.name', 'Local Developer');
      await git.addConfig('user.email', 'developer@example.test');
      if (index === 2) continue;
      const filename = `change-${index}.ts`;
      await writeFile(path.join(repository, filename), `export const change${index} = true;\n`);
      await git.add(filename);
      await git.commit(`Add change ${index}`);
      if (index === 0) {
        await writeFile(path.join(repository, 'follow-up.ts'), 'export const followUp = true;\n');
        await git.add('follow-up.ts');
        await git.commit('Add follow-up change');
      }
    }

    const result = await scanRepositories(directory, 10);
    expect(result.repositories).toHaveLength(2);
    expect(result.skippedEmpty).toBe(1);
    expect(result.payload.evidence).toHaveLength(3);
    expect(result.payload.evidence.filter((item) => item.evidence_ref.repository === 'first').map((item) => item.evidence_ref.message))
      .toEqual(['Add change 0', 'Add follow-up change']);

    let previousHash = GENESIS_HASH;
    for (const item of result.payload.evidence) {
      expect(item.evidence_ref.previous_hash).toBe(previousHash);
      const { chain_hash: _chainHash, previous_hash: _previousHash, ...reference } = item.evidence_ref;
      const { evidence_ref: _evidenceRef, ...base } = item;
      expect(item.evidence_ref.chain_hash).toBe(await createChainHash(previousHash, base, reference));
      previousHash = item.evidence_ref.chain_hash;
    }

    const limited = await scanRepositories(directory, 1);
    expect(limited.payload.evidence).toHaveLength(1);
  }, 60_000);
});
