import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { renderMarkdown } from '../lib/renderMarkdown';
import { useTheme } from '../lib/theme';

/**
 * CodeMirror Markdown source editor with an optional live preview pane.
 * On wide screens the preview sits beside the editor; on narrow screens it
 * stacks below. Preview re-renders as you type (it's cheap — pure string).
 *
 * Theme-aware: follows the app light/dark theme and pins chrome colors to
 * the design tokens (Prec.highest so the builtin oneDark bg never wins).
 *
 * Props: { value, onChange, showPreview, disabled, height }
 */
export default function MarkdownEditor({
  value,
  onChange,
  showPreview,
  disabled,
  height = '26rem',
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

  const previewHtml = useMemo(
    () => (showPreview ? renderMarkdown(value) : ''),
    [showPreview, value],
  );

  return (
    <div className={`grid gap-3 ${showPreview ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
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

      {showPreview && (
        <div
          className="rounded-xl border border-edge bg-paper-raised px-6 py-5 prose-glyph prose-compact overflow-auto"
          style={{ maxHeight: height }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
    </div>
  );
}
