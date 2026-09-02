import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { embedImages, publishPost } from '../lib/publish';
import { client } from '../lib/blogReader';
import { getAuthorCount } from '../lib/data';
import { useWallet } from '../lib/wallet';
import { CHAIN_ID } from '../lib/config';
import ImageUploader from './ImageUploader';
import { etherscanTxUrl } from '../lib/format';
import { Check, AlertCircle, Close, ExternalLink } from './Icons';
import {
  getMarketState,
  estimatePublishGas,
  estimateImageGas,
  gasToCost,
  fmtEth,
  fmtUsd,
  fmtGwei,
} from '../lib/price';
import {
  titleByteLength,
  TITLE_MAX_BYTES,
} from '../lib/title';

// CodeMirror is heavy — split it out of the main bundle; it loads when the
// write tab first renders.
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));

const PLACEHOLDER_TITLE = '';
const PLACEHOLDER_MD = `# 小标题

写点什么...

把图片拖入下方区域或点击上传；点击图片或名称即可复制引用，粘贴到正文。`;

const SEGMENT_ON = 'rounded-full px-2.5 py-1 text-xs transition-colors bg-paper-sunken text-ink font-medium';
const SEGMENT_OFF = 'rounded-full px-2.5 py-1 text-xs transition-colors text-ink-faint hover:text-ink';

export default function Publisher() {
  const [title, setTitle] = useState(PLACEHOLDER_TITLE);
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState([]);
  const [markdown, setMarkdown] = useState(PLACEHOLDER_MD);
  const [files, setFiles] = useState({});
  const [view, setView] = useState('edit'); // 'edit' | 'preview'
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [isFirstPost, setIsFirstPost] = useState(true);
  const [market, setMarket] = useState({ gasPriceWei: null, ethUsd: null });
  const { account, chainId: walletChainId, connect } = useWallet();
  const chainMismatch = walletChainId != null && walletChainId !== CHAIN_ID;
  const chainLabel =
    { 1: '以太坊', 11155111: 'Sepolia 测试网', 167000: 'Taiko 主网', 167013: 'Taiko Hoodi 测试网' }[CHAIN_ID] ||
    `链 ${CHAIN_ID}`;

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

  // First-post status (drives the cold-SSTORE estimate), from the shared
  // wallet store instead of a one-off eth_accounts poll.
  useEffect(() => {
    if (!account) {
      setIsFirstPost(true);
      return undefined;
    }
    let cancelled = false;
    getAuthorCount(account)
      .then((c) => !cancelled && setIsFirstPost(c === 0n))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account]);

  // Poll gas + ETH price every 30s.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const m = await getMarketState(client);
      if (!cancelled) setMarket(m);
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
    const imageEntries = Object.entries(files);
    const imageCosts = imageEntries.map(([key, file]) => {
      const estBytes = Math.min(200_000, Math.ceil(file.size * 0.3));
      const g = estimateImageGas(estBytes);
      return { key, ...gasToCost(g, market.gasPriceWei, market.ethUsd), gas: g };
    });

    const totalGas = postGas + imageCosts.reduce((a, c) => a + c.gas, 0);
    const totalCost = gasToCost(totalGas, market.gasPriceWei, market.ethUsd);

    return { postGas, postCost, imageCosts, totalGas, totalCost, estCompressed };
  }, [market, tags, markdown, files, isFirstPost]);

  // --- Tag handling ---
  // Delimiters: Enter, half/full-width comma (,) and semicolon (;).
  // addTagFromInput splits whatever is in the box, so pasted strings
  // like "家，山；海" become three tags.
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
    for (const t of parts) {
      if (!next.includes(t)) next.push(t);
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
    if (!a) throw new Error('未连接钱包');
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
    setMarkdown(PLACEHOLDER_MD);
    setFiles({});
    setStatus('idle');
    setStatusMsg('');
    setTxHash(null);
  };

  const handlePublish = async () => {
    const missingRefs = uploadRefs.filter((k) => !files[k]);
    if (missingRefs.length > 0) {
      setStatus('error');
      setStatusMsg(`图片未上传: ${missingRefs.join(', ')}`);
      return;
    }
    try {
      await ensureWallet();
      setStatus('processing');
      let finalMd = markdown;
      if (Object.keys(files).length > 0) {
        setStatusMsg('正在上传图片到链上…');
        finalMd = await embedImages(markdown, files, {
          onProgress: (key, i, total) =>
            setStatusMsg(`正在上传图片（${i}/${total}）：${key}`),
        });
        setMarkdown(finalMd);
      }

      setStatus('signing');
      setStatusMsg('请在钱包中确认…');
      const hash = await publishPost({
        title: title.trim(),
        tags,
        markdown: finalMd,
      });
      setTxHash(hash);
      setStatus('done');
      setStatusMsg('发布成功！');
    } catch (err) {
      setStatus('error');
      setStatusMsg(err.message || '发布失败');
    }
  };

  // --- Render ---
  return (
    <div>
      {/* Title */}
      <div className="mb-7">
        <label
          htmlFor="post-title"
          className="block text-xs tracking-label text-ink-faint mb-1.5"
        >
          标题
        </label>
        <input
          id="post-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="周末爬山"
          aria-invalid={titleOver}
          aria-describedby="post-title-bytes"
          className={`w-full bg-transparent pb-2.5 font-serif text-2xl font-bold border-0 border-b
                     focus:outline-none placeholder:text-ink-ghost transition-colors
                     ${titleOver ? 'border-danger' : 'border-edge-strong focus:border-accent'}`}
        />
        {titleOver && (
          <div
            id="post-title-bytes"
            className="text-2xs mt-1 tabular-nums text-danger"
          >
            标题太长，无法编码为 bytes32
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="mb-7">
        <label
          htmlFor="post-tags"
          className="block text-xs tracking-label text-ink-faint mb-1.5"
        >
          标签
        </label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-edge-strong bg-paper-raised px-3 py-2 focus-within:border-accent transition-colors">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2.5 py-0.5 text-xs text-accent-strong"
            >
              {t}
              <button
                type="button"
                onClick={() => setTags(tags.filter((x) => x !== t))}
                aria-label={`移除标签 ${t}`}
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
            placeholder={tags.length === 0 ? '回车、逗号或分号分隔' : ''}
            className="flex-1 min-w-[6rem] bg-transparent text-sm outline-none placeholder:text-ink-ghost"
          />
        </div>
      </div>

      {/* Editor + live preview */}
      <div className="mb-7">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs tracking-label text-ink-faint">正文（Markdown）</span>
          <div
            role="group"
            aria-label="编辑器视图"
            className="inline-flex rounded-full border border-edge p-0.5 gap-0.5"
          >
            <button
              type="button"
              onClick={() => setView('edit')}
              aria-pressed={view === 'edit'}
              className={view === 'edit' ? SEGMENT_ON : SEGMENT_OFF}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setView('preview')}
              aria-pressed={view === 'preview'}
              className={view === 'preview' ? SEGMENT_ON : SEGMENT_OFF}
            >
              预览
            </button>
          </div>
        </div>
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

      {/* Image upload */}
      <div className="mb-7">
        <span className="block text-xs tracking-label text-ink-faint mb-1.5">
          图片（使用 upload:KEY 引用）
        </span>
        <ImageUploader
          files={files}
          uploadRefs={uploadRefs}
          onChange={setFiles}
          disabled={status === 'processing'}
          previewUrls={filePreviews}
        />
      </div>

      {/* Cost estimate */}
      <CostPanel estimate={costEstimate} market={market} chainId={CHAIN_ID} />

      <p className="mt-4 text-xs text-ink-faint">
        一经发布，将永久刻入 {chainLabel}，不可修改、不可删除。
      </p>

      {/* Publish button + live status */}
      <div className="mt-4 flex flex-wrap items-center gap-4">
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
            ? '正在上传图片…'
            : status === 'signing'
            ? '请在钱包中确认…'
            : '发布到链上'}
        </button>

        {status === 'processing' && statusMsg && (
          <span role="status" className="text-sm text-ink-faint">
            {statusMsg}
          </span>
        )}
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
            <span className="font-medium">已发布到链上</span>
            <a
              href={etherscanTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2 hover:text-accent transition-colors"
            >
              {txHash.slice(0, 10)}…
              <ExternalLink size={12} />
            </a>
          </div>
          <p className="mt-1 text-xs">等待区块确认后即可在列表中看到</p>
          <button
            type="button"
            onClick={resetDraft}
            className="-ml-3 mt-2 rounded-lg px-3 py-1.5 text-sm text-accent hover:text-ink hover:bg-paper-sunken transition-colors"
          >
            再写一封
          </button>
        </div>
      )}
    </div>
  );
}

function EditorSkeleton({ height }) {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 gap-3"
      style={{ height }}
    >
      <div className="animate-pulse rounded-xl border border-edge bg-paper-raised" />
    </div>
  );
}

function CostPanel({ estimate, market, chainId }) {
  if (!estimate) {
    return (
      <div className="rounded-xl border border-edge bg-paper-sunken px-5 py-4 text-xs text-ink-faint">
        正在获取 gas 价格…
      </div>
    );
  }
  const { postCost, imageCosts, totalCost, estCompressed } = estimate;
  const usdAvailable = totalCost.usd != null;

  return (
    <div className="rounded-xl border border-edge bg-paper-sunken px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-xs tracking-label text-ink-faint">预估上链成本</span>
        <span className="font-mono text-2xs tabular-nums text-ink-faint">
          {fmtGwei(market.gasPriceWei)}
          {usdAvailable && market.ethUsd != null ? (
            <> · ETH ${market.ethUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
          ) : (
            <> · 美元价格不可用</>
          )}
          {chainId !== 1 && <> · 链 {chainId}</>}
        </span>
      </div>

      <ul className="space-y-1.5 text-sm">
        <li className="flex items-baseline justify-between gap-4 text-ink-soft">
          <span>正文（~{estCompressed} B 压缩后）</span>
          <span className="font-mono tabular-nums text-right">
            {fmtEth(postCost.eth)}
            {usdAvailable && (
              <span className="ml-2 text-ink-faint">{fmtUsd(postCost.usd)}</span>
            )}
          </span>
        </li>
        {imageCosts.map((c) => (
          <li
            key={c.key}
            className="flex items-baseline justify-between gap-4 text-sm text-ink-soft"
          >
            <span className="truncate">图片 {c.key}</span>
            <span className="font-mono tabular-nums text-right shrink-0">
              {fmtEth(c.eth)}
              {usdAvailable && (
                <span className="ml-2 text-ink-faint">{fmtUsd(c.usd)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-edge pt-2.5 text-sm font-medium text-ink">
        <span>合计</span>
        <span className="font-mono tabular-nums text-right">
          {fmtEth(totalCost.eth)}
          {usdAvailable && (
            <span className="ml-2 font-normal text-ink-soft">
              {fmtUsd(totalCost.usd)}
            </span>
          )}
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        （brotli 压缩后实际成本会有浮动）
      </p>
    </div>
  );
}
