import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsSecretShape } from '@vault-verify/core';
import {
  anchorDigest,
  observationPayloadHash,
  publicKeyFromSeedHex,
  signHashHex,
  verifySession,
} from '@vault-verify/core/node';
import { loadChainRecords } from '../src/chainstore.js';
import { importLog, type ImportLogOptions, type ImportResult } from '../src/importer.js';
import { agentLogV1Parser } from '../src/parsers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'sample-agent-log.jsonl');
const EXPECTED_PATH = join(HERE, '..', 'fixtures', 'sample-agent-log.expected.json');

/** vv-agent-log/1 is test-only: every test injects it explicitly. */
const V1 = [agentLogV1Parser];

function v1Import(opts: Omit<ImportLogOptions, 'parsers'>): Promise<ImportResult> {
  return importLog({ ...opts, parsers: V1 });
}

// Secret shapes built at runtime so committed files stay scanner-clean.
const JWT = `eyJ${'A'.repeat(12)}.${'B'.repeat(12)}.${'C'.repeat(12)}`;
const SK = `sk-${'D'.repeat(24)}`;

const STUB_SESSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUB_CANDIDATE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STUB_NONCE = 'cc'.repeat(16);
const STUB_SEED = '2f'.repeat(32); // TEST ONLY

async function tempRuns(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vv-import-'));
}

async function writeLog(dir: string, name: string, lines: Array<Record<string, unknown>>): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return file;
}

function edit(ts: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    ts,
    event: 'edit',
    files: [{ path: 'a.ts', added: 3, removed: 1 }],
    summary: 'tweak',
    ...extra,
  };
}

function test(ts: string, passed: number, failed: number): Record<string, unknown> {
  return { v: 1, ts, event: 'test', command: 'npm test', passed, failed, exit_code: failed > 0 ? 1 : 0 };
}

function startStubAnchor(opts: { failAnchor?: boolean } = {}): Promise<{
  url: string;
  publicKey: string;
  close: () => Promise<void>;
}> {
  const publicKey = publicKeyFromSeedHex(STUB_SEED);
  let server: Server;
  const listening = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        const json = (status: number, value: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        if (req.method === 'POST' && req.url === '/session/start') {
          json(200, { sessionId: STUB_SESSION, nonce: STUB_NONCE, candidateId: STUB_CANDIDATE });
        } else if (req.method === 'POST' && req.url === '/session/anchor') {
          if (opts.failAnchor === true) {
            json(500, { error: { code: 'boom' } });
            return;
          }
          const parsed = JSON.parse(body) as { sessionId: string; seq: number; headHash: string };
          if (parsed.sessionId !== STUB_SESSION) {
            json(404, { error: { code: 'unknown_session' } });
            return;
          }
          const serverTime = '2026-10-29T00:00:00.000Z';
          const digest = anchorDigest({
            sessionId: parsed.sessionId,
            seq: parsed.seq,
            headHash: parsed.headHash,
            serverTime,
          });
          json(200, {
            sessionId: parsed.sessionId,
            seq: parsed.seq,
            headHash: parsed.headHash,
            serverTime,
            signature: signHashHex(STUB_SEED, digest),
          });
        } else {
          json(404, {});
        }
      });
    }).listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return listening.then((url) => ({
    url,
    publicKey,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => {
          if (error) fail(error);
          else done();
        });
      }),
  }));
}

describe('importLog golden', () => {
  it('matches the committed expected events, digest, notes, and unmapped fields', async () => {
    const expected = JSON.parse(await readFile(EXPECTED_PATH, 'utf8')) as {
      digest: string;
      count: number;
      flags: string[];
      notes: string[];
      unmappedFields: string[];
      events: unknown[];
    };
    const runs = await tempRuns();
    try {
      const result = await v1Import({
        logPath: FIXTURE,
        runsDir: runs,
        importedAt: '2026-10-29T00:00:00.000Z',
      });
      expect(result.digest).toBe(expected.digest);
      expect(result.count).toBe(expected.count);
      expect(result.flags).toEqual(expected.flags);
      expect(result.notes).toEqual(expected.notes);
      expect(result.unmappedFields).toEqual(expected.unmappedFields);
      expect(result.events).toEqual(expected.events);
      const records = await loadChainRecords(result.chainPath);
      expect(records.map((r) => r.kind)).toEqual([
        'prompt_transcript',
        'repo_snapshot',
        'test_run',
        'repo_snapshot',
        'test_run',
        'self_report',
        'prompt_transcript',
      ]);
      for (const record of records) {
        expect(record.collectedAt).toBe('2026-10-29T00:00:00.000Z');
      }
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });
});

describe('importLog redaction', () => {
  it('seals no secret shapes: JWTs, keys, emails, paths, connection strings', async () => {
    const runs = await tempRuns();
    try {
      const file = await writeLog(runs, 'dirty.jsonl', [
        { v: 1, ts: '2026-10-20T09:00:00.000Z', event: 'note', text: `jwt ${JWT} mail ada@example.com` },
        { v: 1, ts: '2026-10-20T09:01:00.000Z', event: 'note', text: `key ${SK} path /home/demo/x.ts` },
        {
          v: 1,
          ts: '2026-10-20T09:02:00.000Z',
          event: 'note',
          text: 'db postgres://demo:FAKEpw9@db:5432/app',
        },
        test('2026-10-20T09:03:00.000Z', 1, 0),
      ]);
      const result = await v1Import({ logPath: file, runsDir: runs });
      const chain = await readFile(result.chainPath, 'utf8');
      expect(containsSecretShape(chain)).toBe(false);
      expect(containsSecretShape(JSON.stringify(result.events))).toBe(false);
      expect(chain).toContain('[REDACTED-JWT]');
      expect(chain).toContain('[REDACTED-KEY]');
      expect(chain).toContain('[REDACTED-EMAIL]');
      expect(chain).toContain('[REDACTED-PATH]');
      expect(chain).toContain('postgres://[REDACTED]');
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('drops prompt text by default, keeps it redacted with the flag', async () => {
    const runs = await tempRuns();
    try {
      const prompt = { v: 1, ts: '2026-10-20T09:00:00.000Z', event: 'prompt', text: 'mail bob@example.com the diff' };
      const plain = await v1Import({ logPath: await writeLog(runs, 'a.jsonl', [prompt]), runsDir: runs });
      expect(plain.events[0].promptText).toBeUndefined();
      // Different content (extra line) so the digest differs from the first import.
      const flagged = await v1Import({
        logPath: await writeLog(runs, 'b.jsonl', [prompt, test('2026-10-20T09:01:00.000Z', 1, 0)]),
        runsDir: runs,
        includePromptText: true,
      });
      expect(flagged.events[0].promptText).toContain('[REDACTED-EMAIL]');
      expect(flagged.events[0].promptText).not.toContain('bob@example.com');
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });
});

describe('importLog sealing', () => {
  async function importFixture(): Promise<{ runs: string; result: ImportResult }> {
    const runs = await tempRuns();
    const result = await v1Import({ logPath: FIXTURE, runsDir: runs });
    return { runs, result };
  }

  function factsFor(result: ImportResult, importMeta: { nonce: string; publicKey: string }, anchorPublicKey: string) {
    return {
      sessionId: result.sessionId,
      nonce: importMeta.nonce,
      sessionPublicKey: importMeta.publicKey,
      anchorPublicKey,
      observations: result.events.map((payload, seq) => ({ seq, payloadHash: observationPayloadHash(payload) })),
      provenance: 'retroactive' as const,
    };
  }

  it('caps an offline imported chain at L1 and lists the reason', async () => {
    const { runs, result } = await importFixture();
    try {
      const meta = JSON.parse(await readFile(result.importPath, 'utf8')) as {
        nonce: string;
        publicKey: string;
        anchors: unknown[];
        attestation: { signature: string };
      };
      expect(meta.anchors).toEqual([]);
      expect(typeof meta.attestation.signature).toBe('string');
      const records = await loadChainRecords(result.chainPath);
      const events = records.map((r) => r.event);
      expect(verifySession(events, [], factsFor(result, meta, 'ab'.repeat(32)))).toEqual({
        level: 'L1',
        reasons: ['chain_valid:7_events', 'retroactive_unanchored_cap'],
      });
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('fails closed at L1 when the anchor does not verify', async () => {
    const { runs, result } = await importFixture();
    try {
      const meta = JSON.parse(await readFile(result.importPath, 'utf8')) as {
        nonce: string;
        publicKey: string;
        attestation: { signature: string; serverTime: string };
      };
      const records = await loadChainRecords(result.chainPath);
      const events = records.map((r) => r.event);
      const head = events[events.length - 1];
      // The self-signed attestation checked against a wrong anchor key.
      const verdict = verifySession(
        events,
        [
          {
            sessionId: result.sessionId,
            seq: head.seq,
            headHash: head.hash,
            serverTime: meta.attestation.serverTime,
            signature: meta.attestation.signature,
          },
        ],
        factsFor(result, meta, 'ab'.repeat(32)),
      );
      expect(verdict).toEqual({
        level: 'L1',
        reasons: ['chain_valid:7_events', 'anchor_signature_invalid@seq:6', 'retroactive_unanchored_cap'],
      });
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('anchors at import with server credentials and verifies at L2', async () => {
    const stub = await startStubAnchor();
    const runs = await tempRuns();
    try {
      const result = await v1Import({
        logPath: FIXTURE,
        runsDir: runs,
        server: { anchorUrl: stub.url, jwt: 'test-jwt' },
      });
      expect(result.sessionId).toBe(STUB_SESSION);
      expect(result.notes.join(' ')).toMatch(/server-anchored at import: seq 6/);
      const meta = JSON.parse(await readFile(result.importPath, 'utf8')) as {
        nonce: string;
        publicKey: string;
        candidateId: string;
        anchors: Array<{ sessionId: string; seq: number; headHash: string; serverTime: string; signature: string }>;
        attestation?: unknown;
      };
      expect(meta.candidateId).toBe(STUB_CANDIDATE);
      expect(meta.nonce).toBe(STUB_NONCE);
      expect(meta.anchors).toHaveLength(1);
      expect(meta.attestation).toBeUndefined();
      const records = await loadChainRecords(result.chainPath);
      const events = records.map((r) => r.event);
      expect(verifySession(events, meta.anchors, factsFor(result, meta, stub.publicKey))).toEqual({
        level: 'L2',
        reasons: ['chain_valid:7_events', 'anchors_match:1', 'retroactive_anchored_cap'],
      });
    } finally {
      await stub.close();
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('fails a server-anchored import closed when anchoring fails', async () => {
    const stub = await startStubAnchor({ failAnchor: true });
    const runs = await tempRuns();
    try {
      await expect(
        v1Import({ logPath: FIXTURE, runsDir: runs, server: { anchorUrl: stub.url, jwt: 'test-jwt' } }),
      ).rejects.toThrow(/import anchoring failed/);
      // Nothing half-written survives: no import dir, no registry entry.
      await expect(readFile(join(runs, 'imports.json'), 'utf8')).rejects.toThrow();
    } finally {
      await stub.close();
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('fails a tampered imported chain at L0', async () => {
    const { runs, result } = await importFixture();
    try {
      const meta = JSON.parse(await readFile(result.importPath, 'utf8')) as {
        nonce: string;
        publicKey: string;
      };
      const lines = (await readFile(result.chainPath, 'utf8')).trim().split('\n');
      const tamperedLine = JSON.parse(lines[2]) as { event: { payload: { tests: { passed: number } } } };
      tamperedLine.event.payload.tests.passed = 999;
      lines[2] = JSON.stringify(tamperedLine);
      await writeFile(result.chainPath, `${lines.join('\n')}\n`, 'utf8');
      const records = await loadChainRecords(result.chainPath);
      const verdict = verifySession(
        records.map((r) => r.event),
        [],
        factsFor(result, meta, 'ab'.repeat(32)),
      );
      expect(verdict.level).toBe('L0');
      expect(verdict.reasons).toEqual(['chain_break:hash_mismatch@seq:2']);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('rejects duplicate imports by content digest', async () => {
    const runs = await tempRuns();
    try {
      const file = await writeLog(runs, 'dup.jsonl', [test('2026-10-20T09:00:00.000Z', 1, 0)]);
      const first = await v1Import({ logPath: file, runsDir: runs });
      await expect(v1Import({ logPath: file, runsDir: runs })).rejects.toThrow(
        new RegExp(`duplicate import.*${first.sessionId}`),
      );
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('flags impossible timestamp ordering without rejecting', async () => {
    const runs = await tempRuns();
    try {
      const file = await writeLog(runs, 'skew.jsonl', [
        test('2026-10-20T09:05:00.000Z', 1, 0),
        edit('2026-10-20T09:01:00.000Z'),
      ]);
      const result = await v1Import({ logPath: file, runsDir: runs });
      expect(result.count).toBe(2);
      expect(result.flags).toEqual(['timestamp-order-violation@seq:1']);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });
});

describe('importLog formats and errors', () => {
  it('has no production parsers yet: the test-only format stays invisible', async () => {
    const runs = await tempRuns();
    try {
      await expect(importLog({ logPath: FIXTURE, runsDir: runs })).rejects.toThrow(
        /unknown log format: no parser matched.*none registered yet/,
      );
      await expect(
        importLog({ logPath: FIXTURE, runsDir: runs, format: 'vv-agent-log/1' }),
      ).rejects.toThrow(/unknown log format: "vv-agent-log\/1"/);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('forces the injected format explicitly', async () => {
    const runs = await tempRuns();
    try {
      const result = await v1Import({ logPath: FIXTURE, runsDir: runs, format: 'vv-agent-log/1' });
      expect(result.format).toBe('vv-agent-log/1');
      expect(result.count).toBe(7);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('rejects unknown formats with a clear error', async () => {
    const runs = await tempRuns();
    try {
      const file = join(runs, 'weird.log');
      await writeFile(file, 'this is not json at all\n', 'utf8');
      await expect(v1Import({ logPath: file, runsDir: runs })).rejects.toThrow(
        /unknown log format: no parser matched \(known: vv-agent-log\/1\)/,
      );
      await expect(importLog({ logPath: file, runsDir: runs, parsers: [] })).rejects.toThrow(
        /unknown log format: no parser matched.*none registered yet/,
      );
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('rejects forced unknown formats and empty logs', async () => {
    const runs = await tempRuns();
    try {
      await expect(v1Import({ logPath: FIXTURE, runsDir: runs, format: 'nope' })).rejects.toThrow(
        /unknown log format: "nope" \(known: vv-agent-log\/1\)/,
      );
      const empty = join(runs, 'empty.jsonl');
      await writeFile(empty, '\n', 'utf8');
      await expect(v1Import({ logPath: empty, runsDir: runs })).rejects.toThrow(/unknown log format/);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('reports malformed entries with line numbers', async () => {
    const runs = await tempRuns();
    try {
      const file = join(runs, 'bad.jsonl');
      await writeFile(
        file,
        `${JSON.stringify(test('2026-10-20T09:00:00.000Z', 1, 0))}\n${JSON.stringify({ v: 1, ts: '2026-10-20T09:01:00.000Z', event: 'test', passed: 'lots', failed: 0 })}\n`,
        'utf8',
      );
      await expect(v1Import({ logPath: file, runsDir: runs })).rejects.toThrow(
        /line 2: test entry needs numeric passed\/failed/,
      );
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('fails clearly for missing files', async () => {
    const runs = await tempRuns();
    try {
      await expect(v1Import({ logPath: join(runs, 'nope.jsonl'), runsDir: runs })).rejects.toThrow(
        /cannot read log/,
      );
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });
});

describe('importLog repo corroboration', () => {
  it('notes commit overlap as a note, never a level change', async () => {
    const runs = await tempRuns();
    try {
      const commitAt = Math.floor(Date.parse('2026-10-20T09:04:00.000Z') / 1000);
      const result = await v1Import({
        logPath: FIXTURE,
        runsDir: runs,
        repoPath: '/repo/that/need/not/exist',
        gitLogTimestamps: async () => [commitAt],
      });
      expect(result.notes[0]).toMatch(/repo-history: 7\/7 events within 60min of a commit/);
      expect(result.notes[1]).toMatch(/offline import/);
      expect(result.provenance).toBe('retroactive');
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });

  it('notes unavailable repos instead of failing', async () => {
    const runs = await tempRuns();
    try {
      const result = await v1Import({
        logPath: FIXTURE,
        runsDir: runs,
        repoPath: join(runs, 'no-repo-here'),
      });
      expect(result.notes[0]).toMatch(/repo-history unavailable/);
      expect(result.notes[1]).toMatch(/offline import/);
    } finally {
      await rm(runs, { recursive: true, force: true });
    }
  });
});
