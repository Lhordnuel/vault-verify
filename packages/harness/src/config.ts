import path from 'node:path';

export const HARNESS_VERSION = '0.2.0';
export const HARNESS_COLLECTOR_ID = `harness/tier1@${HARNESS_VERSION}`;

export interface HarnessConfig {
  supabaseUrl: string;
  anonKey: string | null;
  jwt: string;
  anchorUrl: string;
  runsDir: string;
}

function requiredEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`[harness] missing required env ${name}`);
  return value;
}

/**
 * Resolve CLI configuration. The JWT may come from --token or VAULTVERIFY_JWT.
 * anonKey is only required for finish (chain upload).
 */
export function loadConfig(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  token?: string;
  needsAnonKey: boolean;
}): HarnessConfig {
  const supabaseUrl = requiredEnv('VAULTVERIFY_URL', opts.env['VAULTVERIFY_URL']);
  const jwt = opts.token ?? opts.env['VAULTVERIFY_JWT'] ?? '';
  if (!jwt) throw new Error('[harness] missing auth token: pass --token or set VAULTVERIFY_JWT.');
  const anchorUrl =
    opts.env['VAULTVERIFY_ANCHOR_URL'] ?? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/session`;
  const runsDir = opts.env['VAULTVERIFY_RUNS_DIR'] ?? path.join(opts.cwd, '.vaultverify', 'runs');
  const anonKey = opts.env['VAULTVERIFY_ANON_KEY'] ?? null;
  if (opts.needsAnonKey && !anonKey) {
    throw new Error('[harness] missing VAULTVERIFY_ANON_KEY (required for upload).');
  }
  return { supabaseUrl, anonKey, jwt, anchorUrl, runsDir };
}

export interface TaskConfig {
  testCommand: string;
  name?: string;
}

/** Validate a template's vaultverify.json (hand-rolled: zero harness runtime deps). */
export function parseTaskConfig(value: unknown): TaskConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('[harness] vaultverify.json must be an object.');
  }
  const record = value as Record<string, unknown>;
  const testCommand: unknown = record['testCommand'];
  if (typeof testCommand !== 'string' || testCommand.length === 0) {
    throw new Error('[harness] vaultverify.json needs a non-empty testCommand string.');
  }
  const name: unknown = record['name'];
  if (name !== undefined && typeof name !== 'string') {
    throw new Error('[harness] vaultverify.json name must be a string.');
  }
  return name === undefined ? { testCommand } : { testCommand, name };
}
