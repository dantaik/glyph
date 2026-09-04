#!/usr/bin/env node
// xueni.js — the entry point: pick a command, run it, turn a refusal into an
// exit code.
//
// Everything a command needs to say is said by the command; this file's only
// judgement is that an error message belongs on stderr and that a failure
// exits 1, so that `xueni verify … && deploy` and `xueni fetch … > post.md`
// both behave the way a shell expects. A CliError is a sentence written for
// the person reading it (out.js); anything else is a bug or a node behaving
// badly, and its stack is worth keeping when XUENI_DEBUG is set.

import * as author from '../src/commands/author.js';
import * as exportCmd from '../src/commands/export.js';
import * as fetchCmd from '../src/commands/fetch.js';
import * as publish from '../src/commands/publish.js';
import * as verify from '../src/commands/verify.js';
import { msg, usage } from '../src/messages.js';
import { CliError, errorText, note, print } from '../src/out.js';

// `xueni author … | head -3` closes the pipe as soon as it has its three
// lines, and the next write raises EPIPE. That is the reader saying "enough",
// not a failure: a tool that dumps a stack trace there is a tool that cannot
// be piped, so stop quietly, the way every well-behaved Unix program does.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err?.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

const COMMANDS = {
  publish,
  fetch: fetchCmd,
  author,
  export: exportCmd,
  verify,
};

async function main(argv) {
  const [name, ...rest] = argv;
  // Nothing at all, or `--help` before any command, is the overview.
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    print(usage);
    return;
  }
  const command = COMMANDS[name];
  if (!command) {
    note(name.startsWith('-') ? msg.noCommand : msg.unknownCommand(name));
    process.exitCode = 1;
    return;
  }
  await command.run(rest);
}

try {
  await main(process.argv.slice(2));
} catch (err) {
  note(err instanceof CliError ? err.message : errorText(err));
  // The cause is where a chain read's real error went (chain.js), so debugging
  // wants both stacks or neither.
  if (process.env.XUENI_DEBUG) note([err.stack, err.cause?.stack].filter(Boolean).join('\n'));
  process.exitCode = 1;
}
