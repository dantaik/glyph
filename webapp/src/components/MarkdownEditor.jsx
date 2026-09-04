import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { renderMarkdown } from '../lib/renderMarkdown';
import { useTheme } from '../lib/theme';

/**
 * CodeMirror Markdown source editor with a preview pane.
 * `mode` is 'edit' | 'preview' and the two are mutually exclusive:
 * - 'edit' renders only the editor (the preview is not computed at all,
 *   so long articles stay fast while typing);
 * - 'preview' renders only the full-width preview (the editor input is
 *   hidden entirely).
 *
 * The preview shows both kinds of image reference: `upload:KEY` for a file
 * attached to this draft (`previewUrls`), and `eth:0x…` for one already on
 * chain (`resolveEth`, cache-first through the reader). Without the second,
 * reusing an image you published before was writing blind.
 *
 * An image pasted or dropped into the text goes straight in: `onAddImages`
 * attaches the files and returns their keys, and the references are written
 * at the cursor.
 *
 * Theme-aware: follows the app light/dark theme and pins chrome colors to
 * the design tokens (Prec.highest so the builtin oneDark bg never wins).
 *
 * Props: { value, onChange, mode, disabled, height, previewUrls, resolveEth, onAddImages }
 */
export default function MarkdownEditor({
  value,
  onChange,
  mode = 'edit',
  disabled,
  height = '26rem',
  previewUrls = {},
  resolveEth = null,
  onAddImages = null,
}) {
  const { isDark } = useTheme();
  const [previewHtml, setPreviewHtml] = useState('');

  // Object URLs minted for on-chain images in the preview; ours to revoke.
  const urlsRef = useRef([]);
  const releaseUrls = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  };
  useEffect(() => () => releaseUrls(), []);

  // Images arriving by paste or drop. Held in a ref so the editor's extensions
  // stay stable — reconfiguring CodeMirror on every attached file would throw
  // away its state mid-sentence.
  const addImages = useRef(onAddImages);
  addImages.current = onAddImages;

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        paste: (event, view) => insertImages(event.clipboardData, view, event, addImages),
        drop: (event, view) => insertImages(event.dataTransfer, view, event, addImages),
      }),
      Prec.highest(
        EditorView.theme(
          {
            '&': {
              backgroundColor: 'var(--color-paper-raised)',
              color: 'var(--color-ink)',
            },
            '.cm-content': {
              fontFamily: 'inherit',
              fontSize: '14px',
              padding: '14px 16px',
              caretColor: 'var(--color-accent)',
            },
            '.cm-cursor, .cm-dropCursor': {
              borderLeftColor: 'var(--color-accent)',
            },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
              {
                backgroundColor: 'var(--color-accent-wash)',
              },
            '&.cm-focused': { outline: 'none' },
          },
          { dark: isDark },
        ),
      ),
    ],
    [isDark],
  );

  // Only computed in preview mode — no per-keystroke render while typing.
  useEffect(() => {
    if (mode !== 'preview') {
      releaseUrls();
      setPreviewHtml('');
      return undefined;
    }
    let cancelled = false;
    // Attached files first: they are already local, so they never flicker.
    const withUploads = value.replace(/!\[([^\]]*)\]\(upload:([^)\s]+)\)/g, (m, alt, key) => {
      const url = previewUrls[key];
      return url ? `![${alt}](${url})` : m;
    });
    (async () => {
      let resolved = withUploads;
      let urls = [];
      if (resolveEth) {
        // An image the node will not serve leaves its reference alone and
        // renders as alt text, exactly as it does on a post page.
        try {
          ({ markdown: resolved, urls } = await resolveEth(withUploads));
        } catch {
          resolved = withUploads;
          urls = [];
        }
      }
      if (cancelled) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      releaseUrls();
      urlsRef.current = urls;
      setPreviewHtml(renderMarkdown(resolved));
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, value, previewUrls, resolveEth]);

  return (
    <div className="grid grid-cols-1 gap-3">
      {mode === 'edit' && (
        <div className="rounded-xl border border-edge bg-paper-raised overflow-hidden focus-within:border-edge-strong transition-colors">
          <CodeMirror
            value={value}
            onChange={onChange}
            height={height}
            extensions={extensions}
            editable={!disabled}
            theme={isDark ? 'dark' : 'light'}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              indentOnInput: true,
            }}
          />
        </div>
      )}

      {mode === 'preview' && (
        <div
          className="rounded-xl border border-edge bg-paper-raised px-6 py-5 prose-glyph prose-compact overflow-auto"
          style={{ maxHeight: height }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </div>
  );
}

/**
 * Attach whatever images a paste or a drop carried, and write their
 * references at the cursor. Anything that is not an image — text, a file of
 * another kind — is left to CodeMirror to handle as it always did.
 */
function insertImages(transfer, view, event, addImages) {
  const onAdd = addImages.current;
  const files = [...(transfer?.files ?? [])].filter((f) => f.type?.startsWith('image/'));
  if (!onAdd || files.length === 0) return false;
  event.preventDefault();
  const keys = onAdd(files);
  if (!keys?.length) return false;
  const insert = keys.map((key) => `![](upload:${key})`).join('\n');
  const at = view.state.selection.main.head;
  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: { anchor: at + insert.length },
  });
  return true;
}
