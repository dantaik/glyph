// diff.js — a unified diff, written here rather than installed.
//
// `verify` has one job: say whether a file is what the chain holds, and when
// it is not, show where. That is worth a hundred lines of longest-common-
// subsequence; it is not worth a dependency, because this package's whole
// dependency list is `viem`, and a tool people run against their own archive
// years from now should have as little between it and Node as possible.
//
// The output is the ordinary unified format — `--- +++`, `@@` hunk headers,
// three lines of context — so `git apply`, a review tool or a human all read
// it without being told anything.

/** Lines of context on each side of a change, as `diff -u` uses. */
const CONTEXT = 3;

/**
 * The most cells the table below may hold. The comparison is quadratic in
 * the number of differing lines, so a pathological pair (two long documents
 * with nothing in common) would otherwise eat the machine. Past this, the
 * answer is still true — "these two are different, here they are" — it is
 * just no longer minimal, and for two documents with nothing in common that
 * is also the honest reading.
 */
const MAX_CELLS = 4_000_000;

/** Longest common subsequence of two line arrays, as a list of operations. */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((line) => ({ op: '-', line })),
      ...b.map((line) => ({ op: '+', line })),
    ];
  }
  // table[i][j] — the length of the longest common subsequence of a[i…] and
  // b[j…]. Built from the end so the walk forward below reads naturally.
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: ' ', line: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: '-', line: a[i] });
      i++;
    } else {
      ops.push({ op: '+', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ op: '-', line: a[i++] });
  while (j < m) ops.push({ op: '+', line: b[j++] });
  return ops;
}

/** Group operations into hunks: every change, plus CONTEXT lines around it. */
function hunksOf(ops) {
  const changed = ops.map((o) => o.op !== ' ');
  const keep = ops.map((_, i) =>
    changed.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(Boolean),
  );
  const hunks = [];
  let current = null;
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < ops.length; i++) {
    const { op, line } = ops[i];
    if (keep[i]) {
      if (!current) {
        current = { oldStart: oldLine, newStart: newLine, oldCount: 0, newCount: 0, lines: [] };
        hunks.push(current);
      }
      current.lines.push(`${op}${line}`);
      if (op !== '+') current.oldCount++;
      if (op !== '-') current.newCount++;
    } else {
      current = null;
    }
    if (op !== '+') oldLine++;
    if (op !== '-') newLine++;
  }
  return hunks;
}

/**
 * A unified diff of two documents, or an empty string when they are the
 * same. `labels` names the two sides the way `---`/`+++` lines do.
 */
export function unifiedDiff(oldText, newText, { labels = ['a', 'b'] } = {}) {
  if (oldText === newText) return '';
  // A trailing newline is a real difference, but splitting on it would add a
  // phantom empty line to whichever side has one. Compare the documents as
  // the lines they are, and let the "\ No newline at end of file" marker say
  // the rest.
  const split = (text) => {
    const lines = String(text).split('\n');
    const trailing = lines.length > 1 && lines[lines.length - 1] === '';
    if (trailing) lines.pop();
    return { lines, trailing };
  };
  const a = split(oldText);
  const b = split(newText);
  const ops = lcsOps(a.lines, b.lines);
  const out = [`--- ${labels[0]}`, `+++ ${labels[1]}`];
  for (const hunk of hunksOf(ops)) {
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      ...hunk.lines,
    );
  }
  // Only worth saying when the two sides disagree about it: two documents
  // that both end without a newline do not differ there.
  if (a.trailing !== b.trailing) {
    out.push(`\\ No newline at end of file (${a.trailing ? labels[1] : labels[0]})`);
  }
  return out.join('\n');
}
