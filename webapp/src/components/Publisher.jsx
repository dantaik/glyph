import { useCallback, useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import {
  embedImages,
  hashProcessedImage,
  nextImageKeys,
  publishPost,
  usedImageKeys,
  measurePayload,
  MAX_CALLDATA_BYTES,
} from '../lib/publish';
import { knownImage } from '../lib/imageLedger';
import { getClient } from '../lib/clients';
import { READ_CHAIN_IDS } from '../lib/config';
import { getReader } from '../lib/data';
import { resolvePublishChain, savePublishChainId, usePublishChainId } from '../lib/config';
import { useWallet } from '../lib/wallet';
import { chainName, etherscanTxUrl, fmtRelTime } from '../lib/format';
import { clearDraft, isEmptyDraft, loadDraft, saveDraft, takePendingDraftPatch } from '../lib/drafts';
import { t, useLang } from '../lib/i18n';
import { Check, AlertCircle, Close, ExternalLink } from './Icons';
import ImageUploader from './ImageUploader';
import CostPanel from './CostPanel';
import SectionHeader from './SectionHeader';
import EditorSkeleton from './EditorSkeleton';
import WalletPanel from './WalletPanel';
import { BTN_PRIMARY, BTN_QUIET, SEGMENT_OFF, SEGMENT_ON } from './formStyles';
import { Body, Meta, Micro } from './Text';
import {
  getMarketStates,
  estimatePublishGas,
  estimateImageGas,
  gasToCost,
} from '../lib/price';
import {
  titleByteLength,
  TITLE_MAX_BYTES,
} from '../lib/title';

// CodeMirror is heavy — split it out of the main bundle; it loads when the
// write tab first renders.
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));

const PLACEHOLDER_TITLE = '';

/**
 * How long after the last keystroke the draft is written. Long enough that
 * typing a sentence is one write, short enough that nothing is lost to a
 * closed tab.
 */
const DRAFT_SAVE_DELAY_MS = 500;

/**
 * The starting draft, in the language the tab was opened in. Read as a
 * function rather than a constant: it seeds state, so a later language
 * change must not rewrite what someone has already started writing.
 */
const placeholderBody = () => t('publish.placeholderBody');

export default function Publisher() {
  const [title, setTitle] = useState(PLACEHOLDER_TITLE);
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState([]);
  const [markdown, setMarkdown] = useState(placeholderBody);
  const [files, setFiles] = useState({});
  const [view, setView] = useState('edit'); // 'edit' | 'preview'
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [isFirstPost, setIsFirstPost] = useState(true);
  // One entry per chain the app reads: the draft's cost can then be shown
  // on the chain it is going to AND on the others, which is the second big
  // lever on what a post costs.
  const [markets, setMarkets] = useState({});
  // The last day of base fees on the publish chain (gasHistory.js).
  const [history, setHistory] = useState([]);
  // Front-matter beyond the tags — the language, the relations. Empty until
  // the Relations fields fill it; carried in the draft either way.
  const [meta, setMeta] = useState({});
  // Set when what is on screen came back from storage: drives the notice.
  const [restoredAt, setRestoredAt] = useState(null);
  useLang(); // the phrases below are read at render time
  const { account, chainId: walletChainId, connect } = useWallet();
  // The chain to publish on: the one picked here, else the wallet's own
  // when Xueni is read on it, else Ethereum (config.js). Reading and
  // writing are separate things: the feed shows every chain, a post goes
  // to one.
  const pickedChain = usePublishChainId();
  const chainId = resolvePublishChain(pickedChain, walletChainId);
  const reader = getReader(chainId);
  // The market on the chain this draft is going to; the rest are what the
  // comparison lines are made of.
  const market = markets[chainId] ?? { gasPriceWei: null, ethUsd: null };
  const chainMismatch = walletChainId != null && walletChainId !== chainId;

  // --- The draft, kept across the tab ------------------------------------
  //
  // Read once on mount, written a moment after every change. `hydrated`
  // gates the write: without it the empty form this component starts with
  // would overwrite the stored letter in the instant before the read
  // returns.
  const hydrated = useRef(false);
  const skipSave = useRef(false);
  // Bumped whenever the draft is deliberately forgotten. A save scheduled
  // before that moment must not land after it: publishing takes a second or
  // two, a debounced write is half a second out, and on a busy machine the
  // timer can fire after the publish has already cleared the draft — which
  // would put a letter that is now on chain back in the editor.
  const draftEpoch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadDraft().catch(() => null);
      // "Reply to this post" hands over its fields in memory (drafts.js).
      const patch = takePendingDraftPatch();
      if (cancelled) return;
      const restoring = Boolean(stored) && !isEmptyDraft(stored);
      if (restoring) {
        setTitle(stored.title ?? '');
        setTags(stored.tags ?? []);
        setMarkdown(stored.markdown ?? '');
        setFiles(stored.files ?? {});
        setMeta(stored.meta ?? {});
        setRestoredAt(stored.updatedAt ?? null);
      }
      if (patch) {
        if (patch.title != null) setTitle(patch.title);
        if (patch.markdown != null) setMarkdown(patch.markdown);
        if (patch.tags != null) setTags(patch.tags);
        if (patch.meta) setMeta((cur) => ({ ...cur, ...patch.meta }));
      }
      hydrated.current = true;
      // Restoring is not itself a change worth writing back: saving here
      // would only move `updatedAt` forward, and the notice would claim the
      // letter was written a moment ago. A patch IS a change, so it saves.
      if (restoring && !patch) skipSave.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return undefined;
    if (skipSave.current) {
      skipSave.current = false;
      return undefined;
    }
    const draft = { title, tags, markdown, meta, files };
    const epoch = draftEpoch.current;
    const id = setTimeout(() => {
      if (draftEpoch.current !== epoch) return; // published or discarded since
      // An untouched form is not a draft: it is never stored, so opening the
      // write tab and leaving does not leave something to restore.
      if (isEmptyDraft(draft)) clearDraft().catch(() => {});
      else saveDraft(draft).catch(() => {});
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [title, tags, markdown, meta, files]);

  // Stable preview URLs for uploaded files — shared by the dropzone
  // thumbnails and the editor's live preview pane.
  const filePreviews = useMemo(() => {
    const map = {};
    for (const [key, file] of Object.entries(files)) {
      map[key] = URL.createObjectURL(file);
    }
    return map;
  }, [files]);
  useEffect(
    () => () =>
      Object.values(filePreviews).forEach((url) => URL.revokeObjectURL(url)),
    [filePreviews],
  );

  const titleBytes = titleByteLength(title);
  const titleOver = titleBytes > TITLE_MAX_BYTES;

  /**
   * Parse upload:KEY refs from markdown. The key charset mirrors the
   * file-key sanitizer in ImageUploader (ASCII \w plus `-` and CJK).
   */
  const uploadRefs = useMemo(
    () => [...markdown.matchAll(/upload:([A-Za-z0-9_\u4e00-\u9fff-]+)/g)].map((m) => m[1]),
    [markdown],
  );

  // Only the images the body actually displays are published — an attachment
  // whose ref was deleted from the draft would be a transaction for bytes no
  // reader ever sees. Drives the cost panel as well, so the estimate matches
  // what publishing will really sign.
  const usedKeys = useMemo(() => usedImageKeys(markdown, files), [markdown, files]);

  // --- Images already on chain -------------------------------------------
  //
  // An attached image whose processed bytes this browser has already
  // published on this chain costs nothing to use again (imageLedger.js), and
  // the estimate should say so before the writer commits. Hashing means
  // processing the image, so each File is hashed once and remembered.
  const [alreadyOnChain, setAlreadyOnChain] = useState({});
  const hashes = useRef(new WeakMap()); // File -> hash

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = {};
      for (const key of usedKeys) {
        const file = files[key];
        if (!file) continue;
        try {
          let hash = hashes.current.get(file);
          if (!hash) {
            hash = (await hashProcessedImage(file)).hash;
            hashes.current.set(file, hash);
          }
          out[key] = Boolean(knownImage(chainId, hash));
        } catch {
          // A browser that cannot process the image here will say so
          // properly at publish time; the estimate just assumes it is new.
          out[key] = false;
        }
      }
      if (!cancelled) setAlreadyOnChain(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [usedKeys, files, chainId]);

  /** Images pasted or dropped into the editor: attached, and named. */
  const filesRef = useRef(files);
  filesRef.current = files;
  const addImagesFromEditor = useCallback((incoming) => {
    const keys = nextImageKeys(filesRef.current, incoming.length);
    setFiles((cur) => {
      const next = { ...cur };
      keys.forEach((key, i) => {
        next[key] = incoming[i];
      });
      return next;
    });
    return keys;
  }, []);

  /** On-chain image references, resolved for the preview pane. */
  const resolveEth = useCallback((md) => reader.resolveImages(md), [reader]);

  // First-post status (drives the cold-SSTORE estimate), from the shared
  // wallet store instead of a one-off eth_accounts poll.
  useEffect(() => {
    if (!account) {
      setIsFirstPost(true);
      return undefined;
    }
    let cancelled = false;
    reader
      .count(account)
      .then((c) => !cancelled && setIsFirstPost(c === 0n))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account, reader]);

  // Poll gas + ETH price every 30s, for every chain at once — the price is
  // one lookup shared between them, and the comparison needs them all.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const m = await getMarketStates(
        READ_CHAIN_IDS.map((id) => ({ chainId: id, client: getClient(id) })),
      );
      if (!cancelled) setMarkets(m);
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The day's base fees for the chain being published to. Held for ten
  // minutes by the reader, so switching back and forth costs nothing.
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    reader
      .baseFees()
      .then((h) => !cancelled && setHistory(h))
      .catch(() => {}); // a node that will not serve headers just hides the line
    return () => {
      cancelled = true;
    };
  }, [reader]);

  // --- Cost estimate ---
  //
  // The gas this draft would burn, which is the same wherever it is sent —
  // kept apart from the price, so the same figure can be costed on every
  // chain and at any hour of the day.
  // Rough approximation — actual brotli output may differ a little either way.
  const gas = useMemo(() => {
    // payload raw bytes: 3 header + tags + markdown
    const rawBytes =
      3 +
      new TextEncoder().encode(tags.join(',')).length +
      new TextEncoder().encode(markdown).length;
    // brotli q11 on markdown text typically lands at 0.35–0.5
    const estCompressed = Math.max(60, Math.ceil(rawBytes * 0.45));
    const postGas = estimatePublishGas(estCompressed, isFirstPost);
    // The real size depends on the source image; a third of the original is
    // a fair guess until it has actually been processed.
    const images = usedKeys.map((key) => ({
      key,
      // Already on chain: the reference costs nothing to write.
      reused: alreadyOnChain[key] === true,
      gas: alreadyOnChain[key]
        ? 0
        : estimateImageGas(Math.min(MAX_CALLDATA_BYTES, Math.ceil(files[key].size * 0.3))),
    }));
    return {
      estCompressed,
      postGas,
      images,
      totalGas: postGas + images.reduce((a, c) => a + c.gas, 0),
    };
  }, [tags, markdown, files, usedKeys, isFirstPost, alreadyOnChain]);

  const costEstimate = useMemo(() => {
    if (!market.gasPriceWei) return null;
    const price = (g) => gasToCost(g, market.gasPriceWei, market.ethUsd);
    return {
      postGas: gas.postGas,
      postCost: price(gas.postGas),
      imageCosts: gas.images.map(({ key, gas: g, reused }) => ({ key, gas: g, reused, ...price(g) })),
      totalGas: gas.totalGas,
      totalCost: price(gas.totalGas),
      estCompressed: gas.estCompressed,
      // Rough — the exact size is measured with brotli at publish time.
      limitBytes: MAX_CALLDATA_BYTES,
      nearLimit: gas.estCompressed > MAX_CALLDATA_BYTES * 0.9,
    };
  }, [market, gas]);

  /** The same draft, priced on the chains it is NOT going to. */
  const comparisons = useMemo(
    () =>
      READ_CHAIN_IDS.filter((id) => id !== chainId).map((id) => {
        const m = markets[id];
        return {
          chainId: id,
          cost: m?.gasPriceWei ? gasToCost(gas.totalGas, m.gasPriceWei, m.ethUsd) : null,
        };
      }),
    [chainId, markets, gas],
  );

  // --- Tag handling ---
  // Delimiters: Enter, half/full-width comma (,) and semicolon (;).
  // addTagFromInput splits whatever is in the box, so a pasted string like
  // "home, hills; sea" becomes three tags.
  const addTagFromInput = () => {
    const parts = tagsInput
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setTagsInput('');
      return;
    }
    const next = [...tags];
    for (const tag of parts) {
      if (!next.includes(tag)) next.push(tag);
    }
    setTags(next);
    setTagsInput('');
  };
  const handleTagKey = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === 'Backspace' && !tagsInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  // --- Connect wallet helper ---
  const ensureWallet = async () => {
    if (account) return account;
    const a = await connect();
    if (!a) throw new Error(t('publish.noWalletConnected'));
    return a;
  };

  // --- Publish ---
  const canPublish =
    !titleOver &&
    title.trim() &&
    markdown.trim() &&
    uploadRefs.every((k) => files[k]);

  /** Forget the stored draft, and any save still on its way to it. */
  const forgetDraft = () => {
    draftEpoch.current += 1;
    clearDraft().catch(() => {});
  };

  /** Back to an empty form, and nothing left in storage. */
  const emptyTheForm = () => {
    forgetDraft();
    setTitle(PLACEHOLDER_TITLE);
    setTags([]);
    setTagsInput('');
    setMarkdown(placeholderBody());
    setFiles({});
    setMeta({});
    setRestoredAt(null);
  };

  const resetDraft = () => {
    emptyTheForm();
    setStatus('idle');
    setStatusMsg('');
    setTxHash(null);
  };

  const handlePublish = async () => {
    const missingRefs = uploadRefs.filter((k) => !files[k]);
    if (missingRefs.length > 0) {
      setStatus('error');
      setStatusMsg(t('publish.missingImages', { keys: missingRefs.join(', ') }));
      return;
    }
    try {
      await ensureWallet();
      setStatus('processing');

      // Images are uploaded one paid transaction at a time, so check the
      // body against the transaction ceiling while failing is still free.
      setStatusMsg(t('publish.compressing'));
      const size = await measurePayload({ tags, markdown, files });
      if (!size.ok) {
        const kb = (n) => `${Math.ceil(n / 1024)} KB`;
        setStatus('error');
        setStatusMsg(t('publish.bodyTooBig', { size: kb(size.bytes), limit: kb(size.limit) }));
        return;
      }

      let finalMd = markdown;
      if (usedKeys.length > 0) {
        setStatusMsg(t('publish.uploadingToChain'));
        finalMd = await embedImages(markdown, files, {
          chainId,
          onProgress: (key, i, total, { reused } = {}) =>
            setStatusMsg(
              t(reused ? 'publish.reusingImage' : 'publish.uploadProgress', { index: i, total, key }),
            ),
        });
        setMarkdown(finalMd);
      }

      setStatus('signing');
      setStatusMsg(t('publish.confirmInWallet'));
      const hash = await publishPost({
        chainId,
        title: title.trim(),
        tags,
        markdown: finalMd,
      });
      setTxHash(hash);
      setStatus('done');
      setStatusMsg(t('publish.done'));
      // It is on chain now; keeping a copy of it here would only offer to
      // restore something already published.
      forgetDraft();
      setRestoredAt(null);
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message || t('publish.failed'));
    }
  };

  // While images are being paid for, or a publish is waiting to be signed,
  // leaving costs money or loses a signature. Every other moment is covered
  // by the autosave above, so a warning then would be noise.
  const inFlight = status === 'processing' || status === 'signing';
  useEffect(() => {
    if (!inFlight) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = ''; // older browsers want this to show their own prompt
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [inFlight]);

  // --- Render ---
  return (
    <div>
      <WalletPanel
        chainId={chainId}
        picked={pickedChain != null}
        disabled={status === 'processing' || status === 'signing'}
      />

      {restoredAt != null && (
        <div
          role="status"
          data-draft-restored=""
          className="mb-8 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-paper-raised px-4 py-2.5"
        >
          <Meta as="span">
            {t('draft.restored', {
              when: fmtRelTime(new Date(restoredAt), { exact: true }) ?? '',
            })}
          </Meta>
          <button type="button" onClick={emptyTheForm} className={BTN_QUIET}>
            {t('draft.discard')}
          </button>
        </div>
      )}

      <SectionHeader label={t('publish.titleHeading')} />
      <div className="mb-10">
        <input
          id="post-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('publish.titlePlaceholder')}
          aria-invalid={titleOver}
          aria-describedby="post-title-bytes"
          className={`w-full border-0 border-b bg-transparent pb-2.5 text-display transition-colors
                     placeholder:text-ink-ghost focus:outline-none
                     ${titleOver ? 'border-danger' : 'border-edge-strong focus:border-accent'}`}
        />
        {titleOver && (
          <div id="post-title-bytes" className="mt-1 text-2xs tabular-nums text-danger">
            {t('publish.titleTooLong')}
          </div>
        )}
      </div>

      <SectionHeader label={t('publish.tagsHeading')} />
      <div className="mb-10">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-edge-strong bg-paper-raised px-3 py-2 focus-within:border-accent transition-colors">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2.5 py-0.5 text-xs text-accent-strong"
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((x) => x !== tag))}
                aria-label={t('publish.removeTag', { tag })}
                className="hover:text-danger transition-colors"
              >
                <Close size={12} />
              </button>
            </span>
          ))}
          <input
            id="post-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={handleTagKey}
            onBlur={addTagFromInput}
            placeholder={tags.length === 0 ? t('publish.tagsPlaceholder') : ''}
            className="flex-1 min-w-[6rem] bg-transparent text-sm outline-none placeholder:text-ink-ghost"
          />
        </div>
      </div>

      <SectionHeader
        label={t('publish.bodyHeading')}
        right={
          <div
            role="group"
            aria-label={t('publish.editorView')}
            className="inline-flex rounded-full border border-edge p-0.5 gap-0.5"
          >
            <button
              type="button"
              onClick={() => setView('edit')}
              aria-pressed={view === 'edit'}
              className={view === 'edit' ? SEGMENT_ON : SEGMENT_OFF}
            >
              {t('publish.edit')}
            </button>
            <button
              type="button"
              onClick={() => setView('preview')}
              aria-pressed={view === 'preview'}
              className={view === 'preview' ? SEGMENT_ON : SEGMENT_OFF}
            >
              {t('publish.preview')}
            </button>
          </div>
        }
      />
      <div className="mb-10">
        <Suspense fallback={<EditorSkeleton height="26rem" />}>
          <MarkdownEditor
            value={markdown}
            onChange={setMarkdown}
            mode={view}
            disabled={status === 'processing'}
            height="26rem"
            previewUrls={filePreviews}
            resolveEth={resolveEth}
            onAddImages={addImagesFromEditor}
          />
        </Suspense>
      </div>
      <Meta className="-mt-6 mb-10">
        {t('publish.refHintPrefix')}
        <Micro as="code" className="rounded bg-paper-sunken px-1 py-0.5">
          {t('publish.refExample')}
        </Micro>
        {t('publish.refHintSuffix')}
      </Meta>

      <SectionHeader label={t('publish.imagesHeading')} />
      <div className="mb-10">
        <ImageUploader
          files={files}
          uploadRefs={uploadRefs}
          usedKeys={usedKeys}
          onChange={setFiles}
          disabled={status === 'processing'}
          previewUrls={filePreviews}
        />
      </div>

      <SectionHeader label={t('publish.costHeading')} />
      <div className="mb-6">
        <CostPanel
          estimate={costEstimate}
          market={market}
          chainId={chainId}
          history={history}
          comparisons={comparisons}
          onPublishThere={savePublishChainId}
        />
      </div>

      <div className="pt-6">
        <Meta className="mb-4">{t('publish.permanentNotice')}</Meta>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {status === 'processing' && statusMsg && (
            <Body as="span" role="status">
              {statusMsg}
            </Body>
          )}
          <button
            onClick={handlePublish}
            disabled={
              !canPublish ||
              status === 'processing' ||
              status === 'signing' ||
              chainMismatch
            }
            className={BTN_PRIMARY}
          >
            {(status === 'processing' || status === 'signing') && (
              <span
                className="h-4 w-4 rounded-full border-2 border-edge-strong border-t-accent animate-spin"
                aria-hidden="true"
              />
            )}
            {status === 'processing'
              ? t('publish.uploadingImages')
              : status === 'signing'
                ? t('publish.confirmInWallet')
                : t('publish.button')}
          </button>
        </div>

        {status === 'error' && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="break-all">{statusMsg}</span>
          </div>
        )}

        {status === 'done' && txHash && (
          <div className="mt-4 rounded-lg bg-success-wash px-4 py-3 text-sm text-success">
            <div className="flex flex-wrap items-center gap-2">
              <Check size={16} className="shrink-0" />
              <span className="font-medium">{t('publish.publishedTo', { chain: chainName(chainId) })}</span>
              <a
                href={etherscanTxUrl(txHash, chainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-accent transition-colors"
              >
                {txHash.slice(0, 10)}…
                <ExternalLink size={12} />
              </a>
            </div>
            <p className="mt-1 text-xs">{t('publish.waitForBlock')}</p>
            <button
              type="button"
              onClick={resetDraft}
              className="-ml-3 mt-2 rounded-lg px-3 py-1.5 text-sm text-accent hover:text-accent-strong hover:bg-paper-sunken transition-colors"
            >
              {t('publish.writeAnother')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
