import { createHash } from 'node:crypto';
import { HARNESS_COLLECTOR_ID } from './config.js';
import type { ChainRecord } from './chainstore.js';

function uuidFromHash32(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/** Deterministic event id: same session+seq always maps to the same row (retry-safe upserts). */
export function eventRowId(sessionId: string, seq: number): string {
  const full = createHash('sha256').update(`${sessionId}:${seq}`, 'utf8').digest('hex');
  return uuidFromHash32(full.slice(0, 32));
}

export interface UploadResult {
  attempted: number;
  upserted: number;
}

/** Upload the chain as evidence rows (L2 at collection; L3/L4 promotion is a later verifier pass). */
export async function uploadChain(args: {
  supabaseUrl: string;
  anonKey: string;
  jwt: string;
  candidateId: string;
  sessionId: string;
  records: ChainRecord[];
}): Promise<UploadResult> {
  if (args.records.length === 0) return { attempted: 0, upserted: 0 };
  const url = `${args.supabaseUrl.replace(/\/+$/, '')}/rest/v1/evidence_items?on_conflict=id`;
  const rows = args.records.map((r) => ({
    id: eventRowId(args.sessionId, r.event.seq),
    candidate_id: args.candidateId,
    kind: r.kind,
    tier: 1,
    verification_level: 'L2',
    collector_id: HARNESS_COLLECTOR_ID,
    session_id: args.sessionId,
    seq: r.event.seq,
    prev_hash: r.event.prevHash,
    payload: r.event.payload,
    hash: r.event.hash,
    sig: r.event.sig,
    summary: r.summary ?? null,
    collected_at: r.collectedAt,
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: args.anonKey,
      authorization: `Bearer ${args.jwt}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[harness] upload failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
  return { attempted: rows.length, upserted: rows.length };
}
