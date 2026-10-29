/**
 * Chain + session verification for browsers (web entrypoint:
 * `@vault-verify/core/web`). A byte-for-byte twin of `./verify.node`:
 * same vv-crypto-1 constructions, same reason strings, same verdicts —
 * but ed25519/sha256 come from @noble/* (universal) instead of
 * node:crypto. No node:* imports allowed in this file. Parity-tested
 * against the node implementation in `test/web-parity.test.ts`.
 */
import { etc, verify as ed25519Verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import canonicalize from 'canonicalize';
import { z } from 'zod';
import { DOMAIN_SEPARATION, hashInput } from './crypto-spec.js';
import {
  AnchorReceiptSchema,
  GENESIS_PREV_HASH,
  SignedEventSchema,
  type AnchorReceipt,
  type SignedEvent,
} from './ledger.js';
import { Hex64Schema, NonceSchema } from './primitives.js';
import { HarnessFactsSchema, type HarnessFacts } from './sessions.js';
import type { VerificationLevel } from './levels.js';

// ed25519 v2 sync API needs an explicit sha512 until the host provides one.
etc.sha512Sync = (...messages: Uint8Array[]) => sha512(etc.concatBytes(...messages));

/** RFC 8785 canonical JSON. Throws for non-JSON values. */
export function canonicalJson(value: unknown): string {
  const out: unknown = canonicalize(value);
  if (typeof out !== 'string') {
    throw new Error('[vault-verify] value is not JSON-canonicalizable');
  }
  return out;
}

const textEncoder = new TextEncoder();

/** sha256 over UTF-8, lowercase hex. */
export function sha256HexUtf8(input: string): string {
  return bytesToHex(sha256(textEncoder.encode(input)));
}

/** Chain-link hash over seq, prevHash, and canonical payload. */
export function hashEventStruct(input: { seq: number; prevHash: string; payload: unknown }): string {
  const seq = z.number().int().min(0).parse(input.seq);
  const prevHash = Hex64Schema.parse(input.prevHash);
  const framed = `${DOMAIN_SEPARATION.event}\n${seq}\n${prevHash}\n${canonicalJson(input.payload)}`;
  return Hex64Schema.parse(sha256HexUtf8(framed));
}

/** Genesis prevHash for a session chain, derived from the session nonce. */
export function genesisPrevHashFromNonce(nonce: string): string {
  return Hex64Schema.parse(
    sha256HexUtf8(hashInput(DOMAIN_SEPARATION.session, NonceSchema.parse(nonce))),
  );
}

/** Canonical payload digest for harness observations (bare JCS sha256). */
export function observationPayloadHash(payload: unknown): string {
  return Hex64Schema.parse(sha256HexUtf8(canonicalJson(payload)));
}

function hexToBytesSafe(hex: string): Uint8Array | null {
  try {
    return hexToBytes(hex);
  } catch {
    return null;
  }
}

/** False on mismatch AND on malformed input (verification never throws). */
export function verifyHashSignature(
  publicKeyHex: string,
  hashHex: string,
  signatureHex: string,
): boolean {
  try {
    const publicKey = hexToBytesSafe(publicKeyHex);
    const hash = hexToBytesSafe(hashHex);
    const signature = hexToBytesSafe(signatureHex);
    if (!publicKey || !hash || !signature) return false;
    if (publicKey.length !== 32 || hash.length !== 32 || signature.length !== 64) return false;
    return ed25519Verify(signature, hash, publicKey);
  } catch {
    return false;
  }
}

/**
 * Single-link check: hash recomputation plus signature verification.
 * (No constant-time compare here — node-only hardening lives in
 * verifyEventSignature of `./crypto.node`; same boolean outcome.)
 */
export function verifyEventSignature(
  event: { seq: number; prevHash: string; payload: unknown; hash: string; sig: string },
  publicKeyHex: string,
): boolean {
  try {
    const recomputed = hashEventStruct(event);
    if (recomputed !== event.hash) {
      return false;
    }
    return verifyHashSignature(publicKeyHex, event.hash, event.sig);
  } catch {
    return false;
  }
}

/**
 * Digest the server countersigns: sha256 over the anchor domain plus JCS of
 * {headHash, seq, serverTime, sessionId} (keys in UTF-16 order).
 */
export function anchorDigest(input: {
  sessionId: string;
  seq: number;
  headHash: string;
  serverTime: string;
}): string {
  const canonical = canonicalJson({
    headHash: input.headHash,
    seq: input.seq,
    serverTime: input.serverTime,
    sessionId: input.sessionId,
  });
  return sha256HexUtf8(hashInput(DOMAIN_SEPARATION.anchor, canonical));
}

/** Verify a server countersignature (never throws). */
export function verifyAnchorReceipt(receipt: AnchorReceipt, anchorPublicKey: string): boolean {
  try {
    const parsed = AnchorReceiptSchema.safeParse(receipt);
    if (!parsed.success) return false;
    const digest = anchorDigest(parsed.data);
    return verifyHashSignature(anchorPublicKey, digest, parsed.data.signature);
  } catch {
    return false;
  }
}

// Verdict types mirror `./verify.node` (duplicated so this module stays
// free of node-entrypoint imports); parity tests assert identical verdicts.
export type ChainBreakReason =
  | 'empty_chain'
  | 'malformed_event'
  | 'seq_discontinuity'
  | 'genesis_prev_hash_mismatch'
  | 'prev_hash_mismatch'
  | 'hash_mismatch'
  | 'signature_invalid';

export interface ChainBreak {
  index: number;
  seq: number;
  reason: ChainBreakReason;
  detail?: string;
}

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; count: number; break: ChainBreak };

function broken(index: number, seq: number, reason: ChainBreakReason, detail?: string): ChainVerification {
  return { ok: false, count: index, break: { index, seq, reason, detail } };
}

/**
 * Verify internal chain integrity: shape, sequence continuity from 0,
 * prevHash linkage (genesis bound to the expected session prevHash),
 * recomputed hashes, and signatures. Reports the FIRST break.
 */
export function verifyChain(
  events: SignedEvent[],
  publicKey: string,
  opts?: { expectedGenesisPrevHash?: string },
): ChainVerification {
  if (events.length === 0) {
    return broken(-1, -1, 'empty_chain');
  }
  const expectedGenesis = opts?.expectedGenesisPrevHash ?? GENESIS_PREV_HASH;
  const checked: SignedEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const parsed = SignedEventSchema.safeParse(events[i]);
    if (!parsed.success) {
      const seqGuess = (events[i] as { seq?: unknown }).seq;
      return broken(i, typeof seqGuess === 'number' ? seqGuess : -1, 'malformed_event');
    }
    const event = parsed.data;
    if (event.seq !== i) {
      return broken(i, event.seq, 'seq_discontinuity', `expected seq ${i}`);
    }
    const expectedPrev = i === 0 ? expectedGenesis : checked[i - 1].hash;
    if (event.prevHash !== expectedPrev) {
      return broken(i, event.seq, i === 0 ? 'genesis_prev_hash_mismatch' : 'prev_hash_mismatch');
    }
    let recomputed: string;
    try {
      recomputed = hashEventStruct({ seq: event.seq, prevHash: event.prevHash, payload: event.payload });
    } catch {
      return broken(i, event.seq, 'hash_mismatch', 'payload not JSON-canonicalizable');
    }
    if (recomputed !== event.hash) {
      return broken(i, event.seq, 'hash_mismatch');
    }
    if (!verifyHashSignature(publicKey, event.hash, event.sig)) {
      return broken(i, event.seq, 'signature_invalid');
    }
    checked.push(event);
  }
  return { ok: true, count: events.length };
}

export interface SessionVerdict {
  level: VerificationLevel;
  reasons: string[];
}

/**
 * Highest level earned from verifiable inputs. L3 = valid session-bound
 * chain + signatures. L4 additionally requires every supplied anchor to be
 * valid and matching, plus agreeing harness observations with full seq
 * coverage. Anything failing closed reports the specific reason.
 * Retroactive provenance caps valid chains at L1, or L2 with a valid
 * server countersignature.
 */
export function verifySession(
  events: SignedEvent[],
  anchors: AnchorReceipt[],
  facts: HarnessFacts,
): SessionVerdict {
  const reasons: string[] = [];
  const factsParsed = HarnessFactsSchema.safeParse(facts);
  if (!factsParsed.success) {
    return { level: 'L0', reasons: ['invalid_harness_facts'] };
  }
  const f = factsParsed.data;

  const chain = verifyChain(events, f.sessionPublicKey, {
    expectedGenesisPrevHash: genesisPrevHashFromNonce(f.nonce),
  });
  if (!chain.ok) {
    const b = chain.break;
    return { level: 'L0', reasons: [`chain_break:${b.reason}@seq:${b.seq}`] };
  }
  reasons.push(`chain_valid:${chain.count}_events`);

  if (f.provenance === 'retroactive') {
    // Sealed after the fact: collection credit only. A valid server
    // countersignature lifts the cap from L1 to L2; anything else fails
    // closed at L1 with the specific reason.
    if (anchors.length === 0) {
      return { level: 'L1', reasons: [...reasons, 'retroactive_unanchored_cap'] };
    }
    for (const anchor of anchors) {
      const parsed = AnchorReceiptSchema.safeParse(anchor);
      if (!parsed.success) {
        return { level: 'L1', reasons: [...reasons, 'malformed_anchor', 'retroactive_unanchored_cap'] };
      }
      const a = parsed.data;
      if (!verifyAnchorReceipt(a, f.anchorPublicKey)) {
        return {
          level: 'L1',
          reasons: [...reasons, `anchor_signature_invalid@seq:${a.seq}`, 'retroactive_unanchored_cap'],
        };
      }
      if (a.sessionId !== f.sessionId) {
        return {
          level: 'L1',
          reasons: [...reasons, `anchor_session_mismatch@seq:${a.seq}`, 'retroactive_unanchored_cap'],
        };
      }
      const event = events[a.seq];
      if (!event || event.seq !== a.seq) {
        return {
          level: 'L1',
          reasons: [...reasons, `anchor_seq_beyond_chain@seq:${a.seq}`, 'retroactive_unanchored_cap'],
        };
      }
      if (event.hash !== a.headHash) {
        return {
          level: 'L1',
          reasons: [...reasons, `anchor_head_mismatch@seq:${a.seq}`, 'retroactive_unanchored_cap'],
        };
      }
    }
    reasons.push(`anchors_match:${anchors.length}`);
    return { level: 'L2', reasons: [...reasons, 'retroactive_anchored_cap'] };
  }

  if (anchors.length === 0) {
    return { level: 'L3', reasons: [...reasons, 'no_anchors'] };
  }
  for (const anchor of anchors) {
    const parsed = AnchorReceiptSchema.safeParse(anchor);
    if (!parsed.success) {
      return { level: 'L3', reasons: [...reasons, 'malformed_anchor'] };
    }
    const a = parsed.data;
    if (!verifyAnchorReceipt(a, f.anchorPublicKey)) {
      return { level: 'L3', reasons: [...reasons, `anchor_signature_invalid@seq:${a.seq}`] };
    }
    if (a.sessionId !== f.sessionId) {
      return { level: 'L3', reasons: [...reasons, `anchor_session_mismatch@seq:${a.seq}`] };
    }
    const event = events[a.seq];
    if (!event || event.seq !== a.seq) {
      return { level: 'L3', reasons: [...reasons, `anchor_seq_beyond_chain@seq:${a.seq}`] };
    }
    if (event.hash !== a.headHash) {
      return { level: 'L3', reasons: [...reasons, `anchor_head_mismatch@seq:${a.seq}`] };
    }
  }
  reasons.push(`anchors_match:${anchors.length}`);

  if (f.observations.length === 0) {
    return { level: 'L3', reasons: [...reasons, 'no_harness_observations'] };
  }
  const observed = new Set<number>();
  for (const o of f.observations) {
    const event = events[o.seq];
    if (!event || event.seq !== o.seq) {
      return { level: 'L3', reasons: [...reasons, `harness_observation_beyond_chain@seq:${o.seq}`] };
    }
    let recomputed: string;
    try {
      recomputed = observationPayloadHash(event.payload);
    } catch {
      return { level: 'L3', reasons: [...reasons, `harness_payload_unhashable@seq:${o.seq}`] };
    }
    if (recomputed !== o.payloadHash) {
      return { level: 'L3', reasons: [...reasons, `harness_payload_mismatch@seq:${o.seq}`] };
    }
    observed.add(o.seq);
  }
  for (let s = 0; s < events.length; s += 1) {
    if (!observed.has(s)) {
      return { level: 'L3', reasons: [...reasons, `harness_coverage_gap@seq:${s}`] };
    }
  }
  reasons.push(`harness_agrees:${observed.size}/${events.length}`);
  return { level: 'L4', reasons };
}
