import { join } from 'node:path';
import { appendChainRecord, type ChainRecord } from './chainstore.js';
import {
  gitCommitAll,
  gitDiffRange,
  gitDiffStatRange,
  gitHead,
  gitIsClean,
  gitRootCommit,
  gitShowPatch,
  gitShowStat,
} from './git.js';
import { loadPrivateKey, type RunSession } from './session.js';

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

/** Commit dirty state and record a snapshot event (null when clean, unless forced). */
export async function recordSnapshot(
  runDir: string,
  session: RunSession,
  opts?: { force?: boolean; message?: string },
): Promise<ChainRecord | null> {
  if (!opts?.force && (await gitIsClean(runDir))) return null;
  const commit = await gitCommitAll(runDir, opts?.message ?? `harness snapshot ${new Date().toISOString()}`);
  const stat = await gitShowStat(runDir, commit);
  const diff = truncateUtf8(await gitShowPatch(runDir, commit), 64 * 1024);
  const privateKeyHex = await loadPrivateKey(session.keyFile);
  return appendChainRecord({
    file: join(runDir, '.vaultverify', 'chain.jsonl'),
    sessionNonce: session.nonce,
    privateKeyHex,
    kind: 'repo_snapshot',
    payload: { commit, diffstat: stat.slice(0, 8192), diff: diff.text, diffTruncated: diff.truncated },
    summary: `snapshot ${commit.slice(0, 7)}`,
  });
}

/** Emit the whole-run diff (initial import to current head) as its own event. */
export async function recordFinalDiff(runDir: string, session: RunSession): Promise<ChainRecord> {
  const root = await gitRootCommit(runDir);
  const head = await gitHead(runDir);
  const stat = root === head ? '' : await gitDiffStatRange(runDir, root, head);
  const patch = root === head ? '' : await gitDiffRange(runDir, root, head);
  const diff = truncateUtf8(patch, 64 * 1024);
  const privateKeyHex = await loadPrivateKey(session.keyFile);
  return appendChainRecord({
    file: join(runDir, '.vaultverify', 'chain.jsonl'),
    sessionNonce: session.nonce,
    privateKeyHex,
    kind: 'repo_snapshot',
    payload: {
      final: true,
      fromCommit: root,
      toCommit: head,
      diffstat: stat.slice(0, 8192),
      diff: diff.text,
      diffTruncated: diff.truncated,
    },
    summary: `final diff ${head.slice(0, 7)}`,
  });
}
