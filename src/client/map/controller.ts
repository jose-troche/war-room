import type { LatLon } from '../../shared/types';
import { frame, view } from '../store';
import { Camera } from './camera';
import { MapRenderer, relevantPoints } from './renderer';

/** Singleton map controller so panels, ATLAS and Ask can drive the camera. */
export const camera = new Camera();
export const renderer = new MapRenderer();

/** keep the current longitude when going to world view, so the map doesn't spin */
const wxCenter = () => (camera.s > camera.minScale * 1.5 ? camera.cx : 512 + 60);

export const mapCtl = {
  fitAll(animate = true) {
    const v = view.value;
    if (!v) {
      camera.flyToTarget([512, 230, camera.minScale], animate);
      return;
    }
    camera.fitPoints(relevantPoints(v), animate, 6);
  },
  /**
   * Opening view. On portrait phones a whole-planet fit is unreadably small, so frame the
   * theater around our own forces at a legible zoom; edge markers point to the rest.
   */
  initial() {
    const v = view.value;
    const usableH = camera.vh - camera.insets.top - camera.insets.bottom;
    if (!v || camera.vw >= usableH * 1.1) return this.fitAll(false);
    const own = v.units.filter((u) => u.side === v.side && u.domain !== 'space');
    // circular mean longitude of our forces
    let sx = 0, sy = 0;
    for (const u of own) {
      sx += Math.cos((u.lon * Math.PI) / 180);
      sy += Math.sin((u.lon * Math.PI) / 180);
    }
    const lon = (Math.atan2(sy, sx) * 180) / Math.PI;
    const s = Math.max(camera.minScale, Math.min(usableH / (512 * 0.78), camera.vw / (1024 * 0.3)));
    camera.flyToTarget([((lon + 180) / 360) * 1024, 215, s], false);
  },
  fitPoints(points: LatLon[], maxZoom = 8) {
    if (points.length === 1) camera.flyTo(points[0][0], points[0][1], Math.min(maxZoom, 4));
    else camera.fitPoints(points, true, maxZoom);
  },
  fitUnits(ids: string[]) {
    const v = view.value;
    if (!v) return;
    const pts = ids
      .map((id) => renderer.positions.get(id) ?? v.units.find((u) => u.id === id))
      .filter(Boolean)
      .map((p) => [p!.lat, p!.lon] as LatLon);
    if (pts.length) this.fitPoints(pts);
  },
  flyTo(lat: number, lon: number, zoom?: number) {
    camera.flyTo(lat, lon, zoom);
  },
  zoom(factor: number) {
    camera.zoomAt(factor, camera.ox, camera.oy);
  },
  /** Whole-world view that fills the screen height (longitude wraps, so width never runs out). */
  world(animate = true) {
    const usableH = camera.vh - camera.insets.top - camera.insets.bottom;
    const s = Math.max(camera.minScale, Math.min(usableH / (512 * 0.8), camera.vw / (1024 * 0.75)));
    camera.flyToTarget([wxCenter(), 240, s], animate);
  },
  ping(lat: number, lon: number, color = '#ffd23f') {
    frame.effects.push({ kind: 'ping', lat, lon, t0: performance.now(), color });
  },
};
