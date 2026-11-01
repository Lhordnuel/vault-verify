export interface CommitEvidence {
  id: string;
  claim_type: string;
  claim_value: string;
  source: string;
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

export interface SyncPayload {
  handle: string;
  evidence: CommitEvidence[];
}

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
  evidence: Omit<CommitEvidence, 'evidence_ref'>,
  reference: Omit<CommitEvidence['evidence_ref'], 'previous_hash' | 'chain_hash'>,
): Promise<string> {
  return sha256(`${previousHash}\n${canonicalJson({ ...evidence, evidence_ref: reference })}`);
}
