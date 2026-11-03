#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Command } from 'commander';
import { loadScan, readConfig, saveScan, scanRepository, writeConfig } from './evidence.js';
import { parseSessionLogText, sessionEvidenceFromImport, type SyncPayload } from '@attest/core';

const program = new Command();
program.name('attest').description('Create and share evidence-backed developer credentials.').version('0.1.0');
program.option('--api <url>', 'Attest API URL', process.env['ATTEST_API_URL'] ?? 'https://attest-api.emmanuelnwachi2457.workers.dev');

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function login(apiUrl: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/cli/device`, { method: 'POST' });
  if (!response.ok) throw new Error(`Could not start GitHub sign-in (HTTP ${response.status}).`);
  const device = await responseJson<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }>(response);
  console.log(`Open ${device.verification_uri} and enter code ${device.user_code}.`);
  if (process.stdin.isTTY) {
    try {
      const opener = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', device.verification_uri] : [device.verification_uri];
      const child = spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch { /* The printed verification URL remains usable. */ }
  }
  const endAt = Date.now() + device.expires_in * 1000;
  let interval = Math.max(1, device.interval);
  while (Date.now() < endAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    const poll = await fetch(`${apiUrl}/api/cli/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: device.device_code }),
    });
    if (poll.status === 202) continue;
    if (poll.status === 429) { interval += 5; continue; }
    if (!poll.ok) {
      const error = await responseJson<{ error?: string }>(poll).catch((): { error?: string } => ({}));
      throw new Error(`GitHub sign-in failed: ${error.error ?? `HTTP ${poll.status}`}.`);
    }
    const result = await responseJson<{ token: string; handle: string }>(poll);
    await writeConfig({ apiUrl, token: result.token, handle: result.handle });
    console.log(`Signed in as @${result.handle}.`);
    console.log(`Evidence profile: ${apiUrl}/v/${encodeURIComponent(result.handle)}`);
    return;
  }
  throw new Error('GitHub sign-in expired. Run `attest login` to try again.');
}

program.command('login').description('Sign in with GitHub using a device code.').action(async () => {
  const apiUrl = program.opts<{ api: string }>().api;
  await login(apiUrl);
});

program.command('scan')
  .description('Scan git history and optionally import an AI session log into a private preview.')
  .option('--limit <n>', 'maximum commits', '100')
  .option('--session <path>', 'import a Claude Code JSONL or normalized Attest/Vaultio session log')
  .action(async (options: { limit: string; session?: string }) => {
  const cwd = process.cwd();
  const payload = await scanRepository(cwd, Number.parseInt(options.limit, 10));
  if (options.session) {
    const text = await readFile(path.resolve(cwd, options.session), 'utf8');
    const imported = await parseSessionLogText(text);
    const sessionEvidence = await sessionEvidenceFromImport(imported);
    payload.evidence.push(...sessionEvidence);
    console.log(`Imported ${sessionEvidence.length} session events (${imported.format}, ${imported.level}).`);
    console.log(`Session source: ${imported.sessionId}. ${imported.reasons.join('; ')}.`);
  }
  await saveScan(cwd, payload);
  console.log(`Scanned ${payload.evidence.length} evidence records. Evidence is local only; nothing was uploaded.`);
  console.log(`Preview saved to ${cwd}\\.attest\\scan.json. Review it before running attest sync.`);
  for (const item of payload.evidence) {
    const ref = item.evidence_ref;
    const sourceId = 'commit_hash' in ref ? ref.commit_hash.slice(0, 10) : `${ref.session_id}:${ref.event_id}`;
    console.log(`\n${sourceId}  ${item.claim_type}  ${item.claim_value}`);
    console.log(`  Evidence: ${ref.quote.replace(/\n/g, '\n  ')}`);
  }
});

program.command('sync').description('Preview and upload reviewed git evidence after confirmation.').action(async () => {
  const opts = program.opts<{ api: string }>();
  const config = await readConfig(opts.api);
  if (!config.token) throw new Error('Not signed in. Run `attest login` first.');
  const scanned = await loadScan(process.cwd());
  const payload: SyncPayload = { ...scanned, handle: config.handle ?? '' };
  const exactRequest = JSON.stringify({ evidence: payload.evidence }, null, 2);
  console.log('Sync replaces your uploaded evidence snapshot with these records (up to 100 recent commits).');
  console.log('The following JSON is exactly what will be sent to Attest:');
  console.log(exactRequest);
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Upload this evidence? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Upload cancelled. Nothing was sent.');
    return;
  }
  const response = await fetch(`${config.apiUrl}/api/cli/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ evidence: payload.evidence }),
  });
  const result = await responseJson<{ synced?: number; error?: string }>(response)
    .catch((): { synced?: number; error?: string } => ({}));
  if (!response.ok) throw new Error(`Upload failed: ${result.error ?? `HTTP ${response.status}`}.`);
  console.log(`Uploaded ${result.synced ?? 0} evidence items. Profile: ${config.apiUrl}/v/${encodeURIComponent(config.handle ?? '')}`);
});

program.command('wipe').description('Permanently delete your uploaded evidence and assessments.').action(async () => {
  const opts = program.opts<{ api: string }>();
  const config = await readConfig(opts.api);
  if (!config.token) throw new Error('Not signed in. Run `attest login` first.');
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Delete all uploaded evidence and assessments for @${config.handle}? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) { console.log('Wipe cancelled.'); return; }
  const response = await fetch(`${config.apiUrl}/api/cli/wipe`, {
    method: 'DELETE', headers: { authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) throw new Error(`Wipe failed (HTTP ${response.status}).`);
  console.log('Uploaded evidence, assessments, and stored artifacts have been deleted.');
});

program.showHelpAfterError();
await program.parseAsync(process.argv);
