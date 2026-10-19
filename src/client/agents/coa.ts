import { AiCommander } from '../../shared/ai';
import { CATALOG, RULES } from '../../shared/catalog';
import { NODE_LAND_POINT } from '../../shared/scenario';
import type { Base, Command, Side, StrategicNode, TargetClass, UnitType, UnitView, View } from '../../shared/types';
import { dur, kmBetween, nearestNode } from './text';
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
  // ships and ground forces already under way keep their tasking — re-tasking them causes ping-pong
  return u.order.kind !== 'attack' && u.path.length === 0;
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

  // the planning cell's coherent plan comes first; hand-built node advice only fills gaps
  const plan = planRecommendations(v);
  const planned = new Set(plan.map((r) => (r.lat !== undefined ? nearestNode(v, r.lat, r.lon!, 900)?.id : undefined)).filter(Boolean));
  const keep = recs.filter((r) => {
    const n = r.lat !== undefined ? nearestNode(v, r.lat, r.lon!, 600) : null;
    return !(n && planned.has(n.id) && /^(Hold|Take|Retake) /.test(r.text));
  });
  recs.length = 0;
  recs.push(...keep);
  for (const r of plan) if (!r.text.startsWith('Reinforce:')) r.score += 30;
  recs.push(...plan);

  // spending advice ranks below operations unless the bank is getting large
  const buy = recs.some((r) => r.text.startsWith('Reinforce:')) ? null : buySuggestion(v);
  if (buy) recs.push({ score: 20 + Math.min(40, Math.max(0, v.cp - 300) / 8), text: buy.why, actions: [buy.action] });

  if (myHeld < 2 && !recs.length) recs.push({ score: 5, text: 'Concentrate surface ships on the nearest neutral chokepoint.', actions: [] });
  // never offer the same unit twice across the list
  const used = new Set<string>();
  const out: Recommendation[] = [];
  for (const r of recs.sort((a, b) => b.score - a.score)) {
    r.actions = r.actions.filter((a) => {
      const ids = [a.cmd, ...(a.cmds ?? [])].flatMap((c) => (c && c.type === 'order' ? c.unitIds : []));
      if (ids.some((id) => used.has(id))) return false;
      ids.forEach((id) => used.add(id));
      return true;
    });
    if (r.actions.length || !recs.some((x) => x.actions.length)) out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------------ planning cell */

/**
 * ATLAS's planning cell: a shadow commander for our side (the same planner the machine
 * opponent uses) whose intended moves become one-click recommendations.
 */
const planners: Partial<Record<Side, { t: number; plan: Command[] }>> = {};
const PLAN_EVERY = 2.5;

export function currentPlan(v: View): Command[] {
  let p = planners[v.side];
  if (!p || v.t < p.t) p = planners[v.side] = { t: -99, plan: [] };
  if (v.t - p.t >= PLAN_EVERY) {
    // a fresh, memory-less planner each cycle: it plans from what units are actually doing,
    // so advice the commander ignored is simply proposed again
    const fresh: Command[] = [];
    const ai = new AiCommander(v.side, 'elite', 7);
    if (ai.update({ ...v, t: Math.max(v.t, 2) }, (c) => fresh.push(c))) p.plan = fresh;
    p.t = v.t;
  }
  // drop planned orders that are already in progress
  p.plan = p.plan.filter((c) => {
    if (c.type !== 'order') return v.cp >= CATALOG[c.unitType].cost;
    return c.unitIds.some((id) => {
      const u = v.units.find((x) => x.id === id);
      if (!u) return false;
      const o = c.order;
      if (o.kind === 'attack') return u.order.kind !== 'attack' || u.order.targetId !== o.targetId;
      if (o.kind === 'move' || o.kind === 'patrol') {
        const m = u.mission;
        return !((m.kind === 'move' || m.kind === 'patrol') && kmBetween(m.lat, m.lon, o.lat, o.lon) < 400);
      }
      return true;
    });
  });
  return p.plan;
}

function planRecommendations(v: View): Recommendation[] {
  const out: Recommendation[] = [];
  for (const c of currentPlan(v)) {
    if (c.type === 'buy') {
      const spec = CATALOG[c.unitType];
      const b = v.bases.find((x) => x.id === c.baseId);
      if (!b || v.cp < spec.cost + 120 || out.some((r) => r.text.startsWith('Reinforce:'))) continue;
      // only reinforce where it matters: within reach of a contested or enemy-held objective
      if (!v.nodes.some((n) => n.owner !== v.side && kmBetween(n.lat, n.lon, b.lat, b.lon) < 4500)) continue;
      out.push({ score: 8, text: `Reinforce: deploy a ${spec.label} at ${b.name}.`, actions: [{ label: `Deploy ${spec.label} · ${spec.cost} CP`, cmd: c, describe: `Requisitioned ${spec.label} at ${b.name}` }], lat: b.lat, lon: b.lon });
      continue;
    }
    const units = c.unitIds.map((id) => v.units.find((u) => u.id === id)).filter((u): u is UnitView => !!u);
    if (!units.length) continue;
    const names = units.map((u) => u.name).join(' + ');
    const o = c.order;
    if (o.kind === 'attack') {
      const t = v.units.find((x) => x.id === o.targetId) ?? v.bases.find((x) => x.id === o.targetId);
      if (!t) continue;
      const tName = 'domain' in t ? (t.identified ? t.name : 'contact') : t.name;
      const isBase = !('domain' in t);
      const sat = 'domain' in t && t.domain === 'space';
      const eta = sat ? 0 : Math.max(...units.map((u) => etaTo(v, u, t.lat, t.lon, (CATALOG[u.type!].weapon?.rangeKm ?? 0) * 0.8)));
      const n = nearestNode(v, t.lat, t.lon, 1500);
      out.push({
        score: sat ? 55 : isBase ? 50 : 'type' in t && t.type === 'carrier' ? 70 : 62,
        text: sat ? `Shoot down ${tName} while it is overhead.` : `Strike ${tName}${n ? ` near ${n.short}` : ''}.`,
        actions: [{ label: `${sat ? 'Launch' : 'Strike with'} ${names}${isFinite(eta) && eta > 1 ? ` · ETA ${dur(eta)}` : ''}`, cmd: c, describe: `${names} → attack ${tName}` }],
        lat: t.lat, lon: t.lon,
      });
    } else if (o.kind === 'move' || o.kind === 'patrol') {
      const n = nearestNode(v, o.lat, o.lon, 900);
      const air = units.every((u) => u.domain === 'air' || u.domain === 'drone');
      const eta = Math.max(...units.map((u) => etaTo(v, u, o.lat, o.lon)));
      const where = n ? n.short : 'the area';
      const recon = units.every((u) => u.type === 'recon_drone' || u.type === 'awacs');
      out.push({
        score: air ? (recon ? 30 : 46) : n && n.owner !== v.side ? 60 : 52,
        text: air ? (recon ? `Put eyes on ${where}.` : `Air cover over ${where}.`) : `${n && n.owner && n.owner !== v.side ? 'Retake' : n && n.owner === v.side ? 'Hold' : 'Take'} ${where} with ${names}.`,
        actions: [{ label: `${air ? (recon ? 'Scout' : 'Patrol') : 'Send'} ${names}${isFinite(eta) ? ` · ETA ${dur(eta)}` : ''}`, cmd: c, describe: `${names} → ${where}` }],
        lat: o.lat, lon: o.lon,
      });
    }
  }
  return out;
}

/** Plan actions that concern a node (orders into its zone), falling back to nearest capable units. */
export function nodeActions(v: View, n: StrategicNode, max = 2): SuggestedAction[] {
  const fromPlan = planRecommendations(v)
    .filter((r) => r.lat !== undefined && kmBetween(r.lat, r.lon!, n.lat, n.lon) < n.radiusKm * 2.5)
    .flatMap((r) => r.actions);
  return (fromPlan.length ? fromPlan : reinforceNode(v, n, max)).slice(0, max);
}

/** Forget planning state (new match). */
export function resetPlanner() {
  delete planners.blue;
  delete planners.red;
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
