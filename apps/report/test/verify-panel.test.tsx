/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VerifyPanel from '../src/components/VerifyPanel.jsx';

afterEach(() => cleanup());

function loadSample(label: 'Load valid sample' | 'Load tampered sample') {
  render(<VerifyPanel />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Verify log' }));
}

describe('VerifyPanel', () => {
  it('verifies the valid sample at L4', () => {
    loadSample('Load valid sample');
    expect(screen.getByText('Verification passed')).toBeDefined();
    expect(screen.getByText('L4 — anchored and corroborated')).toBeDefined();
    expect(screen.getByText('chain_valid:8_events')).toBeDefined();
  });

  it('fails the tampered sample with the first break and its reason', () => {
    loadSample('Load tampered sample');
    expect(screen.getByText('Verification failed')).toBeDefined();
    expect(screen.getByText('L0 — unverified')).toBeDefined();
    expect(screen.getByText('chain_break:hash_mismatch@seq:2')).toBeDefined();
  });

  it('rejects non-JSON before verification', () => {
    render(<VerifyPanel />);
    fireEvent.change(screen.getByLabelText('Session log JSON'), { target: { value: '{oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify log' }));
    expect(screen.getByText('Log rejected before verification:')).toBeDefined();
    expect(screen.getByText('not valid JSON')).toBeDefined();
  });

  it('reports schema issues with paths', () => {
    render(<VerifyPanel />);
    fireEvent.change(screen.getByLabelText('Session log JSON'), {
      target: { value: '{"version":"vv-session-log/1"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify log' }));
    expect(screen.getByText('Log rejected before verification:')).toBeDefined();
  });
});
