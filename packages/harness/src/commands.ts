import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genesisPrevHashFromNonce, verifyChain } from '@vault-verify/core/node';
import { gitInit } from './git.js';
import { loadChainRecords } from './chainstore.js';
import { loadConfig, parseTaskConfig } from './config.js';
import { anchorHead, loadSession, registerSession, saveSession } from './session.js';
import { recordFinalDiff, recordSnapshot } from './snapshot.js';
import { runTestCommand } from './testcmd.js';
import { uploadChain } from './upload.js';
import { startWatch } from './watch.js';

export interface StartOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  task: string;
  runName?: string;
  token?: string;
  spawnWatcher?: boolean;
}

export interface StartResult {
  runDir: string;
  sessionId: string;
  events: number;
}

function resolveTemplate(cwd: string, task: string): string {
  const asPath = path.resolve(cwd, task);
  if (existsSync(asPath)) return asPath;
  const named = path.join(cwd, 'tasks', 'templates', task);
  if (existsSync(named)) return named;
  throw new Error(`[harness] unknown task template: ${task} (not a path; no tasks/templates/${task}).`);
}

async function uniqueDir(base: string): Promise<string> {
  if (!existsSync(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!existsSync(`${base}-${n}`)) return `${base}-${n}`;
  }
  throw new Error('[harness] too many runs with the same name.');
}

function spawnWatcher(runDir: string): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, [path.join(here, 'cli.js'), '_watch', runDir], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  if (!child.pid) throw new Error('[harness] failed to spawn watcher.');
  return child.pid;
}

export async function startRun(opts: StartOptions): Promise<StartResult> {
  const config = loadConfig({ cwd: opts.cwd, env: opts.env, token: opts.token, needsAnonKey: false });
  const templateDir = resolveTemplate(opts.cwd, opts.task);
  let taskRaw: unknown;
  try {
    taskRaw = JSON.parse(await readFile(path.join(templateDir, 'vaultverify.json'), 'utf8')) as unknown;
  } catch {
    throw new Error(`[harness] template missing vaultverify.json: ${templateDir}`);
  }
  const task = parseTaskConfig(taskRaw);
  const baseName = (opts.runName ?? task.name ?? path.basename(templateDir)).replace(/[^a-zA-Z0-9-_]+/g, '-');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const runDir = await uniqueDir(path.join(config.runsDir, `${baseName}-${stamp}`));
  await mkdir(runDir, { recursive: true });
  await cp(templateDir, runDir, { recursive: true });
  const gitignoreFile = path.join(runDir, '.gitignore');
  const existing = await readFile(gitignoreFile, 'utf8').catch(() => '');
  if (!existing.split('\n').includes('.vaultverify/')) {
    await writeFile(gitignoreFile, `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}.vaultverify/\n`, 'utf8');
  }
  await gitInit(runDir);
  const metaDir = path.join(runDir, '.vaultverify');
  const session = await registerSession({ anchorUrl: config.anchorUrl, jwt: config.jwt, metaDir });
  await saveSession(metaDir, session);
  await writeFile(path.join(metaDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  const record = await recordSnapshot(runDir, session, { force: true, message: 'harness initial import' });
  if (opts.spawnWatcher !== false && opts.env['VAULTVERIFY_NO_WATCH'] !== '1') {
    const pid = spawnWatcher(runDir);
    await writeFile(path.join(metaDir, 'recorder.pid'), `${pid}\n`, 'utf8');
  }
  return { runDir, sessionId: session.sessionId, events: record ? 1 : 0 };
}

export interface RunTestsOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  runDir?: string;
  token?: string;
}

export interface RunTestsResult {
  exitCode: number;
  seq: number;
  anchored: boolean;
  anchorWarning?: string;
}

export async function runTests(opts: RunTestsOptions): Promise<RunTestsResult> {
  const config = loadConfig({ cwd: opts.cwd, env: opts.env, token: opts.token, needsAnonKey: false });
  const runDir = opts.runDir ?? opts.cwd;
  const metaDir = path.join(runDir, '.vaultverify');
  const session = await loadSession(metaDir);
  const task = parseTaskConfig(JSON.parse(await readFile(path.join(metaDir, 'task.json'), 'utf8')) as unknown);
  const result = await runTestCommand({ runDir, session, testCommand: task.testCommand });
  try {
    await anchorHead({
      anchorUrl: config.anchorUrl,
      jwt: config.jwt,
      sessionId: session.sessionId,
      seq: result.record.event.seq,
      headHash: result.record.event.hash,
    });
    return { exitCode: result.exitCode, seq: result.record.event.seq, anchored: true };
  } catch (error) {
    // Anchor failure is a warning: the chain stays valid locally and finish re-anchors.
    return {
      exitCode: result.exitCode,
      seq: result.record.event.seq,
      anchored: false,
      anchorWarning: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface FinishOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  runDir?: string;
  token?: string;
}

export interface FinishResult {
  events: number;
  headHash: string | null;
  anchors: number;
  uploaded: number;
  anchorWarning?: string;
}

async function stopRecorder(metaDir: string): Promise<void> {
  const pidFile = path.join(metaDir, 'recorder.pid');
  let pid: number | null = null;
  try {
    pid = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
  } catch {
    pid = null;
  }
  if (pid !== null && Number.isInteger(pid)) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  await rm(pidFile, { force: true });
}

export async function finishRun(opts: FinishOptions): Promise<FinishResult> {
  const config = loadConfig({ cwd: opts.cwd, env: opts.env, token: opts.token, needsAnonKey: true });
  const anonKey = config.anonKey;
  if (!anonKey) throw new Error('[harness] missing VAULTVERIFY_ANON_KEY.');
  const runDir = opts.runDir ?? opts.cwd;
  const metaDir = path.join(runDir, '.vaultverify');
  const session = await loadSession(metaDir);
  await stopRecorder(metaDir);
  await recordSnapshot(runDir, session);
  await recordFinalDiff(runDir, session);
  const records = await loadChainRecords(path.join(metaDir, 'chain.jsonl'));
  const check = verifyChain(
    records.map((r) => r.event),
    session.publicKey,
    { expectedGenesisPrevHash: genesisPrevHashFromNonce(session.nonce) },
  );
  if (!check.ok) {
    throw new Error(`[harness] local chain invalid: ${check.break.reason}@seq:${check.break.seq}; refusing upload.`);
  }
  let anchors = 0;
  let anchorWarning: string | undefined;
  const head = records[records.length - 1];
  try {
    await anchorHead({
      anchorUrl: config.anchorUrl,
      jwt: config.jwt,
      sessionId: session.sessionId,
      seq: head.event.seq,
      headHash: head.event.hash,
    });
    anchors = 1;
  } catch (error) {
    anchorWarning = error instanceof Error ? error.message : String(error);
  }
  const { upserted: uploaded } = await uploadChain({
    supabaseUrl: config.supabaseUrl,
    anonKey,
    jwt: config.jwt,
    candidateId: session.candidateId,
    sessionId: session.sessionId,
    records,
  });
  return {
    events: records.length,
    headHash: head.event.hash,
    anchors,
    uploaded,
    ...(anchorWarning === undefined ? {} : { anchorWarning }),
  };
}

/** Hidden `_watch` entry: foreground recorder (start spawns it detached). */
export async function watchRun(runDir: string): Promise<() => Promise<void>> {
  const metaDir = path.join(runDir, '.vaultverify');
  const session = await loadSession(metaDir);
  const logFile = path.join(metaDir, 'recorder.log');
  const log = async (line: string): Promise<void> => {
    await appendFile(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
  };
  const handle = await startWatch(
    runDir,
    async () => {
      const record = await recordSnapshot(runDir, session);
      if (record) await log(`snapshot seq=${record.event.seq}`);
    },
    { onError: (error: unknown) => void log(`error: ${error instanceof Error ? error.message : String(error)}`) },
  );
  await log('recorder started');
  return () => handle.stop();
}
