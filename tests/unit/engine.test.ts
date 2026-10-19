import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/shared/engine';
import { findPath } from '../../src/shared/path';
import { isLand } from '../../src/shared/geo';

describe('geo + path', () => {
  it('land mask knows continents and oceans', () => {
    expect(isLand(39, -98)).toBe(true); // Kansas
    expect(isLand(48, 68)).toBe(true); // Kazakhstan
    expect(isLand(30, -40)).toBe(false); // Atlantic
    expect(isLand(-10, 80)).toBe(false); // Indian Ocean
  });

  it('ships route Atlantic → Pacific through Panama', () => {
    const p = findPath([15, -75], [5, -85], { mover: 'sea' });
    expect(p).not.toBeNull();
    expect(p!.length).toBeLessThan(12);
  });

  it('ships route around Africa when Suez is blocked', () => {
    const open = findPath([33, 25], [15, 60], { mover: 'sea' })!;
    const blocked = findPath([33, 25], [15, 60], { mover: 'sea', blocked: new Set([58 * 360 + 212, 59 * 360 + 212, 60 * 360 + 212]) })!;
    expect(open).not.toBeNull();
    expect(blocked).not.toBeNull();
    const minLat = Math.min(...blocked.map((x) => x[0]));
    expect(minLat).toBeLessThan(-30); // around the Cape
  });
});

describe('engine', () => {
  it('runs deterministically for a given seed', () => {
    const a = Engine.create(42), b = Engine.create(42);
    for (let i = 0; i < 400; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(a.s.units)).toEqual(JSON.stringify(b.s.units));
  });

  it('accrues VP for held nodes and produces views with fog', () => {
    const e = Engine.create(7);
    for (let i = 0; i < 40; i++) e.tick();
    expect(e.s.vp.blue).toBeGreaterThan(0);
    const v = e.viewFor('blue');
    expect(v.units.filter((u) => u.side === 'blue').length).toBeGreaterThan(20);
    // satellites are always visible
    expect(v.units.some((u) => u.side === 'red' && u.domain === 'space')).toBe(true);
    // enemy carrier in the Arabian Sea should not be visible at start
    expect(v.units.some((u) => u.side === 'red' && u.type === 'carrier')).toBe(false);
  });

  it('moves a destroyer and captures Gibraltar', () => {
    const e = Engine.create(1);
    const lance = e.s.units.find((u) => u.name === 'DDG LANCE')!;
    const r = e.command('blue', { type: 'order', unitIds: [lance.id], order: { kind: 'move', lat: 36, lon: -6.5 } });
    expect(r.ok).toBe(true);
    for (let i = 0; i < 4 * 120; i++) e.tick();
    const g = e.s.nodes.find((n) => n.id === 'gibraltar')!;
    expect(g.owner).toBe('blue');
  });

  it('launches fighters on patrol and returns them at bingo', () => {
    const e = Engine.create(3);
    const v = e.s.units.find((u) => u.name === 'VIPER-1')!;
    const r = e.command('blue', { type: 'order', unitIds: [v.id], order: { kind: 'move', lat: 30, lon: -70 } });
    expect(r.ok).toBe(true);
    expect(v.state).toBe('moving');
    let sawRtb = false;
    for (let i = 0; i < 4 * 100; i++) {
      e.tick();
      if (v.state === 'rtb') sawRtb = true;
    }
    expect(sawRtb).toBe(true);
  });

  it('buys reinforcements with CP', () => {
    const e = Engine.create(5);
    const r = e.command('blue', { type: 'buy', unitType: 'destroyer', baseId: 'b-trident' });
    expect(r.ok).toBe(true);
    expect(e.s.cp.blue).toBeLessThan(300);
    for (let i = 0; i < 4 * 21; i++) e.tick();
    expect(e.unit(r.unitId!)!.state).toBe('ready');
  });

  it('serializes and resumes', () => {
    const e = Engine.create(9);
    for (let i = 0; i < 50; i++) e.tick();
    const copy = new Engine(JSON.parse(JSON.stringify(e.s)));
    for (let i = 0; i < 50; i++) { e.tick(); copy.tick(); }
    expect(copy.s.t).toBe(e.s.t);
  });
});
