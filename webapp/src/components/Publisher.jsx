import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { embedImages, publishPost, getWallet } from '../lib/publish';
import MarkdownEditor from './MarkdownEditor';
import { client } from '../lib/blogReader';
import { getAuthorCount } from '../lib/data';
import { CHAIN_ID } from '../lib/config';
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

const PLACEHOLDER_TITLE = '';
const PLACEHOLDER_MD = `# 小标题

写点什么...

![图片描述](upload:img1)

把图片拖入下方区域或点击上传，引用它的 Markdown 语法是 \`![描述](upload:img1)\`。`;

const SEGMENT_ON = 'rounded-full px-2.5 py-1 text-xs transition-colors bg-paper-sunken text-ink font-medium';
const SEGMENT_OFF = 'rounded-full px-2.5 py-1 text-xs transition-colors text-ink-faint hover:text-ink';

export default function Publisher() {
  const [title, setTitle] = useState(PLACEHOLDER_TITLE);
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState([]);
  const [markdown, setMarkdown] = useState(PLACEHOLDER_MD);
  const [files, setFiles] = useState({});
  const [showPreview, setShowPreview] = useState(true);
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [account, setAccount] = useState(null);
  const [isFirstPost, setIsFirstPost] = useState(true);
  const [market, setMarket] = useState({ gasPriceWei: null, ethUsd: null });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const titleBytes = titleByteLength(title);
  const titleOver = titleBytes > TITLE_MAX_BYTES;

  /** Parse upload:KEY refs from markdown */
  const uploadRefs = useMemo(
    () => [...markdown.matchAll(/upload:(\w+)/g)].map((m) => m[1]),
    [markdown],
  );

  // Detect wallet + first-post status (drives cold-SSTORE estimate).
  useEffect(() => {
    if (!window.ethereum) return;
    let cancelled = false;
    (async () => {
      try {
        const [addr] =
          (await window.ethereum.request?.({ method: 'eth_accounts' })) || [];
        if (!addr || cancelled) return;
        setAccount(addr);
        const c = await getAuthorCount(addr);
        if (!cancelled) setIsFirstPost(c === 0n);
      } catch {
        // ignore — fall back to first-post estimate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Stable preview URLs for uploaded files.
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
  const addTagFromInput = () => {
    const t = tagsInput.trim().replace(/,$/, '').trim();
    if (!t || tags.includes(t)) {
      setTagsInput('');
      return;
    }
    setTags([...tags, t]);
    setTagsInput('');
  };
  const handleTagKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === 'Backspace' && !tagsInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  // --- File handling ---
  const handleFileChange = useCallback(
    (e) => {
      const newFiles = { ...files };
      for (const f of e.target.files) {
        const base =
          (f.name
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9一-鿿_-]/g, '') || 'img');
        let key = base;
        let suffix = 2;
        while (newFiles[key]) key = `${base}-${suffix++}`;
        newFiles[key] = f;
      }
      setFiles(newFiles);
      e.target.value = '';
    },
    [files],
  );
  const removeFile = (key) => {
    const next = { ...files };
    delete next[key];
    setFiles(next);
  };

  // --- Connect wallet helper ---
  const ensureWallet = async () => {
    const { account: a } = await getWallet();
    setAccount(a);
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
        <div
          id="post-title-bytes"
          className={`text-[11px] mt-1 tabular-nums ${
            titleOver ? 'text-danger' : 'text-ink-faint'
          }`}
        >
          {titleBytes} / {TITLE_MAX_BYTES} 字节
          {titleOver && ' — 太长，无法编码为 bytes32'}
        </div>
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
            placeholder={tags.length === 0 ? '回车或逗号分隔' : ''}
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
              onClick={() => setShowPreview(false)}
              aria-pressed={!showPreview}
              className={showPreview ? SEGMENT_OFF : SEGMENT_ON}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              aria-pressed={showPreview}
              className={showPreview ? SEGMENT_ON : SEGMENT_OFF}
            >
              双栏
            </button>
          </div>
        </div>
        <MarkdownEditor
          value={markdown}
          onChange={setMarkdown}
          showPreview={showPreview}
          disabled={status === 'processing'}
          height="26rem"
        />
      </div>

      {/* Image upload */}
      <div className="mb-7">
        <span className="block text-xs tracking-label text-ink-faint mb-1.5">
          图片（使用 upload:KEY 引用）
        </span>

        {uploadRefs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {uploadRefs.map((key) => (
              <span
                key={key}
                className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 ${
                  files[key]
                    ? 'bg-success-wash text-success'
                    : 'bg-accent-wash text-accent-strong'
                }`}
              >
                {files[key] ? <Check size={12} /> : <AlertCircle size={12} />}
                {key}
              </span>
            ))}
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-label="上传图片"
          className={`rounded-xl border-2 border-dashed p-7 text-center transition-colors cursor-pointer
                     ${isDragging
                       ? 'border-accent bg-accent-wash/50'
                       : 'border-edge-strong bg-paper-raised hover:border-accent'}`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length) {
              handleFileChange({ target: { files: e.dataTransfer.files } });
            }
          }}
        >
          <p className="text-sm text-ink-faint">拖入图片或点击上传</p>
          <p className="text-xs text-ink-ghost mt-1">
            自动转换为 WebP q60，最大长边 1600px
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {Object.keys(files).length > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Object.entries(files).map(([key, file]) => (
              <div key={key} className="relative group">
                <img
                  src={filePreviews[key]}
                  alt={key}
                  className="w-full h-24 object-cover rounded-lg border border-edge"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(key);
                  }}
                  aria-label={`移除图片 ${key}`}
                  className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full
                             bg-paper-raised/90 text-ink-faint hover:text-danger shadow-sm
                             opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
                >
                  <Close size={12} />
                </button>
                <span className="block text-[10px] text-ink-faint mt-0.5 truncate">
                  {key} · {(file.size / 1024).toFixed(0)}KB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cost estimate */}
      <CostPanel estimate={costEstimate} market={market} chainId={CHAIN_ID} />

      {/* Publish button + live status */}
      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button
          onClick={handlePublish}
          disabled={!canPublish || status === 'processing' || status === 'signing'}
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
        <span className="font-mono text-[11px] tabular-nums text-ink-faint">
          {fmtGwei(market.gasPriceWei)}
          {usdAvailable && market.ethUsd != null ? (
            <> · ETH ${market.ethUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
          ) : (
            <> · 美元价格不可用</>
          )}
          {chainId !== 1 && <> · chain {chainId}</>}
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
            className="flex items-baseline justify-between gap-4 text-[13px] text-ink-soft"
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

      <p className="mt-2 text-[10px] text-ink-faint">
        （brotli 压缩后实际成本会有浮动）
      </p>
    </div>
  );
}
