import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createChainHash, GENESIS_HASH, type CommitEvidence } from '@attest/core';
import { establishUser, randomToken, requireUser } from './auth.js';
import assessmentRoutes, { gradeAssessment } from './assessments.js';
import type { Bindings } from './types.js';
import { ImageResponse } from 'workers-og';

type Variables = { user: { id: string; handle: string; github_username: string } };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const AUTH_STATE_COOKIE = 'attest_oauth_state';

app.use('/api/*', async (c, next) => {
  const allowedOrigin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
  return cors({ origin: allowedOrigin, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], credentials: true })(c, next);
});

app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'attest-api',
  readiness: {
    github: Boolean(c.env.GH_CLIENT_ID && c.env.GH_CLIENT_SECRET),
    session: Boolean(c.env.SESSION_SECRET),
    meta_ai: Boolean(c.env.META_LLAMA_API_KEY),
  },
}));

app.get('/api/auth/github', (c) => {
  if (!c.env.GH_CLIENT_ID) return c.text('GitHub sign-in is not configured. Set GH_CLIENT_ID in apps/api/.dev.vars.', 503);
  const state = randomToken();
  const appOrigin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
  setCookie(c, AUTH_STATE_COOKIE, state, { httpOnly: true, secure: appOrigin.startsWith('https://'), sameSite: 'Lax', path: '/', maxAge: 600 });
  const params = new URLSearchParams({
    client_id: c.env.GH_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/api/auth/github/callback`,
    scope: 'read:user',
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get('/api/auth/github/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getCookie(c, AUTH_STATE_COOKIE);
  deleteCookie(c, AUTH_STATE_COOKIE, { path: '/' });
  if (!code || !state || !savedState || state !== savedState) return c.text('GitHub sign-in state did not match.', 400);
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GH_CLIENT_ID, client_secret: c.env.GH_CLIENT_SECRET, code }),
  });
  if (!response.ok) return c.text(`GitHub token exchange returned HTTP ${response.status}.`, 502);
  const result = await response.json<{ access_token?: string; error?: string }>();
  if (!result.access_token) return c.text(`GitHub sign-in failed: ${result.error ?? 'missing access token'}.`, 400);
  const session = await establishUser(result.access_token, c.env);
  setCookie(c, 'attest_session', session.token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 60 * 60,
  });
  return c.redirect(c.env.APP_ORIGIN ?? new URL(c.req.url).origin);
});

app.post('/api/cli/device', async (c) => {
  if (!c.env.GH_CLIENT_ID) return c.json({ error: 'github_sign_in_not_configured' }, 503);
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GH_CLIENT_ID, scope: 'read:user' }),
  });
  if (!response.ok) return c.json({ error: `github_device_flow_http_${response.status}` }, 502);
  const body = await response.json<{ device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error?: string }>();
  if (!body.device_code || !body.user_code || !body.verification_uri) return c.json({ error: body.error ?? 'github_device_flow_unavailable' }, 502);
  return c.json(body);
});

app.post('/api/cli/device/token', async (c) => {
  if (!c.env.GH_CLIENT_ID || !c.env.GH_CLIENT_SECRET || !c.env.SESSION_SECRET) {
    return c.json({ error: 'github_sign_in_not_configured' }, 503);
  }
  const body = await c.req.json<{ device_code?: string }>();
  if (!body.device_code) return c.json({ error: 'device_code_required' }, 400);
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GH_CLIENT_ID,
      device_code: body.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (!response.ok) return c.json({ error: `github_device_poll_http_${response.status}` }, 502);
  const result = await response.json<{ access_token?: string; error?: string }>();
  if (result.error === 'authorization_pending') return c.json({ status: result.error }, 202);
  if (result.error === 'slow_down') return c.json({ status: result.error }, 429);
  if (!result.access_token) return c.json({ error: result.error ?? 'github_device_authorization_failed' }, 400);
  const session = await establishUser(result.access_token, c.env);
  return c.json({ token: session.token, handle: session.user.handle });
});

app.get('/api/cli/me', requireUser, (c) => c.json({ handle: c.get('user').handle, username: c.get('user').github_username }));

app.post('/api/cli/sync', requireUser, async (c) => {
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return c.json({ error: 'sync_payload_too_large' }, 413);
  }
  let body: { evidence?: unknown };
  try {
    body = JSON.parse(rawBody) as { evidence?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(body.evidence) || body.evidence.length === 0 || body.evidence.length > 100) {
    return c.json({ error: 'evidence_must_contain_between_1_and_100_items' }, 400);
  }
  const userId = c.get('user').id;
  const statements: D1PreparedStatement[] = [];
  let previousHash = GENESIS_HASH;
  const allowedNodeKeys = new Set(['id', 'claim_type', 'claim_value', 'source', 'status', 'confidence', 'captured_at', 'evidence_ref']);
  const allowedReferenceKeys = new Set([
    'commit_hash', 'parent_hashes', 'committed_at', 'repository', 'repository_url', 'message', 'files', 'quote',
    'previous_hash', 'chain_hash',
  ]);
  const exactKeys = (value: object, allowed: Set<string>, required: Set<string>): boolean => {
    const keys = Object.keys(value);
    return keys.every((key) => allowed.has(key)) && [...required].every((key) => keys.includes(key));
  };
  for (const raw of body.evidence) {
    if (typeof raw !== 'object' || raw === null) return c.json({ error: 'invalid_evidence_node' }, 400);
    const node = raw as Partial<CommitEvidence>;
    const ref = node.evidence_ref;
    if (
      !exactKeys(node, allowedNodeKeys, allowedNodeKeys) || typeof node.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(node.id) ||
      typeof node.claim_type !== 'string' || node.claim_type.length > 80 ||
      typeof node.claim_value !== 'string' || node.claim_value.length > 1200 ||
      typeof node.source !== 'string' || node.source !== 'git' || node.status !== 'Supported' ||
      node.confidence !== null || !Number.isSafeInteger(node.captured_at) || !ref ||
      !exactKeys(ref, allowedReferenceKeys, new Set(['commit_hash', 'parent_hashes', 'committed_at', 'repository', 'message', 'files', 'quote', 'previous_hash', 'chain_hash'])) ||
      !/^[a-f0-9]{40,64}$/i.test(ref.commit_hash) || typeof ref.message !== 'string' ||
      ref.message.length > 1000 || typeof ref.quote !== 'string' || ref.quote.length > 600 ||
      typeof ref.repository !== 'string' || !/^[\w.-]{1,120}$/.test(ref.repository) ||
      !Array.isArray(ref.parent_hashes) || ref.parent_hashes.length > 2 ||
      !ref.parent_hashes.every((hash) => /^[a-f0-9]{40,64}$/i.test(hash)) ||
      !Array.isArray(ref.files) || ref.files.length > 40 ||
      !ref.files.every((file) => typeof file === 'string' && file.length <= 500) ||
      !Number.isFinite(Date.parse(ref.committed_at)) ||
      (ref.repository_url !== undefined && (typeof ref.repository_url !== 'string' ||
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ref.repository_url))) ||
      ref.previous_hash !== previousHash || !/^[a-f0-9]{64}$/i.test(ref.chain_hash)
    ) return c.json({ error: 'invalid_evidence_chain' }, 400);
    const { chain_hash: suppliedHash, previous_hash: suppliedPrevious, ...reference } = ref;
    const { evidence_ref: _evidenceRef, ...base } = node;
    if (
      typeof base.id !== 'string' || typeof base.claim_type !== 'string' || typeof base.claim_value !== 'string' ||
      typeof base.source !== 'string' || base.status !== 'Supported' || base.confidence !== null ||
      !Number.isSafeInteger(base.captured_at)
    ) return c.json({ error: 'invalid_evidence_node' }, 400);
    const expectedHash = await createChainHash(suppliedPrevious, base as Omit<CommitEvidence, 'evidence_ref'>, reference);
    if (expectedHash !== suppliedHash) return c.json({ error: 'evidence_chain_hash_mismatch' }, 400);
    previousHash = suppliedHash;
    statements.push(c.env.DB.prepare(
      `INSERT INTO evidence_nodes (id, user_id, claim_type, claim_value, source, status, confidence, evidence_ref, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(node.id, userId, node.claim_type, node.claim_value, node.source, node.status, null, JSON.stringify(ref), node.captured_at));
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM evidence_nodes WHERE user_id = ?').bind(userId),
    ...statements,
  ]);
  return c.json({ synced: statements.length });
});

app.delete('/api/cli/wipe', requireUser, async (c) => {
  const userId = c.get('user').id;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM evidence_nodes WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('DELETE FROM assessments WHERE user_id = ?').bind(userId),
  ]);
  let cursor: string | undefined;
  do {
    const objects = await c.env.ARTIFACTS.list({ prefix: `${userId}/`, ...(cursor ? { cursor } : {}) });
    if (objects.objects.length) await c.env.ARTIFACTS.delete(objects.objects.map((object) => object.key));
    cursor = objects.truncated ? objects.cursor : undefined;
  } while (cursor);
  return c.json({ deleted: true });
});

app.get('/api/evidence/:handle', async (c) => {
  const handle = c.req.param('handle').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const user = await c.env.DB.prepare('SELECT id, handle, github_username FROM users WHERE handle = ?')
    .bind(handle).first<{ id: string; handle: string; github_username: string }>();
  if (!user) return c.json({ error: 'profile_not_found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT id, claim_type, claim_value, source, status, confidence, evidence_ref, captured_at
     FROM evidence_nodes WHERE user_id = ? ORDER BY captured_at DESC`,
  ).bind(user.id).all<Record<string, unknown>>();
  const assessments = await c.env.DB.prepare(
    `SELECT id, ai_grade, ai_grade_confidence, grader_agreement, human_review_required, status, graded_at
     FROM assessments WHERE user_id = ? AND status IN ('graded', 'human_review_required')
     ORDER BY graded_at DESC`,
  ).bind(user.id).all<Record<string, unknown>>();
  return c.json({
    handle: user.handle,
    github_username: user.github_username,
    claims: rows.results.map((row) => ({
      ...row,
      evidence_ref: JSON.parse(String(row.evidence_ref)),
    })),
    assessments: assessments.results.map((row) => ({
      ...row, ai_grade: row.ai_grade === null ? null : JSON.parse(String(row.ai_grade)),
    })),
    signal_summary: rows.results.length ? 'Evidence claims are linked to cited git history.' : 'No significant signals detected.',
  });
});

app.get('/api/og/:handle', async (c) => {
  const handle = c.req.param('handle').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const user = await c.env.DB.prepare('SELECT handle FROM users WHERE handle = ?').bind(handle).first<{ handle: string }>();
  if (!user) return c.json({ error: 'profile_not_found' }, 404);
  const safeHandle = user.handle.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
  return new ImageResponse(
    `<div style="width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:80px;background:#101311;color:#e8eee8;font-family:Arial,sans-serif"><div style="font-size:28px;color:#88e8b3;letter-spacing:8px">ATTEST / EVIDENCE PROFILE</div><div style="margin-top:42px;font-size:72px">${safeHandle}</div><div style="margin-top:24px;font-size:30px;color:#a4afa6">Specific claims, backed by verifiable evidence.</div><div style="position:absolute;right:80px;bottom:60px;font-size:20px;color:#88e8b3">attest.sh</div></div>`,
    { width: 1200, height: 630, format: 'png' },
  );
});

app.route('/api/test', assessmentRoutes);
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'internal_error', message: error.message }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ assessmentId: string }>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
      try {
        await gradeAssessment(env, message.body.assessmentId);
        message.ack();
      } catch (error) {
        console.error('grading failed', message.body.assessmentId, error);
        if (message.attempts >= 3) {
          await env.DB.prepare(`UPDATE assessments SET status = 'failed' WHERE id = ? AND status = 'grading'`)
            .bind(message.body.assessmentId).run();
          message.ack();
        } else {
          message.retry();
        }
      }
    }
  },
};
