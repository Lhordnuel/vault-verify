// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';

const profile = {
  handle: 'dev',
  github_username: 'dev',
  claims: [],
  assessments: [],
  signal_summary: 'No significant signals detected.',
};
const profileWithEvidence = {
  ...profile,
  claims: [{
    id: 'claim-1',
    claim_type: 'api-design',
    claim_value: 'API development: Add profile endpoint',
    source: 'git',
    status: 'Supported',
    confidence: null,
    captured_at: 1_767_000_000_000,
    evidence_ref: {
      commit_hash: 'a'.repeat(40),
      committed_at: '2026-11-01T12:00:00.000Z',
      repository: 'sample',
      repository_url: 'https://github.com/dev/sample',
      message: 'Add profile endpoint',
      files: ['src/profile.ts'],
      quote: 'export function getProfile() { return profile; }',
      previous_hash: '0'.repeat(64),
      chain_hash: 'b'.repeat(64),
    },
  }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('evidence profile dashboard', () => {
  it('requires answers to the standardized fifteen questions and two scenarios', async () => {
    window.history.pushState({}, '', '/take/assessment-1');
    const assessment = {
      id: 'assessment-1',
      title: 'Evidence-grounded software engineering',
      instructions: 'Answer each question and explain the scenario decisions.',
      multiple_choice: Array.from({ length: 15 }, (_, index) => ({
        id: `question-${index}`,
        skill: 'testing',
        question: `Question ${index + 1}?`,
        options: ['First choice', 'Second choice', 'Third choice', 'Fourth choice'],
      })),
      scenarios: [
        { id: 'scenario-1', skill: 'debugging', prompt: 'A regression appears after a change. How would you diagnose it and verify the fix?' },
        { id: 'scenario-2', skill: 'tradeoffs', prompt: 'A proposed fix adds complexity. How would you assess the tradeoff and choose an approach?' },
      ],
      evidence_basis: [],
      rubric_instance: { criteria: [{ skill: 'testing', weight: 100, description: 'Testing' }] },
      status: 'pending',
      ai_grade: null,
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ status: 'grading', id: 'assessment-1' }, 202);
      return jsonResponse(assessment);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByText('15 MULTIPLE CHOICE · 2 SCENARIOS')).toBeTruthy();
    const submit = screen.getByRole('button', { name: /Submit assessment/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const answerOptions = screen.getAllByRole('radio');
    for (let index = 0; index < 15; index += 1) {
      fireEvent.click(answerOptions[index * 4]);
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Scenario 1 response' }), { target: { value: 'I would reproduce the issue, isolate the change, add a regression test, and rerun the suite.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Scenario 2 response' }), { target: { value: 'I would compare correctness, maintainability, and operational risk, then test the smallest safe change.' } });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/test/submit',
      expect.objectContaining({ method: 'POST' }),
    ));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(request?.[1]?.body)) as { submission: string };
    const submission = JSON.parse(body.submission) as { answers: Record<string, number>; scenario_answers: Record<string, string> };
    expect(Object.keys(submission.answers)).toHaveLength(15);
    expect(Object.keys(submission.scenario_answers)).toHaveLength(2);
  });

  it('shows the CLI evidence workflow and prevents testing without evidence', async () => {
    window.history.pushState({}, '', '/v/dev');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/evidence/')) return jsonResponse(profile);
      if (url.endsWith('/api/cli/me')) return jsonResponse({ handle: 'dev', username: 'dev' });
      return jsonResponse({ error: 'not_found' }, 404);
    }));

    render(<App />);

    expect(await screen.findByText('Get your evidence on this profile')).toBeTruthy();
    expect(screen.getByText('ATTEST × VAULTIO / CANDIDATE REPORT')).toBeTruthy();
    expect(screen.getByText('Import an AI session log')).toBeTruthy();
    expect(screen.getByText(/ATTEST_API_URL/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take an evidence-based test' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete all uploaded evidence' })).toBeTruthy();
  });

  it('offers profile sharing and a printable PDF export', async () => {
    window.history.pushState({}, '', '/v/dev');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/evidence/')) return jsonResponse(profile);
      if (url.endsWith('/api/cli/me')) return jsonResponse({ error: 'authentication_required' }, 401);
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const print = vi.fn();
    vi.stubGlobal('print', print);

    render(<App />);

    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('shows the Meta provider error when evidence-based test generation fails', async () => {
    window.history.pushState({}, '', '/v/dev');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/evidence/')) return jsonResponse(profileWithEvidence);
      if (url.endsWith('/api/cli/me')) return jsonResponse({ handle: 'dev', username: 'dev' });
      if (url.endsWith('/api/test/generate') && init?.method === 'POST') {
        return jsonResponse({ error: 'internal_error', message: 'Meta Model API returned HTTP 401: Invalid API key.' }, 500);
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take an evidence-based test' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Meta Model API returned HTTP 401: Invalid API key.');
  });

  it('requires explicit confirmation before wiping, then reloads the profile', async () => {
    window.history.pushState({}, '', '/v/dev');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/evidence/')) return jsonResponse(profile);
      if (url.endsWith('/api/cli/me')) return jsonResponse({ handle: 'dev', username: 'dev' });
      if (url.endsWith('/api/cli/wipe') && init?.method === 'DELETE') return jsonResponse({ deleted: true });
      return jsonResponse({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all uploaded evidence' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/cli/wipe',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(window.confirm).toHaveBeenCalledOnce();
  });
});
