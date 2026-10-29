/** Screening report: fixture-driven scores, timeline, and log verification (no database). */
import CriterionCard from './components/CriterionCard.jsx';
import Timeline from './components/Timeline.jsx';
import VerificationBadge from './components/VerificationBadge.jsx';
import VerifyPanel from './components/VerifyPanel.jsx';
import { formatScore, report, timeline } from './lib/report.js';

export default function App() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-slate-900">
      <header>
        <h1 className="text-2xl font-semibold">Screening report</h1>
        <p className="mt-1 text-sm text-slate-600">
          Session {report.sessionId} · rubric {report.roleId} v{report.rubricVersion} · generated{' '}
          {report.generatedAt.slice(0, 10)}
        </p>
      </header>

      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Scores are heuristic, not validated. They describe one observed session and must not be the
        sole basis for a hiring decision.
      </div>

      <section aria-label="Overall result" className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="text-sm font-medium text-slate-600">Overall score</h2>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{formatScore(report.overallScore)}</p>
        </div>
        <VerificationBadge level={report.verification.level} reasons={report.verification.reasons} />
      </section>

      <section aria-label="Per-criterion scores" className="mt-8">
        <h2 className="text-lg font-semibold">Criteria</h2>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {report.criteria.map((criterion) => (
            <CriterionCard key={criterion.criterionId} criterion={criterion} />
          ))}
        </div>
      </section>

      <section aria-label="Session timeline" className="mt-8">
        <h2 className="text-lg font-semibold">Session timeline</h2>
        <div className="mt-2">
          <Timeline moments={timeline} />
        </div>
      </section>

      <section aria-label="Verify a session log" className="mt-8">
        <h2 className="text-lg font-semibold">Verify this log</h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste or upload a session log to re-run chain verification in your browser. Nothing leaves
          this page.
        </p>
        <div className="mt-3">
          <VerifyPanel />
        </div>
      </section>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-600">
        <p>
          Built by {report.generator} from verified session events. Verification level{' '}
          {report.verification.level} is derived from the chain, anchors, and harness facts — scores
          never change it.
        </p>
      </footer>
    </main>
  );
}
