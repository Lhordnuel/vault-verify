// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';

const profile = {
  handle: 'dev',
  github_username: 'dev',
  claims: [],
  assessments: [],
  signal_summary: 'No significant signals detected.',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
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
