import { CATALOG, RULES } from '../../shared/catalog';
import { orbitPos } from '../../shared/engine';
import { dLon } from '../../shared/geo';
import type { Base, Side, StrategicNode, UnitView, View } from '../../shared/types';
import type { Camera } from './camera';
import { H0, highRes, lowRes, W0, wy } from './geodata';
import { COLORS, glyphFor, glyphPath, GLYPHS, sideColor } from './icons';

export interface Pick {
  kind: 'unit' | 'node' | 'base' | 'cluster' | 'ghost';
  id: string;
  ids?: string[];
  x: number;
  y: number;
  r: number;
  side?: Side;
}

export interface Effect { kind: 'boom' | 'capture' | 'ping'; lat: number; lon: number; t0: number; color: string }

export interface RenderInput {
  v: View;
  /** 0..1 interpolation between previous and current snapshot */
  alpha: number;
  prev: Map<string, { lat: number; lon: number }>;
  selection: Set<string>;
  hover: string | null;
  highlight: Set<string>;
  layers: { coverage: boolean; tracks: boolean; threats: boolean };
  now: number;
  attract: boolean;
  effects: Effect[];
  touch: boolean;
}

const KM_PER_DEG = 111.2;
const DOMAIN_ORDER: Record<string, number> = { sea: 0, sub: 0, land: 1, air: 2, drone: 3, space: 4 };

export class MapRenderer {
  picks: Pick[] = [];
  /** interpolated screen-independent positions from the last frame (lat, lon) */
  positions = new Map<string, { lat: number; lon: number }>();

  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, inp: RenderInput | null) {
    this.picks = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBase(ctx, cam, dpr);
    if (!inp) return;
    const v = inp.v;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // interpolated positions
    this.positions.clear();
    const tNow = v.t + inp.alpha * RULES.dt;
    for (const u of v.units) {
      if (u.orbit) {
        this.positions.set(u.id, orbitPos(u.orbit, tNow));
        continue;
      }
      const p = inp.prev.get(u.id);
      if (p && inp.alpha < 1) {
        const k = inp.alpha;
        this.positions.set(u.id, { lat: p.lat + (u.lat - p.lat) * k, lon: p.lon + dLon(p.lon, u.lon) * k });
      } else this.positions.set(u.id, { lat: u.lat, lon: u.lon });
    }
    const pos = (u: UnitView) => this.positions.get(u.id) ?? u;
    const me = v.side;

    if (inp.layers.coverage && !inp.attract) this.drawCoverage(ctx, cam, v, pos);
    this.drawNodeZones(ctx, cam, v.nodes);
    if (inp.layers.tracks) this.drawTracks(ctx, cam, v, tNow, me);
    if (inp.layers.threats) this.drawThreats(ctx, cam, v, pos, inp);
    this.drawSelectionAids(ctx, cam, v, pos, inp);
    this.drawShots(ctx, cam, v, tNow);
    this.drawGhosts(ctx, cam, v);
    this.drawBases(ctx, cam, v);
    this.drawNodes(ctx, cam, v.nodes, inp.now);
    this.drawUnits(ctx, cam, v, pos, inp);
    this.drawNodeLabels(ctx, cam, v.nodes);
    this.drawEffects(ctx, cam, inp);
    if (!inp.attract) this.drawEdgeMarkers(ctx, cam, v.nodes);
  }

  /* ------------------------------------------------------------- geography */

  private drawBase(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number) {
    const { vw, vh, s } = cam;
    ctx.fillStyle = COLORS.ocean0;
    ctx.fillRect(0, 0, vw, vh);
    const g = ctx.createRadialGradient(vw / 2, vh * 0.45, 0, vw / 2, vh * 0.45, Math.max(vw, vh) * 0.75);
    g.addColorStop(0, COLORS.ocean1);
    g.addColorStop(1, COLORS.ocean0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    const geo = cam.zoom > 3 ? highRes() ?? lowRes() : lowRes();
    const worldPx = W0 * s;
    let left = (0 - cam.cx) * s + cam.ox;
    left -= Math.ceil(left / worldPx) * worldPx; // left <= 0
    const top = cam.sy(0);
    for (let x = left; x < vw; x += worldPx) {
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * top);
      ctx.fillStyle = COLORS.land;
      ctx.fill(geo.land);
      ctx.lineWidth = 0.9 / s;
      ctx.strokeStyle = COLORS.landEdge;
      ctx.stroke(geo.land);
      const borders = lowRes().borders;
      if (borders) {
        ctx.lineWidth = 0.6 / s;
        ctx.strokeStyle = COLORS.border;
        ctx.stroke(borders);
      }
    }
    // graticule
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const step = cam.zoom > 8 ? 5 : cam.zoom > 2.5 ? 10 : 30;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -90 + step; lat < 90; lat += step) {
      const y = cam.sy(wy(lat));
      if (y < 0 || y > vh) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(vw, y);
    }
    const spanDeg = cam.visibleLonSpan();
    const [, lonC] = cam.unproject(cam.ox, cam.oy);
    const start = Math.floor((lonC - spanDeg) / step) * step;
    for (let lon = start; lon <= lonC + spanDeg; lon += step) {
      const x = cam.sx(((lon + 180) / 360) * W0);
      ctx.moveTo(x, cam.sy(wy(84)));
      ctx.lineTo(x, cam.sy(wy(-84)));
    }
    ctx.stroke();
    // equator slightly brighter
    ctx.strokeStyle = 'rgba(120,170,220,0.12)';
    ctx.beginPath();
    const eq = cam.sy(wy(0));
    ctx.moveTo(0, eq);
    ctx.lineTo(vw, eq);
    ctx.stroke();
  }

  /* ------------------------------------------------------------- overlays */

  private kmToPx(cam: Camera, km: number) {
    return (km / KM_PER_DEG) * (H0 / 180) * cam.s;
  }

  private ellipse(ctx: CanvasRenderingContext2D, cam: Camera, lat: number, lon: number, km: number) {
    const [x, y] = cam.project(lat, lon);
    const ry = this.kmToPx(cam, km);
    const rx = ry / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  private drawCoverage(ctx: CanvasRenderingContext2D, cam: Camera, v: View, pos: (u: UnitView) => { lat: number; lon: number }) {
    ctx.beginPath();
    for (const u of v.units) {
      if (u.side !== v.side || !u.type || u.state === 'building') continue;
      const r = CATALOG[u.type].sensorKm;
      if (!r) continue;
      if ((u.domain === 'air' || u.domain === 'drone') && (u.state === 'ready' || u.state === 'rearming')) continue;
      const p = pos(u);
      this.ellipse(ctx, cam, p.lat, p.lon, r);
    }
    for (const b of v.bases) {
      if (b.side !== v.side) continue;
      this.ellipse(ctx, cam, b.lat, b.lon, b.type === 'hq' ? 900 : b.type === 'airbase' ? 600 : 500);
    }
    ctx.fillStyle = v.side === 'blue' ? 'rgba(77,163,255,0.07)' : 'rgba(255,77,94,0.07)';
    ctx.fill('nonzero');
  }

  private drawNodeZones(ctx: CanvasRenderingContext2D, cam: Camera, nodes: StrategicNode[]) {
    for (const n of nodes) {
      ctx.beginPath();
      this.ellipse(ctx, cam, n.lat, n.lon, n.radiusKm);
      const c = n.owner ? sideColor(n.owner) : COLORS.neutral;
      ctx.fillStyle = n.owner === 'blue' ? 'rgba(77,163,255,0.08)' : n.owner === 'red' ? 'rgba(255,77,94,0.08)' : 'rgba(199,210,224,0.05)';
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
  }

  private drawTracks(ctx: CanvasRenderingContext2D, cam: Camera, v: View, t: number, me: Side) {
    for (const u of v.units) {
      if (!u.orbit) continue;
      const own = u.side === me;
      ctx.strokeStyle = sideColor(u.side);
      ctx.globalAlpha = own ? 0.35 : 0.2;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      let last: [number, number] | null = null;
      for (let k = 0; k <= 50; k++) {
        const p = orbitPos(u.orbit, t + k);
        const [x, y] = cam.project(p.lat, p.lon);
        if (!last || Math.abs(x - last[0]) > cam.vw / 2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        last = [x, y];
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  private drawThreats(ctx: CanvasRenderingContext2D, cam: Camera, v: View, pos: (u: UnitView) => { lat: number; lon: number }, inp: RenderInput) {
    if (inp.attract) return;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    for (const u of v.units) {
      if (u.side === v.side || !u.type) continue;
      const w = CATALOG[u.type].weapon;
      if (!w || !w.targets.includes('air') || u.domain === 'air') continue;
      const p = pos(u);
      ctx.beginPath();
      this.ellipse(ctx, cam, p.lat, p.lon, w.rangeKm);
      ctx.strokeStyle = 'rgba(255,77,94,0.38)';
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawSelectionAids(ctx: CanvasRenderingContext2D, cam: Camera, v: View, pos: (u: UnitView) => { lat: number; lon: number }, inp: RenderInput) {
    for (const u of v.units) {
      if (!inp.selection.has(u.id) || !u.type) continue;
      const p = pos(u);
      const spec = CATALOG[u.type];
      const own = u.side === v.side;
      // weapon range
      if (spec.weapon) {
        ctx.beginPath();
        this.ellipse(ctx, cam, p.lat, p.lon, spec.weapon.rangeKm);
        ctx.strokeStyle = own ? 'rgba(77,163,255,0.55)' : 'rgba(255,77,94,0.6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (!own) continue;
      // path
      const [x0, y0] = cam.project(p.lat, p.lon);
      if (u.path.length) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        let lx = x0;
        for (const [la, lo] of u.path) {
          let [x, y] = cam.project(la, lo);
          // keep the line continuous across wrap
          while (x - lx > (W0 * cam.s) / 2) x -= W0 * cam.s;
          while (lx - x > (W0 * cam.s) / 2) x += W0 * cam.s;
          ctx.lineTo(x, y);
          lx = x;
        }
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(230,237,246,0.7)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.setLineDash([]);
        const end = u.path[u.path.length - 1];
        const [ex, ey] = cam.project(end[0], end[1]);
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
      }
      if (u.order.kind === 'attack') {
        const t = v.units.find((x) => x.id === (u.order as { targetId: string }).targetId) ?? v.bases.find((b) => b.id === (u.order as { targetId: string }).targetId);
        if (t) {
          const tp = 'domain' in t ? pos(t as UnitView) : t;
          const [tx, ty] = cam.project(tp.lat, tp.lon);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = 'rgba(255,138,61,0.8)';
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (u.order.kind === 'patrol' || (u.mission.kind === 'patrol' && (u.domain === 'air' || u.domain === 'drone'))) {
        const m = u.mission.kind === 'patrol' ? u.mission : (u.order as { lat: number; lon: number });
        ctx.beginPath();
        this.ellipse(ctx, cam, m.lat, m.lon, 140);
        ctx.strokeStyle = 'rgba(230,237,246,0.5)';
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawShots(ctx: CanvasRenderingContext2D, cam: Camera, v: View, t: number) {
    for (const s of v.shots) {
      const p = Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)));
      const [x1, y1] = cam.project(s.fromLat, s.fromLon);
      let [x2, y2] = cam.project(s.toLat, s.toLon);
      if (Math.abs(x2 - x1) > (W0 * cam.s) / 2) x2 += x2 > x1 ? -W0 * cam.s : W0 * cam.s;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const cx = mx, cy = my - Math.min(80, len * 0.25);
      const at = (k: number): [number, number] => [
        (1 - k) * (1 - k) * x1 + 2 * (1 - k) * k * cx + k * k * x2,
        (1 - k) * (1 - k) * y1 + 2 * (1 - k) * k * cy + k * k * y2,
      ];
      const col = sideColor(s.side);
      ctx.beginPath();
      const a = Math.max(0, p - 0.35);
      for (let k = a; k <= p; k += 0.04) {
        const [x, y] = at(k);
        if (k === a) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      for (let k = 0; k <= 1.0001; k += 0.05) {
        const [x, y] = at(k);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const [hx, hy] = at(p);
      ctx.beginPath();
      ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  private drawGhosts(ctx: CanvasRenderingContext2D, cam: Camera, v: View) {
    for (const g of v.ghosts) {
      const [x, y] = cam.project(g.lat, g.lon);
      if (x < -20 || y < -20 || x > cam.vw + 20 || y > cam.vh + 20) continue;
      const a = Math.max(0.15, 1 - g.age / RULES.ghostSeconds) * 0.7;
      ctx.globalAlpha = a;
      this.frame(ctx, x, y, 9, 'hostile', 'transparent', COLORS.ghost, true);
      this.glyph(ctx, glyphFor(g.type, g.domain), x, y, 11, COLORS.ghost);
      ctx.globalAlpha = 1;
      this.picks.push({ kind: 'ghost', id: g.id, x, y, r: 10, side: g.side });
    }
  }

  private drawBases(ctx: CanvasRenderingContext2D, cam: Camera, v: View) {
    const grounded = new Map<string, number>();
    for (const u of v.units) {
      if (u.side === v.side && (u.domain === 'air' || u.domain === 'drone') && (u.state === 'ready' || u.state === 'rearming' || u.state === 'building') && u.homeId) {
        grounded.set(u.homeId, (grounded.get(u.homeId) ?? 0) + 1);
      }
    }
    for (const b of v.bases) {
      const [x, y] = cam.project(b.lat, b.lon);
      if (x < -30 || y < -30 || x > cam.vw + 30 || y > cam.vh + 30) continue;
      const col = sideColor(b.side);
      const size = b.type === 'hq' ? 26 : 19;
      ctx.beginPath();
      ctx.rect(x - size / 2, y - size / 2, size, size);
      ctx.fillStyle = 'rgba(6,14,26,0.85)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = b.disabled ? COLORS.ghost : col;
      ctx.stroke();
      this.glyph(ctx, GLYPHS[b.type], x, y, size - 6, b.disabled ? COLORS.ghost : col);
      if (b.hp < b.maxHp) this.hpBar(ctx, x, y + size / 2 + 3, size, b.hp / b.maxHp);
      const n = grounded.get(b.id);
      if (n) this.badge(ctx, x + size / 2, y - size / 2, String(n), col);
      if (cam.zoom > 1.8 || b.type === 'hq') {
        this.label(ctx, b.name, x, y + size / 2 + (b.hp < b.maxHp ? 13 : 9), b.disabled ? COLORS.ghost : COLORS.inkDim, 10);
      }
      this.picks.push({ kind: 'base', id: b.id, x, y, r: size / 2 + 3, side: b.side });
    }
  }

  private drawNodes(ctx: CanvasRenderingContext2D, cam: Camera, nodes: StrategicNode[], now: number) {
    for (const n of nodes) {
      const [x, y] = cam.project(n.lat, n.lon);
      const col = n.owner ? sideColor(n.owner) : COLORS.neutral;
      const r = 13;
      // hexagon
      ctx.save();
      ctx.translate(x - r, y - r);
      ctx.scale((r * 2) / 24, (r * 2) / 24);
      const hex = glyphPath(GLYPHS.node);
      ctx.fillStyle = 'rgba(6,14,26,0.92)';
      ctx.fill(hex);
      ctx.lineWidth = 2.2 / ((r * 2) / 24);
      ctx.strokeStyle = col;
      ctx.stroke(hex);
      ctx.restore();
      // control arc: blue clockwise, red counter-clockwise
      const frac = Math.abs(n.control) / 100;
      if (frac > 0.01) {
        ctx.beginPath();
        const start = -Math.PI / 2;
        const dir = n.control > 0 ? 1 : -1;
        ctx.arc(x, y, r + 4, start, start + dir * frac * Math.PI * 2, dir < 0);
        ctx.strokeStyle = n.control > 0 ? COLORS.blue : COLORS.red;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (n.contested) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 220);
        ctx.beginPath();
        ctx.arc(x, y, r + 8 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,197,61,${0.4 + 0.4 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // index glyph: first letter
      ctx.fillStyle = col;
      ctx.font = '700 11px Rajdhani, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.short.slice(0, 2).toUpperCase(), x, y + 0.5);
      this.picks.push({ kind: 'node', id: n.id, x, y, r: r + 4 });
    }
  }

  /** Off-screen objectives get a chip on the viewport edge pointing at them. */
  private drawEdgeMarkers(ctx: CanvasRenderingContext2D, cam: Camera, nodes: StrategicNode[]) {
    const m = 22;
    // keep clear of the map controls column on the right
    const l = cam.insets.left + m, t = cam.insets.top + m, r = cam.vw - cam.insets.right - m - 54, b = cam.vh - cam.insets.bottom - m;
    const cx = cam.ox, cy = cam.oy;
    for (const n of nodes) {
      const [x, y] = cam.project(n.lat, n.lon);
      if (x >= l - m && x <= r + m && y >= t - m && y <= b + m) continue;
      const dx = x - cx, dy = y - cy;
      const k = Math.min(dx ? Math.abs((dx > 0 ? r - cx : cx - l) / dx) : Infinity, dy ? Math.abs((dy > 0 ? b - cy : cy - t) / dy) : Infinity);
      const ex = cx + dx * k, ey = cy + dy * k;
      const col = n.owner ? sideColor(n.owner) : COLORS.neutral;
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(4, -6);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fillStyle = n.contested ? COLORS.unknown : col;
      ctx.fill();
      ctx.restore();
      const label = n.short.toUpperCase();
      ctx.font = '700 10px Rajdhani, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 10;
      const lx = Math.max(l - 10 + w / 2, Math.min(r + 10 - w / 2, ex - Math.cos(ang) * (w / 2 + 2)));
      const ly = Math.max(t - 8, Math.min(b + 8, ey - Math.sin(ang) * 12));
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - 8, w, 16, 8);
      ctx.fillStyle = 'rgba(6,14,26,0.88)';
      ctx.fill();
      ctx.strokeStyle = n.contested ? COLORS.unknown : col;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 0.5);
      this.picks.push({ kind: 'node', id: n.id, x: lx, y: ly, r: Math.max(12, w / 2) });
    }
  }

  private drawNodeLabels(ctx: CanvasRenderingContext2D, cam: Camera, nodes: StrategicNode[]) {
    for (const n of nodes) {
      const [x, y] = cam.project(n.lat, n.lon);
      const col = n.owner === 'blue' ? '#9ccdff' : n.owner === 'red' ? '#ff9aa5' : COLORS.ink;
      this.label(ctx, n.short.toUpperCase(), x, y + 25, col, 11.5, true);
    }
  }

  private drawUnits(ctx: CanvasRenderingContext2D, cam: Camera, v: View, pos: (u: UnitView) => { lat: number; lon: number }, inp: RenderInput) {
    const me = v.side;
    const list = v.units
      .filter((u) => {
        if (u.state === 'building') return false;
        // parked aircraft are shown as a count on their base
        if (u.side === me && !inp.attract && (u.domain === 'air' || u.domain === 'drone') && (u.state === 'ready' || u.state === 'rearming') && !inp.selection.has(u.id)) return false;
        if (inp.attract && (u.domain === 'air' || u.domain === 'drone') && (u.state === 'ready' || u.state === 'rearming')) return false;
        return true;
      })
      .sort((a, b) => DOMAIN_ORDER[a.domain] - DOMAIN_ORDER[b.domain]);

    // screen positions + clustering at low zoom
    type Item = { u: UnitView; x: number; y: number };
    const items: Item[] = [];
    for (const u of list) {
      const p = pos(u);
      const [x, y] = cam.project(p.lat, p.lon);
      if (x < -40 || y < -40 || x > cam.vw + 40 || y > cam.vh + 40) continue;
      items.push({ u, x, y });
    }
    const R = inp.touch ? 13 : 11;
    const clusterPx = (cam.zoom < 2.2 ? 20 : cam.zoom < 4 ? 12 : 0) * (inp.touch ? 1.5 : 1);
    const clusters: Item[][] = [];
    if (clusterPx) {
      for (const it of items) {
        if (inp.selection.has(it.u.id) || it.u.domain === 'space') {
          clusters.push([it]);
          continue;
        }
        const c = clusters.find((cl) => {
          const h = cl[0];
          return h.u.side === it.u.side && h.u.domain !== 'space' && !inp.selection.has(h.u.id) && Math.abs(h.x - it.x) < clusterPx && Math.abs(h.y - it.y) < clusterPx;
        });
        if (c) c.push(it);
        else clusters.push([it]);
      }
    } else for (const it of items) clusters.push([it]);

    for (const cl of clusters) {
      const h = cl[0];
      const u = h.u;
      const x = cl.reduce((a, b) => a + b.x, 0) / cl.length;
      const y = cl.reduce((a, b) => a + b.y, 0) / cl.length;
      const friendly = u.side === me || inp.attract;
      const col = !u.identified && !friendly ? COLORS.unknown : sideColor(u.side);
      const shape = (inp.attract ? u.side === 'blue' : u.side === me) ? 'friendly' : 'hostile';
      const hl = cl.some((c) => inp.highlight.has(c.u.id));
      const sel = cl.some((c) => inp.selection.has(c.u.id));
      const hov = cl.some((c) => inp.hover === c.u.id);

      if (hl) {
        const pulse = (inp.now % 1200) / 1200;
        ctx.beginPath();
        ctx.arc(x, y, R + 4 + pulse * 10, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,210,63,${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (sel || hov) {
        ctx.beginPath();
        ctx.arc(x, y, R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = sel ? 2 : 1.5;
        ctx.stroke();
      }
      // heading tick for moving units
      if (u.domain !== 'space' && (u.state === 'moving' || u.state === 'engaged' || u.state === 'rtb' || u.state === 'embarked' || u.state === 'patrol') && cl.length === 1) {
        const a = ((u.heading - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (R + 1), y + Math.sin(a) * (R + 1));
        ctx.lineTo(x + Math.cos(a) * (R + 8), y + Math.sin(a) * (R + 8));
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const dashed = u.state === 'embarked';
      this.frame(ctx, x, y, R, shape, 'rgba(6,14,26,0.9)', col, dashed);
      if (!u.identified && !friendly) {
        ctx.fillStyle = COLORS.unknown;
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y + 1);
      } else {
        this.glyph(ctx, glyphFor(u.type, u.domain), x, y, R * 1.25, col);
      }
      if (cl.length > 1) {
        this.badge(ctx, x + R * 0.85, y - R * 0.85, String(cl.length), col);
      } else {
        if (u.identified && u.hp < u.maxHp) this.hpBar(ctx, x, y + R + 3, R * 2, u.hp / u.maxHp);
        if (u.side === me && u.state === 'rtb') this.badge(ctx, x - R * 0.9, y - R * 0.9, '↩', COLORS.ghost);
        if (u.side === me && (u.domain === 'air' || u.domain === 'drone') && u.fuel >= 0 && u.type && CATALOG[u.type].endurance) {
          const f = u.fuel / CATALOG[u.type].endurance!;
          if (f < 0.25 && u.state !== 'ready' && u.state !== 'rearming') this.badge(ctx, x + R * 0.9, y + R * 0.9, '⛽', COLORS.high);
        }
        if (cam.zoom > 3.2 || sel || hov) {
          this.label(ctx, u.identified || friendly ? u.name : 'UNKNOWN', x, y + R + (u.hp < u.maxHp ? 13 : 9), u.side === me ? COLORS.ink : COLORS.inkDim, 10);
        }
      }
      if (cl.length > 1) {
        this.picks.push({ kind: 'cluster', id: u.id, ids: cl.map((c) => c.u.id), x, y, r: R + 4, side: u.side });
      } else {
        this.picks.push({ kind: 'unit', id: u.id, x, y, r: R + 3, side: u.side });
      }
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, cam: Camera, inp: RenderInput) {
    for (const e of inp.effects) {
      const k = (inp.now - e.t0) / (e.kind === 'capture' ? 1600 : 1000);
      if (k < 0 || k > 1) continue;
      const [x, y] = cam.project(e.lat, e.lon);
      ctx.beginPath();
      ctx.arc(x, y, 6 + k * (e.kind === 'capture' ? 46 : 26), 0, Math.PI * 2);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = e.kind === 'boom' ? 3 : 2;
      ctx.stroke();
      if (e.kind === 'boom' && k < 0.3) {
        ctx.beginPath();
        ctx.arc(x, y, 7 * (1 - k), 0, Math.PI * 2);
        ctx.fillStyle = '#ffd9a0';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------- primitives */

  private frame(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: 'friendly' | 'hostile', fill: string, stroke: string, dashed = false) {
    ctx.beginPath();
    if (shape === 'friendly') ctx.arc(x, y, r, 0, Math.PI * 2);
    else {
      const d = r * 1.18;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (dashed) ctx.setLineDash([3, 2]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private glyph(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, size: number, color: string) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = color;
    ctx.fill(glyphPath(d));
    ctx.restore();
  }

  private badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
    ctx.font = '700 9.5px system-ui, sans-serif';
    const w = Math.max(13, ctx.measureText(text).width + 6);
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 6.5, w, 13, 6.5);
    ctx.fillStyle = '#0a1422';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, f: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 3);
    ctx.fillStyle = f < 0.35 ? COLORS.critical : f < 0.7 ? COLORS.medium : COLORS.ok;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, f), 3);
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number, bold = false) {
    ctx.font = `${bold ? 700 : 600} ${size}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4,10,20,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

export function relevantPoints(v: View, includeEnemy = true): [number, number][] {
  const pts: [number, number][] = [];
  for (const n of v.nodes) pts.push([n.lat, n.lon]);
  for (const b of v.bases) if (b.side === v.side) pts.push([b.lat, b.lon]);
  for (const u of v.units) {
    if (u.domain === 'space') continue;
    if (u.side === v.side || includeEnemy) pts.push([u.lat, u.lon]);
  }
  return pts;
}

export type { Base };
