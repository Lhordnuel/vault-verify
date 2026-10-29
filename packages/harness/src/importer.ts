import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  AgentEventSchema,
  classifyAgentEvent,
  redactText,
  redactValue,
  type AgentEvent,
  type AnchorReceipt,
} from '@vault-verify/core';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  signHashHex,
} from '@vault-verify/core/node';
import type { ChainRecord } from './chainstore.js';
import { git } from './git.js';
import { detectParser, type FormatParser } from './parsers.js';
import { anchorHead, loadPrivateKey, registerSession } from './session.js';

export interface ImportLogOptions {
  logPath: string;
  runsDir: string;
  format?: string;
  /** Parser registry override (tests inject the test-only v1 parser). */
  parsers?: FormatParser[];
  /** Anchor service credentials: present = anchored-at-import (L2 track). */
  server?: { anchorUrl: string; jwt: string };
  includePromptText?: boolean;
  repoPath?: string;
  /** Injectable for tests; default reads `git log` timestamps. */
  gitLogTimestamps?: (repoPath: string) => Promise<number[]>;
  importedAt?: string;
}

export interface ImportRegistryEntry {
  digest: string;
  sessionId: string;
  importedAt: string;
  dir: string;
}

export interface ImportResult {
  sessionId: string;
  format: string;
  digest: string;
  events: AgentEvent[];
  count: number;
  dir: string;
  chainPath: string;
  importPath: string;
  flags: string[];
  notes: string[];
  /** Source fields the parser did not map (unique, sorted). */
  unmappedFields: string[];
  provenance: 'retroactive';
}

function sha256HexUtf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function loadRegistry(runsDir: string): Promise<ImportRegistryEntry[]> {
  try {
    const raw = JSON.parse(await readFile(join(runsDir, 'imports.json'), 'utf8')) as unknown;
    return Array.isArray(raw) ? (raw as ImportRegistryEntry[]) : [];
  } catch {
    return [];
  }
}

async function gitLogTimestampsDefault(repoPath: string): Promise<number[]> {
  const out = await git(repoPath, ['log', '--format=%ct']);
  return out
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function chainKind(rawKind: string, type: AgentEvent['type']): ChainRecord['kind'] {
  if (type === 'file_edit') return 'repo_snapshot';
  if (type === 'test_run') return 'test_run';
  return rawKind === 'prompt' ? 'prompt_transcript' : 'self_report';
}

/**
 * Import a past agent log into a sealed retroactive session. Redacts BEFORE
 * hashing; seals a fresh hash chain; never uploads (the raw log never
 * leaves this machine). Without `server` the import is fully offline with
 * a self-signed local attestation (verifies at most L1); with `server` the
 * session opens on the anchor service and the head is countersigned at
 * import time (verifies up to L2). Duplicate content (by digest) is
 * rejected. Server failures fail the import closed (nothing recorded).
 */
export async function importLog(opts: ImportLogOptions): Promise<ImportResult> {
  let raw: string;
  try {
    raw = await readFile(opts.logPath, 'utf8');
  } catch {
    throw new Error(`[harness] cannot read log: ${opts.logPath}`);
  }
  const digest = sha256HexUtf8(raw);
  const registry = await loadRegistry(opts.runsDir);
  const dupe = registry.find((entry) => entry.digest === digest);
  if (dupe) {
    throw new Error(
      `[harness] duplicate import: content already imported as session ${dupe.sessionId} (${dupe.importedAt}).`,
    );
  }

  const parser = detectParser(raw, opts.format, opts.parsers);
  const parsed = parser.parse(raw);
  const importedAt = opts.importedAt ?? new Date().toISOString();
  const unmappedFields = [...new Set(parsed.flatMap((entry) => entry.unmapped ?? []))].sort();

  const events: AgentEvent[] = parsed.map((entry) => {
    const type = classifyAgentEvent(entry.kind, entry.data);
    const files =
      type === 'file_edit'
        ? {
            changed: typeof entry.data['filesChanged'] === 'number' ? entry.data['filesChanged'] : 0,
            insertions: typeof entry.data['insertions'] === 'number' ? entry.data['insertions'] : 0,
            deletions: typeof entry.data['deletions'] === 'number' ? entry.data['deletions'] : 0,
          }
        : undefined;
    const tests =
      type === 'test_run'
        ? {
            passed: typeof entry.data['passed'] === 'number' ? entry.data['passed'] : 0,
            failed: typeof entry.data['failed'] === 'number' ? entry.data['failed'] : 0,
          }
        : undefined;
    const note =
      entry.note !== undefined
        ? redactText(entry.note).slice(0, 280)
        : entry.kind === 'prompt'
          ? 'agent prompt'
          : undefined;
    const promptText =
      opts.includePromptText === true && entry.promptText !== undefined
        ? redactText(entry.promptText).slice(0, 20000)
        : undefined;
    return AgentEventSchema.parse(
      redactValue({
        type,
        at: entry.at,
        ...(files === undefined ? {} : { files }),
        ...(tests === undefined ? {} : { tests }),
        ...(note === undefined ? {} : { note }),
        ...(promptText === undefined ? {} : { promptText }),
      }),
    );
  });

  const flags: string[] = [];
  for (let i = 1; i < events.length; i += 1) {
    if (Date.parse(events[i].at) < Date.parse(events[i - 1].at)) {
      flags.push(`timestamp-order-violation@seq:${i}`);
    }
  }

  const dir = join(opts.runsDir, `import-${digest.slice(0, 12)}`);
  const keyFile = join(dir, 'keys', 'session.key');
  let sessionId: string = randomUUID();
  let nonce = randomBytes(16).toString('hex');
  let keypair = generateSessionKeypair();
  let candidateId: string | null = null;
  if (opts.server !== undefined) {
    try {
      const registered = await registerSession({
        anchorUrl: opts.server.anchorUrl,
        jwt: opts.server.jwt,
        metaDir: dir,
      });
      sessionId = registered.sessionId;
      nonce = registered.nonce;
      candidateId = registered.candidateId;
      keypair = { publicKey: registered.publicKey, privateKey: await loadPrivateKey(registered.keyFile) };
    } catch (error) {
      throw new Error(
        `[harness] import server session failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let prevHash = genesisPrevHashFromNonce(nonce);
  const records: ChainRecord[] = events.map((event, seq) => {
    const hash = hashEventStruct({ seq, prevHash, payload: event });
    const record: ChainRecord = {
      event: { seq, prevHash, payload: event, hash, sig: signHashHex(keypair.privateKey, hash) },
      kind: chainKind(parsed[seq].kind, event.type),
      collectedAt: importedAt,
      summary: `imported ${event.type} #${seq}`,
    };
    prevHash = hash;
    return record;
  });

  const notes: string[] = [];
  if (opts.repoPath !== undefined) {
    try {
      const commits = await (opts.gitLogTimestamps ?? gitLogTimestampsDefault)(opts.repoPath);
      let hits = 0;
      for (const event of events) {
        const atSec = Math.floor(Date.parse(event.at) / 1000);
        if (commits.some((commit) => Math.abs(commit - atSec) <= 3600)) hits += 1;
      }
      notes.push(`repo-history: ${hits}/${events.length} events within 60min of a commit`);
    } catch (error) {
      notes.push(
        `repo-history unavailable: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`,
      );
    }
  }

  const head = records[records.length - 1];
  const anchors: AnchorReceipt[] = [];
  let attestation: (AnchorReceipt & { issuer: string }) | undefined;
  if (opts.server !== undefined) {
    try {
      const receipt = await anchorHead({
        anchorUrl: opts.server.anchorUrl,
        jwt: opts.server.jwt,
        sessionId,
        seq: head.event.seq,
        headHash: head.event.hash,
      });
      anchors.push(receipt);
      notes.push(`server-anchored at import: seq ${head.event.seq}`);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw new Error(
        `[harness] import anchoring failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    attestation = {
      sessionId,
      seq: head.event.seq,
      headHash: head.event.hash,
      serverTime: importedAt,
      signature: signHashHex(
        keypair.privateKey,
        anchorDigest({ sessionId, seq: head.event.seq, headHash: head.event.hash, serverTime: importedAt }),
      ),
      issuer: 'local-import (self-signed, not a server anchor)',
    };
    notes.push('offline import: no server anchor (caps verification at L1)');
  }

  const chainPath = join(dir, 'chain.jsonl');
  const importPath = join(dir, 'import.json');
  await mkdir(join(dir, 'keys'), { recursive: true });
  await writeFile(chainPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  await writeFile(
    importPath,
    `${JSON.stringify(
      {
        sessionId,
        provenance: 'retroactive',
        format: parser.id,
        digest,
        logFile: basename(opts.logPath),
        importedAt,
        nonce,
        publicKey: keypair.publicKey,
        candidateId,
        chainEvents: records.length,
        anchors,
        ...(attestation === undefined ? {} : { attestation }),
        flags,
        notes,
        unmappedFields,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (opts.server === undefined) {
    await writeFile(keyFile, `${keypair.privateKey}\n`, { mode: 0o600 });
    try {
      await chmod(keyFile, 0o600);
    } catch {
      /* best effort on Windows */
    }
  }

  await mkdir(opts.runsDir, { recursive: true });
  await writeFile(
    join(opts.runsDir, 'imports.json'),
    `${JSON.stringify([...registry, { digest, sessionId, importedAt, dir }], null, 2)}\n`,
    'utf8',
  );

  return {
    sessionId,
    format: parser.id,
    digest,
    events,
    count: events.length,
    dir,
    chainPath,
    importPath,
    flags,
    notes,
    unmappedFields,
    provenance: 'retroactive',
  };
}
