import type { VerificationLevel } from '@vault-verify/core';

const LEVEL_COPY: Record<VerificationLevel, { label: string; className: string }> = {
  L0: { label: 'L0 — unverified', className: 'border-rose-200 bg-rose-50 text-rose-800' },
  L1: { label: 'L1 — linked', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  L2: { label: 'L2 — platform-observed', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  L3: { label: 'L3 — chain-verified', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  L4: {
    label: 'L4 — anchored and corroborated',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
};

export default function VerificationBadge({
  level,
  reasons,
}: {
  level: VerificationLevel;
  reasons: string[];
}) {
  const copy = LEVEL_COPY[level];
  return (
    <div>
      <span className={`inline-block rounded-md border px-2 py-1 text-sm font-semibold ${copy.className}`}>
        {copy.label}
      </span>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-xs text-slate-600">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
