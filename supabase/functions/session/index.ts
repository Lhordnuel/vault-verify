/**
 * Deno adapter: wires the pure handler to Supabase + env. Thin by design;
 * all logic lives in handler.ts (unit-tested). This file is type-checked
 * but not unit-tested.
 */
import { handleSessionRequest } from './handler.ts';
import type { AuthVerifier, SessionStore } from './handler.ts';

// @ts-ignore: Deno resolves https imports; tsc cannot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANCHOR_SEED = Deno.env.get('ANCHOR_SIGNING_KEY');

Deno.serve(async (req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json(
      { error: { code: 'server_misconfigured', message: 'Supabase env missing.' } },
      { status: 500 },
    );
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const store: SessionStore = {
    async ensureCandidateId(authUserId: string): Promise<string> {
      const existing = await admin.from('candidates').select('id').eq('auth_user_id', authUserId).maybeSingle();
      if (existing.error) throw new Error(`candidates lookup failed: ${existing.error.message}`);
      if (existing.data) return (existing.data as { id: string }).id;
      const user = await admin.auth.admin.getUserById(authUserId);
      const meta = (user.data?.user?.user_metadata ?? {}) as Record<string, unknown>;
      const email: unknown = user.data?.user?.email;
      const handle =
        (typeof meta['user_name'] === 'string' && meta['user_name']) ||
        (typeof meta['full_name'] === 'string' && meta['full_name']) ||
        (typeof email === 'string' && email.includes('@') ? email.split('@')[0] : '') ||
        `user-${authUserId.slice(0, 8)}`;
      const created = await admin
        .from('candidates')
        .insert({ auth_user_id: authUserId, handle })
        .select('id')
        .single();
      if (created.error || !created.data) {
        throw new Error(`candidates insert failed: ${created.error?.message ?? 'unknown'}`);
      }
      return (created.data as { id: string }).id;
    },
    async createSession(candidateId: string, publicKey: string, nonce: string): Promise<string> {
      const row = await admin
        .from('collector_sessions')
        .insert({ candidate_id: candidateId, public_key: publicKey, nonce })
        .select('id')
        .single();
      if (row.error || !row.data) throw new Error(`session insert failed: ${row.error?.message ?? 'unknown'}`);
      return (row.data as { id: string }).id;
    },
    async getSession(sessionId: string) {
      const row = await admin
        .from('collector_sessions')
        .select('id,candidate_id,public_key,nonce')
        .eq('id', sessionId)
        .maybeSingle();
      if (row.error) throw new Error(`session lookup failed: ${row.error.message}`);
      if (!row.data) return null;
      const d = row.data as { id: string; candidate_id: string; public_key: string; nonce: string };
      return { id: d.id, candidateId: d.candidate_id, publicKey: d.public_key, nonce: d.nonce };
    },
    async latestAnchorSeq(sessionId: string): Promise<number | null> {
      const row = await admin
        .from('anchors')
        .select('to_seq')
        .eq('session_id', sessionId)
        .order('to_seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row.error) throw new Error(`anchor lookup failed: ${row.error.message}`);
      return row.data ? (row.data as { to_seq: number }).to_seq : null;
    },
    async insertAnchor(a): Promise<void> {
      const res = await admin.from('anchors').insert({
        candidate_id: a.candidateId,
        session_id: a.sessionId,
        from_seq: a.fromSeq,
        to_seq: a.seq,
        anchor_hash: a.headHash,
        nonce: a.nonce,
        issuer: a.issuer,
        signature: a.signature,
        anchored_at: a.serverTime,
      });
      if (res.error) throw new Error(`anchor insert failed: ${res.error.message}`);
    },
  };
  const auth: AuthVerifier = {
    async getUserId(jwt: string): Promise<string | null> {
      const res = await admin.auth.getUser(jwt);
      if (res.error || !res.data?.user) return null;
      return res.data.user.id as string;
    },
  };
  try {
    const out = await handleSessionRequest(req, {
      store,
      auth,
      anchorSigningSeedHex: ANCHOR_SEED ?? null,
      nowIso: () => new Date().toISOString(),
      randomHex: (bytes: number) => {
        const buf = new Uint8Array(bytes);
        crypto.getRandomValues(buf);
        return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
      },
    });
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    console.error('[session]', e);
    return Response.json({ error: { code: 'internal', message: 'Unexpected error.' } }, { status: 500 });
  }
});
