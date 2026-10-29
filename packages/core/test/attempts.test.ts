import { describe, expect, it } from 'vitest';
import {
  AttemptPayloadSchema,
  TestDefinitionSchema,
  deriveAttemptParams,
} from '../src/attempts.js';

const NONCE = 'aa'.repeat(16);
const OTHER_NONCE = 'bb'.repeat(16);
const TEST = {
  id: 'ts-debug-1',
  version: 2,
  tag: 'testing-debugging',
  templateRef: 'software-engineer-ai@1',
  seedParameters: { variant: 4, dataset: 3 },
};

describe('deriveAttemptParams', () => {
  it('is deterministic for the same inputs', () => {
    expect(deriveAttemptParams(NONCE, TEST, 1)).toEqual(deriveAttemptParams(NONCE, TEST, 1));
  });

  it('differs across attempt numbers and nonces', () => {
    const first = deriveAttemptParams(NONCE, TEST, 1);
    const second = deriveAttemptParams(NONCE, TEST, 2);
    const otherSession = deriveAttemptParams(OTHER_NONCE, TEST, 1);
    expect(first.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(second.seed).not.toBe(first.seed);
    expect(otherSession.seed).not.toBe(first.seed);
  });

  it('derives each parameter within its option range', () => {
    const { params } = deriveAttemptParams(NONCE, TEST, 1);
    expect(Object.keys(params).sort()).toEqual(['dataset', 'variant']);
    expect(params['variant']).toBeGreaterThanOrEqual(0);
    expect(params['variant']).toBeLessThan(4);
    expect(params['dataset']).toBeGreaterThanOrEqual(0);
    expect(params['dataset']).toBeLessThan(3);
  });

  it('rejects bad nonces and attempt numbers', () => {
    expect(() => deriveAttemptParams('nope', TEST, 1)).toThrow();
    expect(() => deriveAttemptParams(NONCE, TEST, 0)).toThrow();
  });
});

describe('attempt schemas', () => {
  it('parses a test definition and an attempt payload', () => {
    expect(TestDefinitionSchema.parse(TEST).id).toBe('ts-debug-1');
    const { seed } = deriveAttemptParams(NONCE, TEST, 1);
    const attempt = AttemptPayloadSchema.parse({
      testId: 'ts-debug-1',
      version: 2,
      seed,
      attemptNumber: 1,
      result: { passed: true, score: 0.9 },
    });
    expect(attempt.result.passed).toBe(true);
  });
});
