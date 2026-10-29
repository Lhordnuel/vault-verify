import { useState } from 'react';
import { parseSessionLogText } from '@vault-verify/core';
import { verifySession, type SessionVerdict } from '@vault-verify/core/web';
import VerificationBadge from './VerificationBadge.jsx';
import { tamperedLogText, validLogText } from '../lib/report.js';

type Outcome =
  | { kind: 'none' }
  | { kind: 'issues'; issues: string[] }
  | { kind: 'verdict'; verdict: SessionVerdict };

export default function VerifyPanel() {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });

  function verify() {
    const parsed = parseSessionLogText(text);
    if (!parsed.ok) {
      setOutcome({ kind: 'issues', issues: parsed.issues });
      return;
    }
    setOutcome({
      kind: 'verdict',
      verdict: verifySession(parsed.data.events, parsed.data.anchors, parsed.data.facts),
    });
  }

  function loadFile(file: File | undefined) {
    if (!file) return;
    void file.text().then((content) => {
      setText(content);
      setOutcome({ kind: 'none' });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          onClick={() => {
            setText(validLogText);
            setOutcome({ kind: 'none' });
          }}
        >
          Load valid sample
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          onClick={() => {
            setText(tamperedLogText);
            setOutcome({ kind: 'none' });
          }}
        >
          Load tampered sample
        </button>
        <label className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          Upload log
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Upload session log file"
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          onClick={verify}
        >
          Verify log
        </button>
      </div>
      <textarea
        aria-label="Session log JSON"
        className="mt-3 h-48 w-full rounded-md border border-slate-300 p-3 font-mono text-xs"
        placeholder="Paste a vv-session-log/1 JSON document, upload one, or load a sample."
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="mt-3">
        {outcome.kind === 'issues' && (
          <div>
            <p className="text-sm font-semibold text-rose-800">Log rejected before verification:</p>
            <ul className="mt-1 space-y-1 font-mono text-xs text-rose-800">
              {outcome.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {outcome.kind === 'verdict' && (
          <div>
            <p className="text-sm font-semibold">
              {outcome.verdict.level === 'L0' ? 'Verification failed' : 'Verification passed'}
            </p>
            <div className="mt-2">
              <VerificationBadge level={outcome.verdict.level} reasons={outcome.verdict.reasons} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
