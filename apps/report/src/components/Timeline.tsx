import type { TimelineKind, TimelineMoment } from '@vault-verify/core';

const KIND_LABELS: Record<TimelineKind, string> = {
  edit: 'Edit',
  'test-pass': 'Tests pass',
  'test-fail': 'Tests fail',
  recovery: 'Recovery',
  final: 'Final diff',
};

function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

export default function Timeline({ moments }: { moments: TimelineMoment[] }) {
  return (
    <ol className="divide-y divide-slate-100">
      {moments.map((moment) => (
        <li key={moment.seq} className="flex items-baseline gap-3 py-2 text-sm">
          <span className="w-12 shrink-0 tabular-nums text-slate-600">{timeOf(moment.at)}</span>
          <span className="w-24 shrink-0 font-medium">{KIND_LABELS[moment.kind]}</span>
          <span className="shrink-0 font-mono text-xs text-slate-600">seq:{moment.seq}</span>
          <span className="text-slate-600">{moment.label}</span>
        </li>
      ))}
    </ol>
  );
}
