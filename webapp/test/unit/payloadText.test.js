import { describe, expect, it } from 'vitest';
import {
  FRONT_MATTER_KEYS,
  buildPayloadText,
  parsePayloadText,
  parseTags,
  splitFrontMatter,
} from '../../src/lib/payloadText';

describe('buildPayloadText — the document a payload holds', () => {
  it('writes no front-matter at all when there is no metadata', () => {
    expect(buildPayloadText({ markdown: '# Hello\n\nBody.' })).toBe('# Hello\n\nBody.');
    expect(buildPayloadText({ markdown: 'x', meta: { tags: [] } })).toBe('x');
    expect(buildPayloadText({ markdown: 'x', meta: { lang: '   ' } })).toBe('x');
  });

  it('writes tags exactly as the app always has (older readers see no change)', () => {
    expect(buildPayloadText({ markdown: 'Body.', meta: { tags: ['a', 'b'] } })).toBe(
      '---\ntags: a, b\n---\n\nBody.',
    );
    // A string is accepted as readily as a list.
    expect(buildPayloadText({ markdown: 'Body.', meta: { tags: 'a, b' } })).toBe(
      '---\ntags: a, b\n---\n\nBody.',
    );
  });

  it('writes known keys in one fixed order, whatever order they arrive in', () => {
    const text = buildPayloadText({
      markdown: 'Body.',
      meta: { part: '2', series: 'Winter', lang: 'zh', tags: ['letters'] },
    });
    expect(text).toBe('---\ntags: letters\nlang: zh\nseries: Winter\npart: 2\n---\n\nBody.');
    const order = text
      .split('\n')
      .slice(1, -3)
      .map((line) => line.split(':')[0]);
    expect(order).toEqual(order.slice().sort((a, b) => FRONT_MATTER_KEYS.indexOf(a) - FRONT_MATTER_KEYS.indexOf(b)));
  });

  it('keeps keys it does not know, after the ones it does, alphabetically', () => {
    const text = buildPayloadText({
      markdown: 'Body.',
      meta: { zeta: '1', alpha: '2', lang: 'en' },
    });
    expect(text).toBe('---\nlang: en\nalpha: 2\nzeta: 1\n---\n\nBody.');
  });

  it('is stable: the same draft always produces the same bytes', () => {
    const a = buildPayloadText({ markdown: 'Body.', meta: { lang: 'en', tags: ['x'] } });
    const b = buildPayloadText({ markdown: 'Body.', meta: { tags: ['x'], lang: 'en' } });
    expect(a).toBe(b);
  });
});

describe('splitFrontMatter — conservative on purpose', () => {
  it('reads a well-formed block', () => {
    expect(splitFrontMatter('---\ntags: a\n---\n\nBody.')).toEqual({
      meta: { tags: 'a' },
      body: 'Body.', // the one blank line separating block from body is dropped
    });
  });

  it('leaves a body that merely starts with a rule alone', () => {
    const text = '---\n\nA thematic break, not metadata.';
    expect(splitFrontMatter(text)).toEqual({ meta: {}, body: text });
  });

  it('leaves a block with a line that is not key: value alone', () => {
    const text = '---\ntags: a\nnot a pair\n---\n\nBody.';
    expect(splitFrontMatter(text).meta).toEqual({});
    expect(splitFrontMatter(text).body).toBe(text);
  });

  it('leaves an unterminated block alone', () => {
    const text = '---\ntags: a\n\nBody.';
    expect(splitFrontMatter(text)).toEqual({ meta: {}, body: text });
  });
});

describe('parseTags', () => {
  it('splits, trims and drops the empties', () => {
    expect(parseTags('a,  b ,,c')).toEqual(['a', 'b', 'c']);
  });

  it('tolerates the bracketed array style', () => {
    expect(parseTags('[a, b]')).toEqual(['a', 'b']);
  });

  it('is empty for nothing', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe('round trips', () => {
  it('survives every key, including ones this version invented', () => {
    const meta = {
      tags: ['letters home', '冬'],
      lang: 'zh',
      re: '0x' + 'ab'.repeat(32),
      supersedes: `taiko:0x${'cd'.repeat(32)}/1`,
      prev: '0x' + 'ef'.repeat(32),
      series: 'Letters to Xiaoman',
      part: '3',
      somethingLater: 'kept',
    };
    const markdown = '# 冬至\n\n正文。\n\n---\n\nA rule inside the body.';
    const parsed = parsePayloadText(buildPayloadText({ markdown, meta }));
    expect(parsed.markdown).toBe(markdown);
    expect(parsed.tags).toEqual(['letters home', '冬']);
    expect(parsed.meta.lang).toBe('zh');
    expect(parsed.meta.supersedes).toBe(`taiko:0x${'cd'.repeat(32)}/1`);
    expect(parsed.meta.somethingLater).toBe('kept');
  });

  it('survives a body with no metadata at all', () => {
    const markdown = 'Just prose.\n\nTwo paragraphs.';
    expect(parsePayloadText(buildPayloadText({ markdown }))).toEqual({
      meta: {},
      tags: [],
      markdown,
    });
  });
});
