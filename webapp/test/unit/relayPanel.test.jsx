// @vitest-environment jsdom
// relayPanel.test.jsx — relaying a signed post: what the panel says about a
// ticket, and what it sends.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const sent = [];
vi.mock('../../src/lib/publish', () => ({
  relayTicket: async (ticket, opts) => {
    sent.push({ ticket, opts });
    return `0x${'11'.repeat(32)}`;
  },
}));

const RelayPanel = (await import('../../src/components/RelayPanel')).default;
const { GLYPH_V2_ADDRESS } = await import('../../src/lib/config');
const { buildTicket, serializeTicket } = await import('../../src/lib/relay');
const { encodeTitle } = await import('../../src/lib/title');
const { setLang } = await import('../../src/lib/i18n');

const AUTHOR = '0x8a1f3b52c9e44e1a9b1f0d2c7a44e0b1d2e3f4a5';
const ticketFor = (over = {}) =>
  buildTicket({
    chainId: 1,
    contract: GLYPH_V2_ADDRESS,
    author: AUTHOR,
    title: encodeTitle('Relayed'),
    payload: '0x3b',
    hook: null,
    hookData: '0x',
    index: 2,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    signature: `0x${'ab'.repeat(65)}`,
    ...over,
  });

beforeEach(() => {
  setLang('en');
  sent.length = 0;
});
afterEach(() => cleanup());

const paste = (text) => fireEvent.change(screen.getByPlaceholderText('Paste the signed post here'), { target: { value: text } });
const sendButton = () => screen.getByRole('button', { name: 'Send it on-chain' });
const disabled = () => sendButton().disabled;

describe('RelayPanel', () => {
  it('describes a good ticket and sends it through the wallet', async () => {
    render(<RelayPanel chainId={1} />);
    expect(disabled()).toBe(true);
    paste(serializeTicket(ticketFor()));
    const summary = document.querySelector('[data-relay-summary]');
    expect(summary.textContent).toContain('“Relayed” by 0x8a1f....f4a5, for Ethereum');
    expect(summary.textContent).toContain('post #3 on Glyph v2');
    expect(disabled()).toBe(false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(document.querySelector('[data-relay-sent]')).toBeTruthy());
    expect(sent).toHaveLength(1);
    expect(sent[0].ticket.author).toBe(AUTHOR);
    expect(sent[0].opts).toEqual({ chainId: 1 });
    expect(screen.getByText('Relayed to Ethereum')).toBeTruthy();
  });

  it('names a hook and the ether a ticket asks for', () => {
    render(<RelayPanel chainId={1} />);
    paste(serializeTicket(ticketFor({ hook: '0x00000000000000000000000000000000000000ab', hookData: '0x01', value: 10n ** 16n })));
    const summary = document.querySelector('[data-relay-summary]').textContent;
    expect(summary).toContain('through the hook 0x0000....00ab');
    expect(summary).toContain('sends 0.01 ETH along to the hook');
  });

  it('refuses what it cannot send, with the reason', () => {
    render(<RelayPanel chainId={1} />);
    paste('{"hello":1}');
    expect(screen.getByRole('alert').textContent).toContain('not a signed post');
    expect(disabled()).toBe(true);

    paste(serializeTicket(ticketFor({ deadline: 1 })));
    expect(screen.getByRole('alert').textContent).toContain('expired');
    expect(disabled()).toBe(true);

    paste(serializeTicket(ticketFor({ contract: '0x1111111111111111111111111111111111111111' })));
    expect(screen.getByRole('alert').textContent).toContain('different contract');

    paste(serializeTicket(ticketFor({ chainId: 424242 })));
    expect(screen.getByRole('alert').textContent).toContain('Chain 424242 is not one this app reads');
  });

  it('a ticket for the other chain waits for the publish target to match', () => {
    render(<RelayPanel chainId={1} />);
    paste(serializeTicket(ticketFor({ chainId: 167000 })));
    expect(document.querySelector('[data-relay-summary]').textContent).toContain('This signed post is for Taiko');
    expect(disabled()).toBe(true);
    cleanup();
    render(<RelayPanel chainId={167000} />);
    paste(serializeTicket(ticketFor({ chainId: 167000 })));
    expect(disabled()).toBe(false);
  });

  it('reads a ticket from a file', async () => {
    render(<RelayPanel chainId={1} />);
    const input = screen.getByLabelText('Choose a signed post file');
    const file = new File([serializeTicket(ticketFor())], 'ticket.json', { type: 'application/json' });
    file.text = async () => serializeTicket(ticketFor());
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('[data-relay-summary]')).toBeTruthy());
  });
});
