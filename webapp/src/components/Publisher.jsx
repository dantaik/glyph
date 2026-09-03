import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import {
  embedImages,
  publishPost,
  usedImageKeys,
  measurePayload,
  MAX_CALLDATA_BYTES,
} from '../lib/publish';
import { getClient } from '../lib/clients';
import { getReader } from '../lib/data';
import { resolvePublishChain, usePublishChainId } from '../lib/config';
import { useWallet } from '../lib/wallet';
import { chainName, etherscanTxUrl } from '../lib/format';
import { t, useLang } from '../lib/i18n';
import { Check, AlertCircle, Close, ExternalLink } from './Icons';
import ImageUploader from './ImageUploader';
import CostPanel from './CostPanel';
import SectionHeader from './SectionHeader';
import EditorSkeleton from './EditorSkeleton';
import WalletPanel from './WalletPanel';
import { SEGMENT_OFF, SEGMENT_ON } from './formStyles';
import {
  getMarketState,
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
  const [market, setMarket] = useState({ gasPriceWei: null, ethUsd: null });
  useLang(); // the phrases below are read at render time
  const { account, chainId: walletChainId, connect } = useWallet();
  // The chain to publish on: the one picked here, else the wallet's own
  // when Glyph is read on it, else Ethereum (config.js). Reading and
  // writing are separate things: the feed shows every chain, a post goes
  // to one.
  const pickedChain = usePublishChainId();
  const chainId = resolvePublishChain(pickedChain, walletChainId);
  const reader = getReader(chainId);
  const chainMismatch = walletChainId != null && walletChainId !== chainId;

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

  // Poll gas + ETH price every 30s.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const m = await getMarketState(getClient(chainId));
      if (!cancelled) setMarket(m);
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chainId]);

  // --- Cost estimate ---
  // Rough approximation — actual brotli output may differ a little either way.
  const costEstimate = useMemo(() => {
    if (!market.gasPriceWei) return null;
    // payload raw bytes: 3 header + tags + markdown
    const rawBytes =
      3 +
      new TextEncoder().encode(tags.join(',')).length +
      new TextEncoder().encode(markdown).length;
    // brotli q11 on markdown text typically lands at 0.35–0.5
    const estCompressed = Math.max(60, Math.ceil(rawBytes * 0.45));

    const postGas = estimatePublishGas(estCompressed, isFirstPost);
    const postCost = gasToCost(postGas, market.gasPriceWei, market.ethUsd);

    // Image costs: estimate post-processing size at 50 KB if not yet processed
    // (real value depends on the source image; we use a placeholder until uploaded)
    const imageCosts = usedKeys.map((key) => {
      const estBytes = Math.min(MAX_CALLDATA_BYTES, Math.ceil(files[key].size * 0.3));
      const g = estimateImageGas(estBytes);
      return { key, ...gasToCost(g, market.gasPriceWei, market.ethUsd), gas: g };
    });

    const totalGas = postGas + imageCosts.reduce((a, c) => a + c.gas, 0);
    const totalCost = gasToCost(totalGas, market.gasPriceWei, market.ethUsd);

    return {
      postGas,
      postCost,
      imageCosts,
      totalGas,
      totalCost,
      estCompressed,
      // Rough — the exact size is measured with brotli at publish time.
      limitBytes: MAX_CALLDATA_BYTES,
      nearLimit: estCompressed > MAX_CALLDATA_BYTES * 0.9,
    };
  }, [market, tags, markdown, files, usedKeys, isFirstPost]);

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

  const resetDraft = () => {
    setTitle(PLACEHOLDER_TITLE);
    setTags([]);
    setMarkdown(placeholderBody());
    setFiles({});
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
          onProgress: (key, i, total) =>
            setStatusMsg(t('publish.uploadProgress', { index: i, total, key })),
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
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message || t('publish.failed'));
    }
  };

  // --- Render ---
  return (
    <div>
      <WalletPanel
        chainId={chainId}
        picked={pickedChain != null}
        disabled={status === 'processing' || status === 'signing'}
      />

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
          className={`w-full bg-transparent pb-2.5 text-2xl font-bold border-0 border-b
                     focus:outline-none placeholder:text-ink-ghost transition-colors
                     ${titleOver ? 'border-danger' : 'border-edge-strong focus:border-accent'}`}
        />
        {titleOver && (
          <div
            id="post-title-bytes"
            className="text-2xs mt-1 tabular-nums text-danger"
          >
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
          />
        </Suspense>
      </div>
      <p className="mb-10 -mt-6 text-xs text-ink-ghost">
        {t('publish.refHintPrefix')}
        <code className="rounded bg-paper-sunken px-1 py-0.5 text-2xs text-ink-soft">
          {t('publish.refExample')}
        </code>
        {t('publish.refHintSuffix')}
      </p>

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
        <CostPanel estimate={costEstimate} market={market} chainId={chainId} />
      </div>

      <div className="pt-6">
        <p className="mb-4 text-xs text-ink-faint">{t('publish.permanentNotice')}</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {status === 'processing' && statusMsg && (
            <span role="status" className="text-sm text-ink-faint">
              {statusMsg}
            </span>
          )}
          <button
            onClick={handlePublish}
            disabled={
              !canPublish ||
              status === 'processing' ||
              status === 'signing' ||
              chainMismatch
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-2.5 text-sm
                       font-medium text-paper hover:bg-accent-strong disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors"
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
