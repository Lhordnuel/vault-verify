import { describe, expect, it } from 'vitest';
import { anchorCanonicalJson, handleSessionRequest } from '../handler.ts';
import type { AnchorRow, AuthVerifier, HandlerDeps, SessionRow, SessionStore } from '../handler.ts';
import { canonicalJson } from '../../../../packages/core/src/crypto.node.js';
import { publicKeyFromSeedHex } from '../../../../packages/core/src/crypto.node.js';
import { verifyAnchorReceipt } from '../../../../packages/core/src/verify.node.js';

const USER_JWT = 'jwt-user-1';
const USER_ID = 'user-1';
const OTHER_JWT = 'jwt-user-2';
const OTHER_USER_ID = 'user-2';
const TEST_SERVER_SEED = '0f'.repeat(32); // TEST ONLY
const SERVER_TIME = '2026-10-28T00:00:00.000Z';

function makeStore() {
  const candidates = new Map<string, string>();
  const sessions = new Map<string, SessionRow>();
  const anchors: AnchorRow[] = [];
  let nextSession = 0;
  const store: SessionStore = {
    async ensureCandidateId(authUserId: string): Promise<string> {
      const existing = candidates.get(authUserId);
      if (existing) return existing;
      const id = `candidate-${candidates.size + 1}`;
      candidates.set(authUserId, id);
      return id;
    },
    async createSession(candidateId: string, publicKey: string, nonce: string): Promise<string> {
      nextSession += 1;
      const id = `00000000-0000-0000-0000-${String(nextSession).padStart(12, '0')}`;
      sessions.set(id, { id, candidateId, publicKey, nonce });
      return id;
    },
    async getSession(sessionId: string): Promise<SessionRow | null> {
      return sessions.get(sessionId) ?? null;
    },
    async latestAnchorSeq(sessionId: string): Promise<number | null> {
      const seqs = anchors.filter((a) => a.sessionId === sessionId).map((a) => a.seq);
      return seqs.length > 0 ? Math.max(...seqs) : null;
    },
    async insertAnchor(row: AnchorRow): Promise<void> {
      anchors.push(row);
    },
  };
  return { store, sessions, anchors };
}

const auth: AuthVerifier = {
  async getUserId(jwt: string): Promise<string | null> {
    if (jwt === USER_JWT) return USER_ID;
    if (jwt === OTHER_JWT) return OTHER_USER_ID;
    return null;
  },
};

function depsFor(store: SessionStore, overrides?: Partial<HandlerDeps>): HandlerDeps {
  return {
    store,
    auth,
    anchorSigningSeedHex: TEST_SERVER_SEED,
    nowIso: () => SERVER_TIME,
    randomHex: (bytes: number) => 'ab'.repeat(bytes),
    ...overrides,
  };
}

function post(path: string, body?: unknown, jwt: string | null = USER_JWT): Request {
  return new Request(`https://edge.test${path}`, {
    method: 'POST',
    headers: {
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function errCode(res: { status: number; body: unknown }): string {
  const body = res.body as { error?: { code?: unknown } };
  return typeof body.error?.code === 'string' ? body.error.code : '';
}

describe('POST /session/start', () => {
  it('issues a nonce and registers the session key', async () => {
    const { store, sessions } = makeStore();
    const res = await handleSessionRequest(post('/session/start', { publicKey: '11'.repeat(32) }), depsFor(store));
    expect(res.status).toBe(200);
    const body = res.body as { sessionId: string; nonce: string; candidateId: string };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.nonce).toBe('ab'.repeat(16));
    expect(body.candidateId).toBe('candidate-1');
    expect(sessions.get(body.sessionId)?.publicKey).toBe('11'.repeat(32));
  });

  it('rejects missing/invalid auth', async () => {
    const { store } = makeStore();
    const deps = depsFor(store);
    expect((await handleSessionRequest(post('/session/start', { publicKey: '11'.repeat(32) }, null), deps)).status).toBe(401);
    expect(errCode(await handleSessionRequest(post('/session/start', { publicKey: '11'.repeat(32) }, 'bogus'), deps))).toBe(
      'unauthorized',
    );
  });

  it('rejects bad public keys', async () => {
    const { store } = makeStore();
    const deps = depsFor(store);
    for (const publicKey of [undefined, 'zz', '11'.repeat(31), 'AA'.repeat(32), 42]) {
      const res = await handleSessionRequest(post('/session/start', { publicKey }), deps);
      expect(res.status).toBe(400);
      expect(errCode(res)).toBe('bad_public_key');
    }
  });

  it('rejects non-JSON bodies, wrong methods, and unknown paths', async () => {
    const { store } = makeStore();
    const deps = depsFor(store);
    const noBody = new Request('https://edge.test/session/start', {
      method: 'POST',
      headers: { authorization: `Bearer ${USER_JWT}` },
    });
    expect(errCode(await handleSessionRequest(noBody, deps))).toBe('bad_json');
    const get = new Request('https://edge.test/session/start', {
      headers: { authorization: `Bearer ${USER_JWT}` },
    });
    expect((await handleSessionRequest(get, deps)).status).toBe(405);
    expect((await handleSessionRequest(post('/session/nope', {}), deps)).status).toBe(404);
  });
});

describe('POST /session/anchor', () => {
  async function startSession(): Promise<{ deps: HandlerDeps; sessionId: string; store: SessionStore }> {
    const { store } = makeStore();
    const deps = depsFor(store);
    const res = await handleSessionRequest(post('/session/start', { publicKey: '22'.repeat(32) }), deps);
    const body = res.body as { sessionId: string };
    return { deps, sessionId: body.sessionId, store };
  }

  it('stores and countersigns anchors with increasing seq', async () => {
    const { deps, sessionId, store } = await startSession();
    const first = await handleSessionRequest(
      post('/session/anchor', { sessionId, seq: 0, headHash: 'aa'.repeat(32) }),
      deps,
    );
    expect(first.status).toBe(200);
    const receipt = first.body as { sessionId: string; seq: number; headHash: string; serverTime: string; signature: string };
    expect(receipt).toMatchObject({ sessionId, seq: 0, headHash: 'aa'.repeat(32), serverTime: SERVER_TIME });
    expect(receipt.signature).toMatch(/^[0-9a-f]{128}$/);
    const second = await handleSessionRequest(
      post('/session/anchor', { sessionId, seq: 5, headHash: 'bb'.repeat(32) }),
      deps,
    );
    expect(second.status).toBe(200);
    expect(await store.latestAnchorSeq(sessionId)).toBe(5);
  });

  it('countersignatures verify under core (interop)', async () => {
    const { deps, sessionId } = await startSession();
    const res = await handleSessionRequest(
      post('/session/anchor', { sessionId, seq: 3, headHash: 'cc'.repeat(32) }),
      deps,
    );
    expect(res.status).toBe(200);
    const receipt = res.body as { sessionId: string; seq: number; headHash: string; serverTime: string; signature: string };
    expect(verifyAnchorReceipt(receipt, publicKeyFromSeedHex(TEST_SERVER_SEED))).toBe(true);
  });

  it('serializes anchors byte-identically to core JCS', () => {
    const input = {
      sessionId: '33333333-3333-3333-3333-333333333333',
      seq: 7,
      headHash: 'dd'.repeat(32),
      serverTime: SERVER_TIME,
    };
    expect(anchorCanonicalJson(input)).toBe(
      canonicalJson({ sessionId: input.sessionId, seq: input.seq, headHash: input.headHash, serverTime: input.serverTime }),
    );
  });

  it('rejects unknown sessions', async () => {
    const { store } = makeStore();
    const res = await handleSessionRequest(
      post('/session/anchor', { sessionId: '99999999-9999-9999-9999-999999999999', seq: 0, headHash: 'aa'.repeat(32) }),
      depsFor(store),
    );
    expect(res.status).toBe(404);
    expect(errCode(res)).toBe('unknown_session');
  });

  it('rejects non-increasing seq', async () => {
    const { deps, sessionId } = await startSession();
    const headHash = 'aa'.repeat(32);
    expect((await handleSessionRequest(post('/session/anchor', { sessionId, seq: 2, headHash }), deps)).status).toBe(200);
    const repeat = await handleSessionRequest(post('/session/anchor', { sessionId, seq: 2, headHash }), deps);
    expect(repeat.status).toBe(409);
    expect(errCode(repeat)).toBe('seq_not_increasing');
    const body = repeat.body as { error: { latestSeq: number } };
    expect(body.error.latestSeq).toBe(2);
    const lower = await handleSessionRequest(post('/session/anchor', { sessionId, seq: 1, headHash }), deps);
    expect(lower.status).toBe(409);
  });

  it('rejects sessions owned by another candidate', async () => {
    const { deps, sessionId } = await startSession();
    const res = await handleSessionRequest(
      post('/session/anchor', { sessionId, seq: 0, headHash: 'aa'.repeat(32) }, OTHER_JWT),
      deps,
    );
    expect(res.status).toBe(403);
    expect(errCode(res)).toBe('session_not_owned');
  });

  it('rejects malformed bodies', async () => {
    const { deps } = await startSession();
    const cases: Array<[unknown, string]> = [
      [{ sessionId: 'nope', seq: 0, headHash: 'aa'.repeat(32) }, 'bad_session_id'],
      [{ sessionId: '44444444-4444-4444-4444-444444444444', seq: -1, headHash: 'aa'.repeat(32) }, 'bad_seq'],
      [{ sessionId: '44444444-4444-4444-4444-444444444444', seq: 1.5, headHash: 'aa'.repeat(32) }, 'bad_seq'],
      [{ sessionId: '44444444-4444-4444-4444-444444444444', seq: 0, headHash: 'zz' }, 'bad_head_hash'],
    ];
    for (const [body, code] of cases) {
      const res = await handleSessionRequest(post('/session/anchor', body), deps);
      expect(res.status).toBe(400);
      expect(errCode(res)).toBe(code);
    }
  });

  it('fails closed when the server key is missing', async () => {
    const { deps, sessionId } = await startSession();
    const noKey = depsFor(deps.store, { anchorSigningSeedHex: null });
    const res = await handleSessionRequest(
      post('/session/anchor', { sessionId, seq: 0, headHash: 'aa'.repeat(32) }),
      noKey,
    );
    expect(res.status).toBe(500);
    expect(errCode(res)).toBe('server_misconfigured');
  });
});
