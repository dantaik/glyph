// imageKeys.js — the names attached images go by.
//
// `img1`, `img2`, … rather than file names: the key appears in the body as
// `![](upload:img1)`, and a file called "IMG_20260904 (1).HEIC" would make a
// mess of a Markdown link. Shared by the dropzone and by pasting into the
// editor, so both number the same way and neither can hand out a name the
// other has already used.

/**
 * `count` keys not already taken by `files`, in order.
 * @param {Record<string, unknown>} files
 * @param {number} count
 * @returns {string[]}
 */
export function nextImageKeys(files, count) {
  const taken = new Set(Object.keys(files ?? {}));
  const out = [];
  let n = 1;
  while (out.length < count) {
    const key = `img${n}`;
    if (!taken.has(key)) {
      taken.add(key);
      out.push(key);
    }
    n += 1;
  }
  return out;
}
