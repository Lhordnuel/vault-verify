import { describe, expect, it } from 'vitest';
import { parseTestCounts } from '../src/testcmd.js';

describe('parseTestCounts', () => {
  it('parses jest output', () => {
    expect(parseTestCounts('Tests:       3 passed, 3 total')).toEqual({ passed: 3, failed: 0, framework: 'jest' });
    expect(parseTestCounts('Tests:       1 failed, 2 passed, 3 total')).toEqual({
      passed: 2,
      failed: 1,
      framework: 'jest',
    });
  });

  it('parses vitest output', () => {
    const out = ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Start at  02:48:33';
    expect(parseTestCounts(out)).toEqual({ passed: 3, failed: 0, framework: 'vitest' });
  });

  it('parses mocha output', () => {
    expect(parseTestCounts('  5 passing (10ms)\n  2 failing')).toEqual({ passed: 5, failed: 2, framework: 'mocha' });
  });

  it('parses TAP output', () => {
    expect(parseTestCounts('TAP version 13\n1..3\nok 1 first\nnot ok 2 second\nok 3 third')).toEqual({
      passed: 2,
      failed: 1,
      framework: 'tap',
    });
  });

  it('parses pytest output', () => {
    expect(parseTestCounts('2 failed, 3 passed in 0.50s')).toEqual({ passed: 3, failed: 2, framework: 'pytest' });
    expect(parseTestCounts('5 passed in 0.50s')).toEqual({ passed: 5, failed: 0, framework: 'pytest' });
  });

  it('parses go output with unknown pass counts', () => {
    expect(parseTestCounts('ok  \tpkg/foo\t0.123s')).toEqual({ passed: null, failed: 0, framework: 'go' });
    expect(parseTestCounts('--- FAIL: TestFoo (0.00s)\nFAIL\tpkg/foo\t0.1s')).toEqual({
      passed: null,
      failed: 1,
      framework: 'go',
    });
  });

  it('returns nulls for unknown output', () => {
    expect(parseTestCounts('hello world')).toEqual({ passed: null, failed: null, framework: null });
  });
});
