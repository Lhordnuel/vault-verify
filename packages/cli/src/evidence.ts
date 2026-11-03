import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const MAX_REPOSITORIES = 500;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.attest', '.cache', '.next', '.nuxt',
  'target', 'bower_components', '.venv', 'venv',
]);
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
  const head = await git.raw(['rev-parse', '--verify', 'HEAD']).catch((error: unknown) => {
    if (error instanceof Error && /Needed a single revision/.test(error.message)) return '';
    throw error;
  });
  if (!head.trim()) return { handle: '', evidence: [] };
  const format = '%x1e%H%x00%P%x00%cI%x00%s%x00%b%x00';
  const maxCount = `--max-count=${limit}`;
  const [fileLog, patchLog] = await Promise.all([
    git.raw(['log', `--format=${format}`, '--name-only', '--no-renames', '--reverse', maxCount]),
    git.raw(['log', `--format=${format}`, '-p', '--no-ext-diff', '--unified=1', '--reverse', maxCount]),
  ]);
  const parseRecords = (output: string) => output.split('\x1e').filter((record) => record.trim()).map((record) => {
    const [rawHash, rawParents, committedAt, subject, body, ...details] = record.split('\0');
    const hash = rawHash?.trim();
    if (!hash || !committedAt || subject === undefined || body === undefined) {
      throw new Error('Git returned an incomplete commit record while scanning.');
    }
    return {
      hash,
      parents: rawParents?.trim() ? rawParents.trim().split(/\s+/) : [],
      committedAt,
      message: redact(`${subject}\n${body}`.trim()).slice(0, 1000),
      details: details.join('\0'),
    };
  });
  const filesByCommit = new Map(parseRecords(fileLog).map((commit) => [
    commit.hash,
    commit.details.split(/\r?\n/).map((file) => file.trim()).filter(Boolean).slice(0, 40),
  ]));
  const patchByCommit = new Map(parseRecords(patchLog).map((commit) => {
    const start = commit.details.indexOf('diff --git ');
    return [commit.hash, start === -1 ? '' : commit.details.slice(start)] as const;
  }));
  const commits = parseRecords(fileLog);
  if (!commits.length) return { handle: '', evidence: [] };
  let previousHash = GENESIS_HASH;
  const evidence: CommitEvidence[] = [];

  for (const record of commits) {
    const files = filesByCommit.get(record.hash) ?? [];
    const patch = patchByCommit.get(record.hash) ?? '';
    const message = record.message;
    const classified = classify(message, files);
    const reference = {
      commit_hash: record.hash,
      parent_hashes: record.parents,
      committed_at: new Date(record.committedAt).toISOString(),
      repository: path.basename(root),
      ...(githubPath ? { repository_url: `https://github.com/${githubPath}` } : {}),
      message,
      files,
      quote: quoteFromPatch(patch, message),
    };
    const base = {
      id: randomUUID(),
      claim_type: classified.type,
      claim_value: `${classified.claim}: ${message.split('\n')[0] || '(commit message unavailable)'}`,
      source: 'git',
      status: 'Supported' as const,
      confidence: null,
      captured_at: Date.parse(record.committedAt),
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

async function findRepositories(parent: string): Promise<string[]> {
  const repositories: string[] = [];
  const pending = [parent];
  const visited = new Set<string>();
  while (pending.length) {
    const directory = pending.pop()!;
    const normalized = path.resolve(directory).toLowerCase();
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === '.git')) {
      repositories.push(directory);
      if (repositories.length > MAX_REPOSITORIES) {
        throw new Error(`Found more than ${MAX_REPOSITORIES} git repositories. Choose a smaller parent folder.`);
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
      pending.push(path.join(directory, entry.name));
    }
  }
  return repositories.sort((left, right) => left.localeCompare(right));
}

async function rechainEvidence(items: CommitEvidence[]): Promise<CommitEvidence[]> {
  const ordered = [...items].sort((left, right) => left.captured_at - right.captured_at);
  let previousHash = GENESIS_HASH;
  const chained: CommitEvidence[] = [];
  for (const item of ordered) {
    const { evidence_ref: originalReference, ...base } = item;
    const { previous_hash: _previousHash, chain_hash: _chainHash, ...reference } = originalReference;
    const chainHash = await createChainHash(previousHash, base, reference);
    chained.push({
      ...base,
      evidence_ref: { ...reference, previous_hash: previousHash, chain_hash: chainHash },
    });
    previousHash = chainHash;
  }
  return chained;
}

export async function scanRepositories(
  parent: string,
  requestedLimit = MAX_COMMITS,
): Promise<{ payload: SyncPayload; repositories: string[]; skippedEmpty: number }> {
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_COMMITS, Math.max(1, Math.floor(requestedLimit)))
    : MAX_COMMITS;
  const repositories = await findRepositories(path.resolve(parent));
  if (!repositories.length) {
    throw new Error(`No git repositories found under ${path.resolve(parent)}. Choose a folder containing your repositories.`);
  }
  const perRepositoryLimit = Math.max(1, Math.ceil(limit / repositories.length));
  const evidence: CommitEvidence[] = [];
  const scannedRepositories: string[] = [];
  let skippedEmpty = 0;
  for (const repository of repositories) {
    const result = await scanRepository(repository, perRepositoryLimit);
    if (!result.evidence.length) {
      skippedEmpty++;
      continue;
    }
    evidence.push(...result.evidence);
    scannedRepositories.push(repository);
  }
  if (!evidence.length) throw new Error('The selected folder contains no committed repository work to scan.');

  const selected = [...evidence]
    .sort((left, right) => right.captured_at - left.captured_at)
    .slice(0, limit);
  return {
    payload: { handle: '', evidence: await rechainEvidence(selected) },
    repositories: scannedRepositories,
    skippedEmpty,
  };
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
