/**
 * Anchor service request handler: pure logic with injected dependencies.
 * Zero dependencies apart from node:crypto (Deno + Node compatible).
 * Tested in test/handler.test.ts with in-memory fakes.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';

export interface SessionRow {
  id: string;
  candidateId: string;
  publicKey: string;
  nonce: string;
}

export interface AnchorRow {
  candidateId: string;
  sessionId: string;
  seq: number;
  fromSeq: number;
  headHash: string;
  nonce: string;
  serverTime: string;
  signature: string;
  issuer: string;
}

export interface SessionStore {
  ensureCandidateId(authUserId: string): Promise<string>;
  createSession(candidateId: string, publicKey: string, nonce: string): Promise<string>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  latestAnchorSeq(sessionId: string): Promise<number | null>;
  insertAnchor(row: AnchorRow): Promise<void>;
}

export interface AuthVerifier {
  getUserId(jwt: string): Promise<string | null>;
}

export interface HandlerDeps {
  store: SessionStore;
  auth: AuthVerifier;
  anchorSigningSeedHex: string | null;
  nowIso: () => string;
  randomHex: (bytes: number) => string;
}

export interface HandlerResponse {
  status: number;
  body: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANCHOR_DOMAIN = 'vv-crypto-1:anchor';
const ISSUER = 'anchor/session@1';
/** PKCS#8 DER prefix for an ed25519 seed (16 bytes). Mirrors @vault-verify/core. */
const ED25519_PKCS8_PREFIX = '302e020100300506032b657004220420';

function err(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): HandlerResponse {
  return { status, body: { error: { code, message, ...extra } } };
}

function bearerJwt(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}

async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: (await req.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Byte-identical to JCS for this fixed shape: keys in UTF-16 order
 * (headHash, seq, serverTime, sessionId); values need no escaping
 * (uuid/lowercase-hex/ISO only); seq serializes as a plain integer.
 * MUST match AnchorReceipt canonicalization in @vault-verify/core
 * (interop-tested in test/handler.test.ts).
 */
export function anchorCanonicalJson(input: {
  sessionId: string;
  seq: number;
  headHash: string;
  serverTime: string;
}): string {
  return `{"headHash":${JSON.stringify(input.headHash)},"seq":${input.seq},"serverTime":${JSON.stringify(input.serverTime)},"sessionId":${JSON.stringify(input.sessionId)}}`;
}

function sha256HexUtf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function ed25519SignHex(seedHex: string, digestHex: string): string {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from(ED25519_PKCS8_PREFIX, 'hex'), Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(digestHex, 'hex'), key).toString('hex');
}

export async function handleSessionRequest(req: Request, deps: HandlerDeps): Promise<HandlerResponse> {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'Use POST.');
  if (/(^|\/)session\/start$/.test(path)) return handleStart(req, deps);
  if (/(^|\/)session\/anchor$/.test(path)) return handleAnchor(req, deps);
  return err(404, 'not_found', 'Unknown endpoint.');
}

async function authedUserId(req: Request, deps: HandlerDeps): Promise<string | null> {
  const jwt = bearerJwt(req);
  if (!jwt) return null;
  return deps.auth.getUserId(jwt);
}

async function handleStart(req: Request, deps: HandlerDeps): Promise<HandlerResponse> {
  const userId = await authedUserId(req, deps);
  if (!userId) return err(401, 'unauthorized', 'Missing or invalid bearer token.');
  const parsed = await readJson(req);
  if (!parsed.ok) return err(400, 'bad_json', 'Body must be JSON.');
  const publicKey = isRecord(parsed.value) ? parsed.value['publicKey'] : undefined;
  if (typeof publicKey !== 'string' || !HEX64.test(publicKey)) {
    return err(400, 'bad_public_key', 'publicKey must be 64 lowercase hex chars.');
  }
  const nonce = deps.randomHex(16);
  if (!/^[0-9a-f]{32}$/.test(nonce)) return err(500, 'server_misconfigured', 'Nonce generator failed.');
  const candidateId = await deps.store.ensureCandidateId(userId);
  const sessionId = await deps.store.createSession(candidateId, publicKey, nonce);
  return { status: 200, body: { sessionId, nonce, candidateId } };
}

async function handleAnchor(req: Request, deps: HandlerDeps): Promise<HandlerResponse> {
  const userId = await authedUserId(req, deps);
  if (!userId) return err(401, 'unauthorized', 'Missing or invalid bearer token.');
  const parsed = await readJson(req);
  if (!parsed.ok) return err(400, 'bad_json', 'Body must be JSON.');
  const body = isRecord(parsed.value) ? parsed.value : {};
  const sessionId = body['sessionId'];
  const seq = body['seq'];
  const headHash = body['headHash'];
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
    return err(400, 'bad_session_id', 'sessionId must be a uuid.');
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return err(400, 'bad_seq', 'seq must be an integer >= 0.');
  }
  if (typeof headHash !== 'string' || !HEX64.test(headHash)) {
    return err(400, 'bad_head_hash', 'headHash must be 64 lowercase hex chars.');
  }
  const seed = deps.anchorSigningSeedHex;
  if (!seed || !HEX64.test(seed)) {
    return err(500, 'server_misconfigured', 'Anchor signer not configured.');
  }
  const session = await deps.store.getSession(sessionId);
  if (!session) return err(404, 'unknown_session', 'Unknown session.');
  const callerCandidateId = await deps.store.ensureCandidateId(userId);
  if (session.candidateId !== callerCandidateId) {
    return err(403, 'session_not_owned', 'Session belongs to another candidate.');
  }
  const latest = await deps.store.latestAnchorSeq(sessionId);
  if (latest !== null && seq <= latest) {
    return err(409, 'seq_not_increasing', `seq must exceed ${latest}.`, { latestSeq: latest });
  }
  const serverTime = deps.nowIso();
  const canonical = anchorCanonicalJson({ sessionId, seq, headHash, serverTime });
  const digest = sha256HexUtf8(`${ANCHOR_DOMAIN}\n${canonical}`);
  const signature = ed25519SignHex(seed, digest);
  await deps.store.insertAnchor({
    candidateId: session.candidateId,
    sessionId,
    seq,
    fromSeq: latest === null ? 0 : latest + 1,
    headHash,
    nonce: session.nonce,
    serverTime,
    signature,
    issuer: ISSUER,
  });
  return { status: 200, body: { sessionId, seq, headHash, serverTime, signature } };
}
