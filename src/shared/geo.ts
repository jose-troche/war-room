import { MASK_B64, MASK_H, MASK_W } from './geo/mask';
import type { LatLon } from './types';

export const EARTH_KM = 6371;
const RAD = Math.PI / 180;

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Signed shortest longitude delta from a to b, in -180..180. */
export function dLon(a: number, b: number): number {
  return wrapLon(b - a);
}

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = p2 - p1, dl = dLon(lon1, lon2) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Heading in degrees (0 = north, 90 = east) on the equirectangular plane — matches what is drawn. */
export function headingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dx = dLon(lon1, lon2) * Math.cos(((lat1 + lat2) / 2) * RAD);
  const dy = lat2 - lat1;
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

/**
 * Advance from (lat,lon) toward (lat2,lon2) by `km`, interpolating linearly in lat/lon
 * (shortest wrap). Returns new position and whether the target was reached.
 */
export function stepToward(
  lat: number, lon: number, lat2: number, lon2: number, km: number,
): { lat: number; lon: number; arrived: boolean } {
  const d = distKm(lat, lon, lat2, lon2);
  if (d <= km || d < 1e-6) return { lat: lat2, lon: lon2, arrived: true };
  const f = km / d;
  return { lat: lat + (lat2 - lat) * f, lon: wrapLon(lon + dLon(lon, lon2) * f), arrived: false };
}

/* ---------- land mask ---------- */

let maskBits: Uint8Array | null = null;
function bits(): Uint8Array {
  if (!maskBits) {
    const bin = atob(MASK_B64);
    maskBits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) maskBits[i] = bin.charCodeAt(i);
  }
  return maskBits;
}

export const GRID_W = MASK_W;
export const GRID_H = MASK_H;

export function cellOf(lat: number, lon: number): [number, number] {
  const c = Math.floor(wrapLon(lon) + 180) % GRID_W;
  const r = Math.min(GRID_H - 1, Math.max(0, Math.floor(90 - lat)));
  return [c, r];
}

export function cellCenter(c: number, r: number): LatLon {
  return [90 - r - 0.5, -180 + c + 0.5];
}

export function isLandCell(c: number, r: number): boolean {
  const i = r * GRID_W + (((c % GRID_W) + GRID_W) % GRID_W);
  return ((bits()[i >> 3] >> (i & 7)) & 1) === 1;
}

export function isLand(lat: number, lon: number): boolean {
  const [c, r] = cellOf(lat, lon);
  return isLandCell(c, r);
}

/** Geographic bounding box. lon range may exceed 180 when crossing the antimeridian. */
export interface BBox { minLat: number; maxLat: number; minLon: number; maxLon: number }

/**
 * Smallest bbox enclosing the points, choosing the longitude window that minimizes width
 * (handles clusters spanning the antimeridian, e.g. Bering + Hawaii).
 */
export function bboxOf(points: LatLon[]): BBox | null {
  if (!points.length) return null;
  let minLat = 90, maxLat = -90;
  const lons: number[] = [];
  for (const [la, lo] of points) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    lons.push(wrapLon(lo));
  }
  lons.sort((a, b) => a - b);
  // the largest gap between consecutive longitudes is the part we exclude
  let gap = 360 - (lons[lons.length - 1] - lons[0]);
  let start = lons[0];
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gap) {
      gap = g;
      start = lons[i];
    }
  }
  const width = 360 - gap;
  return { minLat, maxLat, minLon: start, maxLon: start + width };
}
