import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { appendChainRecord, type ChainRecord } from './chainstore.js';
import { loadPrivateKey, type RunSession } from './session.js';

export interface TestCounts {
  passed: number | null;
  failed: number | null;
  framework: string | null;
}

function findCount(output: string, re: RegExp): number | null {
  const match = re.exec(output);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/** Best-effort pass/fail extraction across common runners. Unknowns stay null (honest). */
export function parseTestCounts(output: string): TestCounts {
  if (output.includes('Tests:')) {
    const passed = findCount(output, /Tests:[^\n]*?(\d+)\s+passed/);
    const failed = findCount(output, /Tests:[^\n]*?(\d+)\s+failed/);
    if (passed !== null || failed !== null) {
      return { passed: passed ?? 0, failed: failed ?? 0, framework: 'jest' };
    }
  }
  if (output.includes('Test Files')) {
    const passed = findCount(output, /Tests\s+(\d+)\s+passed/);
    const failed = findCount(output, /(\d+)\s+failed/);
    if (passed !== null || failed !== null) {
      return { passed: passed ?? 0, failed: failed ?? 0, framework: 'vitest' };
    }
  }
  {
    const passed = findCount(output, /(\d+)\s+passing/);
    const failed = findCount(output, /(\d+)\s+failing/);
    if (passed !== null || failed !== null) {
      return { passed: passed ?? 0, failed: failed ?? 0, framework: 'mocha' };
    }
  }
  if (/^1\.\.\d+/m.test(output)) {
    const passed = (output.match(/^ok /gm) ?? []).length;
    const failed = (output.match(/^not ok /gm) ?? []).length;
    return { passed, failed, framework: 'tap' };
  }
  {
    const passed = findCount(output, /(\d+)\s+passed/);
    const failed = findCount(output, /(\d+)\s+failed/);
    if (passed !== null || failed !== null) {
      return { passed: passed ?? 0, failed: failed ?? 0, framework: 'pytest' };
    }
  }
  if (/^(ok|FAIL)\s/m.test(output) || /^--- FAIL:/m.test(output)) {
    return { passed: null, failed: (output.match(/^--- FAIL:/gm) ?? []).length, framework: 'go' };
  }
  return { passed: null, failed: null, framework: null };
}

export interface TestRunResult {
  exitCode: number;
  durationMs: number;
  counts: TestCounts;
  record: ChainRecord;
}

export async function runTestCommand(args: {
  runDir: string;
  session: RunSession;
  testCommand: string;
}): Promise<TestRunResult> {
  const started = Date.now();
  const { exitCode, output } = await execShell(args.testCommand, args.runDir);
  const durationMs = Date.now() - started;
  const counts = parseTestCounts(output);
  const privateKeyHex = await loadPrivateKey(args.session.keyFile);
  const record = await appendChainRecord({
    file: join(args.runDir, '.vaultverify', 'chain.jsonl'),
    sessionNonce: args.session.nonce,
    privateKeyHex,
    kind: 'test_run',
    payload: {
      command: args.testCommand,
      exitCode,
      durationMs,
      passed: counts.passed,
      failed: counts.failed,
      framework: counts.framework,
      outputTail: output.slice(-32768),
    },
    summary: `test ${exitCode === 0 ? 'pass' : 'fail'} (${counts.passed ?? '?'} passed)`,
  });
  return { exitCode, durationMs, counts, record };
}

const OUTPUT_CAP = 512 * 1024;

function execShell(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let output = '';
    const onData = (chunk: unknown): void => {
      output += String(chunk);
      if (output.length > OUTPUT_CAP) output = output.slice(-OUTPUT_CAP);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', () => resolve({ exitCode: 127, output }));
    child.on('close', (code) => resolve({ exitCode: code ?? 127, output }));
  });
}
