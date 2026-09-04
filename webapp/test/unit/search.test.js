import { describe, expect, it } from 'vitest';
import { highlightParts, matchPost, normalizeQuery, snippetAround } from '../../src/lib/search';

const post = {
  title: 'Winter by the sea',
  tags: ['sea', 'letters home'],
  markdown:
    'The fishing harbour is laid up for the winter, the boats hauled out and turned over like a row of whales in the sun.',
};

const chinese = {
  title: '关于外婆的香樟木箱',
  tags: ['家信'],
  markdown: '冬至前两天，我上阁楼找腊味罐，却先翻出了外婆的香樟木箱。铜锁绿了，箱角磨得发亮。',
};

describe('finding a word', () => {
  it('looks in the title, the tags and the text, and says which', () => {
    expect(matchPost(post, normalizeQuery('Winter')).where).toBe('title');
    expect(matchPost(post, normalizeQuery('letters')).where).toBe('tags');
    expect(matchPost(post, normalizeQuery('harbour')).where).toBe('body');
  });

  it('ignores case, in either script', () => {
    expect(matchPost(post, normalizeQuery('WINTER'))).toBeTruthy();
    expect(matchPost(post, normalizeQuery('  boats  '))).toBeTruthy();
  });

  it('finds Chinese, which no tokeniser would have split for us', () => {
    // The point of matching substrings rather than words: there are no spaces
    // to split on here, and this is the writing the app was built for.
    expect(matchPost(chinese, normalizeQuery('香樟木箱')).where).toBe('title');
    expect(matchPost(chinese, normalizeQuery('阁楼')).where).toBe('body');
    expect(matchPost(chinese, normalizeQuery('家信')).where).toBe('tags');
  });

  it('answers with nothing when there is nothing', () => {
    expect(matchPost(post, normalizeQuery('camphorwood'))).toBeNull();
    expect(matchPost(post, normalizeQuery(''))).toBeNull();
    expect(matchPost({}, normalizeQuery('anything'))).toBeNull();
  });
});

describe('the words around a match', () => {
  const long = `${'a '.repeat(120)}NEEDLE${' b'.repeat(120)}`;

  it('shows a window around it, marked where it was cut', () => {
    const { text } = snippetAround(long, long.indexOf('NEEDLE'));
    expect(text).toContain('NEEDLE');
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(200);
  });

  it('returns a short text whole, with no ellipsis', () => {
    expect(snippetAround('A short line.', 2)).toEqual({ text: 'A short line.', from: 0 });
  });

  it('does not hunt for a space that a Chinese paragraph does not have', () => {
    const zh = '冬'.repeat(400);
    const { text } = snippetAround(zh, 200);
    expect(text.replace(/…/g, '').length).toBeGreaterThan(100);
  });
});

describe('marking the matches for display', () => {
  it('splits the text around every occurrence', () => {
    const parts = highlightParts('winter, and more winter', 'winter');
    expect(parts.map((p) => p.text)).toEqual(['winter', ', and more ', 'winter']);
    expect(parts.map((p) => p.hit)).toEqual([true, false, true]);
  });

  it('marks a match whatever case it was written in', () => {
    expect(highlightParts('Winter', 'winter')).toEqual([{ text: 'Winter', hit: true }]);
  });

  it('leaves text with no match in one piece', () => {
    expect(highlightParts('nothing here', 'winter')).toEqual([{ text: 'nothing here', hit: false }]);
    expect(highlightParts('nothing here', '')).toEqual([{ text: 'nothing here', hit: false }]);
  });
});
