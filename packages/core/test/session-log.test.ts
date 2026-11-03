import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, createChainHash, parseSessionLogText, sessionEvidenceFromImport } from '../src/index.js';

describe('session log import', () => {
  it('parses Claude Code JSONL locally, preserves roles, and redacts secrets', async () => {
    const text = [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-session-1',
        uuid: 'user-1',
        timestamp: '2026-11-01T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'Please fix the test failure.' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'claude-session-1',
        uuid: 'assistant-1',
        timestamp: '2026-11-01T10:01:00.000Z',
        message: { content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/test.ts' } },
          { type: 'text', text: 'The test is fixed using ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ.' },
        ] },
      }),
    ].join('\n');

    const result = await parseSessionLogText(text);
    expect(result.format).toBe('claude-code-jsonl');
    expect(result.level).toBe('L0');
    expect(result.events.map((event) => [event.actor, event.type])).toEqual([
      ['user', 'message'],
      ['assistant', 'tool_use'],
      ['assistant', 'message'],
    ]);
    expect(result.events[2].text).toContain('[REDACTED]');
    expect(result.events[2].text).not.toContain('ghp_');
  });

  it('parses normalized logs but never trusts a candidate-supplied verification level', async () => {
    const result = await parseSessionLogText(JSON.stringify({
      version: 'attest-session-log/1',
      session_id: 'sample',
      verification_level: 'L4',
      events: [{ at: '2026-11-01T10:00:00Z', actor: 'assistant', type: 'test_run', text: 'Tests passed.' }],
    }));
    expect(result.level).toBe('L0');
    expect(result.events[0].type).toBe('test_run');
  });

  it('chains imported records and keeps self-supplied session exports unverified', async () => {
    const log = await parseSessionLogText(JSON.stringify({
      version: 'attest-session-log/1',
      session_id: 'sample',
      events: [{ at: '2026-11-01T10:00:00Z', actor: 'assistant', type: 'message', text: 'I verified the change.' }],
    }));
    const [item] = await sessionEvidenceFromImport(log);
    expect(item.source).toBe('session');
    expect(item.status).toBe('Unverified');
    expect(item.evidence_ref.previous_hash).toBe(GENESIS_HASH);
    const { chain_hash: _chainHash, previous_hash: _previousHash, ...reference } = item.evidence_ref;
    const { evidence_ref: _evidenceRef, ...base } = item;
    expect(item.evidence_ref.chain_hash).toBe(await createChainHash(GENESIS_HASH, base, reference));
  });

  it('rejects malformed JSONL instead of silently importing partial evidence', async () => {
    await expect(parseSessionLogText('{"type":"assistant"\n')).rejects.toThrow('Invalid JSON on line 1');
  });
});
