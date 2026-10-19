import { cellCenter, cellOf, dLon, distKm, GRID_H, GRID_W, isLandCell, wrapLon } from './geo';
import type { LatLon } from './types';

export type Mover = 'sea' | 'land';

export interface PathOpts {
  mover: Mover;
  /** cell indices (r * W + c) that this mover may not enter, e.g. canals held by the enemy */
  blocked?: Set<number>;
}

const SEA_MAX_LAT = 72;
const LAND_MIN_LAT = -58;
const WATER_COST_FOR_LAND = 4;

const idx = (c: number, r: number) => r * GRID_W + c;

function passable(c: number, r: number, o: PathOpts): boolean {
  const lat = 90 - r - 0.5;
  if (o.blocked?.has(idx(c, r))) return false;
  if (o.mover === 'sea') return !isLandCell(c, r) && Math.abs(lat) <= SEA_MAX_LAT;
  return lat >= LAND_MIN_LAT && lat <= 78;
}

function terrainCost(c: number, r: number, o: PathOpts): number {
  if (o.mover === 'land' && !isLandCell(c, r)) return WATER_COST_FOR_LAND;
  return 1;
}

/** Nearest passable cell (BFS rings) to the given cell, or null. */
export function nearestPassable(lat: number, lon: number, o: PathOpts, maxRing = 8): [number, number] | null {
  const [c0, r0] = cellOf(lat, lon);
  if (passable(c0, r0, o)) return [c0, r0];
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr;
        if (r < 0 || r >= GRID_H) continue;
        const c = (c0 + dc + GRID_W) % GRID_W;
        if (!passable(c, r, o)) continue;
        const [la, lo] = cellCenter(c, r);
        const d = distKm(lat, lon, la, lo);
        if (d < bestD) {
          bestD = d;
          best = [c, r];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    const a = this.items, k = this.keys;
    a.push(item);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items, k = this.keys;
    const top = a[0];
    const lastI = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastI;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

const cellKm = (r: number) => {
  const lat = 90 - r - 0.5;
  return { dy: 111.2, dx: 111.2 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)) };
};

/**
 * A* over the 1° grid. Returns waypoints (excluding the start, ending at the destination)
 * or null if unreachable.
 */
export function findPath(from: LatLon, to: LatLon, o: PathOpts): LatLon[] | null {
  const start = nearestPassable(from[0], from[1], o, 3);
  const goal = nearestPassable(to[0], to[1], o, 8);
  if (!start || !goal) return null;
  const sI = idx(start[0], start[1]);
  const gI = idx(goal[0], goal[1]);
  const [gLat, gLon] = cellCenter(goal[0], goal[1]);
  const destExact = passable(...cellOf(to[0], to[1]), o);
  const finalPoint: LatLon = destExact ? [to[0], wrapLon(to[1])] : [gLat, gLon];

  if (sI === gI) return [finalPoint];

  const N = GRID_W * GRID_H;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap();
  g[sI] = 0;
  heap.push(sI, 0);
  const h = (c: number, r: number) => {
    const [la, lo] = cellCenter(c, r);
    return distKm(la, lo, gLat, gLon);
  };

  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === gI) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cr = Math.floor(cur / GRID_W), cc = cur % GRID_W;
    const { dx, dy } = cellKm(cr);
    for (let dr = -1; dr <= 1; dr++) {
      const nr = cr + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = (cc + dc + GRID_W) % GRID_W;
        const ni = idx(nc, nr);
        if (closed[ni] || !passable(nc, nr, o)) continue;
        const step = Math.hypot(dc * dx, dr * dy) * terrainCost(nc, nr, o);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + h(nc, nr));
        }
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let i = gI; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  const pts: LatLon[] = cells.map((i) => cellCenter(i % GRID_W, Math.floor(i / GRID_W)));
  pts[0] = [from[0], from[1]];
  pts[pts.length - 1] = finalPoint;
  return smooth(pts, o).slice(1);
}

/** Terrain class along a straight segment must stay homogeneous and passable. */
export function segmentClear(a: LatLon, b: LatLon, o: PathOpts): boolean {
  const dlo = dLon(a[1], b[1]);
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(dlo)) / 0.34));
  let firstLand: boolean | null = null;
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const [c, r] = cellOf(a[0] + (b[0] - a[0]) * f, a[1] + dlo * f);
    if (!passable(c, r, o)) return false;
    if (o.mover === 'land') {
      const l = isLandCell(c, r);
      if (firstLand === null) firstLand = l;
      else if (l !== firstLand) return false;
    }
  }
  return true;
}

function smooth(pts: LatLon[], o: PathOpts): LatLon[] {
  if (pts.length <= 2) return pts;
  const out: LatLon[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && segmentClear(pts[i], pts[j + 1], o)) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
