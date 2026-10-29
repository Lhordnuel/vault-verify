import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateSessionKeypair } from '@vault-verify/core/node';
import { loadChainRecords } from '../src/chainstore.js';
import { gitInit } from '../src/git.js';
import type { RunSession } from '../src/session.js';
import { recordSnapshot } from '../src/snapshot.js';
import { startWatch } from '../src/watch.js';

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe('watcher', () => {
  it('snapshots workspace changes and ignores harness state', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'vv-watch-'));
    await gitInit(runDir);
    await writeFile(join(runDir, '.gitignore'), '.vaultverify/\n');
    const keys = generateSessionKeypair();
    const metaDir = join(runDir, '.vaultverify');
    const keyFile = join(metaDir, 'keys', 'session.key');
    await mkdir(dirname(keyFile), { recursive: true });
    await writeFile(keyFile, `${keys.privateKey}\n`);
    const session: RunSession = {
      sessionId: '55555555-5555-5555-5555-555555555555',
      nonce: 'dd'.repeat(16),
      candidateId: '66666666-6666-6666-6666-666666666666',
      publicKey: keys.publicKey,
      keyFile,
      anchorUrl: '',
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(runDir, 'a.txt'), 'v1\n');
    const first = await recordSnapshot(runDir, session, { force: true });
    expect(first?.event.seq).toBe(0);
    const chainFile = join(metaDir, 'chain.jsonl');
    const seen: number[] = [];
    const handle = await startWatch(
      runDir,
      async () => {
        const record = await recordSnapshot(runDir, session);
        if (record) seen.push(record.event.seq);
      },
      { debounceMs: 200 },
    );
    try {
      await writeFile(join(runDir, 'b.txt'), 'hello\n');
      expect(await waitFor(async () => (await loadChainRecords(chainFile)).length >= 2, 20000)).toBe(true);
      expect(seen).toContain(1);
      const before = (await loadChainRecords(chainFile)).length;
      await writeFile(join(metaDir, 'note.txt'), 'ignored\n');
      await new Promise((r) => setTimeout(r, 1200));
      expect((await loadChainRecords(chainFile)).length).toBe(before);
    } finally {
      await handle.stop();
    }
  }, 60000);
});
