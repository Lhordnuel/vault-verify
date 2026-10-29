import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { DOMAIN_SEPARATION } from './crypto-spec.js';
import { Hex64Schema, NonceSchema } from './primitives.js';

/**
 * A defined assessment test. seedParameters maps parameter name -> option
 * count; each attempt derives one option per name from the session nonce,
 * so attempts differ even for the same candidate and test.
 */
export const TestDefinitionSchema = z.object({
  id: z.string().min(1).max(80),
  version: z.number().int().min(1),
  /** Skill or library tag, e.g. 'typescript-node' or 'vitest'. */
  tag: z.string().min(1).max(80),
  templateRef: z.string().min(1).max(120),
  seedParameters: z.record(z.string().min(1).max(80), z.number().int().min(1)),
});
export type TestDefinition = z.infer<typeof TestDefinitionSchema>;

export const AttemptResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1).optional(),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

/**
 * Attempt evidence payload (evidence kind 'attempt'). Attempts are
 * append-only: every attempt is retained, none overwritten.
 */
export const AttemptPayloadSchema = z.object({
  testId: z.string().min(1).max(80),
  version: z.number().int().min(1),
  seed: Hex64Schema,
  attemptNumber: z.number().int().min(1),
  result: AttemptResultSchema,
});
export type AttemptPayload = z.infer<typeof AttemptPayloadSchema>;

const textEncoder = new TextEncoder();

function sha256HexUtf8(input: string): string {
  return bytesToHex(sha256(textEncoder.encode(input)));
}

/**
 * Seed hook: derive attempt parameters from the server-issued session
 * nonce. Same (nonce, test, attemptNumber) -> same params; anything
 * differs -> (almost surely) different seed. Parameter names sort so key
 * order can never change the derivation.
 */
export function deriveAttemptParams(
  nonce: string,
  test: Pick<TestDefinition, 'id' | 'version' | 'seedParameters'>,
  attemptNumber: number,
): { seed: string; params: Record<string, number> } {
  const cleanNonce = NonceSchema.parse(nonce);
  const cleanTest = TestDefinitionSchema.pick({ id: true, version: true, seedParameters: true }).parse(test);
  const cleanAttempt = z.number().int().min(1).parse(attemptNumber);
  const seed = Hex64Schema.parse(
    sha256HexUtf8(
      `${DOMAIN_SEPARATION.attempt}\n${cleanNonce}\n${cleanTest.id}\n${cleanTest.version}\n${cleanAttempt}`,
    ),
  );
  const bytes = hexToBytes(seed);
  const params: Record<string, number> = {};
  for (const [index, name] of Object.keys(cleanTest.seedParameters).sort().entries()) {
    params[name] = bytes[index % bytes.length] % cleanTest.seedParameters[name];
  }
  return { seed, params };
}
