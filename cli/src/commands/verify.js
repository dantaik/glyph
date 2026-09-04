// verify.js — is this file what the chain holds?
//
// The question a backup exists to answer. A post is immutable, so a file
// that came out of `xueni export` or a browser's "Download .md" either still
// matches the chain byte for byte or has been changed since — and knowing
// which, without reading both by eye, is what makes a directory of `.md`
// files trustworthy years later. Exit code 0 or 1 with a diff, so it drops
// into a cron job or a CI step with nothing around it.
//
// One normalisation, and only one: CRLF becomes LF on both sides. An editor
// on Windows rewrites every line ending in a file it saves, and that is not
// a change to the letter — but a changed word is, so nothing else is
// forgiven, not trailing whitespace and not a missing final newline.

import { readFileSync } from 'node:fs';
import { parsePostArg, readArgs, readRpcOverrides, resolveChain } from '../args.js';
import { onChain } from '../chain.js';
import { unifiedDiff } from '../diff.js';
import { help, msg } from '../messages.js';
import { fail, note, print, printJson } from '../out.js';
import { readPost, readersFor } from '../walk.js';

export const OPTIONS = {};

/** The one difference that is not a difference. */
export const normalise = (text) => String(text ?? '').replace(/\r\n/g, '\n');

export async function run(argv) {
  const { values, positionals } = readArgs(argv, OPTIONS);
  if (values.help) return print(help.verify);

  // `verify <file> <chain> <post>`, or `--chain <chain>` with the post alone —
  // see fetch.js.
  const [file, second, third] = positionals;
  if (!file) fail(msg.needsFile('verify'));
  const chain = third == null ? values.chain : second;
  const postArg = third ?? second;
  if (!chain || !postArg) fail(msg.needsPost('verify'));
  const chainId = resolveChain(chain, { command: 'verify' });
  const post = parsePostArg(postArg);

  let onDisk;
  try {
    onDisk = readFileSync(file, 'utf8');
  } catch (err) {
    fail(`${file}: ${err.message}`);
  }

  const [reader] = readersFor(chainId, readRpcOverrides(values.rpc));
  const { body } = await onChain(reader.name, () => readPost(reader, post));

  const mine = normalise(onDisk);
  const theirs = normalise(body.text);
  const match = mine === theirs;
  // The chain is the original, so it is the `-` side: the diff reads as what
  // would have to change in the file to make it the post again.
  const diff = match ? '' : unifiedDiff(theirs, mine, { labels: [`${post.txHash} (chain)`, file] });

  if (values.json) {
    printJson({
      match,
      file,
      chainId,
      chain: reader.slug,
      txHash: post.txHash,
      eventIndex: post.eventIndex,
      diff,
    });
  } else if (match) {
    print(msg.verifyMatch(file, post.txHash));
  } else {
    print(diff);
    note(msg.verifyDiffer(file, post.txHash));
  }
  // The answer IS the exit code — a script should not have to read the words.
  if (!match) process.exitCode = 1;
}
