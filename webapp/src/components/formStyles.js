// formStyles.js — the form vocabulary shared by the write tab and the
// settings page: one look for a segmented choice, a primary action, a quiet
// action, so the two surfaces read as one app.

/** A segmented choice — the selected segment and the others. */
export const SEGMENT_ON =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors bg-paper-sunken text-ink font-medium';
export const SEGMENT_OFF =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors text-ink-faint hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
/** The pill around a segmented choice. */
export const SEGMENT_GROUP = 'inline-flex rounded-full border border-edge p-0.5 gap-0.5';

/** The one filled button on a page. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-paper hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
/** A text-like action beside it. */
export const BTN_QUIET =
  'rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-accent hover:bg-paper-sunken transition-colors';
/** A small tinted pill — the wallet's connect button. */
export const BTN_PILL =
  'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-accent-wash px-3 text-xs font-medium text-accent-strong hover:bg-accent hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
/** An outlined action — the secondary button on a page. */
export const BTN_OUTLINE =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-edge-strong px-4 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
/** A small icon-only action inside a list row. */
export const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-ghost hover:text-accent hover:bg-paper-sunken disabled:opacity-25 disabled:hover:text-ink-ghost disabled:hover:bg-transparent transition-colors';

/** A text field. Addresses and URLs take `INPUT_MONO`; numbers and words, `INPUT`. */
export const INPUT =
  'w-full rounded-lg border border-edge-strong bg-paper px-3 py-2 text-sm placeholder:text-ink-ghost focus:border-accent focus:outline-none';
export const INPUT_MONO = `${INPUT} font-mono`;
/** The label above a field. */
export const FIELD_LABEL = 'mb-1.5 block text-xs tracking-label text-ink-faint';
