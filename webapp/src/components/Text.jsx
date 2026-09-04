// Text.jsx — the app's type roles, as components.
//
// Before this file every surface spelled its own recipe out of utilities —
// forty distinct size/colour/weight combinations across twenty-six files,
// so two paragraphs meaning the same thing could differ by a tier and
// nobody would notice. The roles below are the whole vocabulary now; a
// screen picks one instead of inventing another.
//
// The ladder, loudest to quietest:
//
//   ArticleTitle  a post's own title — the largest type in the app
//   Title         a page's title
//   Label         a section heading inside a page (tracked, medium)
//   Body          running text — the default for a sentence
//   Meta          bylines, times, counts: readable at 5:1 (AA)
//   Micro         the same, one tier down, where space is tight
//   Hint          decorative asides only — ink-ghost is ~2.9:1 and must
//                 never carry a sentence the reader has to read
//
// Each takes `as` to choose its element (a `p` role inside a flex row is
// usually a `span`), `className` for layout — margins, flex, truncation —
// and `nums` for tabular figures, so block numbers and counts line up in a
// column without every call site remembering `tabular-nums`.
//
// A role owns its COLOUR as well as its size, which is the one thing to
// know before reaching for one: text that has to be a status colour — a
// success notice, the inside of a danger box — must not use a role, since
// Tailwind utilities share a specificity and an appended `text-success`
// would not reliably beat the role's own `text-ink-faint`. Those few
// places set the size utility directly, and inherit the colour from the
// box they sit in.

const join = (...parts) => parts.filter(Boolean).join(' ');

/**
 * One type role. `base` is the role's own type; everything else is the
 * call site's business.
 */
function role(base, defaultTag) {
  return function Role({ as: Tag = defaultTag, nums = false, className = '', children, ...rest }) {
    return (
      <Tag className={join(base, nums && 'tabular-nums', className)} {...rest}>
        {children}
      </Tag>
    );
  };
}

/**
 * A post's title. The weight comes from the type scale (display is 700,
 * jumbo 900), so it is not repeated here — a title that sets its own
 * weight is how the h1 and the list rows drifted apart in the first place.
 */
export const ArticleTitle = role('text-display sm:text-jumbo', 'h1');

/** A page's title — the feed, an author, the settings. */
export const Title = role('text-xl font-semibold text-ink', 'h2');

/** A section heading within a page. */
export const Label = role('text-sm font-medium tracking-label text-ink-soft', 'h2');

/** Running text: the default for a sentence the reader is meant to read. */
export const Body = role('text-sm text-ink-soft', 'p');

/** Bylines, times, counts, statuses — quieter than body, still AA. */
export const Meta = role('text-xs text-ink-faint', 'p');

/** Meta one tier down, for captions and dense rows. */
export const Micro = role('text-2xs text-ink-faint', 'p');

/**
 * Decorative only. `ink-ghost` is ~2.9:1, below AA: placeholders, empty
 * states and asides that carry no information the reader needs.
 */
export const Hint = role('text-xs text-ink-ghost', 'p');

/**
 * Explanatory prose beside a control — Meta that wraps, so it gets the
 * looser leading a paragraph needs. Named for what it is on the page.
 */
export const Note = role('text-xs leading-relaxed text-ink-faint', 'p');
