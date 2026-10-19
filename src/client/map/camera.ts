import { bboxOf, dLon, type BBox } from '../../shared/geo';
import type { LatLon } from '../../shared/types';
import { H0, W0, wx, wy } from './geodata';

export interface Insets { top: number; right: number; bottom: number; left: number }

/**
 * Equirectangular camera. (cx, cy) is the world-pixel point at the center of the usable
 * viewport; `s` is screen pixels per world pixel.
 */
export class Camera {
  cx = W0 / 2;
  cy = H0 / 2 - 30;
  s = 1;
  vw = 800;
  vh = 600;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private anim: { from: [number, number, number]; to: [number, number, number]; t0: number; dur: number } | null = null;

  get minScale() {
    return Math.min(this.vw / W0, this.vh / (H0 * 0.86)) * 0.98;
  }
  get maxScale() {
    return this.minScale * 48;
  }
  /** zoom factor relative to "whole world" */
  get zoom() {
    return this.s / this.minScale;
  }

  sized = false;
  private pending: (() => void) | null = null;

  resize(w: number, h: number) {
    const first = !this.sized;
    this.vw = w;
    this.vh = h;
    if (first) this.s = this.minScale;
    this.sized = w > 0 && h > 0;
    this.clamp();
    if (this.sized && this.pending) {
      const fn = this.pending;
      this.pending = null;
      fn();
    }
  }

  /** Run now if the viewport is measured, otherwise right after the first resize. */
  whenSized(fn: () => void) {
    if (this.sized) fn();
    else this.pending = fn;
  }

  /** Center of the usable area (excludes overlays such as the mobile bottom sheet). */
  get ox() {
    return this.insets.left + (this.vw - this.insets.left - this.insets.right) / 2;
  }
  get oy() {
    return this.insets.top + (this.vh - this.insets.top - this.insets.bottom) / 2;
  }

  /** Screen position of a world x, choosing the wrapped copy nearest the camera. */
  sx(worldX: number): number {
    let dx = worldX - this.cx;
    dx -= Math.round(dx / W0) * W0;
    return dx * this.s + this.ox;
  }
  sy(worldY: number): number {
    return (worldY - this.cy) * this.s + this.oy;
  }
  project(lat: number, lon: number): [number, number] {
    return [this.sx(wx(lon)), this.sy(wy(lat))];
  }
  unproject(x: number, y: number): LatLon {
    const worldX = (x - this.ox) / this.s + this.cx;
    const worldY = (y - this.oy) / this.s + this.cy;
    let lon = (worldX / W0) * 360 - 180;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return [90 - (worldY / H0) * 180, lon];
  }

  clamp() {
    this.s = Math.max(this.minScale, Math.min(this.maxScale, this.s));
    this.cx = ((this.cx % W0) + W0) % W0;
    const usableH = this.vh - this.insets.top - this.insets.bottom;
    const half = usableH / 2 / this.s;
    const top = H0 * 0.04, bottom = H0 * 0.9;
    if (bottom - top <= half * 2) this.cy = (top + bottom) / 2;
    else this.cy = Math.max(top + half, Math.min(bottom - half, this.cy));
  }

  panBy(dx: number, dy: number) {
    this.anim = null;
    this.cx -= dx / this.s;
    this.cy -= dy / this.s;
    this.clamp();
  }

  zoomAt(factor: number, x: number, y: number) {
    this.anim = null;
    const before = this.unscreen(x, y);
    this.s *= factor;
    this.clamp();
    const after = this.unscreen(x, y);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
    this.clamp();
  }

  private unscreen(x: number, y: number): [number, number] {
    return [(x - this.ox) / this.s + this.cx, (y - this.oy) / this.s + this.cy];
  }

  /** Camera target that fits the bbox, with padding in screen px. */
  targetFor(b: BBox, pad = 60, maxZoom = 10): [number, number, number] {
    const usableW = Math.max(100, this.vw - this.insets.left - this.insets.right - pad * 2);
    const usableH = Math.max(100, this.vh - this.insets.top - this.insets.bottom - pad * 2);
    const ww = Math.max(((b.maxLon - b.minLon) / 360) * W0, 6);
    const wh = Math.max(((b.maxLat - b.minLat) / 180) * H0, 4);
    const s = Math.max(this.minScale, Math.min(this.minScale * maxZoom, usableW / ww, usableH / wh));
    const cx = wx((b.minLon + b.maxLon) / 2);
    const cy = wy((b.minLat + b.maxLat) / 2);
    return [cx, cy, s];
  }

  fitPoints(points: LatLon[], animate = true, maxZoom = 10) {
    const b = bboxOf(points);
    if (!b) return;
    this.flyToTarget(this.targetFor(b, 60, maxZoom), animate);
  }

  flyTo(lat: number, lon: number, zoom?: number, animate = true) {
    const s = zoom ? this.minScale * zoom : Math.max(this.s, this.minScale * 3);
    this.flyToTarget([wx(lon), wy(lat), s], animate);
  }

  flyToTarget(to: [number, number, number], animate = true) {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce) {
      [this.cx, this.cy, this.s] = to;
      this.anim = null;
      this.clamp();
      return;
    }
    // shortest horizontal route across the wrap
    const dx = (dLon((this.cx / W0) * 360, (to[0] / W0) * 360) / 360) * W0;
    this.anim = { from: [this.cx, this.cy, this.s], to: [this.cx + dx, to[1], to[2]], t0: performance.now(), dur: 650 };
  }

  /** Advance animation; returns true while animating. */
  update(now: number): boolean {
    if (!this.anim) return false;
    const { from, to, t0, dur } = this.anim;
    const k = Math.min(1, (now - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.cx = from[0] + (to[0] - from[0]) * e;
    this.cy = from[1] + (to[1] - from[1]) * e;
    this.s = Math.exp(Math.log(from[2]) + (Math.log(to[2]) - Math.log(from[2])) * e);
    this.clamp();
    if (k >= 1) this.anim = null;
    return true;
  }

  get animating() {
    return !!this.anim;
  }

  /** Visible geographic bounds (approximate, for culling). */
  visibleLonSpan(): number {
    return ((this.vw / this.s) / W0) * 360;
  }
}
