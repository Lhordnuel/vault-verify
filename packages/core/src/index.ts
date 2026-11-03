export interface CommitEvidence {
  id: string;
  claim_type: string;
  claim_value: string;
  source: 'git';
  status: 'Supported';
  confidence: null;
  evidence_ref: {
    commit_hash: string;
    parent_hashes: string[];
    committed_at: string;
    repository: string;
    repository_url?: string;
    message: string;
    files: string[];
    quote: string;
    previous_hash: string;
    chain_hash: string;
  };
  captured_at: number;
}

export interface SessionEvidence {
  id: string;
  claim_type: string;
  claim_value: string;
  source: 'session';
  status: 'Supported' | 'Unverified';
  confidence: null;
  evidence_ref: {
    session_id: string;
    format: string;
    event_id: string;
    event_type: string;
    actor: string;
    occurred_at: string;
    quote: string;
    verification_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
    verification_reasons: string[];
    previous_hash: string;
    chain_hash: string;
  };
  captured_at: number;
}

export type EvidenceNode = CommitEvidence | SessionEvidence;

export interface SyncPayload {
  handle: string;
  evidence: EvidenceNode[];
}

export { parseSessionLogText, sessionEvidenceFromImport } from './session-log.js';
export type { ImportedSessionEvent, ImportedSessionLog } from './session-log.js';

export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createChainHash(
  previousHash: string,
  evidence: Record<string, unknown>,
  reference: Record<string, unknown>,
): Promise<string> {
  return sha256(`${previousHash}\n${canonicalJson({ ...evidence, evidence_ref: reference })}`);
}
