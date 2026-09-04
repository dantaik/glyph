// app.mjs — what every spec needs: the app pointed at the mock node, the
// outside world kept out, the oracle, and the wallet.
import { walletScript } from './wallet.mjs';

export const RPC = process.env.GLYPH_RPC_URL ?? 'http://127.0.0.1:8545';
export const ETH = 1;
export const TAIKO = 167000;

/** The endpoint lists the app will read, for a scenario. */
export const rpcLists = (scenario) => ({
  [ETH]: [`${RPC}/rpc/${scenario}/${ETH}`],
  [TAIKO]: [`${RPC}/rpc/${scenario}/${TAIKO}`],
});

/**
 * Point the page at the mock node (through the app's own endpoint setting),
 * block every real host, and optionally install a wallet — all before the
 * app loads.
 */
export async function prepare(page, { scenario = 'default', wallet = null, storage = {} } = {}) {
  await page.route(/coingecko\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ethereum":{"usd":2500}}' }),
  );
  await page.route(
    (u) => /drpc\.org|taiko\.xyz|mevblocker\.io|llamarpc|ankr\.com|publicnode|etherscan|taikoscan/.test(u.hostname),
    (route) => route.abort(),
  );
  await page.addInitScript(
    ({ rpcs, storage }) => {
      localStorage.setItem('glyph.rpcs.v1', JSON.stringify(rpcs));
      localStorage.setItem('glyph.log.v1', '0');
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    },
    { rpcs: rpcLists(scenario), storage },
  );
  if (wallet) await page.addInitScript(walletScript(wallet));
}

/** What the mock worlds hold: posts in merged order (with hrefs), per-author counts. */
export async function oracle(request, scenario = 'default') {
  const res = await request.get(`${RPC}/__oracle/${scenario}`);
  return res.json();
}

export async function calls(request, scenario, chainId) {
  const res = await request.get(`${RPC}/__calls/${scenario}${chainId ? `?chain=${chainId}` : ''}`);
  return res.json();
}

export const reset = (request, scenario) => request.post(`${RPC}/__reset/${scenario}`);

/** The post links on the page in document order, once each. */
export async function postHrefs(page) {
  const hrefs = await page.locator('main a[href*="/tx/"]').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  return [...new Set(hrefs)];
}

export const chip = (page, name) => page.locator(`main a[title="${name} only"]`);
