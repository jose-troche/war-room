import type { BaseType, Domain, UnitType } from '../../shared/types';

/** 24x24 SVG path data shared by the canvas renderer (Path2D) and DOM panels (<svg>). */
export const GLYPHS: Record<UnitType | BaseType | 'node' | 'unknown_air' | 'unknown_sea' | 'unknown_land' | 'unknown_sub' | 'unknown_drone', string> = {
  fighter: 'M12 2 L13.5 9 L21 13 V15 L13.5 13 L13 19 L16 21 V22 L12 21 L8 22 V21 L11 19 L10.5 13 L3 15 V13 L10.5 9 Z',
  bomber: 'M12 4 L22 15 L19 16.5 L15.5 14 L12 17.5 L8.5 14 L5 16.5 L2 15 Z',
  awacs: 'M12 3 L13 9 L20 12 V13.5 L13 12 L12.6 18 L15 19.5 V20.5 L12 20 L9 20.5 V19.5 L11.4 18 L11 12 L4 13.5 V12 L11 9 Z M6.5 9.5 A5.5 2.2 0 1 0 17.5 9.5 A5.5 2.2 0 1 0 6.5 9.5 Z',
  carrier: 'M2 10 H22 L19.5 16.5 H4.5 Z M14 6 H17 V10 H14 Z',
  destroyer: 'M1.5 12.5 L5 16.5 H19 L22.5 12.5 Z M9 9 H14 V12.5 H9 Z M14 10.5 H17.5 V12.5 H14 Z M11 6 H12.4 V9 H11 Z',
  submarine: 'M3 14 A3 3 0 0 1 6 11 H18 A3 3 0 0 1 18 17 H6 A3 3 0 0 1 3 14 Z M10 7.5 H13.5 V11 H10 Z',
  armor: 'M3.5 14 H20.5 A2 2 0 0 1 20.5 18.5 H3.5 A2 2 0 0 1 3.5 14 Z M7 9.5 H15.5 V14 H7 Z M15.5 10.8 H22 V12.4 H15.5 Z',
  sam: 'M3 18 H21 V20.5 H3 Z M7 18 L13.6 5.5 L15.6 6.6 L9.6 18 Z M12 18 L18.4 8.8 L20.2 10 L14.6 18 Z',
  missile: 'M10.8 2.5 H13.2 L14.2 7 V16.5 L16.5 20 V21.5 H7.5 V20 L9.8 16.5 V7 Z',
  recon_drone: 'M12 5.5 L22.5 12 L12 10.3 L1.5 12 Z M11 10 H13 V18.5 L12 20 L11 18.5 Z M9 17.5 H15 V19 H9 Z',
  strike_drone: 'M6 3.5 L9.5 10.5 L6 8.8 L2.5 10.5 Z M18 3.5 L21.5 10.5 L18 8.8 L14.5 10.5 Z M12 12 L15.5 19 L12 17.3 L8.5 19 Z',
  recon_sat: 'M10 8.5 H14 V15.5 H10 Z M1.5 10 H8.5 V14 H1.5 Z M15.5 10 H22.5 V14 H15.5 Z M8.5 11.4 H10 V12.6 H8.5 Z M14 11.4 H15.5 V12.6 H14 Z',
  comms_sat: 'M10 10 H14 V16.5 H10 Z M2 11.2 H8.5 V15.2 H2 Z M15.5 11.2 H22 V15.2 H15.5 Z M8 7 A4 2.6 0 0 0 16 7 Z M11.4 7 H12.6 V10 H11.4 Z',
  asat: 'M10.6 2.5 H13.4 L14.5 8 V15 H9.5 V8 Z M7 15 H17 V18.5 H7 Z M4.5 18.5 H19.5 V21.5 H4.5 Z',
  hq: 'M12 1.8 L14.9 8.6 L22.2 9.2 L16.6 14 L18.3 21.2 L12 17.4 L5.7 21.2 L7.4 14 L1.8 9.2 L9.1 8.6 Z',
  airbase: 'M10.5 2 H13.5 V22 H10.5 Z M3 10 L10.5 8 V12 L3 13.5 Z M21 10 L13.5 8 V12 L21 13.5 Z',
  port: 'M11 2.5 A2.4 2.4 0 1 1 13 2.5 V6 H16.5 V8.2 H13 V18.6 C15.8 18.2 17.8 16.3 18.4 14 H16.4 L19.5 10.2 L22.2 14 H20.5 C19.7 17.8 16.2 20.8 12 20.8 C7.8 20.8 4.3 17.8 3.5 14 H1.8 L4.5 10.2 L7.6 14 H5.6 C6.2 16.3 8.2 18.2 11 18.6 V8.2 H7.5 V6 H11 Z',
  node: 'M12 1.5 L21.5 7 V17 L12 22.5 L2.5 17 V7 Z',
  unknown_air: 'M12 5 L20 14 L12 11.5 L4 14 Z',
  unknown_sea: 'M3 12 L6 16 H18 L21 12 Z',
  unknown_land: 'M5 9 H19 V17 H5 Z',
  unknown_sub: 'M4 14 A3 3 0 0 1 7 11 H17 A3 3 0 0 1 17 17 H7 A3 3 0 0 1 4 14 Z',
  unknown_drone: 'M12 6 L20 12 L12 10.5 L4 12 Z',
};

export function glyphFor(type: UnitType | null, domain: Domain): string {
  if (type) return GLYPHS[type];
  const d = domain === 'space' ? 'air' : domain;
  return GLYPHS[`unknown_${d}` as keyof typeof GLYPHS];
}

const cache = new Map<string, Path2D>();
export function glyphPath(d: string): Path2D {
  let p = cache.get(d);
  if (!p) {
    p = new Path2D(d);
    cache.set(d, p);
  }
  return p;
}

/** Colors carry meaning only: side, severity, status. Mirrors CSS tokens in styles.css. */
export const COLORS = {
  blue: '#4da3ff',
  blueDim: 'rgba(77,163,255,0.16)',
  red: '#ff4d5e',
  redDim: 'rgba(255,77,94,0.16)',
  unknown: '#ffc53d',
  ghost: '#8a96a8',
  neutral: '#c7d2e0',
  critical: '#ff3b5c',
  high: '#ff8a3d',
  medium: '#ffd23f',
  low: '#2fd6b4',
  info: '#8aa0b8',
  ok: '#3ddc97',
  ink: '#e6edf6',
  inkDim: '#9fb0c6',
  ocean0: '#071423',
  ocean1: '#0b1d33',
  land: '#16273b',
  landEdge: '#3a6488',
  border: 'rgba(120,160,200,0.22)',
  grid: 'rgba(120,170,220,0.07)',
};

export const sideColor = (side: 'blue' | 'red') => (side === 'blue' ? COLORS.blue : COLORS.red);
