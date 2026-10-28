#!/usr/bin/env node
/**
 * Pre-commit secret check (Q1). Scans staged files for secret material.
 * Exit 0 = clean, exit 1 = blocked (with reasons).
 *
 * NOTE: detection patterns are built from fragments so this file does not
 * match its own rules when it is staged.
 */
import { execFileSync } from 'node:child_process';

const ALLOWLISTED_NAMES = new Set(['.env.example']);

const BLOCKED_NAME_RULES = [
  { re: /(^|\/)\.env(\..+)?$/, label: 'dotenv file (only .env.example may be committed)' },
  { re: /\.pem$/i, label: 'PEM file' },
  { re: /(^|\/)(id_rsa|id_ed25519)$/, label: 'SSH private key file' },
  { re: /\.key$/i, label: '.key file' },
  { re: /(^|\/)supabase\/\.(temp|branches)\//, label: 'supabase CLI state dir' },
];

// Fragments keep any single line from matching its own rule.
const BEGIN = '-'.repeat(5) + 'BEGIN ';
const PRIV = 'PRIVATE' + ' KEY';
const FENCE = '-'.repeat(5);

const CONTENT_RULES = [
  { re: new RegExp(BEGIN + '.*' + PRIV + FENCE), label: 'PEM private key block' },
  {
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    label: 'JWT-like token (Supabase keys are JWTs)',
  },
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'sk- style secret key' },
  { re: /ghp_[A-Za-z0-9]{20,}/, label: 'GitHub personal access token' },
  { re: /xox[bpras]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
];

const MAX_BLOB_BYTES = 512 * 1024;

function stagedPaths() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter((p) => p.length > 0);
}

function stagedBlob(path) {
  try {
    const size = Number(execFileSync('git', ['cat-file', '-s', `:${path}`], { encoding: 'utf8' }).trim());
    if (!Number.isFinite(size) || size > MAX_BLOB_BYTES) return null; // skip huge blobs
    const buf = execFileSync('git', ['show', `:${path}`], { maxBuffer: 1024 * 1024 });
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null; // deleted / unreadable
  }
}

const violations = [];
for (const path of stagedPaths()) {
  const name = path.split('/').pop();
  if (!ALLOWLISTED_NAMES.has(path) && !ALLOWLISTED_NAMES.has(name)) {
    for (const rule of BLOCKED_NAME_RULES) {
      if (rule.re.test(path)) violations.push(`${path}: ${rule.label}`);
    }
  }
  const content = stagedBlob(path);
  if (content === null) continue;
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(content)) violations.push(`${path}: ${rule.label}`);
  }
}

if (violations.length > 0) {
  console.error('[check:secrets] blocked — possible secret material in staged files:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('Remove the secret (use .env locally / function secrets in Supabase), unstage, and retry.');
  process.exit(1);
}
console.log('[check:secrets] clean');
