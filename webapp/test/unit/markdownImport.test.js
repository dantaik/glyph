import { describe, expect, it } from 'vitest';
import { fitTitle, importMarkdown, titleFromMarkdown } from '../../src/lib/markdownImport';
import { postFileName } from '../../src/lib/download';
import { fmtBytes } from '../../src/lib/format';
import { titleByteLength } from '../../src/lib/title';

describe('finding a title for an imported file', () => {
  it('prefers the front-matter, the way every static-site generator writes it', () => {
    const text = '---\ntitle: A letter\ntags: home\n---\n\n# Something else\n\nBody.';
    expect(importMarkdown(text).title).toBe('A letter');
  });

  it('falls back to the first heading, then to the file name', () => {
    expect(titleFromMarkdown('# Rain at midnight\n\nBody.')).toBe('Rain at midnight');
    expect(titleFromMarkdown('   ## Indented, still a heading')).toBe('Indented, still a heading');
    expect(titleFromMarkdown('Just prose.', { fileName: 'winter-letter.md' })).toBe('winter-letter');
  });

  it('cuts a title to what a bytes32 holds, without splitting a character', () => {
    // Eleven Chinese characters is 33 bytes: one too many.
    const long = '冬至前两天我上阁楼找腊';
    expect(titleByteLength(long)).toBeGreaterThan(32);
    const fitted = fitTitle(long);
    expect(titleByteLength(fitted)).toBeLessThanOrEqual(32);
    expect(fitted).toBe('冬至前两天我上阁楼找');
    // …and nothing is lost from a title that already fits.
    expect(fitTitle('A letter')).toBe('A letter');
  });
});

describe('reading a Markdown file into a draft', () => {
  it('takes the tags and the keys this version knows', () => {
    const text = '---\ntags: letters home, 冬\nlang: zh\nseries: Winter\npart: 2\n---\n\n正文。';
    const fields = importMarkdown(text);
    expect(fields.tags).toEqual(['letters home', '冬']);
    expect(fields.meta).toEqual({ lang: 'zh', series: 'Winter', part: '2' });
    expect(fields.markdown).toBe('正文。');
    expect(fields.dropped).toEqual([]);
  });

  it('names the keys it will not carry rather than smuggling them on chain', () => {
    const text = '---\ntags: a\nlayout: post\ndraft: true\n---\n\nBody.';
    const fields = importMarkdown(text);
    expect(fields.dropped.sort()).toEqual(['draft', 'layout']);
    expect(fields.meta).toEqual({});
  });

  it('takes a file with no front-matter at all as pure Markdown', () => {
    const fields = importMarkdown('# A heading\n\nBody.', { fileName: 'notes.md' });
    expect(fields).toMatchObject({ title: 'A heading', tags: [], meta: {}, dropped: [] });
    expect(fields.markdown).toBe('# A heading\n\nBody.');
  });
});

describe('naming the file a post is downloaded as', () => {
  it('is the day it was mined and a readable form of the title', () => {
    expect(postFileName({ title: 'A letter before the solstice', ts: 1_757_000_000 })).toBe(
      '2025-09-04-a-letter-before-the-solstice.md',
    );
  });

  it('keeps a title in its own script rather than reducing it to dashes', () => {
    expect(postFileName({ title: '关于外婆的香樟木箱', ts: 1_757_000_000 })).toBe(
      '2025-09-04-关于外婆的香樟木箱.md',
    );
  });

  it('falls back to the transaction when a post has no title', () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    expect(postFileName({ title: '', ts: 1_757_000_000, txHash })).toBe('2025-09-04-0xabababab.md');
    expect(postFileName({ title: '', txHash })).toBe('0xabababab.md');
  });
});

describe('byte counts, as a reader reads them', () => {
  it('changes unit where the number stops being legible', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1_432)).toBe('1.4 KB');
    expect(fmtBytes(999)).toBe('999 B');
    expect(fmtBytes(43_264)).toBe('42.3 KB');
    expect(fmtBytes(5_000_000)).toBe('4.77 MB');
    expect(fmtBytes(null)).toBe('');
  });
});
