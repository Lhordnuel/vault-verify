import type { EvidenceAdapter } from '@vault-verify/core';

export const adapterId = 'adapter/muse-code';

/** Tier 2 Muse Code adapter (stub — not implemented). */
export const adapter: EvidenceAdapter = {
  id: adapterId,
  agent: 'muse-code',
  tier: 2,
  async collect() {
    throw new Error(`[${adapterId}] not implemented (scaffold only)`);
  },
};

export default adapter;
