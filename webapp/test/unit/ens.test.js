import { describe, expect, it, vi } from 'vitest';
import { createEns, handle, hasProfileText, isEnsName, safeUrl } from '../../src/lib/ens';

const ADDRESS = '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5';
const OTHER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

/** A chainIO stand-in with an ENS the test decides the contents of. */
function fakeIo({ hasEns = true, names = {}, addresses = {}, avatars = {}, records = {} } = {}) {
  const calls = { ensName: 0, ensAddress: 0, ensAvatar: 0, ensText: 0 };
  return {
    calls,
    hasEns,
    async ensName(address) {
      calls.ensName += 1;
      return names[String(address).toLowerCase()] ?? null;
    },
    async ensAddress(name) {
      calls.ensAddress += 1;
      return addresses[name] ?? null;
    },
    async ensAvatar(name) {
      calls.ensAvatar += 1;
      return avatars[name] ?? null;
    },
    async ensText(name, key) {
      calls.ensText += 1;
      return records[name]?.[key] ?? null;
    },
  };
}

const world = () =>
  fakeIo({
    names: { [ADDRESS.toLowerCase()]: 'xiaoman.eth' },
    addresses: { 'xiaoman.eth': ADDRESS },
    avatars: { 'xiaoman.eth': 'https://example.test/face.png' },
    records: {
      'xiaoman.eth': { description: 'Letters home.', url: 'xiaoman.example', 'com.github': '@xiaoman' },
    },
  });

describe('isEnsName', () => {
  it('accepts a .eth name in any case, and nothing else', () => {
    expect(isEnsName('xiaoman.eth')).toBe(true);
    expect(isEnsName('  Xiaoman.ETH ')).toBe(true);
    expect(isEnsName('a.b.eth')).toBe(true);
    expect(isEnsName('xiaoman')).toBe(false);
    expect(isEnsName('xiaoman.com')).toBe(false);
    expect(isEnsName(ADDRESS)).toBe(false);
    expect(isEnsName('')).toBe(false);
    expect(isEnsName(null)).toBe(false);
  });
});

describe('createEns', () => {
  it('resolves a name and reverses an address', async () => {
    const io = world();
    const ens = createEns(io);
    expect(ens.enabled).toBe(true);
    expect(await ens.resolveEnsName('xiaoman.eth')).toBe(ADDRESS);
    expect(await ens.ensName(ADDRESS)).toBe('xiaoman.eth');
  });

  it('asks once per address and once per name', async () => {
    const io = world();
    const ens = createEns(io);
    await ens.ensName(ADDRESS);
    await ens.ensName(ADDRESS.toLowerCase());
    await ens.resolveEnsName('xiaoman.eth');
    await ens.resolveEnsName('  XIAOMAN.eth  ');
    expect(io.calls.ensName).toBe(1);
    expect(io.calls.ensAddress).toBe(1);
  });

  it('a chain without ENS is never asked at all', async () => {
    const io = fakeIo({ hasEns: false, names: { [ADDRESS.toLowerCase()]: 'xiaoman.eth' } });
    const ens = createEns(io);
    expect(ens.enabled).toBe(false);
    expect(await ens.ensName(ADDRESS)).toBeNull();
    expect(await ens.resolveEnsName('xiaoman.eth')).toBeNull();
    expect(await ens.ensProfile(ADDRESS)).toBeNull();
    expect(io.calls).toEqual({ ensName: 0, ensAddress: 0, ensAvatar: 0, ensText: 0 });
  });

  it('something that is not a name is not looked up', async () => {
    const io = world();
    const ens = createEns(io);
    expect(await ens.resolveEnsName('xiaoman')).toBeNull();
    expect(await ens.resolveEnsName(ADDRESS)).toBeNull();
    expect(io.calls.ensAddress).toBe(0);
  });

  it('a profile carries the name, the avatar and the records', async () => {
    const ens = createEns(world());
    expect(await ens.ensProfile(ADDRESS)).toEqual({
      name: 'xiaoman.eth',
      avatar: 'https://example.test/face.png',
      description: 'Letters home.',
      url: 'xiaoman.example',
      twitter: null,
      github: '@xiaoman',
    });
  });

  it('a reverse record the name does not claim back is not a name', async () => {
    // Anyone may point their reverse record at any name; only the forward
    // resolution decides. Here it comes back to somebody else.
    const io = fakeIo({
      names: { [ADDRESS.toLowerCase()]: 'xiaoman.eth' },
      addresses: { 'xiaoman.eth': OTHER },
      records: { 'xiaoman.eth': { description: 'Not mine.' } },
    });
    const ens = createEns(io);
    expect(await ens.ensProfile(ADDRESS)).toBeNull();
    expect(io.calls.ensText).toBe(0); // and the records are never read
  });

  it('an address with no name has no profile, and no records are read', async () => {
    const io = world();
    const ens = createEns(io);
    expect(await ens.ensProfile(OTHER)).toBeNull();
    expect(io.calls.ensText).toBe(0);
  });

  it('a failing node means no name, never an error', async () => {
    const io = world();
    io.ensName = async () => {
      throw new Error('node is down');
    };
    io.ensAddress = async () => {
      throw new Error('node is down');
    };
    const ens = createEns(io);
    expect(await ens.ensName(ADDRESS)).toBeNull();
    expect(await ens.resolveEnsName('xiaoman.eth')).toBeNull();
    expect(await ens.ensProfile(ADDRESS)).toBeNull();
  });

  it('a failing record leaves the rest of the profile standing', async () => {
    const io = world();
    io.ensAvatar = async () => {
      throw new Error('gateway is down');
    };
    const profile = await createEns(io).ensProfile(ADDRESS);
    expect(profile.avatar).toBeNull();
    expect(profile.description).toBe('Letters home.');
  });

  it('a name is held for ten minutes and then asked again', async () => {
    vi.useFakeTimers();
    try {
      const io = world();
      const ens = createEns(io);
      await ens.ensName(ADDRESS);
      vi.advanceTimersByTime(9 * 60_000);
      await ens.ensName(ADDRESS);
      expect(io.calls.ensName).toBe(1);
      vi.advanceTimersByTime(2 * 60_000);
      await ens.ensName(ADDRESS);
      expect(io.calls.ensName).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what a profile is worth showing', () => {
  it('nothing at all when every record is empty', () => {
    expect(hasProfileText(null)).toBe(false);
    expect(hasProfileText({ name: 'xiaoman.eth', avatar: 'x', description: null, url: null })).toBe(false);
    expect(hasProfileText({ description: 'Hello.' })).toBe(true);
    expect(hasProfileText({ github: 'xiaoman' })).toBe(true);
  });

  it('only http(s) is a link — a text record is written by whoever owns the name', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('a.example')).toBe('https://a.example/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it('a handle without the @ its owner may have typed', () => {
    expect(handle('@xiaoman')).toBe('xiaoman');
    expect(handle(' xiaoman ')).toBe('xiaoman');
    expect(handle('')).toBeNull();
  });
});
