import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnchorReceipt, SignedEvent } from '@vault-verify/core';
import {
  anchorDigest,
  genesisPrevHashFromNonce,
  publicKeyFromSeedHex,
  signHashHex,
  verifyAnchorReceipt,
  verifyChain,
} from '@vault-verify/core/node';

const TEST_SERVER_SEED = '0e'.repeat(32); // TEST ONLY
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CANDIDATE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NONCE = 'cc'.repeat(16);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, '..');
const CLI_JS = join(PKG_DIR, 'dist', 'cli.js');

interface EvidenceRow {
  id: string;
  seq: number;
  hash: string;
  sig: string;
  [key: string]: unknown;
}

let server: Server;
let baseUrl = '';
let receipts: AnchorReceipt[] = [];
let rows: EvidenceRow[] = [];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk: unknown) => {
      text += String(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(text) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  // Build the real dist CLI once, then exercise it as a subprocess.
  const tsc = join(PKG_DIR, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: PKG_DIR }, (error, stdout, stderr) => {
      if (error) reject(new Error(`harness build failed: ${String(stderr || stdout).slice(0, 2000)}`));
      else resolve();
    });
  });
  let latestSeq: number | null = null;
  server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '';
      try {
        if (req.method === 'POST' && url.endsWith('/session/start')) {
          await readBody(req);
          json(res, 200, { sessionId: SESSION_ID, nonce: NONCE, candidateId: CANDIDATE_ID });
        } else if (req.method === 'POST' && url.endsWith('/session/anchor')) {
          const body = (await readBody(req)) as { seq?: unknown; headHash?: unknown };
          const seq = body.seq as number;
          const headHash = body.headHash as string;
          if (latestSeq !== null && seq <= latestSeq) {
            json(res, 409, { error: { code: 'seq_not_increasing', message: 'nope' } });
            return;
          }
          latestSeq = seq;
          const serverTime = new Date().toISOString();
          const digest = anchorDigest({ sessionId: SESSION_ID, seq, headHash, serverTime });
          const receipt: AnchorReceipt = {
            sessionId: SESSION_ID,
            seq,
            headHash,
            serverTime,
            signature: signHashHex(TEST_SERVER_SEED, digest),
          };
          receipts.push(receipt);
          json(res, 200, receipt);
        } else if (req.method === 'POST' && url.includes('/rest/v1/evidence_items')) {
          const body = (await readBody(req)) as EvidenceRow[];
          rows.push(...body);
          json(res, 201, []);
        } else {
          json(res, 404, { error: { code: 'not_found', message: url } });
        }
      } catch (error) {
        json(res, 500, { error: { code: 'stub_error', message: error instanceof Error ? error.message : String(error) } });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server failed to bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
  });
});

async function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_JS, ...args], { cwd, env, timeout: 120000 }, (error, stdout, stderr) => {
      const raw = (error as { code?: unknown } | null)?.code;
      resolve({ code: typeof raw === 'number' ? raw : error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

describe('harness lifecycle (real CLI + stub servers)', () => {
  it('runs start, test, finish end to end', async () => {
    receipts = [];
    rows = [];
    const scratch = await mkdtemp(join(tmpdir(), 'vv-e2e-'));
    try {
      const template = join(scratch, 'template');
      await mkdir(template, { recursive: true });
      await writeFile(join(template, 'vaultverify.json'), JSON.stringify({ testCommand: 'node check.js', name: 'e2e-task' }));
      await writeFile(join(template, 'check.js'), 'process.exit(0);\n');
      await writeFile(join(template, 'README.md'), '# e2e\n');
      const runsDir = join(scratch, 'runs');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        VAULTVERIFY_URL: baseUrl,
        VAULTVERIFY_ANON_KEY: 'test-anon',
        VAULTVERIFY_JWT: 'test-jwt',
        VAULTVERIFY_RUNS_DIR: runsDir,
        VAULTVERIFY_NO_WATCH: '1',
      };

      const start = await runCli(['start', template], env, scratch);
      expect(`${start.stdout}\n${start.stderr}`).toContain('session:');
      expect(start.code).toBe(0);
      const entries = await readdir(runsDir);
      expect(entries).toHaveLength(1);
      const runDir = join(runsDir, entries[0]);
      const session = JSON.parse(await readFile(join(runDir, '.vaultverify', 'session.json'), 'utf8')) as {
        sessionId: string;
        nonce: string;
        candidateId: string;
        publicKey: string;
      };
      expect(session.sessionId).toBe(SESSION_ID);

      await writeFile(join(runDir, 'notes.txt'), 'hello\n');
      const test1 = await runCli(['test', '--dir', runDir], env, scratch);
      expect(test1.code).toBe(0);
      expect(test1.stdout).toContain('anchored: yes');

      await writeFile(join(runDir, 'check.js'), 'process.exit(1);\n');
      const test2 = await runCli(['test', '--dir', runDir], env, scratch);
      expect(test2.code).toBe(1);
      expect(test2.stdout).toContain('anchored: yes');

      const finish = await runCli(['finish', '--dir', runDir], env, scratch);
      expect(`${finish.stdout}\n${finish.stderr}`).toContain('uploaded:');
      expect(finish.code).toBe(0);

      const chainText = await readFile(join(runDir, '.vaultverify', 'chain.jsonl'), 'utf8');
      const events = chainText
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => (JSON.parse(l) as { event: SignedEvent }).event);
      expect(events.length).toBeGreaterThanOrEqual(5);
      const check = verifyChain(events, session.publicKey, {
        expectedGenesisPrevHash: genesisPrevHashFromNonce(session.nonce),
      });
      expect(check).toEqual({ ok: true, count: events.length });

      expect(receipts.length).toBeGreaterThanOrEqual(3);
      const serverPub = publicKeyFromSeedHex(TEST_SERVER_SEED);
      for (const receipt of receipts) {
        expect(verifyAnchorReceipt(receipt, serverPub)).toBe(true);
        expect(events[receipt.seq].hash).toBe(receipt.headHash);
      }
      const seqs = receipts.map((r) => r.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

      expect(rows).toHaveLength(events.length);
      for (const row of rows) {
        const event = events[row.seq];
        expect(row.hash).toBe(event.hash);
        expect(row.sig).toBe(event.sig);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120000);

  it('imports no agent adapters (agent-agnostic)', async () => {
    const srcDir = join(PKG_DIR, 'src');
    const files = (await readdir(srcDir)).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(await readFile(join(srcDir, file), 'utf8')).not.toContain('@vault-verify/adapter');
    }
  });
});
