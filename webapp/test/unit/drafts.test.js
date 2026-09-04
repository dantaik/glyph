// @vitest-environment jsdom
//
// jsdom has no IndexedDB, which is exactly the situation of a private window
// or a browser with site data blocked: cache.js falls back to memory, and a
// draft still survives everything except closing the tab. The behaviour under
// test is the same either way.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDraft,
  isEmptyDraft,
  loadDraft,
  saveDraft,
  setPendingDraftPatch,
  takePendingDraftPatch,
} from '../../src/lib/drafts';
import { setLang, translate } from '../../src/lib/i18n';

beforeEach(async () => {
  await clearDraft();
  setLang('en');
});

describe('a draft, out and back', () => {
  it('keeps the words, the tags, the front-matter and the attached files', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'hills.png', { type: 'image/png' });
    await saveDraft({
      title: '冬至',
      tags: ['letters home', '冬'],
      markdown: '# 冬至\n\n正文。 ![](upload:img1)',
      meta: { lang: 'zh' },
      files: { img1: file },
    });

    const back = await loadDraft();
    expect(back.title).toBe('冬至');
    expect(back.tags).toEqual(['letters home', '冬']);
    expect(back.markdown).toContain('upload:img1');
    expect(back.meta).toEqual({ lang: 'zh' });
    // The image comes back as a File, so `upload:img1` still resolves and the
    // transaction it would have cost has not been thrown away.
    expect(back.files.img1).toBeInstanceOf(File);
    expect(back.files.img1.name).toBe('hills.png');
    expect(typeof back.updatedAt).toBe('number');
  });

  it('is gone once cleared', async () => {
    await saveDraft({ title: 'x', tags: [], markdown: 'y' });
    expect(await loadDraft()).not.toBeNull();
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });

  it('answers with nothing when nothing was ever written', async () => {
    expect(await loadDraft()).toBeNull();
  });
});

describe('isEmptyDraft — what is not worth keeping', () => {
  it('treats a blank form as empty', () => {
    expect(isEmptyDraft({ title: '', tags: [], markdown: '', meta: {}, files: {} })).toBe(true);
    expect(isEmptyDraft({ title: '  ', tags: [], markdown: '\n\n' })).toBe(true);
    expect(isEmptyDraft(null)).toBe(true);
  });

  it('treats the untouched placeholder body as empty, in either language', () => {
    for (const lang of ['en', 'zh']) {
      const markdown = translate(lang, 'publish.placeholderBody');
      expect(isEmptyDraft({ title: '', tags: [], markdown })).toBe(true);
    }
    // …and still does when the interface has since been switched.
    setLang('zh');
    expect(isEmptyDraft({ title: '', tags: [], markdown: translate('en', 'publish.placeholderBody') })).toBe(true);
  });

  it('treats anything the writer actually did as worth keeping', () => {
    const placeholder = translate('en', 'publish.placeholderBody');
    expect(isEmptyDraft({ title: 'A title', tags: [], markdown: placeholder })).toBe(false);
    expect(isEmptyDraft({ title: '', tags: ['travel'], markdown: placeholder })).toBe(false);
    expect(isEmptyDraft({ title: '', tags: [], markdown: 'Something written.' })).toBe(false);
    expect(isEmptyDraft({ title: '', tags: [], markdown: placeholder, files: { img1: {} } })).toBe(false);
    expect(isEmptyDraft({ title: '', tags: [], markdown: placeholder, meta: { lang: 'zh' } })).toBe(false);
    // An empty front-matter value is not a change.
    expect(isEmptyDraft({ title: '', tags: [], markdown: placeholder, meta: { lang: '' } })).toBe(true);
  });
});

describe('the pending patch — "reply to this post" starting a draft', () => {
  it('is handed over once and then gone', () => {
    setPendingDraftPatch({ meta: { re: '0xabc' } });
    expect(takePendingDraftPatch()).toEqual({ meta: { re: '0xabc' } });
    expect(takePendingDraftPatch()).toBeNull();
  });

  it('treats nothing as nothing', () => {
    setPendingDraftPatch({});
    expect(takePendingDraftPatch()).toBeNull();
    setPendingDraftPatch(null);
    expect(takePendingDraftPatch()).toBeNull();
  });
});
