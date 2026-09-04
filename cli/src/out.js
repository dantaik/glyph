// out.js — what goes to stdout, what goes to stderr, and what exits non-zero.
//
// The rule the whole tool follows: STDOUT CARRIES THE ANSWER, stderr carries
// everything else. A post's Markdown, a JSON record, a list of titles — those
// are the answer, and they are all a pipe should ever receive. Progress
// ("walking author…"), warnings and errors go to stderr, so
// `xueni fetch … > letter.md` produces a file with nothing in it but the
// letter, even while the terminal shows what is happening.
//
// One deliberate exception: `verify`'s diff is the answer to the question it
// was asked, so it prints on stdout even though the command exits 1.

/** The answer. */
export function print(text = '') {
  process.stdout.write(`${text}\n`);
}

/**
 * A DOCUMENT as the answer — a post's Markdown, the exact bytes the chain
 * holds — written verbatim, with no newline added.
 *
 * This is what makes `xueni fetch --raw … > letter.md` produce a file that
 * `xueni verify` then confirms: a trailing newline nobody asked for would be
 * one byte of difference between the file and the post, and `verify`
 * forgives only CRLF. The one indulgence is a terminal: when stdout is a TTY
 * nothing is being captured, so a document that ends mid-line gets a newline
 * so the shell prompt does not land on top of the last sentence.
 */
export function printDoc(text) {
  const body = String(text ?? '');
  const tidy = process.stdout.isTTY && body && !body.endsWith('\n') ? '\n' : '';
  process.stdout.write(body + tidy);
}

/**
 * The answer, as JSON. BigInts become plain numbers: every quantity in this
 * app — block heights, post indexes, timestamps — sits far below 2^53, and
 * the archive format (plan §11.1) is specified in plain JSON numbers, so a
 * bundle written here is one the web app can read back.
 */
export function printJson(value) {
  print(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

/** Progress and asides — never part of the answer. */
export function note(text) {
  process.stderr.write(`${text}\n`);
}

/**
 * A message that ends the command. Thrown rather than exiting on the spot so
 * that whatever is half-written gets a chance to unwind, and so that the
 * tests can catch it; bin/xueni.js turns it into stderr plus exit code 1.
 */
export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

export const fail = (message) => {
  throw new CliError(message);
};

/**
 * What went wrong, in the fewest words that still say it. viem wraps a node's
 * answer in several layers of prose; the short message is the useful line.
 */
export const errorText = (err) =>
  String(err?.shortMessage || err?.details || err?.message || err || 'unknown error');
