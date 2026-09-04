// harness.mjs — a chain to test against, and a way to run the tool at it.
//
// THE E2E MOCK NODE IS THIS PACKAGE'S TEST CHAIN. `webapp/test/e2e/rpcServer.mjs`
// already serves the demo worlds as a real JSON-RPC endpoint — Post events as
// ABI-encoded logs, bodies as brotli calldata in publish() transactions,
// receipts, heads, the contract's two views — and it publishes an ORACLE at
// `/__oracle/<scenario>` saying what the answers should be. Reusing it means
// the CLI is checked against exactly the chain the browser tests are checked
// against, and that a change to the fixtures moves both at once.
//
// What it does NOT do is accept transactions, so nothing here tests the
// sending path; see test/publish.test.js.
//
// This file lives under test/support/ rather than beside the tests because
// the runner is pointed at `test/**/*.test.js` (package.json): a support
// module with no tests in it has no business being reported as an empty test
// file on every run, and the glob leaves it out by name.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = join(here, '..', '..');
export const BIN = join(CLI_ROOT, 'bin', 'xueni.js');
const RPC_SERVER = join(CLI_ROOT, '..', 'webapp', 'test', 'e2e', 'rpcServer.mjs');

/** A port nothing is listening on. Asking the kernel is the only honest way. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the mock node and wait until it answers. Returns the handles the
 * tests need: the RPC URL for a chain, the oracle, and a way to stop it.
 */
export async function startNode({ scenario = 'default' } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [RPC_SERVER, String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`the mock node exited with ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/__health`);
      if (res.ok) break;
    } catch {
      // Not listening yet — the only expected failure here.
    }
    if (Date.now() > deadline) throw new Error('the mock node did not start');
    await sleep(50);
  }
  return {
    port,
    base,
    scenario,
    /** The endpoint for one chain, in the form `--rpc` takes. */
    rpc: (chainId) => `${base}/rpc/${scenario}/${chainId}`,
    /** `--rpc` arguments covering every chain the tool reads. */
    rpcArgs: (slugs = { ethereum: 1, taiko: 167000 }) =>
      Object.entries(slugs).flatMap(([slug, id]) => ['--rpc', `${slug}=${base}/rpc/${scenario}/${id}`]),
    /** What the pages — and this tool — must show. */
    oracle: async () => (await fetch(`${base}/__oracle/${scenario}`)).json(),
    stop: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      }),
  };
}

/**
 * Run the CLI as a user would: a real process, real argv, real exit code.
 * Nothing is stubbed, so what the tests assert is what a terminal would show.
 */
export function run(args, { env = {}, cwd = CLI_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      // A clean environment plus whatever the test asked for: PRIVATE_KEY must
      // never leak in from the machine running the tests.
      env: { ...process.env, PRIVATE_KEY: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run the CLI and refuse to carry on if it failed — most tests want this. */
export async function ok(args, options) {
  const result = await run(args, options);
  if (result.code !== 0) {
    throw new Error(`xueni ${args.join(' ')} exited ${result.code}\n${result.stderr}`);
  }
  return result;
}

/** The oracle's posts for one author, newest first, as the CLI should list them. */
export const oraclePostsOf = (oracle, author, chainId = null) =>
  oracle.posts.filter(
    (p) => p.author.toLowerCase() === author.toLowerCase() && (chainId == null || p.chainId === chainId),
  );
