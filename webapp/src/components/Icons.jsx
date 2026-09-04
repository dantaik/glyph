/** Inline SVG icon set — Feather-style strokes, 24×24 viewBox, currentColor */

function iconProps(size) {
  return {
    width: size ?? 20,
    height: size ?? 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
}

/**
 * Xueni's mark — a simple square seal stamped with a swallow's footprint:
 * three toes forward, one behind. The seal face takes the current colour;
 * the print is carved out in the paper tone.
 */
export function GlyphMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest} stroke="none">
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" fill="currentColor" />
      <g stroke="var(--color-paper-raised)" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M12.3 13.9V7.9" />
        <path d="M12.3 13.9L7.9 10.9" />
        <path d="M12.3 13.9L16.7 10.9" />
        <path d="M12.3 13.9L13.8 18" />
      </g>
    </svg>
  );
}

export function Plus({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function Sun({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function Moon({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ArrowLeft({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export function ArrowRight({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function Close({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


export function Check({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function AlertCircle({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function ExternalLink({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function Download({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/**
 * The empty-state mark — a V formation of wild geese with echo arcs
 * trailing the lead
 * bird. Empty-state placeholder: similar in spirit to the hand-drawn
 * line illustrations other writing products use, but unique to the brand.
 */
export function GeeseMark({ size, ...rest }) {
  return (
    <svg
      {...iconProps(size)}
      width={size ?? 20}
      height={(size ?? 20) / 2}
      viewBox="0 0 200 100"
      {...rest}
    >
      {/* Echo arcs left behind by the lead goose */}
      <path d="M112 10 A10 10 0 0 0 112 30" />
      <path d="M102 4 A16 16 0 0 0 102 36" />
      {/* lead goose */}
      <path d="M126 14 Q134.5 5.5 143 14" />
      <path d="M143 14 Q134.5 11 126 14" />
      {/* left wing */}
      <path d="M92 32 Q98.5 25.5 105 32" />
      <path d="M105 32 Q98.5 29.8 92 32" />
      <path d="M56 50 Q62.5 43.5 69 50" />
      <path d="M69 50 Q62.5 47.8 56 50" />
      {/* right wing */}
      <path d="M158 32 Q164.5 25.5 171 32" />
      <path d="M171 32 Q164.5 29.8 158 32" />
      <path d="M184 50 Q190.5 43.5 197 50" />
      <path d="M197 50 Q190.5 47.8 184 50" />
      {/* horizon */}
      <path d="M28 86 H172" strokeDasharray="1 7" opacity="0.5" />
    </svg>
  );
}

export function Sliders({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function ChevronDown({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronUp({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

export function Trash({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

/**
 * Ethereum's diamond, as the mono mark: the upper and lower octahedron
 * halves with the waist band between them. Geometry follows the canonical
 * logo; drawn in currentColor so it sits in the palette like every other
 * icon here rather than importing a second brand colour.
 */
export function EthereumMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest} stroke="none" fill="currentColor">
      <path d="M12 3v6.652l5.625 2.516zm0 0-5.625 9.166L12 9.652zm0 13.478V21l5.625-7.785zM12 21v-4.522l-5.625-3.263z" />
      <path d="m12 15.43 5.625-3.263L12 9.652zm-5.625-3.263L12 15.43V9.652z" />
    </svg>
  );
}

/**
 * Taiko's mark — the three folded planes of the taiko drum glyph.
 * Same treatment as EthereumMark: real geometry, currentColor fill.
 */
export function TaikoMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest} stroke="none" fill="currentColor">
      <path d="m20.622 16.86-3.085-4.107a1.97 1.97 0 0 0-1.36-.773.38.38 0 0 1-.287-.185.37.37 0 0 1-.02-.338 1.88 1.88 0 0 0-.003-1.54l-2.086-4.67A1.94 1.94 0 0 0 12 4.104c-.772 0-1.471.449-1.78 1.141L8.132 9.917a1.9 1.9 0 0 0-.004 1.54.37.37 0 0 1-.019.338.38.38 0 0 1-.288.185 1.97 1.97 0 0 0-1.36.773L3.379 16.86a1.875 1.875 0 0 0-.118 2.082 1.96 1.96 0 0 0 1.899.94l5.171-.563a1.96 1.96 0 0 0 1.362-.768.386.386 0 0 1 .616 0c.316.42.8.707 1.362.768l5.171.564a1.96 1.96 0 0 0 1.899-.941 1.875 1.875 0 0 0-.118-2.082m-11.14-6.356 2.09-4.677a.47.47 0 0 1 .859 0l2.09 4.677a.47.47 0 0 1-.039.452.49.49 0 0 1-.408.216H9.927a.49.49 0 0 1-.408-.216.47.47 0 0 1-.039-.452zm1.072 7.12a.49.49 0 0 1-.38.258l-5.177.564a.47.47 0 0 1-.459-.226.45.45 0 0 1 .03-.502l3.087-4.111a.49.49 0 0 1 .419-.194.49.49 0 0 1 .395.238l.003.005 2.067 3.51.004.005c.082.14.087.31.013.453zm1.871-1.588a.494.494 0 0 1-.85 0l-1.589-2.695a.47.47 0 0 1 0-.48.5.5 0 0 1 .426-.242h3.175a.49.49 0 0 1 .425.24.47.47 0 0 1 0 .481zm7.038 2.184a.47.47 0 0 1-.459.227l-5.176-.564a.49.49 0 0 1-.381-.259.47.47 0 0 1 .013-.453l.003-.006 2.067-3.509.003-.005a.492.492 0 0 1 .814-.044l3.088 4.11c.11.148.121.345.029.503z" />
    </svg>
  );
}

/**
 * Fallback chain mark for a chain with no logo of its own (a testnet from
 * VITE_CHAIN_ID): a hollow hexagon — a block, not a brand.
 */
export function ChainMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <path d="M12 2.75 20 7.5v9L12 21.25 4 16.5v-9z" />
    </svg>
  );
}

/** Overflow "⋯" — opens the menu holding the controls a phone has no room for. */
/** A globe with meridians — the interface language. */
export function Search({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function Globe({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  );
}

export function MoreHorizontal({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest} stroke="none" fill="currentColor">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
