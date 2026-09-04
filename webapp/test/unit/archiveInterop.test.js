// @vitest-environment jsdom
//
// The command-line tool writes the same bundles the web app reads. That is
// a claim about two separate implementations of one format, so it is checked
// here against `cli/src/archive.js` itself rather than against a copy of it:
// if either side drifts, this fails.
import { describe, expect, it } from 'vitest';
import { archiveImage, archivePost, buildArchive, ARCHIVE_FORMAT as CLI_FORMAT } from '../../../cli/src/archive.js';
import { ARCHIVE_FORMAT, parseArchive } from '../../src/lib/archive';
import { GLYPH_ADDRESS } from '../../src/lib/config';
import { AUTHORS } from '../../src/lib/fixtureWorld';

const TX = `0x${'ab'.repeat(32)}`;
const IMAGE_TX = `0x${'cd'.repeat(32)}`;

describe('the format the two tools share', () => {
  it('agrees on the version number', () => {
    expect(CLI_FORMAT).toBe(ARCHIVE_FORMAT);
  });

  it('a bundle built by the command-line tool is one the web app reads', () => {
    const doc = buildArchive({
      contract: GLYPH_ADDRESS,
      scope: { kind: 'author', address: AUTHORS[0].toLowerCase() },
      posts: [
        archivePost({
          chainId: 1,
          row: {
            txHash: TX,
            eventIndex: 0,
            author: AUTHORS[0].toLowerCase(),
            index: 3n,
            block: 25_945_650n,
            prevBlock: 25_901_234n,
            logIndex: 12,
            ts: 1_757_000_000,
            title: 'A letter before the solstice',
          },
          body: { text: '---\ntags: letters home\n---\n\nXiaoman,', compressedBytes: 1432 },
        }),
      ],
      images: [archiveImage({ chainId: 1, txHash: IMAGE_TX, bytes: new Uint8Array([1, 2, 3]) })],
      authors: [{ chainId: 1, address: AUTHORS[0].toLowerCase(), head: 25_945_650, complete: true }],
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    const { doc: parsed, problems, summary } = parseArchive(JSON.stringify(doc));
    expect(problems).toEqual([]);
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.images).toHaveLength(1);
    expect(summary).toEqual(['Ethereum: 1 post, 1 image', '1 author, complete']);
    // Every field survives as a plain JSON value: no BigInt reaches a file.
    expect(parsed.posts[0]).toMatchObject({ index: 3, block: 25_945_650, prevBlock: 25_901_234 });
  });
});
