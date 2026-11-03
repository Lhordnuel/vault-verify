import { getCookie } from 'hono/cookie';
import type { AuthMiddleware, AuthUser, Bindings } from './types.js';

const SESSION_COOKIE = 'attest_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub: userId, iat: now, exp: now + SESSION_TTL_MS / 1000 }));
  const body = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body)));
  return `${body}.${base64Url(signature)}`;
}

async function tokenUser(token: string, env: Bindings): Promise<AuthUser | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let payload: { sub?: string; exp?: number };
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env.SESSION_SECRET),
      arrayBuffer(fromBase64Url(parts[2])),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
  if (!payload.sub || !payload.exp || payload.exp * 1000 <= Date.now()) return null;
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  const tokenHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const row = await env.DB.prepare(
    `SELECT users.id, users.github_username, users.handle
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.user_id = ? AND sessions.expires_at > ?`,
  ).bind(tokenHash, payload.sub, Date.now()).first<AuthUser>();
  return row ?? null;
}

export async function createSession(userId: string, env: Bindings): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured.');
  const token = await signToken(userId, env.SESSION_SECRET);
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  const tokenHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, tokenHash, Date.now() + SESSION_TTL_MS)
    .run();
  return token;
}

export const requireUser: AuthMiddleware = async (c, next) => {
  const authorization = c.req.header('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'authentication_required' }, 401);
  const user = await tokenUser(token, c.env);
  if (!user) return c.json({ error: 'invalid_or_expired_session' }, 401);
  c.set('user', user);
  await next();
};

async function githubUser(accessToken: string): Promise<{ id: number; login: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'Attest' },
  });
  if (!response.ok) throw new Error(`GitHub profile lookup returned HTTP ${response.status}`);
  return response.json<{ id: number; login: string }>();
}

export async function establishUser(accessToken: string, env: Bindings): Promise<{ token: string; user: AuthUser }> {
  const github = await githubUser(accessToken);
  const existing = await env.DB.prepare('SELECT id, github_username, handle FROM users WHERE github_username = ?')
    .bind(github.login)
    .first<AuthUser>();
  let user = existing;
  if (!user) {
    const id = crypto.randomUUID();
    const base = github.login.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'developer';
    const handle = (await env.DB.prepare('SELECT id FROM users WHERE handle = ?').bind(base).first())
      ? `${base}-${id.slice(0, 6)}`
      : base;
    await env.DB.prepare('INSERT INTO users (id, github_username, handle, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, github.login, handle, Date.now())
      .run();
    user = { id, github_username: github.login, handle };
  }
  const token = await createSession(user.id, env);
  return { token, user };
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
