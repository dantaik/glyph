import { describe, expect, it } from 'vitest';
import en from '../../src/lib/locales/en';
import zh from '../../src/lib/locales/zh';

/**
 * The two dictionaries are one vocabulary in two languages. A key in one and
 * not the other is a phrase that silently falls back to English (or, worse,
 * renders as its own key) — invisible until someone reading in that language
 * hits it. So the sets are compared here, and every feature that adds a
 * phrase has to add both halves of it.
 */
describe('the interface dictionaries', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();

  it('carry exactly the same keys', () => {
    const missingFromZh = enKeys.filter((k) => !(k in zh));
    const missingFromEn = zhKeys.filter((k) => !(k in en));
    expect({ missingFromZh, missingFromEn }).toEqual({ missingFromZh: [], missingFromEn: [] });
  });

  it('agree on which phrases interpolate', () => {
    // A key that is a function in one language and a plain string in the
    // other drops its interpolated parts on the floor in the string one.
    const mismatched = enKeys.filter((k) => k in zh && typeof en[k] !== typeof zh[k]);
    expect(mismatched).toEqual([]);
  });

  it('hold no empty phrases where the other language has words', () => {
    const empty = enKeys.filter(
      (k) =>
        typeof en[k] === 'string' &&
        typeof zh[k] === 'string' &&
        (en[k].trim() === '') !== (zh[k].trim() === ''),
    );
    // The one legitimate asymmetry: English writes "Posts by <author>" and
    // Chinese "<author> 的文章", so each language leaves the other's half of
    // the pair empty.
    expect(empty.sort()).toEqual(['author.postsByPrefix', 'author.postsBySuffix']);
  });
});
