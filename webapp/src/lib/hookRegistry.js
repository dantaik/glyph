// hookRegistry.js — which hooks the reader knows by name, and how the
// write tab's hook choice becomes a call.
//
// A hook is a stranger's contract. The reader never runs anything for one:
// it shows the address, and a name where the address is one it knows —
// today the fan-out deployed beside the v2 contract. Anything richer (a
// hook's own records, its own page) is that hook developer's to host.
//
// The write tab offers three shapes: no hook; one hook, with its data and
// the ETH to send along; or several, packed into the fan-out. This module
// turns that choice into `{ hook, hookData, value }` for publish(), and
// says what is wrong with it before anything is signed.

import { parseEther } from 'viem';
import { MULTI_HOOK_ADDRESS } from './config';
import { t } from './i18n';
import { encodeMultiHookData } from './relay';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

/** The hooks this build knows by name, by lowercase address. */
export const KNOWN_HOOKS = Object.freeze({
  [MULTI_HOOK_ADDRESS.toLowerCase()]: { key: 'multi', nameKey: 'hook.multiName' },
});

/** What to call a hook: its name when known, else its address. */
export function hookInfo(address) {
  const key = String(address ?? '').toLowerCase();
  const known = KNOWN_HOOKS[key] ?? null;
  return { address: key, known: Boolean(known), key: known?.key ?? null, name: known ? t(known.nameKey) : null };
}

/** The write tab's hook choice, empty. */
export const emptyHookConfig = () => ({
  mode: 'none', // 'none' | 'single' | 'multi'
  address: '',
  data: '',
  value: '',
  entries: [{ address: '', data: '', value: '' }],
});

const HEX_EMPTY = '0x';

function readEntry(entry, position) {
  const problems = [];
  const address = String(entry.address ?? '').trim();
  const data = String(entry.data ?? '').trim();
  const valueText = String(entry.value ?? '').trim();
  if (!ADDRESS_RE.test(address)) problems.push({ code: 'invalidAddress', position });
  if (data !== '' && !HEX_RE.test(data)) problems.push({ code: 'invalidHex', position });
  let value = 0n;
  if (valueText !== '') {
    try {
      value = parseEther(valueText);
      if (value < 0n) throw new Error('negative');
    } catch {
      problems.push({ code: 'invalidValue', position });
    }
  }
  return { hook: address, data: data === '' ? HEX_EMPTY : data, value, problems };
}

/**
 * The call a hook choice makes: `{ active, hook, hookData, value, problems }`.
 * `problems` are `{ code, position }` codes for the form to say; with any,
 * nothing should be signed.
 */
export function resolveHookConfig(config) {
  if (!config || config.mode === 'none') {
    return { active: false, hook: null, hookData: HEX_EMPTY, value: 0n, problems: [] };
  }
  if (config.mode === 'single') {
    const one = readEntry(config, 1);
    return { active: true, hook: one.hook, hookData: one.data, value: one.value, problems: one.problems };
  }
  const entries = (config.entries ?? []).map((e, i) => readEntry(e, i + 1));
  const problems = entries.flatMap((e) => e.problems);
  if (entries.length === 0) problems.push({ code: 'noHooks', position: 0 });
  const value = entries.reduce((sum, e) => sum + e.value, 0n);
  return {
    active: true,
    hook: MULTI_HOOK_ADDRESS,
    hookData: problems.length ? HEX_EMPTY : encodeMultiHookData(entries),
    value,
    problems,
  };
}
