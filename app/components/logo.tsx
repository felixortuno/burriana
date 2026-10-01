import { useId, type SVGProps } from 'react';

/**
 * The Grupo Trimodos emblem, drawn inline so it can be animated and recoloured.
 * Geometry comes from logo/emblema-*.svg and must not change. Each stroke is its
 * own element with pathLength=1, so the loader can draw it group by group:
 * 1 the square, 2 the horizontal and vertical lines, 3 the triangle and the arc.
 */
export function EmblemShapes() {
  return <>
    <rect data-trazo="1" x="5" y="5" width="90" height="90" pathLength={1}/>
    <path data-trazo="2" d="M5 30H95" pathLength={1}/>
    <path data-trazo="2" d="M50 5V95" pathLength={1}/>
    <path data-trazo="3" d="M50 5L5 95" pathLength={1}/>
    <path data-trazo="3" d="M50 5L95 95" pathLength={1}/>
    <path data-trazo="3" d="M5 52A53 53 0 0 0 95 52" pathLength={1}/>
  </>;
}

/** clipPath ids must be unique per instance and plain enough for url(#…). */
export function useClipId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

const colors = { lima: 'var(--tm-lima)', negro: 'var(--tm-negro)', blanco: '#FFFFFF' } as const;

type LogoProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  variant?: keyof typeof colors;
  /** Pixels or any CSS length; the emblem is square. */
  size?: number | string;
  /** Accessible name; without it the emblem is decorative. */
  title?: string;
  strokeWidth?: number;
};

export default function Logo({ variant = 'lima', size = 24, title, strokeWidth = 5.5, style, ...props }: LogoProps) {
  const clip = useClipId('tm-logo-');
  return <svg viewBox="0 0 100 100" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    style={{ display: 'block', flexShrink: 0, ...style }} {...props}>
    <defs><clipPath id={clip}><rect x="2.25" y="2.25" width="95.5" height="95.5"/></clipPath></defs>
    <g fill="none" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="miter" clipPath={`url(#${clip})`}><EmblemShapes/></g>
  </svg>;
}
