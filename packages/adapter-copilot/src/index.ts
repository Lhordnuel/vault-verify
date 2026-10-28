import type { EvidenceAdapter } from '@vault-verify/core';

export const adapterId = 'adapter/copilot';

/** Tier 2 Copilot adapter (stub — not implemented). */
export const adapter: EvidenceAdapter = {
  id: adapterId,
  agent: 'copilot',
  tier: 2,
  async collect() {
    throw new Error(`[${adapterId}] not implemented (scaffold only)`);
  },
};

export default adapter;
