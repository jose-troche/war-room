import { useEffect, useRef, useState } from 'preact/hooks';
import { CATALOG } from '../../shared/catalog';
import { NODE_LAND_POINT } from '../../shared/scenario';
import {
  canAttack, clearSelection, commandAttack, commandMoveTo, openBase, openNode, openUnit, orderUnits, selectedUnits, selectUnits,
} from '../actions';
import { clickMode, frame, highlights, hoverId, isMobile, mode, panel, paused, selection, settings, view } from '../store';
import { camera, renderer } from './controller';
import type { Pick } from './renderer';

interface Tip { x: number; y: number; title: string; sub: string; side?: string }

export function MapView({ insetBottom = 0 }: { insetBottom?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    camera.insets = { top: 0, right: 0, bottom: insetBottom, left: 0 };
    camera.clamp();
  }, [insetBottom]);

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext('2d', { alpha: false })!;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      camera.resize(r.width, r.height);
    });
    ro.observe(el);

    let raf = 0;
    const touch = matchMedia('(pointer: coarse)').matches;
    const draw = (now: number) => {
      camera.update(now);
      const v = view.value;
      const hl = highlights.value;
      const alpha = paused.value ? 1 : Math.min(1, (now - frame.tView) / Math.max(16, frame.interval));
      frame.effects = frame.effects.filter((e) => now - e.t0 < 2000);
      renderer.draw(ctx, camera, dpr, v ? {
        v, alpha, prev: frame.prev,
        selection: new Set(selection.value),
        hover: hoverId.value,
        highlight: new Set(now < hl.until ? hl.ids : []),
        layers: settings.value,
        now,
        attract: mode.value === 'attract',
        effects: frame.effects,
        touch,
      } : null);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  /* ---------------------------------------------------------- interaction */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean; box: boolean; pinch?: number; long?: number; button: number } | null>(null);

  const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pickAt = (x: number, y: number, extra = 0): Pick | null => {
    let best: Pick | null = null;
    let bd = Infinity;
    // later picks were drawn on top
    for (let i = renderer.picks.length - 1; i >= 0; i--) {
      const p = renderer.picks[i];
      const d = Math.hypot(p.x - x, p.y - y);
      const rank = p.kind === 'unit' || p.kind === 'cluster' ? 0 : p.kind === 'node' ? 2 : 4;
      if (d <= p.r + extra && d + rank < bd) {
        bd = d + rank;
        best = p;
      }
    }
    return best;
  };

  const onClick = (x: number, y: number, additive: boolean, coarse: boolean) => {
    if (mode.value === 'attract') return;
    const v = view.value;
    if (!v) return;
    const p = pickAt(x, y, coarse ? 10 : 2);
    const me = v.side;
    const hasSel = selectedUnits().length > 0;
    if (p?.kind === 'unit' || p?.kind === 'ghost') {
      if (p.side === me) {
        if (clickMode.value === 'attack') return;
        selectUnits([p.id], additive);
        return;
      }
      if (hasSel && p.kind === 'unit' && canAttack(p.id)) {
        commandAttack(p.id);
        return;
      }
      if (p.kind === 'unit') openUnit(p.id);
      return;
    }
    if (p?.kind === 'cluster') {
      const ids = p.ids ?? [p.id];
      if (p.side === me) {
        selectUnits(ids, additive);
      } else if (hasSel) {
        const target = ids.find((id) => canAttack(id));
        if (target) commandAttack(target);
      }
      const pts = ids.map((id) => renderer.positions.get(id)).filter(Boolean).map((q) => [q!.lat, q!.lon] as [number, number]);
      if (pts.length) camera.fitPoints(pts, true, Math.max(camera.zoom * 2.2, 3));
      return;
    }
    if (p?.kind === 'node') {
      const n = v.nodes.find((x) => x.id === p.id)!;
      if (hasSel && clickMode.value !== 'attack') {
        // send ships to the node, ground units to its land point, aircraft to patrol it
        const units = selectedUnits().filter((u) => u.type && CATALOG[u.type].speed > 0);
        const land = units.filter((u) => u.domain === 'land');
        const rest = units.filter((u) => u.domain !== 'land');
        const lp = NODE_LAND_POINT[n.id];
        if (rest.length) orderUnits(rest.map((u) => u.id), { kind: 'move', lat: n.lat, lon: n.lon }, `${rest.length === 1 ? rest[0].name : rest.length + ' units'} → ${n.short}`);
        if (land.length) orderUnits(land.map((u) => u.id), { kind: 'move', lat: lp ? lp[0] : n.lat, lon: lp ? lp[1] : n.lon }, `${land.length === 1 ? land[0].name : land.length + ' units'} → ${n.short}`);
        if (units.length) return;
      }
      openNode(p.id, false);
      return;
    }
    if (p?.kind === 'base') {
      const b = v.bases.find((x) => x.id === p.id)!;
      if (b.side !== me && hasSel && canAttack(b.id)) {
        commandAttack(b.id);
        return;
      }
      if (b.side === me && hasSel && clickMode.value === 'smart') {
        const units = selectedUnits();
        if (units.every((u) => u.domain === 'air' || u.domain === 'drone')) {
          orderUnits(units.map((u) => u.id), { kind: 'rtb' }, 'Returning to base');
          return;
        }
      }
      openBase(b.id);
      return;
    }
    // empty map
    if (hasSel) {
      const [lat, lon] = camera.unproject(x, y);
      commandMoveTo(lat, lon);
    } else {
      clearSelection();
      if (panel.value.kind !== 'forces') panel.value = { kind: 'forces' };
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = local(e);
    pointers.current.set(e.pointerId, { x, y });
    if (pointers.current.size === 1) {
      gesture.current = { x, y, t: performance.now(), moved: false, box: e.shiftKey && e.pointerType === 'mouse', button: e.button };
      if (e.pointerType === 'touch') {
        gesture.current.long = window.setTimeout(() => {
          const g = gesture.current;
          if (g && !g.moved) {
            const p = pickAt(x, y, 10);
            if (p && (p.kind === 'unit' || p.kind === 'cluster') && p.side === view.value?.side) {
              selectUnits(p.ids ?? [p.id], true);
              navigator.vibrate?.(15);
            }
            g.moved = true; // suppress click
          }
        }, 520);
      }
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = true;
      clearTimeout(gesture.current.long);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const { x, y } = local(e);
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev) {
      // hover
      if (e.pointerType === 'mouse') {
        const p = pickAt(x, y, 2);
        hoverId.value = p?.kind === 'unit' ? p.id : null;
        setTip(p ? tipFor(p, x, y) : null);
        wrap.current!.style.cursor = p ? 'pointer' : selection.value.length ? (clickMode.value === 'attack' ? 'crosshair' : 'cell') : 'grab';
      }
      return;
    }
    pointers.current.set(e.pointerId, { x, y });
    if (!g) return;
    if (pointers.current.size === 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      camera.zoomAt(d / g.pinch, mx, my);
      g.pinch = d;
      if (e.pointerId === [...pointers.current.keys()][0]) camera.panBy((x - prev.x) / 2, (y - prev.y) / 2);
      else camera.panBy((x - prev.x) / 2, (y - prev.y) / 2);
      return;
    }
    if (!g.moved && Math.hypot(x - g.x, y - g.y) > 6) {
      g.moved = true;
      clearTimeout(g.long);
      setTip(null);
    }
    if (!g.moved) return;
    if (g.box) setBox({ x0: g.x, y0: g.y, x1: x, y1: y });
    else camera.panBy(x - prev.x, y - prev.y);
  };

  const onPointerUp = (e: PointerEvent) => {
    const { x, y } = local(e);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g) return;
    clearTimeout(g.long);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (g.box && box) {
      const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      const me = view.value?.side;
      const ids = renderer.picks
        .filter((p) => (p.kind === 'unit' || p.kind === 'cluster') && p.side === me && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        .flatMap((p) => p.ids ?? [p.id]);
      setBox(null);
      if (ids.length) selectUnits(ids, true);
      return;
    }
    setBox(null);
    if (!g.moved && g.button === 0) onClick(x, y, e.shiftKey || e.metaKey || e.ctrlKey, e.pointerType !== 'mouse');
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { x, y } = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    camera.zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)), x, y);
  };

  const onDbl = (e: MouseEvent) => {
    const { x, y } = local(e);
    if (!pickAt(x, y)) camera.zoomAt(2, x, y);
  };

  const onContext = (e: MouseEvent) => {
    // right click: direct order with current selection
    e.preventDefault();
    if (mode.value === 'attract' || !selection.value.length) return;
    const { x, y } = local(e);
    const p = pickAt(x, y, 2);
    if (p && p.side && p.side !== view.value?.side && (p.kind === 'unit' || p.kind === 'base')) commandAttack(p.id);
    else if (!p) {
      const [lat, lon] = camera.unproject(x, y);
      commandMoveTo(lat, lon);
    } else onClick(x, y, false, false);
  };

  return (
    <div
      ref={wrap}
      class="map"
      data-tour="map"
      onPointerDown={onPointerDown as never}
      onPointerMove={onPointerMove as never}
      onPointerUp={onPointerUp as never}
      onPointerCancel={onPointerUp as never}
      onPointerLeave={() => {
        hoverId.value = null;
        setTip(null);
      }}
      onWheel={onWheel as never}
      onDblClick={onDbl as never}
      onContextMenu={onContext as never}
      role="application"
      aria-label="World battle map. Use the Ask ATLAS box or panels for keyboard access."
    >
      <canvas ref={canvas} />
      {box && (
        <div class="map-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />
      )}
      {tip && !isMobile.value && (
        <div class={`map-tip side-${tip.side ?? 'none'}`} style={{ left: tip.x + 14, top: tip.y + 12 }}>
          <b>{tip.title}</b>
          <span>{tip.sub}</span>
        </div>
      )}
    </div>
  );
}

function tipFor(p: Pick, x: number, y: number): Tip | null {
  const v = view.value;
  if (!v) return null;
  if (p.kind === 'unit' || p.kind === 'ghost') {
    const u = v.units.find((q) => q.id === p.id);
    if (p.kind === 'ghost') {
      const g = v.ghosts.find((q) => q.id === p.id);
      return g ? { x, y, title: 'Last known position', sub: `${g.type ? CATALOG[g.type].label : 'Unknown ' + g.domain} · ${Math.round(g.age)}s ago`, side: 'ghost' } : null;
    }
    if (!u) return null;
    if (!u.identified && u.side !== v.side) return { x, y, title: 'Unidentified contact', sub: `${u.domain} track — get closer to classify`, side: 'unknown' };
    const hp = Math.round((u.hp / u.maxHp) * 100);
    const state = u.state === 'rtb' ? 'returning to base' : u.state;
    return { x, y, title: u.name, sub: `${CATALOG[u.type!].label} · ${hp}% · ${state}`, side: u.side };
  }
  if (p.kind === 'cluster') {
    const n = p.ids?.length ?? 0;
    return { x, y, title: `${n} units`, sub: 'Click to zoom in & select', side: p.side };
  }
  if (p.kind === 'node') {
    const n = v.nodes.find((q) => q.id === p.id);
    if (!n) return null;
    const own = n.owner ? (n.owner === v.side ? 'held by us' : 'held by enemy') : 'neutral';
    return { x, y, title: n.name, sub: `${own}${n.contested ? ' · CONTESTED' : ''} · control ${Math.round(n.control)}`, side: n.owner ?? 'none' };
  }
  if (p.kind === 'base') {
    const b = v.bases.find((q) => q.id === p.id);
    if (!b) return null;
    return { x, y, title: b.name, sub: `${b.type === 'hq' ? 'Headquarters' : b.type === 'port' ? 'Naval port' : 'Airbase'} · ${Math.round((b.hp / b.maxHp) * 100)}%${b.disabled ? ' · DISABLED' : ''}`, side: b.side };
  }
  return null;
}
