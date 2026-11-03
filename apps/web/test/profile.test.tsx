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

  it('renders a cited candidate report summary from the shared evidence', async () => {
    window.history.pushState({}, '', '/v/dev');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/evidence/')) return jsonResponse(profileWithEvidence);
      if (url.endsWith('/api/cli/me')) return jsonResponse({ error: 'authentication_required' }, 401);
      return jsonResponse({ error: 'not_found' }, 404);
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Candidate evidence report' })).toBeTruthy();
    expect(screen.getByText('EVIDENCE RECORDS')).toBeTruthy();
    expect(screen.getAllByText(/api design/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Evidence register' })).toBeTruthy();
    expect(screen.getByText(/does not independently establish authorship or successful outcomes/)).toBeTruthy();
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
