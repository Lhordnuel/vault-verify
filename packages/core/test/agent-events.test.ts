import { describe, expect, it } from 'vitest';
import {
  classifyAgentEvent,
  parseDiffstatCounts,
  scoredEventToAgentEvent,
} from '../src/agent-events.js';
import type { ScoredEvent } from '../src/scoring.js';

function scored(kind: ScoredEvent['kind'], payload: unknown): ScoredEvent {
  return {
    event: {
      seq: 0,
      prevHash: '0'.repeat(64),
      payload,
      hash: '1'.repeat(64),
      sig: '2'.repeat(128),
    },
    kind,
    collectedAt: '2026-10-28T10:00:00.000Z',
  };
}

describe('classifyAgentEvent', () => {
  it('types test runs by pass/fail counts', () => {
    expect(classifyAgentEvent('test_run', { passed: 3, failed: 0 })).toBe('test_run');
    expect(classifyAgentEvent('test_run', { nope: true })).toBe('session_note');
  });

  it('types snapshots with file changes as edits, finals as notes', () => {
    expect(
      classifyAgentEvent('repo_snapshot', { diffstat: ' 1 file changed, 2 insertions(+)' }),
    ).toBe('file_edit');
    expect(
      classifyAgentEvent('repo_snapshot', { final: true, diffstat: ' 1 file changed' }),
    ).toBe('session_note');
    expect(classifyAgentEvent('repo_snapshot', {})).toBe('session_note');
  });

  it('types importer-style edit entries by counts', () => {
    expect(classifyAgentEvent('file_edit', { insertions: 4, deletions: 1 })).toBe('file_edit');
    expect(classifyAgentEvent('edit', { files: ['a.ts'] })).toBe('file_edit');
  });

  it('types attempts with results as test runs', () => {
    expect(classifyAgentEvent('attempt', { result: { passed: true } })).toBe('test_run');
    expect(classifyAgentEvent('attempt', {})).toBe('session_note');
  });

  it('falls back to session_note for unknown kinds', () => {
    expect(classifyAgentEvent('prompt_transcript', { text: 'hi' })).toBe('session_note');
    expect(classifyAgentEvent('mystery', null)).toBe('session_note');
  });

  it('honors sealed AgentEvent self-type hints', () => {
    expect(classifyAgentEvent('repo_snapshot', { type: 'file_edit' })).toBe('file_edit');
    expect(classifyAgentEvent('test_run', { type: 'session_note' })).toBe('session_note');
  });
});

describe('scoredEventToAgentEvent', () => {
  it('extracts diffstat counts for snapshots', () => {
    const event = scoredEventToAgentEvent(
      scored('repo_snapshot', { diffstat: ' 2 files changed, 9 insertions(+), 3 deletions(-)' }),
    );
    expect(event.type).toBe('file_edit');
    expect(event.files).toEqual({ changed: 2, insertions: 9, deletions: 3 });
  });

  it('extracts test counts for test runs', () => {
    const event = scoredEventToAgentEvent(scored('test_run', { passed: 5, failed: 1, exitCode: 1 }));
    expect(event.type).toBe('test_run');
    expect(event.tests).toEqual({ passed: 5, failed: 1 });
  });

  it('marks final diffs as notes', () => {
    const event = scoredEventToAgentEvent(scored('repo_snapshot', { final: true }));
    expect(event.type).toBe('session_note');
    expect(event.note).toBe('final diff checkpoint');
  });
});

describe('parseDiffstatCounts', () => {
  it('parses full, partial, and missing summaries', () => {
    expect(parseDiffstatCounts(' 2 files changed, 9 insertions(+), 3 deletions(-)')).toEqual({
      filesChanged: 2,
      insertions: 9,
      deletions: 3,
    });
    expect(parseDiffstatCounts(' 1 file changed, 1 insertion(+)')).toEqual({
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    });
    expect(parseDiffstatCounts('garbage, no summary')).toEqual({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  });
});
