// relay.js — a post signed by its author for somebody else to send.
//
// Xueni's `publishFor` records a post under the author who signed it,
// whoever pays the gas. What the author signs is an EIP-712 struct over the
// exact call — the title, the payload bytes, the hook and its data, the
// deadline — with their next post index as the nonce, so it lands once, in
// order, and only as the post they meant. This module is the shape of that
// signature and of the file that carries it to the relayer: the "ticket".
//
// A ticket is one JSON document: everything `publishFor` needs, plus what a
// person reading the file wants to know (the title as text). Nothing in it
// is secret — the signature is only good for this one post — and nothing in
// it is executed. It is data, like an archive bundle.
//
// Plain JavaScript on purpose: no React, no wallet, no I/O, so the same
// checks run in a browser and at a terminal.

import { encodeAbiParameters, hashTypedData, keccak256 } from 'viem';
import { PUBLISH_TYPES, publishDomain } from './abi';
import { decodeTitle } from './title';

/** The file format, as `xueni.relay`. Bumping it is breaking the file. */
export const TICKET_FORMAT = 1;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

const lower = (s) => String(s ?? '').toLowerCase();

/** The name a ticket is offered under. */
export const ticketFileName = (ticket) =>
  `xueni-signed-post-${lower(ticket.author).slice(2, 10)}-${Number(ticket.index)}.json`;

/**
 * The typed data the author signs, exactly as Xueni.publishDigest hashes
 * it. `payload` and `hookData` are the bytes (hex); the struct carries their
 * hashes. `index` is the author's post count on the v2 contract at the time
 * the post will land — their next index.
 */
export function relayTypedData({ chainId, contract, author, title, payload, hook, hookData, index, deadline }) {
  return {
    domain: publishDomain(chainId, contract),
    types: PUBLISH_TYPES,
    primaryType: 'Publish',
    message: {
      author,
      title,
      payloadHash: keccak256(payload),
      hook: hook ?? ZERO_ADDRESS,
      hookDataHash: keccak256(hookData ?? '0x'),
      index: BigInt(index),
      deadline: BigInt(deadline),
    },
  };
}

/** The digest that typed data hashes to — what the contract recomputes. */
export const relayDigest = (fields) => hashTypedData(relayTypedData(fields));

/**
 * The ticket, from the signed fields. `value` is what the relayer should
 * send along to the hook, in wei as a decimal string — a hint for them, not
 * part of the signature.
 */
export function buildTicket({ chainId, contract, author, title, payload, hook, hookData, index, deadline, signature, value = 0n }) {
  return {
    xueni: { relay: TICKET_FORMAT },
    chainId: Number(chainId),
    contract: lower(contract),
    author: lower(author),
    title,
    titleText: decodeTitle(title),
    payload,
    hook: hook && lower(hook) !== ZERO_ADDRESS ? lower(hook) : null,
    hookData: hookData && hookData !== '0x' ? hookData : '0x',
    index: Number(index),
    deadline: Number(deadline),
    signature,
    value: String(BigInt(value ?? 0)),
  };
}

export const serializeTicket = (ticket) => JSON.stringify(ticket, null, 2);

/**
 * Read a ticket and say what is wrong with it. `problems` are codes, not
 * sentences, so a browser and a terminal can each say them their own way:
 *
 *   notJson · notTicket · wrongFormat · badField (with `field`)
 *
 * Whether the chain is one this reader knows and whether the contract is
 * the right one are the caller's to decide, since only it knows its
 * registry; `ticket` is handed back whenever the shape is right.
 */
export function parseTicket(text) {
  let raw;
  try {
    raw = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { ticket: null, problems: [{ code: 'notJson' }] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ticket: null, problems: [{ code: 'notTicket' }] };
  const format = raw.xueni?.relay;
  if (format == null) return { ticket: null, problems: [{ code: 'notTicket' }] };
  if (Number(format) !== TICKET_FORMAT) return { ticket: null, problems: [{ code: 'wrongFormat', format }] };

  const problems = [];
  const bad = (field) => problems.push({ code: 'badField', field });
  if (!Number.isInteger(Number(raw.chainId)) || Number(raw.chainId) <= 0) bad('chainId');
  if (!ADDRESS_RE.test(String(raw.contract ?? ''))) bad('contract');
  if (!ADDRESS_RE.test(String(raw.author ?? ''))) bad('author');
  if (!BYTES32_RE.test(String(raw.title ?? ''))) bad('title');
  if (!HEX_RE.test(String(raw.payload ?? '')) || String(raw.payload).length < 4) bad('payload');
  if (raw.hook != null && !ADDRESS_RE.test(String(raw.hook))) bad('hook');
  if (raw.hookData != null && !HEX_RE.test(String(raw.hookData))) bad('hookData');
  if (!Number.isInteger(Number(raw.index)) || Number(raw.index) < 0) bad('index');
  if (!Number.isInteger(Number(raw.deadline)) || Number(raw.deadline) <= 0) bad('deadline');
  const sig = String(raw.signature ?? '');
  if (!HEX_RE.test(sig) || ![130, 132].includes(sig.length - 2) && sig.length < 4) bad('signature');
  if (raw.value != null && !/^\d+$/.test(String(raw.value))) bad('value');
  if (problems.length) return { ticket: null, problems };

  return {
    ticket: {
      xueni: { relay: TICKET_FORMAT },
      chainId: Number(raw.chainId),
      contract: lower(raw.contract),
      author: lower(raw.author),
      title: lower(raw.title),
      titleText: decodeTitle(lower(raw.title)),
      payload: lower(raw.payload),
      hook: raw.hook ? lower(raw.hook) : null,
      hookData: raw.hookData ? lower(raw.hookData) : '0x',
      index: Number(raw.index),
      deadline: Number(raw.deadline),
      signature: lower(sig),
      value: String(raw.value ?? '0'),
    },
    problems: [],
  };
}

/** The arguments of `publishFor`, in order, as viem wants them. */
export const publishForArgs = (ticket) => [
  ticket.author,
  ticket.title,
  ticket.payload,
  ticket.hook ?? ZERO_ADDRESS,
  ticket.hookData ?? '0x',
  BigInt(ticket.deadline),
  ticket.signature,
];

/** Whether the ticket's deadline has passed, at `now` (ms). */
export const ticketExpired = (ticket, now = Date.now()) => Number(ticket.deadline) * 1000 < now;

/** Days from now, as a unix deadline in seconds. */
export const deadlineInDays = (days, now = Date.now()) => Math.floor(now / 1000) + Math.round(Number(days) * 86400);

// --- The fan-out hook's data --------------------------------------------

const MULTI_TYPES = [{ type: 'address[]' }, { type: 'bytes[]' }, { type: 'uint256[]' }];

/** `abi.encode(hooks, datas, values)`: what MultiHook wants as its data. */
export function encodeMultiHookData(entries) {
  return encodeAbiParameters(MULTI_TYPES, [
    entries.map((e) => e.hook),
    entries.map((e) => e.data ?? '0x'),
    entries.map((e) => BigInt(e.value ?? 0)),
  ]);
}
