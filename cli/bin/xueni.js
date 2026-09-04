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
  if (process.env.XUENI_DEBUG && !(err instanceof CliError)) note(err.stack ?? '');
  process.exitCode = 1;
}
