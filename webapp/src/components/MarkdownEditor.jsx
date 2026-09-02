import { useMemo } from 'react';
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
 * Theme-aware: follows the app light/dark theme and pins chrome colors to
 * the design tokens (Prec.highest so the builtin oneDark bg never wins).
 *
 * Props: { value, onChange, mode, disabled, height, previewUrls }
 * previewUrls: { key: blobUrl } for uploaded images, used to render
 *   `upload:KEY` references in the preview.
 */
export default function MarkdownEditor({
  value,
  onChange,
  mode = 'edit',
  disabled,
  height = '26rem',
  previewUrls = {},
}) {
  const { isDark } = useTheme();

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      Prec.highest(
        EditorView.theme(
          {
            '&': {
              backgroundColor: 'var(--color-paper-raised)',
              color: 'var(--color-ink)',
            },
            '.cm-content': {
              fontFamily: 'var(--font-mono)',
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

  // Only computed in preview mode — no per-keystroke re-render while typing.
  const previewHtml = useMemo(() => {
    if (mode !== 'preview') return '';
    // Resolve upload:KEY image references to blob URLs so the
    // preview actually shows the uploaded images.
    const resolved = value.replace(/!\[([^\]]*)\]\(upload:([^)\s]+)\)/g, (m, alt, key) => {
      const url = previewUrls[key];
      return url ? `![${alt}](${url})` : m;
    });
    return renderMarkdown(resolved);
  }, [mode, value, previewUrls]);

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
