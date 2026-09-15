// relay.test.js — the ticket: what the author signs, and the file that
// carries it to a relayer.

import { describe, expect, it } from 'vitest';
import { concatHex, encodeAbiParameters, keccak256, stringToHex, toHex } from 'viem';
import { PUBLISH_TYPES, publishDomain } from '../../src/lib/abi';
import {
  ZERO_ADDRESS,
  buildTicket,
  deadlineInDays,
  encodeMultiHookData,
  parseTicket,
  publishForArgs,
  relayDigest,
  relayTypedData,
  serializeTicket,
  signatureKind,
  ticketExpired,
  ticketFileName,
} from '../../src/lib/relay';
import { encodeTitle } from '../../src/lib/title';

const CONTRACT = '0x0000003ce1a46c7fbb02b9e1a0a4709ad9cb15d9';
const AUTHOR = '0x8a1f3b52c9e44e1a9b1f0d2c7a44e0b1d2e3f4a5';
const HOOK = '0x0000098b1f5b2fb1f7251af47f8df15eb319ed10';
const SIG = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`;
const PAYLOAD = toHex(new TextEncoder().encode('# The drums\n\nThey beat all afternoon.\n'));

/** Xueni.PUBLISH_TYPEHASH, as `cast keccak` computes it from the contract's string. */
const PUBLISH_TYPEHASH = '0x7021345f7fad316ba3ea48618e456fc23fef7604f5e11d420be886ec86075d85';
const DOMAIN_TYPEHASH = keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));

const fields = {
  chainId: 1,
  contract: CONTRACT,
  author: AUTHOR,
  title: encodeTitle('The drums'),
  payload: PAYLOAD,
  hook: HOOK,
  hookData: '0xc0ffee',
  index: 3,
  deadline: 1_900_000_000,
};

describe('what the author signs', () => {
  it('is the Publish struct under the Xueni/1 domain, with the hashes of the bytes', () => {
    const typed = relayTypedData(fields);
    expect(typed.domain).toEqual({ name: 'Xueni', version: '1', chainId: 1, verifyingContract: CONTRACT });
    expect(typed.domain).toEqual(publishDomain(1, CONTRACT));
    expect(typed.primaryType).toBe('Publish');
    expect(typed.types).toBe(PUBLISH_TYPES);
    expect(typed.message).toEqual({
      author: AUTHOR,
      title: fields.title,
      payloadHash: keccak256(PAYLOAD),
      hook: HOOK,
      hookDataHash: keccak256('0xc0ffee'),
      index: 3n,
      deadline: 1_900_000_000n,
    });
    // No hook: the zero address and the hash of empty bytes, as the contract computes them.
    const plain = relayTypedData({ ...fields, hook: null, hookData: '0x' }).message;
    expect(plain.hook).toBe(ZERO_ADDRESS);
    expect(plain.hookDataHash).toBe(keccak256('0x'));
  });

  it('hashes to exactly what Xueni.publishDigest computes', () => {
    // The contract's own arithmetic, spelled out: keccak256("\x19\x01" ‖
    // domainSeparator ‖ structHash), with the typehash the Solidity source
    // declares. If viem's typed-data encoding of PUBLISH_TYPES ever drifted
    // from that string, this is where it would show.
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
        [DOMAIN_TYPEHASH, keccak256(stringToHex('Xueni')), keccak256(stringToHex('1')), 1n, CONTRACT],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        [PUBLISH_TYPEHASH, AUTHOR, fields.title, keccak256(PAYLOAD), HOOK, keccak256('0xc0ffee'), 3n, 1_900_000_000n],
      ),
    );
    expect(relayDigest(fields)).toBe(keccak256(concatHex(['0x1901', domainSeparator, structHash])));
    // Another chain, another digest: the same signature cannot cross.
    expect(relayDigest({ ...fields, chainId: 167000 })).not.toBe(relayDigest(fields));
    expect(relayDigest({ ...fields, index: 4 })).not.toBe(relayDigest(fields));
  });
});

describe('the ticket', () => {
  const ticket = buildTicket({ ...fields, signature: SIG, value: 5n });

  it('carries everything publishFor needs, and the title as text for a person', () => {
    expect(ticket).toEqual({
      xueni: { relay: 1 },
      chainId: 1,
      contract: CONTRACT,
      author: AUTHOR,
      title: fields.title,
      titleText: 'The drums',
      payload: PAYLOAD,
      hook: HOOK,
      hookData: '0xc0ffee',
      index: 3,
      deadline: 1_900_000_000,
      signature: SIG,
      value: '5',
    });
    expect(publishForArgs(ticket)).toEqual([AUTHOR, fields.title, PAYLOAD, HOOK, '0xc0ffee', 1_900_000_000n, SIG]);
    expect(ticketFileName(ticket)).toBe('xueni-signed-post-8a1f3b52-3.json');
    // A plain post: no hook, nothing to send along.
    const plain = buildTicket({ ...fields, hook: ZERO_ADDRESS, hookData: '0x', signature: SIG });
    expect(plain.hook).toBeNull();
    expect(plain.hookData).toBe('0x');
    expect(plain.value).toBe('0');
    expect(publishForArgs(plain)[3]).toBe(ZERO_ADDRESS);
  });

  it('reads back from its own text, whatever the case of the hex', () => {
    const text = serializeTicket(ticket);
    expect(text).toContain('"xueni"');
    const { ticket: back, problems } = parseTicket(text);
    expect(problems).toEqual([]);
    expect(back).toEqual(ticket);
    const upper = JSON.parse(text);
    upper.author = upper.author.toUpperCase().replace('0X', '0x');
    upper.signature = upper.signature.toUpperCase().replace('0X', '0x');
    expect(parseTicket(JSON.stringify(upper)).ticket).toEqual(ticket);
    // An object is as good as its text.
    expect(parseTicket(JSON.parse(text)).ticket).toEqual(ticket);
  });

  it('says what is wrong with a file that is not one', () => {
    expect(parseTicket('not json').problems).toEqual([{ code: 'notJson' }]);
    expect(parseTicket('[]').problems).toEqual([{ code: 'notTicket' }]);
    expect(parseTicket('{"xueni":{"archive":1}}').problems).toEqual([{ code: 'notTicket' }]);
    expect(parseTicket('{"xueni":{"relay":2}}').problems).toEqual([{ code: 'wrongFormat', format: 2 }]);
    const broken = { ...ticket, author: 'xiaoman.eth', title: '0x12', deadline: 0, signature: 'nope' };
    const { ticket: none, problems } = parseTicket(JSON.stringify(broken));
    expect(none).toBeNull();
    expect(problems.map((p) => p.field)).toEqual(['author', 'title', 'deadline', 'signature']);
    expect(parseTicket(JSON.stringify({ ...ticket, hook: '0x12' })).problems).toEqual([{ code: 'badField', field: 'hook' }]);
    expect(parseTicket(JSON.stringify({ ...ticket, value: '1.5' })).problems).toEqual([{ code: 'badField', field: 'value' }]);
  });

  it('holds a signature to being hex and non-empty, and says whose shape it has', () => {
    const withSig = (signature) => parseTicket(JSON.stringify({ ...ticket, signature }));
    const badSig = [{ code: 'badField', field: 'signature' }];
    expect(withSig('').problems).toEqual(badSig);
    expect(withSig('0x').problems).toEqual(badSig);
    expect(withSig('0xabc').problems).toEqual(badSig);
    expect(withSig('nope').problems).toEqual(badSig);
    // 65 bytes (r, s, v) and the 64-byte EIP-2098 form are a wallet's, and
    // the contract checks them with ecrecover.
    const compact = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}`;
    expect(withSig(compact).problems).toEqual([]);
    expect(withSig(compact).ticket.signature).toBe(compact);
    expect(signatureKind(compact)).toBe('wallet');
    expect(signatureKind(SIG)).toBe('wallet');
    // Any other length only a contract account can have made (ERC-1271), so
    // it parses, and the caller is told to ask the chain who the author is.
    expect(withSig('0x12').problems).toEqual([]);
    expect(signatureKind('0x12')).toBe('contract');
    expect(signatureKind(`0x${'ab'.repeat(66)}`)).toBe('contract');
    expect(signatureKind(`0x${'ab'.repeat(96)}`)).toBe('contract');
    expect(signatureKind('')).toBeNull();
    expect(signatureKind('0x')).toBeNull();
    expect(signatureKind('nope')).toBeNull();
  });

  it('refuses numbers a file cannot carry exactly, and reads the ones it can', () => {
    const at = (over) => parseTicket({ ...ticket, ...over });
    expect(at({ index: 2 ** 53 }).problems).toEqual([{ code: 'badField', field: 'index' }]);
    expect(at({ index: '9007199254740993' }).problems).toEqual([{ code: 'badField', field: 'index' }]);
    expect(at({ deadline: 1.5 }).problems).toEqual([{ code: 'badField', field: 'deadline' }]);
    expect(at({ chainId: '' }).problems).toEqual([{ code: 'badField', field: 'chainId' }]);
    expect(at({ index: '' }).problems).toEqual([{ code: 'badField', field: 'index' }]);
    expect(at({ index: true }).problems).toEqual([{ code: 'badField', field: 'index' }]);
    expect(at({ index: '7', deadline: 1_900_000_000n }).ticket).toMatchObject({ index: 7, deadline: 1_900_000_000 });
    expect(() => buildTicket({ ...fields, signature: SIG, index: 2n ** 53n })).toThrow(RangeError);
    expect(() => buildTicket({ ...fields, signature: SIG, deadline: -1 })).toThrow(RangeError);
  });

  it('knows when it has expired, and how long a fresh one lasts', () => {
    expect(ticketExpired(ticket, 1_900_000_000 * 1000 - 1)).toBe(false);
    expect(ticketExpired(ticket, 1_900_000_000 * 1000 + 1)).toBe(true);
    expect(deadlineInDays(7, 1_000_000_000 * 1000)).toBe(1_000_000_000 + 7 * 86400);
    expect(deadlineInDays(0.5, 1_000_000_000 * 1000)).toBe(1_000_000_000 + 43200);
  });
});

describe("the fan-out's data", () => {
  it('is abi.encode(hooks, datas, values)', () => {
    const entries = [
      { hook: HOOK, data: '0x01', value: 0n },
      { hook: AUTHOR, data: '0x', value: 25n },
    ];
    expect(encodeMultiHookData(entries)).toBe(
      encodeAbiParameters(
        [{ type: 'address[]' }, { type: 'bytes[]' }, { type: 'uint256[]' }],
        [[HOOK, AUTHOR], ['0x01', '0x'], [0n, 25n]],
      ),
    );
  });
});
