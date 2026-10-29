import type { CriterionScore, ScoringSignalId } from '@vault-verify/core';

const SIGNAL_LABELS: Record<ScoringSignalId, { label: string; unit: string }> = {
  'edit-test-latency': { label: 'Edit-to-test latency', unit: ' min median' },
  'test-follow-share': { label: 'Edits followed by a test or review', unit: '' },
  'recovery-cost': { label: 'Recovery cost', unit: ' edits mean' },
  'revert-count': { label: 'Reverts', unit: '' },
  'hidden-test-outcome': { label: 'Hidden-test outcome', unit: '' },
};

function formatValue(signal: ScoringSignalId, value: number | null): string {
  if (value === null) return 'n/a';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${SIGNAL_LABELS[signal].unit}`;
}

function formatPct(score: number | null): string {
  return score === null ? 'n/a' : `${Math.round(score * 100)}`;
}

export default function CriterionCard({ criterion }: { criterion: CriterionScore }) {
  return (
    <section className="py-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-semibold">{criterion.label}</h3>
        <p className="shrink-0 text-sm text-slate-600 tabular-nums">
          {criterion.score === null ? (
            'Insufficient evidence'
          ) : (
            <>
              <span className="text-lg font-semibold text-slate-900">{formatPct(criterion.score)}</span>
              {' / 100 · '}
              {`weight ${criterion.weight} · confidence ${formatPct(criterion.confidence)}`}
            </>
          )}
        </p>
      </div>
      {criterion.score !== null && (
        <div
          className="mt-2 h-1.5 w-full rounded-full bg-slate-100"
          role="img"
          aria-label={`score ${formatPct(criterion.score)} of 100`}
        >
          <div className="h-1.5 rounded-full bg-slate-900" style={{ width: `${criterion.score * 100}%` }} />
        </div>
      )}
      {criterion.citedEventIds.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Cited evidence:{' '}
          {criterion.citedEventIds.map((id) => (
            <code key={id} className="mr-1 rounded border border-slate-200 bg-slate-50 px-1 font-mono">
              {id}
            </code>
          ))}
        </p>
      )}
      <dl className="mt-3 space-y-1 text-sm">
        {criterion.signals.map((signal) => (
          <div key={signal.signal} className="flex items-baseline justify-between gap-4">
            <dt className="text-slate-600">
              {SIGNAL_LABELS[signal.signal].label}
              <span className="text-slate-600"> — value {formatValue(signal.signal, signal.value)}</span>
              {signal.note && <span> ({signal.note})</span>}
            </dt>
            <dd className="shrink-0 tabular-nums">{formatPct(signal.score)}</dd>
          </div>
        ))}
      </dl>
      {criterion.judgments.map((judgment) => (
        <div key={judgment.aspect} className="mt-3 border-t border-slate-100 pt-3 text-sm">
          <p>
            <span className="font-medium">Judge ({judgment.aspect}): {formatPct(judgment.score)} / 100</span>
          </p>
          <p className="mt-1 text-slate-600">{judgment.rationale}</p>
          <p className="mt-1 text-xs text-slate-600">
            Cites:{' '}
            {judgment.citedEventIds.map((id) => (
              <code key={id} className="mr-1 rounded border border-slate-200 bg-slate-50 px-1 font-mono">
                {id}
              </code>
            ))}
          </p>
        </div>
      ))}
      {criterion.discardedJudgments > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          {criterion.discardedJudgments} uncited judgment(s) discarded.
        </p>
      )}
    </section>
  );
}
