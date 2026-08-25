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

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="m6 7 12-2" />
      <path d="m6 7-3 6a3 3 0 0 0 6 0L6 7Z" />
      <path d="m18 5-3 6a3 3 0 0 0 6 0l-3-6Z" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function CapitolIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2 4 6h16l-8-4Z" />
      <path d="M4 6h16" />
      <path d="M6 6v11M10 6v11M14 6v11M18 6v11" />
      <path d="M3 21h18" />
      <path d="M4 17h16v4H4z" />
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

export function ServerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** Circular agency seal used as the primary brand mark. */
export function BrandSeal({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      role="img"
    >
      <circle cx="24" cy="24" r="23" fill="var(--seal-navy)" />
      <circle cx="24" cy="24" r="19.5" fill="none" stroke="var(--seal-gold)" strokeWidth="1" />
      <circle cx="24" cy="24" r="17" fill="none" stroke="var(--seal-gold)" strokeWidth="0.5" opacity="0.6" />
      {/* scales of justice — authority + evaluation */}
      <g stroke="var(--seal-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M24 13v22" />
        <path d="M17 35h14" />
        <path d="M15 18h18" />
        <path d="M15 18l-3 6a3 3 0 0 0 6 0l-3-6Z" />
        <path d="M33 18l-3 6a3 3 0 0 0 6 0l-3-6Z" />
      </g>
      <circle cx="24" cy="13" r="1.6" fill="var(--seal-gold)" />
    </svg>
  );
}
