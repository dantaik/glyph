// @vitest-environment jsdom
// hookFields.test.jsx — choosing a hook in the write tab.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import HookFields from '../../src/components/HookFields';
import { MULTI_HOOK_ADDRESS } from '../../src/lib/config';
import { emptyHookConfig, resolveHookConfig } from '../../src/lib/hookRegistry';
import { setLang } from '../../src/lib/i18n';

let latest = null;
function Harness() {
  const [config, setConfig] = useState(emptyHookConfig());
  latest = config;
  return <HookFields config={config} onChange={setConfig} />;
}

beforeEach(() => {
  setLang('en');
  latest = null;
});
afterEach(() => cleanup());

describe('HookFields', () => {
  it('starts folded with no hook, and unfolds a hook when one is chosen', () => {
    render(<Harness />);
    const details = document.querySelector('[data-hook-fields]');
    expect(details.open).toBe(false);
    expect(screen.getByRole('button', { name: 'None', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'One hook' }));
    expect(latest.mode).toBe('single');
    fireEvent.change(screen.getByLabelText('Hook address'), { target: { value: '0x00000000000000000000000000000000000000ab' } });
    fireEvent.change(screen.getByLabelText('Hook data (hex)'), { target: { value: '0xc0ffee' } });
    fireEvent.change(screen.getByLabelText('ETH to send along'), { target: { value: '0.01' } });
    const call = resolveHookConfig(latest);
    expect(call.hook).toBe('0x00000000000000000000000000000000000000ab');
    expect(call.hookData).toBe('0xc0ffee');
    expect(call.problems).toEqual([]);
  });

  it('says what is wrong with an entry, and names a hook it knows', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'One hook' }));
    fireEvent.change(screen.getByLabelText('Hook address'), { target: { value: '0x12' } });
    fireEvent.change(screen.getByLabelText('Hook data (hex)'), { target: { value: 'zz' } });
    fireEvent.change(screen.getByLabelText('ETH to send along'), { target: { value: 'many' } });
    expect(screen.getByText('Hook 1: that is not a contract address.')).toBeTruthy();
    expect(screen.getByText('Hook 1: the data must be hex, 0x-prefixed.')).toBeTruthy();
    expect(screen.getByText('Hook 1: that is not an amount of ETH.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Hook address'), { target: { value: MULTI_HOOK_ADDRESS } });
    expect(screen.getByText('Known here as Fan-out (several hooks).')).toBeTruthy();
  });

  it('several hooks: entries can be added and removed, never below one', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Several hooks' }));
    expect(document.querySelectorAll('[data-hook-entry]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove hook 1' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add a hook' }));
    expect(document.querySelectorAll('[data-hook-entry]')).toHaveLength(2);
    const [first, second] = screen.getAllByLabelText('Hook address');
    fireEvent.change(first, { target: { value: '0x00000000000000000000000000000000000000ab' } });
    fireEvent.change(second, { target: { value: '0x00000000000000000000000000000000000000cd' } });
    const call = resolveHookConfig(latest);
    expect(call.hook).toBe(MULTI_HOOK_ADDRESS);
    expect(call.problems).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove hook 2' }));
    expect(document.querySelectorAll('[data-hook-entry]')).toHaveLength(1);
    expect(latest.entries).toHaveLength(1);
  });
});
