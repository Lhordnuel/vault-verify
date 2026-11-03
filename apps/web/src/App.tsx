import { useEffect, useRef, useState } from 'react';
import { parseSessionLogText, sessionEvidenceFromImport } from '@attest/core';
import type { ImportedSessionLog, SessionEvidence } from '@attest/core';

type GitEvidenceRef = {
  commit_hash: string;
  committed_at: string;
  repository: string;
  repository_url?: string;
  message: string;
  files: string[];
  quote: string;
  previous_hash: string;
  chain_hash: string;
};
type SessionEvidenceRef = {
  session_id: string;
  format: string;
  event_id: string;
  event_type: string;
  actor: string;
  occurred_at: string;
  quote: string;
  verification_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  verification_reasons: string[];
  previous_hash: string;
  chain_hash: string;
};
type Claim = {
  id: string;
  claim_type: string;
  claim_value: string;
  status: string;
  confidence: number | null;
  source: 'git' | 'session';
  evidence_ref: GitEvidenceRef | SessionEvidenceRef;
  captured_at: number;
};
type Grade = {
  overall?: number | null;
  multiple_choice?: { correct: number; total: number; score: number };
  pass1: { overall: number | null; competencies: Array<{ skill: string; score: number | null; evidence_quote: string | null; evidence_refs?: string[] }>; rationale: string };
  pass2: { overall: number | null; competencies: Array<{ skill: string; score: number | null; evidence_quote: string | null; evidence_refs?: string[] }>; rationale: string };
  agreement: number | null;
};
type Profile = {
  handle: string;
  github_username: string;
  claims: Claim[];
  assessments: Array<{ id: string; status: string; ai_grade: Grade | null; grader_agreement: number | null; human_review_required: number }>;
  signal_summary: string;
};
type UserSession = { handle: string; username: string };
type Test = {
  id: string;
  title: string;
  instructions: string;
  multiple_choice: Array<{ id: string; skill: string; question: string; options: string[] }>;
  scenarios: Array<{ id: string; skill: string; prompt: string }>;
  evidence_basis: Array<{ ref: string; source: string; claim: string; quote: string }>;
  rubric_instance: { criteria: Array<{ skill: string; weight: number; description: string }> };
};
type SessionPreview = { log: ImportedSessionLog; evidence: SessionEvidence[] };

function api<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, { credentials: 'include', ...init }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      const detail = body.message && body.error === 'internal_error' ? body.message : body.error ?? body.message;
      const knownErrors: Record<string, string> = {
        evidence_required: 'Sync your reviewed git evidence before generating a test.',
        meta_model_api_not_configured: 'Meta Model API is not configured for this deployment.',
        model_returned_invalid_test: 'Meta could not produce a valid exercise. Try generating the test again.',
        assessment_not_submittable: 'This assessment cannot be submitted in its current state.',
        invalid_assessment_submission: 'Answer all 15 multiple-choice questions and both scenarios before submitting.',
      };
      throw new Error((detail && knownErrors[detail]) ?? detail ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  });
}

function Landing() {
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const commandInput = useRef<HTMLInputElement>(null);
  const copyCommand = async () => {
    if (copyFallback) {
      commandInput.current?.select();
      return;
    }
    try {
      await Promise.race([
        navigator.clipboard.writeText('.\\attest.cmd scan'),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Clipboard access timed out.')), 800);
        }),
      ]);
      setCopied(true);
    } catch {
      setCopyFallback(true);
      window.setTimeout(() => commandInput.current?.select(), 0);
    }
  };
  return (
    <main className="landing">
      <header className="landing-header">
        <a className="brand" href="/"><span className="brand-mark">A</span> attest<span className="brand-dot">.</span></a>
        <a className="header-signin" href="/api/auth/github">Sign in with GitHub <span aria-hidden="true">↗</span></a>
      </header>
      <section className="hero">
        <p className="eyebrow"><span className="live-dot" /> PORTABLE WORK CREDENTIALS</p>
        <h1>Specific claims.<br /><em>Supporting evidence.</em></h1>
        <p className="intro">Turn your local git history into a portable record of what you built — with every claim linked back to its source.</p>
        <div className="landing-actions">
          <a className="button primary landing-cta" href="/api/auth/github">Get started with GitHub <span aria-hidden="true">→</span></a>
          <span className="landing-or">OR USE THE CLI</span>
        </div>
        <div className="command-card">
          <span className="terminal-prompt" aria-hidden="true">$</span>
          {copyFallback
            ? <input ref={commandInput} className="command-copy-input" aria-label="Select and copy CLI command" value=".\attest.cmd scan" readOnly />
            : <code>.\attest.cmd scan</code>}
          <button className="copy-command" onClick={copyCommand} aria-label="Copy Windows CLI command">
            {copied ? 'Copied ✓' : copyFallback ? 'Select command' : 'Copy command'}
          </button>
        </div>
        <div className="quick-start">
          <span><b>01</b> Sign in <code>.\attest.cmd login</code></span>
          <span><b>02</b> Review <code>.\attest.cmd scan</code></span>
          <span><b>03</b> Confirm <code>.\attest.cmd sync</code></span>
        </div>
        {copyFallback && <p className="copy-fallback" role="status">Clipboard access is unavailable. The command is selected—press Ctrl+C to copy.</p>}
        <span className="sr-only" aria-live="polite">{copied ? 'Command copied to clipboard.' : ''}</span>
        <p className="privacy-note"><span>◇</span> Use the included Windows <code>attest.cmd</code> launcher. Nothing uploads before confirmation.</p>
      </section>
      <footer className="landing-footer"><span>ATTEST / EVIDENCE FIRST</span><span>Not a score of a person.</span><a href="/api/health">API status ↗</a></footer>
    </main>
  );
}

function GradeCard({ grade }: { grade: Grade }) {
  const gatewayUrl = import.meta.env.VITE_AI_GATEWAY_DASHBOARD_URL;
  return (
    <section className="grade-card">
      <div className="section-title"><span>01</span><h2>Assessment evidence</h2>
        {gatewayUrl && <a className="gateway-link" href={gatewayUrl} target="_blank" rel="noreferrer">AI Gateway traces ↗</a>}
      </div>
      {grade.multiple_choice && <div className="assessment-scoreline">
        <strong>{grade.overall === null || grade.overall === undefined ? 'Unverified' : `${grade.overall.toFixed(1)} / 100`}</strong>
        <span>{grade.multiple_choice.correct} / {grade.multiple_choice.total} multiple-choice correct</span>
      </div>}
      <p className="agreement-line">Independent scenario-grader agreement: {grade.agreement === null ? 'Unverified' : `${grade.agreement.toFixed(1)}%`}</p>
      <div className="grade-passes">
        {[['Pass 1 · Muse Spark 1.3', grade.pass1], ['Pass 2 · Muse Wonder 1.0', grade.pass2]].map(([label, pass]) => {
          const result = pass as Grade['pass1'];
          return <div className="grade-pass" key={label as string}>
            <div className="pass-label">{label as string}<strong>{result.overall === null ? '—' : `${result.overall}/100`}</strong></div>
            <p>{result.rationale}</p>
            {result.competencies.map((item, index) => <div className="competency" key={`${item.skill}-${index}`}>
              <span>{item.skill}</span><b>{item.score === null ? 'Unverified' : `${item.score}/100`}</b>
              {item.evidence_quote && <blockquote>“{item.evidence_quote}”</blockquote>}
              {'evidence_refs' in item && item.evidence_refs && item.evidence_refs.length > 0 &&
                <small className="grade-evidence-refs">Grounded in {item.evidence_refs.join(', ')}</small>}
            </div>)}
          </div>;
        })}
      </div>
    </section>
  );
}

function SessionTimeline({ claims }: { claims: Claim[] }) {
  const events = claims
    .filter((claim): claim is Claim & { evidence_ref: SessionEvidenceRef } => 'session_id' in claim.evidence_ref)
    .sort((a, b) => a.evidence_ref.occurred_at.localeCompare(b.evidence_ref.occurred_at));
  if (events.length === 0) return null;
  const counts = events.reduce<Record<string, number>>((result, event) => {
    result[event.evidence_ref.event_type] = (result[event.evidence_ref.event_type] ?? 0) + 1;
    return result;
  }, {});
  return <section className="session-timeline">
    <div className="section-title"><span>02</span><h2>AI session timeline</h2><small>{events.length} EVENTS · IMPORTED</small></div>
    <div className="timeline-metrics">
      {Object.entries(counts).map(([name, count]) => <div key={name}><strong>{count}</strong><span>{name.replace(/_/g, ' ')}</span></div>)}
    </div>
    <ol>{events.map((event) => <li key={event.id}>
      <time dateTime={event.evidence_ref.occurred_at}>{new Date(event.evidence_ref.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      <b>{event.evidence_ref.event_type.replace(/_/g, ' ')}</b>
      <code>{event.evidence_ref.event_id}</code>
      <p>{event.evidence_ref.quote}</p>
    </li>)}</ol>
    <small>Imported exports describe the supplied transcript. Their chain integrity does not independently authenticate who produced it.</small>
  </section>;
}

function ProfilePage({ handle }: { handle: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionLogText, setSessionLogText] = useState('');
  const [sessionPreview, setSessionPreview] = useState<SessionPreview | null>(null);
  const isOwner = session?.handle === profile?.handle;
  useEffect(() => {
    if (profile) document.title = `${profile.handle} - Attest evidence profile`;
  }, [profile?.handle]);
  const loadProfile = async () => {
    setRefreshing(true);
    setError('');
    try {
      const next = await api<Profile>(`/api/evidence/${encodeURIComponent(handle)}`);
      setProfile(next);
      setNotice('Evidence profile refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load evidence profile');
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    setNotice('');
    setError('');
    api<Profile>(`/api/evidence/${encodeURIComponent(handle)}`).then(setProfile).catch((err: Error) => setError(err.message));
    api<UserSession>('/api/cli/me').then(setSession).catch(() => setSession(null));
  }, [handle]);
  const latestGrade = profile?.assessments.find((assessment) => assessment.ai_grade)?.ai_grade;
  const startAssessment = async () => {
    setBusy(true);
    try {
      const test = await api<Test>('/api/test/generate', { method: 'POST' });
      location.href = `/take/${test.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate assessment');
      setBusy(false);
    }
  };
  const verifySessionLog = async () => {
    setError('');
    setSessionPreview(null);
    try {
      const log = await parseSessionLogText(sessionLogText);
      const existing = profile?.claims.filter((claim): claim is Claim & { evidence_ref: SessionEvidenceRef } =>
        'session_id' in claim.evidence_ref && claim.evidence_ref.session_id === log.sessionId,
      ) ?? [];
      const existingEventIds = new Set(existing.map((claim) => claim.evidence_ref.event_id));
      if (log.events.some((event) => existingEventIds.has(event.id))) {
        throw new Error('This session log contains events already shared on the profile. Import only new events from this session.');
      }
      const existingHashes = new Set(existing.map((claim) => claim.evidence_ref.chain_hash));
      const priorHashes = new Set(existing.map((claim) => claim.evidence_ref.previous_hash));
      const chainHead = [...existingHashes].find((hash) => !priorHashes.has(hash));
      const evidence = await sessionEvidenceFromImport(log, chainHead);
      setSessionPreview({ log, evidence });
      setNotice(`Validated ${log.events.length} session events locally. Nothing has been uploaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify this session log');
    }
  };
  const shareSessionLog = async () => {
    if (!profile || !sessionPreview || !window.confirm(
      'Add these session records to your public report? This replaces the uploaded snapshot with your current git evidence plus the session events shown in the preview.',
    )) return;
    setBusy(true);
    setError('');
    try {
      const existing = profile.claims.map((claim) => ({
        id: claim.id,
        claim_type: claim.claim_type,
        claim_value: claim.claim_value,
        source: claim.source,
        status: claim.status,
        confidence: claim.confidence,
        evidence_ref: claim.evidence_ref,
        captured_at: claim.captured_at,
      }));
      await api('/api/cli/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidence: [...existing, ...sessionPreview.evidence] }),
      });
      setSessionLogText('');
      setSessionPreview(null);
      await loadProfile();
      setNotice('Session evidence added to your shareable report.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add session evidence');
    } finally {
      setBusy(false);
    }
  };
  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(success);
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the text below.');
    }
  };
  const shareProfile = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Attest evidence profile: ${profile?.handle ?? handle}`,
          text: 'Specific claims, backed by cited evidence.',
          url: profileUrl,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(`Unable to share profile: ${err.message}`);
        }
      }
      return;
    }
    await copyText(profileUrl, 'Profile link copied.');
  };
  const wipeEvidence = async () => {
    if (!window.confirm('Permanently delete all uploaded evidence, assessments, and stored artifacts for this account? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      await api<{ deleted: boolean }>('/api/cli/wipe', { method: 'DELETE' });
      await loadProfile();
      setNotice('Your uploaded evidence and assessments were deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete your evidence');
    } finally {
      setBusy(false);
    }
  };
  const profileUrl = window.location.href;
  const apiUrl = window.location.origin;
  const commandSnippet = [
    `$env:ATTEST_API_URL = '${apiUrl}'`,
    '# Run these from the git repository you want to scan:',
    '& "$env:ATTEST_HOME\\attest.cmd" login',
    '& "$env:ATTEST_HOME\\attest.cmd" scan',
    '# Optional AI session evidence (Claude Code JSONL or normalized Attest/Vaultio log):',
    '& "$env:ATTEST_HOME\\attest.cmd" scan --session .\\session.jsonl',
    '& "$env:ATTEST_HOME\\attest.cmd" sync',
  ].join('\n');
  const cliSetupSnippet = [
    'git clone https://github.com/Lhordnuel/vault-verify.git attest',
    'Set-Location attest',
    'npm.cmd install',
    'npm.cmd run build -w @attest/core',
    'npm.cmd run build -w @attest/cli',
    '$env:ATTEST_HOME = (Get-Location).Path',
    "$env:ATTEST_REPO = 'C:\\path\\to\\your\\git\\repository'",
    'Set-Location $env:ATTEST_REPO',
    commandSnippet,
  ].join('\n');
  if (error && !profile) return <main className="page-shell"><p className="error">{error}</p></main>;
  if (!profile) return <main className="page-shell"><p className="muted">Loading evidence…</p></main>;
  return <main className="page-shell">
    <header className="page-nav"><a className="brand" href="/"><span className="brand-mark">A</span> attest<span className="brand-dot">.</span></a>
      {session ? <span className="nav-link">{session.username}</span> : <a className="nav-link" href="/api/auth/github">Sign in with GitHub</a>}</header>
    <section className="profile-hero">
      <div className="avatar">{profile.handle.slice(0, 1).toUpperCase()}</div>
      <div><p className="eyebrow">ATTEST × VAULTIO / CANDIDATE REPORT</p><h1>{profile.handle}<span className="muted"> /</span></h1><a className="github-link" href={`https://github.com/${encodeURIComponent(profile.github_username)}`} target="_blank" rel="noreferrer">@{profile.github_username} ↗</a></div>
      <div className="profile-actions">
        <div className="profile-export-actions">
          <button className="button secondary" onClick={() => void shareProfile()}>Share profile</button>
          <button className="button secondary" onClick={() => window.print()} title="Choose Save as PDF in the print dialog">Download PDF</button>
        </div>
        <span className="export-hint">For a file, choose “Save as PDF” in the print dialog.</span>
        <button className="button primary" disabled={!isOwner || !profile.claims.length || busy} onClick={startAssessment}>{busy ? 'Preparing…' : 'Take an evidence-based test'}</button>
        <span>{!isOwner ? 'Sign in as the profile owner to start an assessment.' : !profile.claims.length ? 'Sync reviewed evidence before generating a test.' : 'Scores only appear with cited evidence.'}</span>
      </div>
    </section>
    <div className="print-heading"><span>ATTEST / EVIDENCE CREDENTIAL</span><span>{window.location.host}</span></div>
    <div className="notice"><span>◎</span> Attest × Vaultio reports describe what the submitted git and AI-session evidence supports, and what remains unverified. Missing evidence is not evidence of missing ability; neither git history nor an imported chat log proves authorship by itself.</div>
    <section className="report-summary" aria-label="Evidence coverage">
      <div><strong>{profile.claims.filter((claim) => claim.source === 'git').length}</strong><span>Git records</span></div>
      <div><strong>{profile.claims.filter((claim) => claim.source === 'session').length}</strong><span>AI-session records</span></div>
      <div><strong>{profile.claims.filter((claim) => claim.status === 'Unverified').length}</strong><span>Unverified records</span></div>
      <p>These are observed sources, not a verdict about the candidate. A skill is only reported where the cited evidence or assessment supports it.</p>
    </section>
    {isOwner && <section className="owner-tools">
      <div className="owner-tool-heading"><div><p className="eyebrow">YOUR ATTEST ACCOUNT</p><h2>Get your evidence on this profile</h2></div>
        <div className="owner-tool-actions">
          <button className="button secondary" onClick={() => void loadProfile()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh evidence'}</button>
          <button className="button secondary" onClick={() => void copyText(profileUrl, 'Profile link copied.')}>Copy profile link</button>
        </div>
      </div>
      {!profile.claims.length && <p className="owner-tool-copy">Attest never reads your local repository from this page. Use the CLI in the repository you want to share; scanning stays local until you review the preview and confirm sync.</p>}
      <details className="session-import">
        <summary>Import an AI session log</summary>
        <p>Paste or upload a Claude Code JSONL export or a normalized Attest/Vaultio log. Parsing, redaction, and integrity checks run in this browser; nothing uploads until you review the preview and confirm.</p>
        <label className="session-file">Choose a session log
          <input type="file" accept=".json,.jsonl,application/json,application/x-ndjson" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
              setSessionLogText(text);
              setSessionPreview(null);
              setError('');
            }).catch((err: Error) => setError(`Unable to read session log: ${err.message}`));
          }} />
        </label>
        <textarea aria-label="AI session log text" value={sessionLogText} onChange={(event) => {
          setSessionLogText(event.target.value);
          setSessionPreview(null);
        }} placeholder="Paste Claude Code JSONL or an Attest/Vaultio normalized session log…" />
        <button className="button secondary" onClick={() => void verifySessionLog()} disabled={!sessionLogText.trim() || busy}>Validate locally</button>
        {sessionPreview && <div className="session-preview" role="status">
          <strong>{sessionPreview.log.format} · {sessionPreview.log.level} · {sessionPreview.log.events.length} events</strong>
          <span>{sessionPreview.log.reasons.join(' · ')}</span>
          <details className="session-preview-events">
            <summary>Review all redacted events before sharing</summary>
            <ul>{sessionPreview.log.events.map((event) => <li key={event.id}>
              <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
              <b>{event.actor} · {event.type}</b> {event.text}
            </li>)}</ul>
          </details>
          <button className="button primary" onClick={() => void shareSessionLog()} disabled={busy}>{busy ? 'Adding…' : 'Add verified preview to report'}</button>
        </div>}
      </details>
      <details className="cli-instructions" open={!profile.claims.length}>
        <summary>{profile.claims.length ? 'CLI setup and sync instructions' : 'Connect a git repository with the CLI'}</summary>
        <ol>
          <li>Clone the Attest source and build the CLI once. Then change the <code>ATTEST_REPO</code> example path to your local git repository.</li>
          <li>Run the copied commands. Scan previews locally; sync uploads only after you confirm.</li>
        </ol>
        <pre><code>{cliSetupSnippet}</code></pre>
        <button className="button secondary" onClick={() => void copyText(cliSetupSnippet, 'CLI setup and sync commands copied.')}>Copy CLI setup and sync</button>
        <p>Review the scan output before <code>sync</code>; the CLI asks for confirmation before any upload. Your public profile updates when you press Refresh evidence.</p>
      </details>
      <div className="owner-danger-zone"><span>Privacy control</span><button className="button danger" onClick={() => void wipeEvidence()} disabled={busy}>{busy ? 'Working…' : 'Delete all uploaded evidence'}</button></div>
    </section>}
    <section className="evidence-section">
      <div className="section-title"><span>01</span><h2>Claims &amp; evidence</h2><small>{profile.claims.length} RECORDS</small></div>
      {!profile.claims.length ? <div className="empty-state"><p>{profile.signal_summary}</p><small>Evidence appears here only after its owner reviews and syncs it.</small></div> :
        <div className="claim-list">{profile.claims.map((claim) => <article className="claim-card" key={claim.id}>
          <div className="claim-heading"><span className="claim-type">{claim.source} · {claim.claim_type.replace(/-/g, ' ')}</span><span className={`status ${claim.status.toLowerCase().replace(/ /g, '-')}`}>{claim.status}</span></div>
          <h3>{claim.claim_value}</h3>
          <div className="evidence-quote"><span>“</span><p>{claim.evidence_ref.quote}</p></div>
          {'commit_hash' in claim.evidence_ref
            ? <>
                <div className="evidence-meta"><span>{claim.evidence_ref.repository} · {claim.evidence_ref.files.length} files</span><span>{new Date(claim.evidence_ref.committed_at).toLocaleDateString()}</span></div>
                {claim.evidence_ref.repository_url && <a className="commit-link" href={`${claim.evidence_ref.repository_url}/commit/${claim.evidence_ref.commit_hash}`} target="_blank" rel="noreferrer">Review cited commit ↗</a>}
                <details className="chain-details"><summary>Git evidence chain · {claim.evidence_ref.commit_hash.slice(0, 10)}</summary><code>previous {claim.evidence_ref.previous_hash}<br />record&nbsp; {claim.evidence_ref.chain_hash}</code></details>
              </>
            : <>
                <div className="evidence-meta"><span>{claim.evidence_ref.format} · {claim.evidence_ref.actor} · {claim.evidence_ref.verification_level}</span><span>{new Date(claim.evidence_ref.occurred_at).toLocaleString()}</span></div>
                <details className="chain-details"><summary>Session chain · {claim.evidence_ref.session_id}</summary><code>{claim.evidence_ref.verification_reasons.join('; ')}<br />previous {claim.evidence_ref.previous_hash}<br />record&nbsp; {claim.evidence_ref.chain_hash}</code></details>
              </>}
        </article>)}</div>}
    </section>
    <section className="findings-section">
      <div className="section-title"><span>02</span><h2>Evidence findings</h2></div>
      <div className="findings-grid">
        <div><h3>Signals present in shared evidence</h3>
          {profile.claims.some((claim) => claim.status === 'Supported')
            ? <ul>{[...new Set(profile.claims.filter((claim) => claim.status === 'Supported').map((claim) => claim.claim_type.replace(/-/g, ' ')))].map((skill) => <li key={skill}>{skill}</li>)}</ul>
            : <p>No capability claims are supported by the currently shared evidence.</p>}
        </div>
        <div><h3>Not established by shared evidence</h3>
          {profile.claims.some((claim) => claim.status === 'Unverified')
            ? <ul>{[...new Set(profile.claims.filter((claim) => claim.status === 'Unverified').map((claim) => claim.claim_type.replace(/-/g, ' ')))].map((skill) => <li key={skill}>{skill}</li>)}</ul>
            : <p>No unverified claims in the shared records. This does not imply other skills were tested.</p>}
          <small>Absence of evidence is not evidence of absence.</small>
        </div>
      </div>
    </section>
    <SessionTimeline claims={profile.claims} />
    {latestGrade && <GradeCard grade={latestGrade} />}
    {error && <p className="error inline-error" role="alert">{error}</p>}
    {notice && <p className="action-notice" role="status">{notice}</p>}
    <p className="print-disclaimer">This profile documents specific claims and their cited sources. It is not a judgment of a person's overall ability. Git history is a source citation, not independent proof of authorship.</p>
    <footer className="profile-footer">Evidence can be reviewed and revoked by its owner. Missing evidence is unverified, never guessed.</footer>
  </main>;
}

function TakePage({ id }: { id: string }) {
  const [test, setTest] = useState<Test | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [scenarioAnswers, setScenarioAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<Test & { status: string; ai_grade: Grade | null }>(`/api/test/${encodeURIComponent(id)}`).then((result) => {
      setTest(result);
      setGrade(result.ai_grade);
      if (result.status !== 'pending') setStatus(result.status);
    }).catch((err: Error) => setError(err.message));
  }, [id]);
  const submit = async () => {
    setError('');
    try {
      await api(`/api/test/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assessmentId: id, submission: JSON.stringify({ answers, scenario_answers: scenarioAnswers }) }),
      });
      setStatus('grading');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit'); }
  };
  useEffect(() => {
    if (status !== 'grading') return;
    let active = true;
    const timer = window.setInterval(() => {
      api<{ status: string; ai_grade: Grade | null }>(`/api/test/${encodeURIComponent(id)}`).then((result) => {
        if (active) {
          setGrade(result.ai_grade);
          if (result.status !== 'grading') setStatus(result.status);
        }
      }).catch((err: Error) => {
        if (active) setError(`Unable to check grading status: ${err.message}`);
      });
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [status, id]);
  const canSubmit = status === '' || status === 'pending' || status === 'failed';
  const completedAnswers = test !== null &&
    Object.keys(answers).length === 15 &&
    test.scenarios.every((scenario) => (scenarioAnswers[scenario.id] ?? '').trim().length > 0);
  const statusMessage = status === 'failed'
    ? 'Grading did not complete. Check the Meta API configuration and submit again to retry.'
    : status === 'human_review_required'
      ? 'Automated graders disagree or lack confidence; this result is flagged for human review.'
      : status === 'grading'
        ? 'Two independent graders are reviewing your response…'
        : status
          ? `Status: ${status.replace(/_/g, ' ')}`
          : 'Submission is sent only when you press submit.';
  if (error && !test) return <main className="page-shell"><p className="error">{error}</p></main>;
  if (!test) return <main className="page-shell"><p className="muted">Loading assessment…</p></main>;
  return <main className="page-shell take-shell">
    <header className="page-nav"><a className="brand" href="/"><span className="brand-mark">A</span> attest<span className="brand-dot">.</span></a><span className="eyebrow">ATTEST × VAULTIO / STANDARDIZED ASSESSMENT</span></header>
    <section className="test-intro"><p className="eyebrow">15 MULTIPLE CHOICE · 2 SCENARIOS</p><h1>{test.title}</h1><p>{test.instructions}</p>
      <small>Scenario scores require exact quotes from your answers and citations to shared evidence. No evidence or a missing citation means Unverified, not zero ability.</small>
    </section>
    <section className="assessment-questions" aria-label="Multiple-choice questions">
      <h2>Part 1 · Multiple choice</h2>
      {test.multiple_choice.map((question, index) => <fieldset className="question-card" key={question.id} disabled={!canSubmit}>
        <legend><span>{String(index + 1).padStart(2, '0')} / 15</span> {question.question}</legend>
        <small>{question.skill}</small>
        {question.options.map((option, optionIndex) => <label className="answer-option" key={optionIndex}>
          <input type="radio" name={question.id} checked={answers[question.id] === optionIndex}
            onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} />
          <span>{option}</span>
        </label>)}
      </fieldset>)}
    </section>
    <section className="assessment-questions scenario-questions" aria-label="Written scenarios">
      <h2>Part 2 · Applied scenarios</h2>
      {test.scenarios.map((scenario, index) => <article className="scenario-card" key={scenario.id}>
        <h3><span>{index + 1} / 2 · {scenario.skill}</span>{scenario.prompt}</h3>
        <textarea aria-label={`Scenario ${index + 1} response`} value={scenarioAnswers[scenario.id] ?? ''}
          disabled={!canSubmit} maxLength={20_000} rows={8} placeholder="Explain your approach, trade-offs, and how you would verify the outcome."
          onChange={(event) => setScenarioAnswers((current) => ({ ...current, [scenario.id]: event.target.value }))} />
      </article>)}
    </section>
    {test.evidence_basis.length > 0 && <details className="assessment-evidence">
      <summary>Evidence used to tailor this assessment · {test.evidence_basis.length} sources</summary>
      <ul>{test.evidence_basis.map((item) => <li key={item.ref}><b>{item.source} · {item.ref}</b><span>{item.claim}</span><q>{item.quote}</q></li>)}</ul>
    </details>}
    <div className="submit-row"><span>{completedAnswers ? statusMessage : `${15 - Object.keys(answers).length} multiple-choice answers and ${test.scenarios.filter((scenario) => !(scenarioAnswers[scenario.id] ?? '').trim()).length} scenarios remaining`}</span><button className="button primary" onClick={() => void submit()} disabled={!canSubmit || !completedAnswers}>Submit assessment <span>→</span></button></div>
    {grade && <GradeCard grade={grade} />}
    {error && <p className="error">{error}</p>}
  </main>;
}

export default function App() {
  const path = window.location.pathname;
  const profileMatch = path.match(/^\/v\/([^/]+)\/?$/);
  const testMatch = path.match(/^\/take\/([^/]+)\/?$/);
  if (profileMatch) return <ProfilePage handle={decodeURIComponent(profileMatch[1])} />;
  if (testMatch) return <TakePage id={decodeURIComponent(testMatch[1])} />;
  return <Landing />;
}
