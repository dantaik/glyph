import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, orderedRequest } from '../../src/lib/transport';

/**
 * Endpoints scripted call by call: 'ok' answers; 'down' fails the way a
 * dead node does; 'rate' is a 429; 'reply' is an error the node ANSWERED
 * with (a JSON-RPC error: range too large). Every call is recorded.
 */
function harness(script) {
  const calls = [];
  const makeRequest = (url) => async (args) => {
    calls.push(url);
    const step = script[url].shift() ?? 'ok';
    if (step === 'ok') return `${url}:${args.method}`;
    if (step === 'down') throw Object.assign(new Error('fetch failed'), { name: 'HttpRequestError' });
    if (step === 'rate') throw Object.assign(new Error('Too Many Requests'), { status: 429 });
    throw Object.assign(new Error('query exceeds max block range'), { name: 'RpcRequestError' });
  };
  let t = 1_000_000;
  const provider = orderedRequest(Object.keys(script), null, 'test', { makeRequest, now: () => t });
  return {
    calls,
    tick: (ms) => {
      t += ms;
    },
    request: (method = 'eth_blockNumber') => provider.request({ method }),
  };
}

describe('transport.orderedRequest', () => {
  it('walks the endpoints in order and answers from the first that works', async () => {
    const h = harness({ a: ['down'], b: ['ok'] });
    expect(await h.request()).toBe('b:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b']);
  });

  it('puts a dead endpoint on cool-down, tries it last, and welcomes it back after', async () => {
    const h = harness({ a: ['down', 'ok', 'ok'], b: ['ok', 'ok'] });
    await h.request();
    // a is cooling: b is asked first and answers, a is never bothered.
    expect(await h.request()).toBe('b:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'b']);
    h.tick(COOLDOWN_MS + 1);
    expect(await h.request()).toBe('a:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'b', 'a']);
  });

  it('a reply the node made is not a failure: the next endpoint is tried, nothing is cooled, the last error propagates', async () => {
    const h = harness({ a: ['reply', 'ok'], b: ['reply'] });
    await expect(h.request('eth_getLogs')).rejects.toThrow(/exceeds max block range/);
    expect(h.calls).toEqual(['a', 'b']);
    // a stays first in line.
    expect(await h.request()).toBe('a:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'a']);
  });

  it('a rate limit counts as a node failure', async () => {
    const h = harness({ a: ['rate', 'ok'], b: ['ok', 'ok'] });
    await h.request();
    expect(await h.request()).toBe('b:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'b']);
  });

  it('endpoints on cool-down are still the last resort, in their order', async () => {
    const h = harness({ a: ['down', 'ok'], b: ['down', 'ok'] });
    await expect(h.request()).rejects.toThrow(/fetch failed/);
    // Both cooling: nothing is ready, so the original order is walked anyway.
    expect(await h.request()).toBe('a:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'a']);
  });

  it('a success clears the cool-down at once', async () => {
    const h = harness({ a: ['down', 'ok', 'ok'], b: ['down', 'ok'] });
    await h.request().catch(() => {});
    await h.request(); // a (cooling, first in line) answers → back in rotation
    expect(await h.request()).toBe('a:eth_blockNumber');
    expect(h.calls).toEqual(['a', 'b', 'a', 'a']);
  });
});
