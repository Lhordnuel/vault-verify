import { execFile } from 'node:child_process';

export async function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(' ')} failed: ${String(stderr || error.message).slice(0, 500)}`));
      else resolve(stdout);
    });
  });
}

/** Fresh repo with uniform harness authorship (distinguishes harness snapshots). */
export async function gitInit(cwd: string): Promise<void> {
  await git(cwd, ['init', '-q']);
  await git(cwd, ['config', 'user.name', 'vault-verify']);
  await git(cwd, ['config', 'user.email', 'harness@vault-verify.local']);
}

export async function gitIsClean(cwd: string): Promise<boolean> {
  return (await git(cwd, ['status', '--porcelain'])).trim() === '';
}

export async function gitCommitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-q', '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

export async function gitHead(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

export async function gitRootCommit(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-list', '--max-parents=0', 'HEAD'])).trim();
}

export async function gitShowStat(cwd: string, commit: string): Promise<string> {
  return git(cwd, ['show', '--stat', '--oneline', commit]);
}

export async function gitShowPatch(cwd: string, commit: string): Promise<string> {
  return git(cwd, ['show', '--format=', '--patch', commit]);
}

export async function gitDiffStatRange(cwd: string, from: string, to: string): Promise<string> {
  return git(cwd, ['diff', '--stat', from, to]);
}

export async function gitDiffRange(cwd: string, from: string, to: string): Promise<string> {
  return git(cwd, ['diff', from, to]);
}
