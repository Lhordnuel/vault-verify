import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

const CodeEditor = lazy(async () => {
  const [editorModule, languageModule] = await Promise.all([
    import('@uiw/react-codemirror'),
    import('@codemirror/lang-javascript'),
  ]);
  return {
    default: function DeferredCodeEditor(props: { value: string; onChange: (value: string) => void; editable: boolean }) {
      const Editor = editorModule.default;
      return <Editor {...props} height="380px" extensions={[languageModule.javascript()]} />;
    },
  };
});

type EvidenceRef = {
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
type Claim = {
  id: string;
  claim_type: string;
  claim_value: string;
  status: string;
  confidence: number | null;
  evidence_ref: EvidenceRef;
  captured_at: number;
};
type Grade = {
  pass1: { overall: number | null; competencies: Array<{ skill: string; score: number | null; evidence_quote: string | null }>; rationale: string };
  pass2: { overall: number | null; competencies: Array<{ skill: string; score: number | null; evidence_quote: string | null }>; rationale: string };
  agreement: number | null;
};
type Profile = {
  handle: string;
  github_username: string;
  claims: Claim[];
  assessments: Array<{ id: string; status: string; ai_grade: Grade | null; grader_agreement: number | null; human_review_required: number }>;
  signal_summary: string;
};
type Test = { id: string; test_prompt: string; starter_code: string; rubric_instance: { criteria: Array<{ skill: string; weight: number; description: string }> } };

function api<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, { credentials: 'include', ...init }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Request failed (${response.status})`);
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
      <p className="agreement-line">Independent grader agreement: {grade.agreement === null ? 'Unverified' : `${grade.agreement.toFixed(1)}%`}</p>
      <div className="grade-passes">
        {[['Pass 1 · Llama 3.3', grade.pass1], ['Pass 2 · Llama 4 Scout', grade.pass2]].map(([label, pass]) => {
          const result = pass as Grade['pass1'];
          return <div className="grade-pass" key={label as string}>
            <div className="pass-label">{label as string}<strong>{result.overall === null ? '—' : `${result.overall}/100`}</strong></div>
            <p>{result.rationale}</p>
            {result.competencies.map((item, index) => <div className="competency" key={`${item.skill}-${index}`}>
              <span>{item.skill}</span><b>{item.score === null ? 'Unverified' : `${item.score}/100`}</b>
              {item.evidence_quote && <blockquote>“{item.evidence_quote}”</blockquote>}
            </div>)}
          </div>;
        })}
      </div>
    </section>
  );
}

function ProfilePage({ handle }: { handle: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    api<Profile>(`/api/evidence/${encodeURIComponent(handle)}`).then(setProfile).catch((err: Error) => setError(err.message));
    api<{ handle: string }>('/api/cli/me').then(() => setSignedIn(true)).catch(() => setSignedIn(false));
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
  if (error && !profile) return <main className="page-shell"><p className="error">{error}</p></main>;
  if (!profile) return <main className="page-shell"><p className="muted">Loading evidence…</p></main>;
  return <main className="page-shell">
    <header className="page-nav"><a className="brand" href="/"><span className="brand-mark">A</span> attest<span className="brand-dot">.</span></a>
      {signedIn ? <span className="nav-link">{profile.github_username}</span> : <a className="nav-link" href="/api/auth/github">Sign in with GitHub</a>}</header>
    <section className="profile-hero">
      <div className="avatar">{profile.handle.slice(0, 1).toUpperCase()}</div>
      <div><p className="eyebrow">EVIDENCE PROFILE</p><h1>{profile.handle}<span className="muted"> /</span></h1><a className="github-link" href={`https://github.com/${encodeURIComponent(profile.github_username)}`} target="_blank" rel="noreferrer">@{profile.github_username} ↗</a></div>
      <div className="profile-actions"><button className="button primary" disabled={!signedIn || busy} onClick={startAssessment}>{busy ? 'Preparing…' : 'Take an evidence-based test'}</button><span>Scores only appear with cited evidence.</span></div>
    </section>
    <div className="notice"><span>◎</span> Attest means these specific claims have supporting evidence — not that a person is good. Git history is a source citation, not independent proof of authorship.</div>
    <section className="evidence-section">
      <div className="section-title"><span>01</span><h2>Claims &amp; evidence</h2><small>{profile.claims.length} RECORDS</small></div>
      {!profile.claims.length ? <div className="empty-state"><p>{profile.signal_summary}</p><small>Evidence appears here only after its owner reviews and syncs it.</small></div> :
        <div className="claim-list">{profile.claims.map((claim) => <article className="claim-card" key={claim.id}>
          <div className="claim-heading"><span className="claim-type">{claim.claim_type.replace(/-/g, ' ')}</span><span className="status supported">{claim.status}</span></div>
          <h3>{claim.claim_value}</h3>
          <div className="evidence-quote"><span>“</span><p>{claim.evidence_ref.quote}</p></div>
          <div className="evidence-meta"><span>{claim.evidence_ref.repository} · {claim.evidence_ref.files.length} files</span><span>{new Date(claim.evidence_ref.committed_at).toLocaleDateString()}</span></div>
          {claim.evidence_ref.repository_url && <a className="commit-link" href={`${claim.evidence_ref.repository_url}/commit/${claim.evidence_ref.commit_hash}`} target="_blank" rel="noreferrer">Review cited commit ↗</a>}
          <details className="chain-details"><summary>Evidence chain · {claim.evidence_ref.commit_hash.slice(0, 10)}</summary><code>previous {claim.evidence_ref.previous_hash}<br />record&nbsp; {claim.evidence_ref.chain_hash}</code></details>
        </article>)}</div>}
    </section>
    {latestGrade && <GradeCard grade={latestGrade} />}
    {error && <p className="error inline-error">{error}</p>}
    <footer className="profile-footer">Evidence can be reviewed and revoked by its owner. Missing evidence is unverified, never guessed.</footer>
  </main>;
}

function TakePage({ id }: { id: string }) {
  const [test, setTest] = useState<Test | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<Test & { status: string; ai_grade: Grade | null }>(`/api/test/${encodeURIComponent(id)}`).then((result) => {
      setTest(result);
      setCode(result.starter_code);
      setGrade(result.ai_grade);
      if (result.status !== 'pending') setStatus(result.status);
    }).catch((err: Error) => setError(err.message));
  }, [id]);
  const submit = async () => {
    setError('');
    try {
      await api(`/api/test/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assessmentId: id, submission: code }) });
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
      }).catch(() => undefined);
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [status, id]);
  const competencyNames = useMemo(() => test?.rubric_instance.criteria.map((item) => item.skill).join(' · ') ?? '', [test]);
  if (error && !test) return <main className="page-shell"><p className="error">{error}</p></main>;
  if (!test) return <main className="page-shell"><p className="muted">Loading assessment…</p></main>;
  return <main className="page-shell take-shell">
    <header className="page-nav"><a className="brand" href="/"><span className="brand-mark">A</span> attest<span className="brand-dot">.</span></a><span className="eyebrow">EVIDENCE-BASED EXERCISE</span></header>
    <section className="test-intro"><p className="eyebrow">ONE SHORT EXERCISE</p><h1>Show your reasoning.</h1><p>{test.test_prompt}</p><small>Grading: {competencyNames}. Every score needs a direct quote from your submission.</small></section>
    <div className="editor-frame"><div className="editor-bar"><span>submission.js</span><span>YOUR WORK STAYS PRIVATE UNTIL SUBMITTED</span></div>
      <Suspense fallback={<div className="editor-loading">Loading editor…</div>}><CodeEditor value={code} onChange={setCode} editable={status !== 'grading' && status !== 'graded'} /></Suspense>
    </div>
    <div className="submit-row"><span>{status === 'grading' ? 'Two independent graders are reviewing your response…' : status ? `Status: ${status.replace(/_/g, ' ')}` : 'Submission is sent only when you press submit.'}</span><button className="button primary" onClick={submit} disabled={status === 'grading' || status === 'graded'}>Submit for grading <span>→</span></button></div>
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
