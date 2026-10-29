import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AnchorReceiptSchema, SessionStartResponseSchema, type AnchorReceipt } from '@vault-verify/core';
import { generateSessionKeypair } from '@vault-verify/core/node';

export interface RunSession {
  sessionId: string;
  nonce: string;
  candidateId: string;
  publicKey: string;
  keyFile: string;
  anchorUrl: string;
  createdAt: string;
}

export async function postJson(url: string, jwt: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = (await res.json()) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export function anchorErrorMessage(json: unknown, fallback: string): string {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const error = (json as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      return `[harness] anchor service: ${String(code)}${typeof message === 'string' ? ` (${message})` : ''}`;
    }
  }
  return fallback;
}

export async function registerSession(opts: {
  anchorUrl: string;
  jwt: string;
  metaDir: string;
}): Promise<RunSession> {
  const keypair = generateSessionKeypair();
  const { status, json } = await postJson(
    `${opts.anchorUrl.replace(/\/+$/, '')}/session/start`,
    opts.jwt,
    { publicKey: keypair.publicKey },
  );
  if (status !== 200) throw new Error(anchorErrorMessage(json, `[harness] session start failed (HTTP ${status}).`));
  const parsed = SessionStartResponseSchema.parse(json);
  const keyFile = join(opts.metaDir, 'keys', 'session.key');
  await mkdir(dirname(keyFile), { recursive: true });
  await writeFile(keyFile, `${keypair.privateKey}\n`, { mode: 0o600 });
  try {
    await chmod(keyFile, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return {
    sessionId: parsed.sessionId,
    nonce: parsed.nonce,
    candidateId: parsed.candidateId,
    publicKey: keypair.publicKey,
    keyFile,
    anchorUrl: opts.anchorUrl,
    createdAt: new Date().toISOString(),
  };
}

export async function loadPrivateKey(keyFile: string): Promise<string> {
  return (await readFile(keyFile, 'utf8')).trim();
}

export async function anchorHead(opts: {
  anchorUrl: string;
  jwt: string;
  sessionId: string;
  seq: number;
  headHash: string;
}): Promise<AnchorReceipt> {
  const { status, json } = await postJson(`${opts.anchorUrl.replace(/\/+$/, '')}/session/anchor`, opts.jwt, {
    sessionId: opts.sessionId,
    seq: opts.seq,
    headHash: opts.headHash,
  });
  if (status !== 200) throw new Error(anchorErrorMessage(json, `[harness] anchor failed (HTTP ${status}).`));
  return AnchorReceiptSchema.parse(json);
}

export async function saveSession(metaDir: string, session: RunSession): Promise<string> {
  const file = join(metaDir, 'session.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return file;
}

export async function loadSession(metaDir: string): Promise<RunSession> {
  const raw = JSON.parse(await readFile(join(metaDir, 'session.json'), 'utf8')) as Record<string, unknown>;
  for (const key of ['sessionId', 'nonce', 'candidateId', 'publicKey', 'keyFile', 'anchorUrl', 'createdAt']) {
    if (typeof raw[key] !== 'string') throw new Error('[harness] corrupt session.json.');
  }
  return raw as unknown as RunSession;
}
