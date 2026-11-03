import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  createChainHash,
  GENESIS_HASH,
  type CommitEvidence,
  type SyncPayload,
} from '@attest/core';

const MAX_COMMITS = 100;
const MAX_EVIDENCE = 200;
const PEM_BEGIN = '-'.repeat(5) + 'BEGIN ';
const PEM_PRIVATE_KEY = 'PRIVATE' + ' KEY';
const PEM_FENCE = '-'.repeat(5);
const PEM_END = '-'.repeat(5) + 'END ';
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /\b(?:xox[bpras]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9._-]{20,})\b/g,
  /\b(?:api[_-]?key|secret|password|token)\b[\s"'`]*[:=][\s"'`]*[A-Za-z0-9._~+/-]{8,}/gi,
  new RegExp(`${PEM_BEGIN}[A-Z ]*${PEM_PRIVATE_KEY}${PEM_FENCE}[\\s\\S]*?${PEM_END}[A-Z ]*${PEM_PRIVATE_KEY}${PEM_FENCE}`, 'g'),
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

function commitUuid(hash: string): string {
  const compact = createHash('sha256').update(hash).digest('hex').slice(0, 32);
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-5${compact.slice(13, 16)}-a${compact.slice(17, 20)}-${compact.slice(20)}`;
}

function classify(message: string, files: string[]): { type: string; claim: string } {
  const text = `${message} ${files.join(' ')}`.toLowerCase();
  const mappings: Array<[RegExp, string, string]> = [
    [/\b(test|spec|coverage|assert)\b/, 'testing', 'testing behavior'],
    [/\b(perf|performance|cache|optimi[sz])\b/, 'performance', 'performance work'],
    [/\b(api|endpoint|route|http|graphql)\b/, 'api-design', 'API development'],
    [/\b(doc|readme|guide|comment)\b/, 'documentation', 'documentation'],
    [/\b(refactor|extract|simplif|cleanup)\b/, 'maintainability', 'maintainability'],
    [/\b(fix|bug|error|crash|retry|resilien)\b/, 'reliability', 'reliability work'],
    [/\b(ui|ux|component|css|layout|accessib)\b/, 'frontend', 'frontend development'],
    [/\b(db|database|sql|migration|schema)\b/, 'data-modeling', 'data modeling'],
  ];
  const match = mappings.find(([pattern]) => pattern.test(text));
  return match ? { type: match[1], claim: match[2] } : { type: 'engineering', claim: 'software engineering' };
}

function quoteFromPatch(patch: string, message: string): string {
  const excerpt = patch
    .split('\n')
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')))
    .map((line) => line.slice(1).trim())
    .filter((line) => line && !/^(?:password|secret|token|api[_-]?key)\s*[=:]/i.test(line))
    .slice(0, 3)
    .join('\n');
  return redact((excerpt || message).slice(0, 600));
}

export async function scanRepository(cwd: string, requestedLimit = MAX_COMMITS): Promise<SyncPayload> {
  const git = simpleGit(cwd);
  const root = (await git.revparse(['--show-toplevel'])).trim();
  const remotes = await git.getRemotes(true);
  const remoteUrl = remotes.find((remote) => remote.name === 'origin')?.refs.fetch ?? '';
  const githubPath = /(?:https:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(remoteUrl)?.[1]?.replace(/\.git$/i, '');
  const limit = Number.isFinite(requestedLimit) ? Math.min(MAX_EVIDENCE, Math.max(1, Math.floor(requestedLimit))) : MAX_COMMITS;
  const log = await git.log({ maxCount: limit });
  if (log.total === 0) throw new Error('No git commits found in this repository.');
  const commits = log.all.slice(0, limit).reverse();
  let previousHash = GENESIS_HASH;
  const evidence: CommitEvidence[] = [];

  for (const commit of commits) {
    const filesOutput = await git.raw(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit.hash]);
    const files = filesOutput.split(/\r?\n/).map((file) => file.trim()).filter(Boolean).slice(0, 40);
    const parentsOutput = await git.raw(['rev-list', '--parents', '-n', '1', commit.hash]);
    const [, ...parentHashes] = parentsOutput.trim().split(/\s+/);
    const patch = await git.show([commit.hash, '--format=', '--no-ext-diff', '--unified=1']);
    const message = redact(`${commit.message}\n${commit.body ?? ''}`.trim()).slice(0, 1000);
    const classified = classify(message, files);
    const reference = {
      commit_hash: commit.hash,
      parent_hashes: parentHashes,
      committed_at: new Date(commit.date).toISOString(),
      repository: path.basename(root),
      ...(githubPath ? { repository_url: `https://github.com/${githubPath}` } : {}),
      message,
      files,
      quote: quoteFromPatch(patch, message),
    };
    const base = {
      id: commitUuid(commit.hash),
      claim_type: classified.type,
      claim_value: `${classified.claim}: ${message.split('\n')[0] || '(commit message unavailable)'}`,
      source: 'git',
      status: 'Supported' as const,
      confidence: null,
      captured_at: Date.parse(commit.date),
    };
    const chainHash = await createChainHash(previousHash, base, reference);
    const node: CommitEvidence = {
      ...base,
      evidence_ref: { ...reference, previous_hash: previousHash, chain_hash: chainHash },
    };
    evidence.push(node);
    previousHash = chainHash;
  }
  return { handle: '', evidence };
}

function scanFile(cwd: string): string {
  return path.join(cwd, '.attest', 'scan.json');
}

export async function saveScan(cwd: string, payload: SyncPayload): Promise<void> {
  const file = scanFile(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function loadScan(cwd: string): Promise<SyncPayload> {
  const text = await readFile(scanFile(cwd), 'utf8');
  return JSON.parse(text) as SyncPayload;
}

export interface AttestConfig {
  apiUrl: string;
  token?: string;
  handle?: string;
}

export function configFile(): string {
  return path.join(os.homedir(), '.attest', 'config.json');
}

export async function readConfig(apiUrl: string): Promise<AttestConfig> {
  try {
    const config = JSON.parse(await readFile(configFile(), 'utf8')) as AttestConfig;
    return { ...config, apiUrl: apiUrl || config.apiUrl };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { apiUrl };
    throw error;
  }
}

export async function writeConfig(config: AttestConfig): Promise<void> {
  const file = configFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
