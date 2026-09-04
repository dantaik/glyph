# Xueni for macOS

The same [Xueni](../README.md) the website is, in a window. It is not a
second app: the shell here builds `webapp/dist` and puts it in a WebKit view,
so the reader, the write tab, the caches and both chains are the code in
`webapp/`, unchanged. What lives in this directory is the window around it
and the three things a WKWebView cannot do on its own.

**Download**: `https://github.com/dantaik/glyph/releases/latest/download/Xueni-macOS.dmg`

## Why Tauri and not Electron

Tauri wraps the WebKit view macOS already has, in a small Rust shell. The
download is around ten megabytes rather than the two hundred an Electron app
carries its own browser for, and there is no bundled browser to keep patched
— which matters for something meant to be kept, not upgraded weekly. The
price is that WebKit is the only engine, and WebKit has two gaps the shell
has to fill. Both are filled below; neither was worth two hundred megabytes.

Windows and Linux are out of scope for now. With Tauri they are a matrix
change in the workflow rather than a port.

## What the shell actually does

- **Encodes WebP.** WebKit cannot encode WebP from a canvas: asked for one it
  hands back PNG bytes, which would go on chain as an image the reader is
  told is WebP. The `transcode_image` command downscales with the `image`
  crate (Lanczos3) and encodes with libwebp instead, and `publish.js` calls
  it whenever it finds itself here. On the web the canvas path stays, with a
  check on the blob's type so the same lie cannot pass there either.
- **Saves files.** A WKWebView has no download manager, so `<a download>`
  does nothing. Every download the app offers — a post as `.md`, an archive,
  the settings export — opens a native save panel instead. The shell may
  write exactly the one file the panel returned and nothing else: the save
  dialog is what widens the file permission, and it widens it to that path.
- **Sends links out.** A link to an explorer or an ENS profile opens in the
  default browser. Followed inside the window it would put the reader in a
  browser with no address bar, no tabs and no way back.
- **Remembers the window** — its size and its position, between launches.
- **Adds ⌘R.** The menu is the ordinary macOS one plus a Reload item, because
  a web app with no way to reload is a strange thing to sit in front of.

Two things it deliberately does not do. It has no updater: once a day it asks
GitHub whether a newer release exists and, if so, shows one dismissible line
in the footer — the download is still the reader's decision. And it does not
route: serving `index.html` for any path that is not a bundled file, the rule
`vercel.json` gives the website, is Tauri's own asset behaviour.

## Building it here

Requires Node 22, a Rust toolchain, and Xcode's command line tools.

```bash
cd desktop && npm install
npm run dev      # the Vite dev server in a window, with hot reload
npm run build    # a universal .dmg in src-tauri/target/.../bundle/dmg/
```

Both start with the web app: `npm run dev` runs Vite's dev server in
`../webapp` and `npm run build` builds it there (`beforeDevCommand` and
`beforeBuildCommand` in `tauri.conf.json`), so the web app's dependencies
have to be installed as well. The fourth script, `tauri`, is the plain CLI —
it is what `tauri-action` reaches for in CI.

To publish from a local build you need a WalletConnect project id — there is
no browser extension inside the app to sign with:

```bash
VITE_WALLETCONNECT_PROJECT_ID=... npm run build
```

Without it the app still builds and reads everything; the write tab says
that this build cannot publish.

The icons come from the web app's own, and are regenerated with
`npm run icon`. That writes a full set for every platform Tauri can target;
only the files `tauri.conf.json` names are kept, and `.gitignore` holds the
rest.

## Testing

```bash
cd src-tauri/transcode && cargo test
```

The image work is a crate of its own, next door to the shell rather than
inside it, for one reason: the shell depends on Tauri, which only compiles
where the system webview libraries are installed, and the transcoding is the
part with logic worth testing. Split out, its tests run on any machine —
Linux CI included — and they are what the workflow runs before building. The
shell itself is compiled by the build, on macOS, where it can be.

The app's behaviour is the web app's behaviour, covered by the Playwright
suite in `webapp/test/e2e`. What is desktop-only — the platform seam, the
save panel, the two image paths — is `webapp/test/unit/platform.test.js`.
There is no WebDriver for Tauri on macOS, so nothing drives the built app;
the workflow checks instead that the DMG holds a signed, universal
`Xueni.app`.

## Releasing

The version lives in two files and they have to agree, or the workflow stops
before it builds anything:

1. Set the same `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Commit it.
3. Tag it — annotated, because the tag's message becomes the release notes:
   ```bash
   git tag -a v0.2.0 -m "What changed in this one."
   git push origin v0.2.0
   ```

`.github/workflows/desktop.yml` takes it from there: about fifteen minutes
later there is a GitHub Release holding the versioned DMG, plus a copy named
`Xueni-macOS.dmg`, which is the name the README's download link uses so that
the link never has to change.

## Signing

Signing and notarisation are optional and want six repository secrets:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. With them the DMG is signed
and notarised and opens like any other application.

Without them the build is ad-hoc signed, and macOS will refuse the first
launch with "Xueni cannot be opened because the developer cannot be
verified". Right-click the app and choose Open, then Open again in the
dialog; macOS remembers the decision. This is Gatekeeper doing its job on an
application whose developer has paid Apple nothing — the bytes are the same
ones this repository built.

## The files

```
package.json              scripts and the one devDependency, the Tauri CLI
src-tauri/
  Cargo.toml              the shell's crate; Cargo.lock beside it pins everything
  tauri.conf.json         product name, identifier, the window, the macOS bundle
  build.rs                tauri-build
  capabilities/default.json  what the web side is allowed to ask the shell for
  icons/                  generated from webapp/public/icon.svg
  src/main.rs             three lines
  src/lib.rs              plugins, the menu, the transcode command
  transcode/              the image crate, and the only tests
```
