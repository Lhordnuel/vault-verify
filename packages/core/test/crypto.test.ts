import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  sha256HexUtf8,
  signHashHex,
  verifyHashSignature,
} from '../src/node.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

describe('canonicalJson', () => {
  it('is stable under key insertion order', () => {
    const a = canonicalJson({ b: 2, a: 1, nested: { z: 0, y: [3, 2, 1] } });
    const b = canonicalJson({ nested: { y: [3, 2, 1], z: 0 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"nested":{"y":[3,2,1],"z":0}}');
  });

  it('rejects non-JSON values', () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });
});

describe('sha256HexUtf8', () => {
  it('matches WebCrypto (independent implementation)', async () => {
    const bytes = new TextEncoder().encode('vault-verify');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(sha256HexUtf8('vault-verify')).toBe(hex);
  });
});

describe('hashEventStruct', () => {
  it('is deterministic and well-formed', () => {
    const input = { seq: 0, prevHash: 'a'.repeat(64), payload: { x: 1 } };
    const h1 = hashEventStruct(input);
    expect(hashEventStruct(input)).toBe(h1);
    expect(h1).toMatch(HEX64);
  });

  it('changes when any input changes', () => {
    const base = { seq: 1, prevHash: 'b'.repeat(64), payload: { x: 1 } };
    const h = hashEventStruct(base);
    expect(hashEventStruct({ ...base, seq: 2 })).not.toBe(h);
    expect(hashEventStruct({ ...base, prevHash: 'c'.repeat(64) })).not.toBe(h);
    expect(hashEventStruct({ ...base, payload: { x: 2 } })).not.toBe(h);
  });

  it('rejects malformed inputs', () => {
    expect(() => hashEventStruct({ seq: -1, prevHash: 'a'.repeat(64), payload: {} })).toThrow();
    expect(() => hashEventStruct({ seq: 0, prevHash: 'nope', payload: {} })).toThrow();
  });
});

describe('genesisPrevHashFromNonce', () => {
  it('is deterministic, distinct per nonce, and 64-hex', () => {
    const g1 = genesisPrevHashFromNonce('11'.repeat(16));
    expect(g1).toBe(genesisPrevHashFromNonce('11'.repeat(16)));
    expect(g1).toMatch(HEX64);
    expect(genesisPrevHashFromNonce('22'.repeat(16))).not.toBe(g1);
  });

  it('rejects malformed nonces', () => {
    expect(() => genesisPrevHashFromNonce('nope')).toThrow();
  });
});

describe('ed25519 session keys', () => {
  it('signs and verifies a hash round-trip', () => {
    const kp = generateSessionKeypair();
    expect(kp.publicKey).toMatch(HEX64);
    expect(kp.privateKey).toMatch(HEX64);
    const hash = sha256HexUtf8('hello');
    const sig = signHashHex(kp.privateKey, hash);
    expect(sig).toMatch(HEX128);
    expect(verifyHashSignature(kp.publicKey, hash, sig)).toBe(true);
  });

  it('rejects wrong-key and tampered signatures without throwing', () => {
    const a = generateSessionKeypair();
    const b = generateSessionKeypair();
    const hash = sha256HexUtf8('hello');
    const sig = signHashHex(a.privateKey, hash);
    expect(verifyHashSignature(b.publicKey, hash, sig)).toBe(false);
    expect(verifyHashSignature(a.publicKey, sha256HexUtf8('bye'), sig)).toBe(false);
    expect(verifyHashSignature(a.publicKey, hash, '00'.repeat(64))).toBe(false);
    expect(verifyHashSignature('not-hex', hash, sig)).toBe(false);
  });
});

describe('observationPayloadHash', () => {
  it('is stable across key order and sensitive to content', () => {
    expect(observationPayloadHash({ a: 1, b: 2 })).toBe(observationPayloadHash({ b: 2, a: 1 }));
    expect(observationPayloadHash({ a: 1 })).not.toBe(observationPayloadHash({ a: 2 }));
  });
});

describe('known-answer vector', () => {
  // Fixed TEST-ONLY seed + nonce. Regression tripwire: any accidental
  // construction change breaks these constants. Never use in production.
  const TEST_SEED = '01'.repeat(32);
  const TEST_NONCE = '02'.repeat(16);

  it('pins the genesis event bytes', () => {
    const prevHash = genesisPrevHashFromNonce(TEST_NONCE);
    const hash = hashEventStruct({ seq: 0, prevHash, payload: { hello: 'world' } });
    expect(prevHash).toBe('f0f37df5a9332ddfc1b5cc8e5e20b03bc3c1f829f569119cf9bdbad9899fa068');
    expect(hash).toBe('bf1596f772f44865953a271ddaade953825f5db3ab873cafa1895acb68fe1d1e');
    expect(signHashHex(TEST_SEED, sha256HexUtf8('vector'))).toBe(
      '79b43ad4312e6597dd113153bf7a109197e5650bfba039530ee57f732d5c44066f45630ba3337bba7c04fce7bd71fc77a2df1e3614186e43b08cd9083fa3f90c',
    );
  });
});
