import { useState } from 'react';
import { archiveFileName, collectAuthorArchive, serializeArchive } from '../lib/archive';
import { downloadText } from '../lib/download';
import { useT } from '../lib/i18n';
import { SEGMENT_OFF } from './formStyles';

/**
 * One author's complete output, as a file.
 *
 * "Complete" is the whole point, and it is why this is not simply a download
 * of what is on screen: the walk is driven back to the author's first post
 * before anything is written, so the bundle can say so and another browser
 * can open that author with no node at all.
 *
 * It can take a while for a prolific author, so the button says where it has
 * got to rather than going quiet.
 */
export default function ExportAuthorButton({ view, author }) {
  const t = useT();
  const [state, setState] = useState(null); // { phase, done, total }

  const run = async () => {
    setState({ phase: 'walking' });
    try {
      const doc = await collectAuthorArchive(view, author, { onProgress: setState });
      downloadText(archiveFileName(doc.scope), serializeArchive(doc), 'application/json');
    } catch {
      // Nothing to say beyond the button coming back: the walk failed, and
      // the page below is already showing whichever chain went quiet.
    } finally {
      setState(null);
    }
  };

  const label = (() => {
    if (!state) return t('archive.exportAuthor');
    if (state.phase === 'walking') return t('archive.walking');
    return t('archive.exporting', { done: state.done ?? 0, total: state.total ?? 0 });
  })();

  return (
    <button
      type="button"
      onClick={run}
      disabled={state != null}
      className={SEGMENT_OFF}
      data-export-author=""
    >
      {label}
    </button>
  );
}
