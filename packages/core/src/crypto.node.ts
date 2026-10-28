/**
 * Node-only executable crypto (Q2). Import from `@vault-verify/core/node`.
 * Never imported by the universal entrypoint (browser safety).
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
import canonicalize from 'canonicalize';
import { DOMAIN_SEPARATION, hashInput } from './crypto-spec';
import { Hex128Schema, Hex64Schema } from './primitives';
import { SessionKeypairSchema, type SessionKeypair } from './sessions';

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

/** Chain-link hash over the event struct (domain: vv-crypto-1:event). */
export function hashEventStruct(input: { seq: number; prevHash: string; payload: unknown }): string {
  const struct = canonicalJson({ prevHash: input.prevHash, payload: input.payload, seq: input.seq });
  return Hex64Schema.parse(sha256HexUtf8(hashInput(DOMAIN_SEPARATION.event, struct)));
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
 * Full chain-link verification: recompute the hash (constant-time compare),
 * then verify the signature against the session public key.
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
