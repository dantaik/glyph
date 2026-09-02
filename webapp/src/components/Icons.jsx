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

export function GlyphMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <polygon points="12,2 21,12 12,22 3,12" />
      <line x1="12" y1="7" x2="12" y2="17" />
      <line x1="7" y1="12" x2="17" y2="12" />
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

export function ImageIcon({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
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

/**
 * 雁过留声 — a V formation of wild geese with echo arcs trailing the lead
 * bird. Empty-state placeholder: similar in spirit to the hand-drawn
 * line illustrations other writing products use, but unique to the brand.
 */
export function GeeseMark({ size, ...rest }) {
  return (
    <svg {...iconProps(size)} viewBox="0 0 200 100" {...rest}>
      {/* 留声 — echo arcs left behind by the lead goose */}
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
