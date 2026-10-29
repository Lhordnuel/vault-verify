/**
 * Node-only executable crypto (ledger spec vv-crypto-1).
 * Import from `@vault-verify/core/node`. Never imported by the universal
 * entrypoint (browser safety).
 *
 * Constructions (see docs/DECISIONS.md for rationale):
 * - eventHash = sha256hex(`vv-crypto-1:event` LF seq LF prevHash LF JCS(payload))
 * - genesis prevHash = sha256hex(`vv-crypto-1:session` LF sessionNonce)
 * - signatures: ed25519 over hash bytes, lowercase hex.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { DOMAIN_SEPARATION, hashInput } from './crypto-spec.js';
import { Hex128Schema, Hex64Schema, NonceSchema } from './primitives.js';
import { SessionKeypairSchema, type SessionKeypair } from './sessions.js';

// `canonicalize` is CJS without ESM-typed exports: require it explicitly.
const require = createRequire(import.meta.url);
const canonicalize = require('canonicalize') as (input: unknown) => string | undefined;

/** RFC 8785 canonical JSON. Throws for non-JSON values. */
export function canonicalJson(value: unknown): string {
  const out: unknown = canonicalize(value);
  if (typeof out !== 'string') {
    throw new Error('[vault-verify] value is not JSON-canonicalizable');
  }
  return out;
}

/** sha256 over UTF-8, lowercase hex. */
export function sha256HexUtf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Chain-link hash over seq, prevHash, and canonical payload. */
export function hashEventStruct(input: { seq: number; prevHash: string; payload: unknown }): string {
  const seq = z.number().int().min(0).parse(input.seq);
  const prevHash = Hex64Schema.parse(input.prevHash);
  const framed = `${DOMAIN_SEPARATION.event}\n${seq}\n${prevHash}\n${canonicalJson(input.payload)}`;
  return Hex64Schema.parse(sha256HexUtf8(framed));
}

/**
 * Genesis prevHash for a session chain, derived from the server-issued
 * session nonce. Binds the whole chain to its session (replaying an old
 * chain under a fresh nonce fails genesis verification).
 */
export function genesisPrevHashFromNonce(nonce: string): string {
  return Hex64Schema.parse(
    sha256HexUtf8(hashInput(DOMAIN_SEPARATION.session, NonceSchema.parse(nonce))),
  );
}

/** Canonical payload digest for harness observations (bare JCS sha256). */
export function observationPayloadHash(payload: unknown): string {
  return Hex64Schema.parse(sha256HexUtf8(canonicalJson(payload)));
}

function base64UrlToHex(input: string): string {
  return Buffer.from(input, 'base64url').toString('hex');
}

/** Fresh per-session ed25519 keypair (Q6). The private key stays local. */
export function generateSessionKeypair(): SessionKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  if (typeof pubJwk.x !== 'string' || typeof privJwk.d !== 'string') {
    throw new Error('[vault-verify] ed25519 JWK export missing key material');
  }
  return SessionKeypairSchema.parse({
    publicKey: base64UrlToHex(pubJwk.x),
    privateKey: base64UrlToHex(privJwk.d),
  });
}

/** PKCS#8 DER prefix for an ed25519 seed (16 bytes). */
const ED25519_PKCS8_PREFIX = '302e020100300506032b657004220420';
/** SPKI DER prefix for an ed25519 public key (12 bytes). */
const ED25519_SPKI_PREFIX = '302a300506032b6570032100';

function privateKeyFromSeedHex(seedHex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from(ED25519_PKCS8_PREFIX, 'hex'),
      Buffer.from(Hex64Schema.parse(seedHex), 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Derive the ed25519 public key (hex) from a seed — e.g. to publish the
 * anchor public key that verifiers check countersignatures against.
 */
export function publicKeyFromSeedHex(seedHex: string): string {
  const derived = createPublicKey(privateKeyFromSeedHex(seedHex));
  const jwk = derived.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') {
    throw new Error('[vault-verify] public key export failed');
  }
  return Hex64Schema.parse(base64UrlToHex(jwk.x));
}

function publicKeyFromHex(publicKeyHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([
      Buffer.from(ED25519_SPKI_PREFIX, 'hex'),
      Buffer.from(Hex64Schema.parse(publicKeyHex), 'hex'),
    ]),
    format: 'der',
    type: 'spki',
  });
}

/** ed25519 signature over hash bytes, lowercase hex. Throws on bad input. */
export function signHashHex(privateSeedHex: string, hashHex: string): string {
  const signature = sign(
    null,
    Buffer.from(Hex64Schema.parse(hashHex), 'hex'),
    privateKeyFromSeedHex(privateSeedHex),
  );
  return Hex128Schema.parse(signature.toString('hex'));
}

/** False on mismatch AND on malformed input (verification never throws). */
export function verifyHashSignature(
  publicKeyHex: string,
  hashHex: string,
  signatureHex: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(hashHex, 'hex'),
      publicKeyFromHex(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Single-link check: hash recomputation (constant-time compare) plus
 * signature verification. Checks NEITHER sequence continuity NOR genesis
 * binding — use verifyChain for full verification.
 */
export function verifyEventSignature(
  event: { seq: number; prevHash: string; payload: unknown; hash: string; sig: string },
  publicKeyHex: string,
): boolean {
  try {
    const recomputed = hashEventStruct(event);
    const a = Buffer.from(recomputed, 'hex');
    const b = Buffer.from(event.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return false;
    }
    return verifyHashSignature(publicKeyHex, event.hash, event.sig);
  } catch {
    return false;
  }
}
