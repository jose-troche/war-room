import { CATALOG, RULES } from '../../shared/catalog';
import { NODE_LAND_POINT } from '../../shared/scenario';
import type { Base, StrategicNode, TargetClass, UnitType, UnitView, View } from '../../shared/types';
import { dur, kmBetween } from './text';
import type { SuggestedAction } from './types';

/**
 * Course-of-action generation: turn a threat or opportunity into one-click orders using
 * the forces the commander actually has available.
 */

const isAirLike = (u: UnitView) => u.domain === 'air' || u.domain === 'drone';

export function homeOf(v: View, u: UnitView): { lat: number; lon: number } {
  return v.bases.find((b) => b.id === u.homeId) ?? v.units.find((x) => x.id === u.homeId) ?? u;
}

/** Can this unit take a new task without abandoning something important? */
export function available(u: UnitView): boolean {
  if (u.state === 'building' || u.domain === 'space') return false;
  if (isAirLike(u)) return (u.state === 'ready' && u.mission.kind === 'hold') || u.mission.kind === 'patrol' || u.state === 'rearming';
  return u.order.kind !== 'attack';
}

/** Seconds for `u` to reach (lat,lon); Infinity when out of reach. */
export function etaTo(v: View, u: UnitView, lat: number, lon: number, standoffKm = 0): number {
  if (!u.type) return Infinity;
  const spec = CATALOG[u.type];
  if (spec.speed <= 0) return Infinity;
  if (isAirLike(u)) {
    const h = homeOf(v, u);
    const origin = u.state === 'ready' || u.state === 'rearming' ? h : u;
    const d = Math.max(0, kmBetween(origin.lat, origin.lon, lat, lon) - standoffKm);
    const fromHome = kmBetween(h.lat, h.lon, lat, lon);
    if (fromHome * 2 > (spec.endurance ?? 0) * spec.speed * 0.95) return Infinity;
    return d / spec.speed + (u.state === 'rearming' ? (u.buildLeft ?? 8) : 0);
  }
  const d = Math.max(0, kmBetween(u.lat, u.lon, lat, lon) - standoffKm);
  return (d * 1.3) / spec.speed;
}

const PREF: Partial<Record<TargetClass, UnitType[]>> = {
  sea: ['bomber', 'strike_drone', 'submarine', 'missile', 'destroyer'],
  sub: ['destroyer', 'submarine', 'strike_drone'],
  air: ['fighter'],
  drone: ['fighter'],
  land: ['bomber', 'strike_drone', 'missile', 'armor'],
  base: ['bomber', 'missile', 'strike_drone'],
  space: ['asat'],
};

/** Best units to engage a target (enemy unit or base). */
export function counterTo(v: View, target: UnitView | Base, max = 2): SuggestedAction[] {
  const tClass: TargetClass = 'domain' in target ? target.domain : 'base';
  const prefs = PREF[tClass] ?? [];
  const cands: { u: UnitView; eta: number }[] = [];
  for (const u of v.units) {
    if (u.side !== v.side || !u.type || !prefs.includes(u.type) || !available(u)) continue;
    const w = CATALOG[u.type].weapon;
    if (!w || !w.targets.includes(tClass)) continue;
    if (u.type === 'asat' || CATALOG[u.type].speed <= 6) {
      // fixed launchers: only if already in range
      if (kmBetween(u.lat, u.lon, target.lat, target.lon) > w.rangeKm || u.cd > 0) continue;
      cands.push({ u, eta: 0 });
      continue;
    }
    const eta = etaTo(v, u, target.lat, target.lon, w.rangeKm * 0.8);
    if (eta > 240) continue;
    cands.push({ u, eta });
  }
  cands.sort((a, b) => a.eta * (1 + prefs.indexOf(a.u.type!) * 0.25) - b.eta * (1 + prefs.indexOf(b.u.type!) * 0.25));
  const out: SuggestedAction[] = [];
  const usedTypes = new Set<string>();
  const tName = 'domain' in target ? (target.identified ? target.name : 'contact') : target.name;
  for (const c of cands) {
    if (out.length >= max) break;
    if (usedTypes.has(c.u.type!) && cands.length > max) continue;
    usedTypes.add(c.u.type!);
    const verb = c.u.type === 'asat' ? 'Launch ASAT' : isAirLike(c.u) || c.u.type === 'missile' ? 'Strike with' : 'Engage with';
    out.push({
      label: c.u.type === 'asat' ? `Launch ${c.u.name}` : `${verb} ${c.u.name}${c.eta > 1 ? ` · ETA ${dur(c.eta)}` : ''}`,
      cmd: { type: 'order', unitIds: [c.u.id], order: { kind: 'attack', targetId: target.id } },
      describe: `${c.u.name} → attack ${tName}`,
    });
  }
  return out;
}

/** Send capable forces to take or hold a node. */
export function reinforceNode(v: View, n: StrategicNode, max = 2): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const cands: { u: UnitView; eta: number }[] = [];
  for (const u of v.units) {
    if (u.side !== v.side || !u.type || !available(u)) continue;
    const cap = CATALOG[u.type].captures;
    if (!cap || (n.kind !== 'both' && cap !== n.kind)) continue;
    const near = kmBetween(u.lat, u.lon, n.lat, n.lon) < n.radiusKm;
    if (near) continue;
    const m = u.mission;
    if ((m.kind === 'move' || m.kind === 'patrol') && kmBetween(m.lat, m.lon, n.lat, n.lon) < n.radiusKm * 1.5) continue;
    const eta = etaTo(v, u, n.lat, n.lon);
    if (eta > 300) continue;
    cands.push({ u, eta });
  }
  cands.sort((a, b) => a.eta - b.eta + (a.u.type === 'carrier' ? 60 : 0) - (b.u.type === 'carrier' ? 60 : 0));
  for (const c of cands.slice(0, max)) {
    const lp = c.u.domain === 'land' ? NODE_LAND_POINT[n.id] ?? [n.lat, n.lon] : [n.lat, n.lon];
    out.push({
      label: `Send ${c.u.name} · ETA ${dur(c.eta)}`,
      cmd: { type: 'order', unitIds: [c.u.id], order: { kind: 'move', lat: lp[0], lon: lp[1] } },
      describe: `${c.u.name} → ${n.short}`,
    });
  }
  // air cover if enemy aircraft are around
  const enemyAir = v.units.some((e) => e.side !== v.side && isAirLike({ domain: e.domain } as UnitView) && kmBetween(e.lat, e.lon, n.lat, n.lon) < 1500);
  if (enemyAir && out.length < max + 1) {
    const f = v.units
      .filter((u) => u.side === v.side && u.type === 'fighter' && u.state === 'ready' && u.mission.kind === 'hold')
      .map((u) => ({ u, eta: etaTo(v, u, n.lat, n.lon) }))
      .filter((x) => x.eta < 120)
      .sort((a, b) => a.eta - b.eta)[0];
    if (f) {
      out.push({
        label: `Air cover: ${f.u.name} · ETA ${dur(f.eta)}`,
        cmd: { type: 'order', unitIds: [f.u.id], order: { kind: 'patrol', lat: n.lat, lon: n.lon } },
        describe: `${f.u.name} CAP over ${n.short}`,
      });
    }
  }
  return out;
}

/** Enemy air-defense umbrellas that cover a point. */
export function aaThreatsAt(v: View, lat: number, lon: number): UnitView[] {
  return v.units.filter((e) => {
    if (e.side === v.side || !e.type || isAirLike(e)) return false;
    const w = CATALOG[e.type].weapon;
    return !!w && w.targets.includes('air') && kmBetween(e.lat, e.lon, lat, lon) < w.rangeKm;
  });
}

export interface Recommendation { score: number; text: string; actions: SuggestedAction[]; lat?: number; lon?: number }

/** Ranked list of what the commander should consider next. */
export function recommendations(v: View): Recommendation[] {
  const recs: Recommendation[] = [];
  const me = v.side;
  const enemyHeld = v.nodes.filter((n) => n.owner && n.owner !== me).length;
  const myHeld = v.nodes.filter((n) => n.owner === me).length;

  for (const n of v.nodes) {
    const enemyNear = v.units.filter((e) => e.side !== me && e.domain !== 'space' && e.domain !== 'air' && kmBetween(e.lat, e.lon, n.lat, n.lon) < n.radiusKm * 1.5);
    const myNear = v.units.filter((u) => u.side === me && u.type && CATALOG[u.type].captures && kmBetween(u.lat, u.lon, n.lat, n.lon) < n.radiusKm);
    if (n.owner === me && (n.contested || enemyNear.length)) {
      const acts = reinforceNode(v, n);
      const strike = enemyNear.find((e) => e.identified);
      if (strike) acts.push(...counterTo(v, strike, 1));
      recs.push({ score: 90, text: `Hold ${n.short}: ${enemyNear.length} hostile ${enemyNear.length === 1 ? 'unit' : 'units'} in the zone.`, actions: acts.slice(0, 3), lat: n.lat, lon: n.lon });
    } else if (!n.owner && !myNear.length) {
      const acts = reinforceNode(v, n);
      if (acts.length) recs.push({ score: enemyNear.length ? 55 : 70, text: `Take ${n.short} — ${enemyNear.length ? 'enemy is moving in' : 'it is unclaimed'}.`, actions: acts, lat: n.lat, lon: n.lon });
    } else if (n.owner && n.owner !== me && !myNear.length) {
      const acts = reinforceNode(v, n);
      const strike = enemyNear.find((e) => e.identified);
      if (strike) acts.unshift(...counterTo(v, strike, 1));
      if (acts.length) recs.push({ score: 60 + (enemyHeld >= RULES.majorityNodes ? 30 : 0), text: `Retake ${n.short}${enemyHeld >= RULES.majorityNodes ? ' — break their majority bonus' : ''}.`, actions: acts.slice(0, 3), lat: n.lat, lon: n.lon });
    }
  }

  // high-value targets in reach
  for (const e of v.units) {
    if (e.side === me || !e.identified || !e.type) continue;
    if (e.type === 'carrier' || e.type === 'awacs' || (e.type === 'destroyer' && e.hp < e.maxHp * 0.5)) {
      const acts = counterTo(v, e, 2);
      if (acts.length) recs.push({ score: e.type === 'carrier' ? 65 : 45, text: `Strike opportunity: ${e.name}${e.hp < e.maxHp ? ` (${Math.round((e.hp / e.maxHp) * 100)}%)` : ''}.`, actions: acts, lat: e.lat, lon: e.lon });
    }
    if (e.domain === 'space') {
      const acts = counterTo(v, e, 1);
      if (acts.length) recs.push({ score: 50, text: `${e.name} is overhead an ASAT site — shoot it down.`, actions: acts, lat: e.lat, lon: e.lon });
    }
  }

  // aircraft parked in harm's way
  for (const u of v.units) {
    if (u.side !== me || !isAirLike(u) || u.state === 'ready' || u.state === 'rearming' || u.state === 'rtb') continue;
    const th = aaThreatsAt(v, u.lat, u.lon);
    if (th.length && u.type !== 'bomber') {
      recs.push({
        score: 58, text: `${u.name} is inside ${th[0].identified ? th[0].name : 'enemy'} air defenses.`,
        actions: [{ label: `Pull ${u.name} back`, cmd: { type: 'order', unitIds: [u.id], order: { kind: 'rtb' } }, describe: `${u.name} RTB` }],
        lat: u.lat, lon: u.lon,
      });
    }
  }

  const buy = buySuggestion(v);
  if (buy) recs.push({ score: 35 + Math.min(30, (v.cp - 300) / 10), text: buy.why, actions: [buy.action] });

  if (myHeld < 2 && !recs.length) recs.push({ score: 20, text: 'Concentrate surface ships on the nearest neutral chokepoint.', actions: [] });
  return recs.sort((a, b) => b.score - a.score);
}

/** What to requisition with available CP. */
export function buySuggestion(v: View): { action: SuggestedAction; why: string } | null {
  const mine = v.units.filter((u) => u.side === v.side);
  const count = (t: UnitType) => mine.filter((u) => u.type === t).length;
  const bases = v.bases.filter((b) => b.side === v.side && !b.disabled);
  const pick = (t: UnitType, why: string, near?: { lat: number; lon: number }) => {
    const spec = CATALOG[t];
    if (spec.cost > v.cp) return null;
    const cands = bases.filter((b) => spec.spawnAt.includes(b.type));
    if (!cands.length) return null;
    const focus = near ?? v.nodes.find((n) => n.owner !== v.side) ?? v.nodes[0];
    cands.sort((a, b) => kmBetween(a.lat, a.lon, focus.lat, focus.lon) - kmBetween(b.lat, b.lon, focus.lat, focus.lon));
    const b = cands[0];
    return {
      action: { label: `Deploy ${spec.label} at ${b.name} · ${spec.cost} CP`, cmd: { type: 'buy' as const, unitType: t, baseId: b.id }, describe: `Requisitioned ${spec.label} at ${b.name}` },
      why: `${Math.floor(v.cp)} CP available — ${why}`,
    };
  };
  if (!count('comms_sat')) return pick('comms_sat', 'replace the comms satellite to restore +20% accuracy.');
  if (!count('recon_sat')) return pick('recon_sat', 'we are blind from orbit; launch a recon satellite.');
  const pressured = v.nodes.find((n) => n.kind !== 'land' && (n.contested || n.owner !== v.side));
  if (count('destroyer') + count('carrier') < 4) return pick('destroyer', 'more hulls to hold chokepoints.', pressured);
  const enemySurface = v.units.filter((e) => e.side !== v.side && e.domain === 'sea').length;
  if (enemySurface >= 3) return pick('bomber', `${enemySurface} enemy ships tracked — add strike power.`, pressured);
  if (count('fighter') < 3) return pick('fighter', 'rebuild air cover.');
  if (v.cp > 450) return pick('destroyer', 'bank is high; convert it into sea control.', pressured);
  return null;
}
