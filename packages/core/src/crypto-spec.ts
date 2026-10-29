/**
 * Q2 crypto spec (universal: safe to import in browser and node).
 * - Canonicalization: RFC 8785 JSON Canonicalization Scheme (JCS) via the
 *   `canonicalize` library (applied in the node entrypoint only).
 * - Hash: sha256 over domain + LF + framed fields, lowercase hex.
 * - Signatures: ed25519 (node:crypto), lowercase hex.
 */
export const CRYPTO_SPEC_VERSION = 'vv-crypto-1';

/** Domain-separation prefixes. The spec tag is embedded in every domain. */
export const DOMAIN_SEPARATION = {
  event: 'vv-crypto-1:event',
  session: 'vv-crypto-1:session',
  anchor: 'vv-crypto-1:anchor',
  report: 'vv-crypto-1:report',
} as const;
export type CryptoDomain = (typeof DOMAIN_SEPARATION)[keyof typeof DOMAIN_SEPARATION];

/** Hash-input construction shared by every domain. */
export function hashInput(domain: CryptoDomain, canonicalStruct: string): string {
  return `${domain}\n${canonicalStruct}`;
}
