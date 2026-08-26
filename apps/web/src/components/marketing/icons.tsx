import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

/* ------------------------------------------------------------------ */
/* Status glyphs — each a DISTINCT SHAPE so meaning never relies on    */
/* color alone (WCAG 1.4.1). Always paired with a text label.          */
/* ------------------------------------------------------------------ */

/** PASS — check inside a circle. */
export function PassGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

/** FAIL — cross inside a circle. */
export function FailGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

/** RISK — the only triangle; reserved for real findings. */
export function RiskGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** INDETERMINATE — neutral dashed circle; the honest "not enough data". */
export function IndeterminateGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3a9 9 0 0 1 0 18" strokeDasharray="2.6 2.6" />
      <path d="M12 3a9 9 0 0 0 0 18" strokeDasharray="2.6 2.6" />
      <path d="M9 12h6" />
    </svg>
  );
}

/** MANUAL_REVIEW — an eye; a human must look. */
export function ManualReviewGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/** NOT_APPLICABLE — circle with a slash; out of scope. */
export function NotApplicableGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Supporting UI icons                                                 */
/* ------------------------------------------------------------------ */

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 6v5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function FileCheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <path d="M12 15v2" />
    </svg>
  );
}

export function NoWriteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

export function StampIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3a3 3 0 0 0-3 3c0 1.5 1 2.2 1 3.5S9 12 7.5 12H6a2 2 0 0 0-2 2v1h16v-1a2 2 0 0 0-2-2h-1.5c-1.5 0-2.5-.7-2.5-2.5S14 7.5 14 6a3 3 0 0 0-2-3Z" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 7h14" />
      <path d="M5 7 2.5 13a3 3 0 0 0 5 0Z" />
      <path d="M19 7l-2.5 6a3 3 0 0 0 5 0Z" />
    </svg>
  );
}
