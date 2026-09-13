// hookRegistry.test.js — the write tab's hook choice, resolved into a call.

import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, parseEther } from 'viem';
import { MULTI_HOOK_ADDRESS } from '../../src/lib/config';
import { emptyHookConfig, hookInfo, resolveHookConfig } from '../../src/lib/hookRegistry';
import { setLang } from '../../src/lib/i18n';

const HOOK = '0x00000000000000000000000000000000000000AB';
const OTHER = '0x00000000000000000000000000000000000000cd';

describe('hookInfo', () => {
  it('names the fan-out and nothing else', () => {
    setLang('en');
    expect(hookInfo(MULTI_HOOK_ADDRESS)).toMatchObject({ known: true, key: 'multi', name: 'Fan-out (several hooks)' });
    expect(hookInfo(MULTI_HOOK_ADDRESS.toUpperCase().replace('0X', '0x')).known).toBe(true);
    expect(hookInfo(HOOK)).toEqual({ address: HOOK.toLowerCase(), known: false, key: null, name: null });
  });
});

describe('resolveHookConfig', () => {
  it('none is no hook at all', () => {
    expect(resolveHookConfig(emptyHookConfig())).toEqual({ active: false, hook: null, hookData: '0x', value: 0n, problems: [] });
    expect(resolveHookConfig(null).active).toBe(false);
  });

  it('one hook: the address, the data, the ether — with every problem named', () => {
    const good = resolveHookConfig({ ...emptyHookConfig(), mode: 'single', address: HOOK, data: '0xc0ffee', value: '0.01' });
    expect(good).toEqual({ active: true, hook: HOOK, hookData: '0xc0ffee', value: parseEther('0.01'), problems: [] });
    // Empty data and no value are the defaults, not problems.
    expect(resolveHookConfig({ ...emptyHookConfig(), mode: 'single', address: HOOK })).toMatchObject({ hookData: '0x', value: 0n, problems: [] });
    const bad = resolveHookConfig({ ...emptyHookConfig(), mode: 'single', address: '0x12', data: 'zz', value: 'lots' });
    expect(bad.problems).toEqual([
      { code: 'invalidAddress', position: 1 },
      { code: 'invalidHex', position: 1 },
      { code: 'invalidValue', position: 1 },
    ]);
    expect(resolveHookConfig({ ...emptyHookConfig(), mode: 'single', address: HOOK, value: '-1' }).problems).toEqual([
      { code: 'invalidValue', position: 1 },
    ]);
  });

  it('several hooks: the fan-out, with the entries packed and the ether summed', () => {
    const config = {
      ...emptyHookConfig(),
      mode: 'multi',
      entries: [
        { address: HOOK, data: '0x01', value: '0.5' },
        { address: OTHER, data: '', value: '' },
      ],
    };
    const out = resolveHookConfig(config);
    expect(out.active).toBe(true);
    expect(out.hook).toBe(MULTI_HOOK_ADDRESS);
    expect(out.value).toBe(parseEther('0.5'));
    expect(out.problems).toEqual([]);
    const [hooks, datas, values] = decodeAbiParameters(
      [{ type: 'address[]' }, { type: 'bytes[]' }, { type: 'uint256[]' }],
      out.hookData,
    );
    expect(hooks.map((h) => h.toLowerCase())).toEqual([HOOK.toLowerCase(), OTHER]);
    expect(datas).toEqual(['0x01', '0x']);
    expect(values).toEqual([parseEther('0.5'), 0n]);
  });

  it('several hooks with a bad entry, or none, is not signable', () => {
    const bad = resolveHookConfig({ ...emptyHookConfig(), mode: 'multi', entries: [{ address: HOOK, data: '', value: '' }, { address: 'x', data: '', value: '' }] });
    expect(bad.problems).toEqual([{ code: 'invalidAddress', position: 2 }]);
    expect(bad.hookData).toBe('0x');
    expect(resolveHookConfig({ ...emptyHookConfig(), mode: 'multi', entries: [] }).problems).toEqual([{ code: 'noHooks', position: 0 }]);
  });
});
