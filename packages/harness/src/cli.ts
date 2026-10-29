#!/usr/bin/env node
/** Harness CLI entrypoint (thin argv wrapper over commands.ts). */
import { finishRun, runTests, startRun, watchRun } from './commands.js';

function usage(): string {
  return [
    'harness start <task> [--name <run>] [--token <jwt>]  start a run from a template dir',
    'harness test [--dir <run>] [--token <jwt>]           run tests, record + anchor',
    'harness finish [--dir <run>] [--token <jwt>]         snapshot, diff, anchor, upload',
    '',
    'Env: VAULTVERIFY_URL (required), VAULTVERIFY_JWT (or --token),',
    '     VAULTVERIFY_ANON_KEY (finish only), VAULTVERIFY_ANCHOR_URL, VAULTVERIFY_RUNS_DIR.',
  ].join('\n');
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'start': {
        const task = rest.find((a) => !a.startsWith('--'));
        if (!task) {
          console.error('Usage: harness start <task> [--name <run>] [--token <jwt>]');
          return 1;
        }
        const result = await startRun({ cwd, env, task, runName: flag(rest, '--name'), token: flag(rest, '--token') });
        console.log(`run: ${result.runDir}\nsession: ${result.sessionId}\nevents: ${result.events}`);
        return 0;
      }
      case 'test': {
        const result = await runTests({ cwd, env, runDir: flag(rest, '--dir'), token: flag(rest, '--token') });
        console.log(`exit: ${result.exitCode} seq: ${result.seq} anchored: ${result.anchored ? 'yes' : 'no'}`);
        if (result.anchorWarning) console.error(`anchor warning: ${result.anchorWarning}`);
        return result.exitCode;
      }
      case 'finish': {
        const result = await finishRun({ cwd, env, runDir: flag(rest, '--dir'), token: flag(rest, '--token') });
        console.log(
          `events: ${result.events}\nhead: ${result.headHash}\nanchors: ${result.anchors}\nuploaded: ${result.uploaded}`,
        );
        if (result.anchorWarning) console.error(`anchor warning: ${result.anchorWarning}`);
        return 0;
      }
      case '_watch': {
        await watchRun(rest[0] ?? cwd);
        return 0;
      }
      default: {
        if (command === '--help' || command === '-h' || command === undefined) {
          console.log(usage());
          return 0;
        }
        console.error(`${usage()}\n\nunknown command: ${command}`);
        return 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const code = await main(process.argv.slice(2), process.env, process.cwd());
process.exit(code);
