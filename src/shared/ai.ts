import { CATALOG } from './catalog';
import { distKm } from './geo';
import { NODE_LAND_POINT } from './scenario';
import type { Base, Command, Side, StrategicNode, UnitType, UnitView, View } from './types';
import { otherSide } from './types';
import { Rng } from './rng';

export type Difficulty = 'recruit' | 'veteran' | 'elite';

export const DIFFICULTY: Record<Difficulty, { label: string; interval: number; reserve: number; aggression: number; cpMult: number; blurb: string }> = {
  // Humans act on a handful of things at a time; lower levels give the machine slower reactions and thinner logistics.
  recruit: { label: 'Recruit', interval: 15, reserve: 500, aggression: 0.25, cpMult: 0.5, blurb: 'Slow, cautious opponent. Learn the ropes.' },
  veteran: { label: 'Veteran', interval: 7, reserve: 200, aggression: 0.7, cpMult: 0.8, blurb: 'Competent and balanced.' },
  elite: { label: 'Elite', interval: 3, reserve: 40, aggression: 1, cpMult: 1, blurb: 'Full-strength machine: fast, coordinated, hunts your satellites.' },
};

const SURFACE: UnitType[] = ['destroyer', 'carrier'];

/**
 * Utility-based machine commander. It only ever sees its own fog-of-war View,
 * exactly like a human player.
 */
export class AiCommander {
  private nextAt = 2;
  private assign = new Map<string, string>(); // unitId -> nodeId
  private lastReassign = 0;
  private rng: Rng;

  constructor(public side: Side, public difficulty: Difficulty, seed = 1) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    // gentler levels give the human a moment to read the board before the first moves
    this.nextAt = { recruit: 25, veteran: 8, elite: 2 }[difficulty];
  }

  /** Plans and issues commands when its reaction interval has elapsed. Returns true if it ran. */
  update(v: View, issue: (cmd: Command) => void): boolean {
    if (v.ended || v.t < this.nextAt) return false;
    const cfg = DIFFICULTY[this.difficulty];
    this.nextAt = v.t + cfg.interval * this.rng.range(0.8, 1.2);
    const me = this.side;
    const mine = v.units.filter((u) => u.side === me && u.state !== 'building');
    const enemies = v.units.filter((u) => u.side !== me);
    const ids = new Set(mine.map((u) => u.id));
    for (const id of [...this.assign.keys()]) if (!ids.has(id)) this.assign.delete(id);
    // infer assignments from what units are actually doing (robust to orders we never saw issued)
    for (const u of mine) {
      if (this.assign.has(u.id) || !u.type || !CATALOG[u.type].captures) continue;
      const m = u.mission;
      const p = m.kind === 'move' || m.kind === 'patrol' ? m : u;
      const n = v.nodes.find((x) => (x.kind === 'both' || x.kind === CATALOG[u.type!].captures) && distKm(p.lat, p.lon, x.lat, x.lon) < x.radiusKm * 1.6);
      if (n) this.assign.set(u.id, n.id);
    }

    const nodeValue = (n: StrategicNode) => {
      let val = n.owner === me ? 4 : n.owner ? 12 : 10;
      if (n.contested) val += 6;
      const threat = enemies.some((e) => e.domain !== 'space' && distKm(e.lat, e.lon, n.lat, n.lon) < 1200);
      if (n.owner === me && threat) val += 8;
      return val;
    };
    const order = (u: UnitView, o: Command & { type: 'order' }) => issue(o);
    // known enemy air defenses (ships, SAMs, bases)
    const aaThreats: { lat: number; lon: number; r: number }[] = [
      ...enemies.filter((e) => e.type && CATALOG[e.type].weapon?.targets.includes('air')).map((e) => ({ lat: e.lat, lon: e.lon, r: CATALOG[e.type!].weapon!.rangeKm })),
      ...v.bases.filter((b) => b.side !== me && !b.disabled).map((b) => ({ lat: b.lat, lon: b.lon, r: b.type === 'hq' ? 520 : 300 })),
    ];
    /** Pull a patrol point back toward `home` until it is outside known enemy air defenses. */
    const safePoint = (p: { lat: number; lon: number }, home: { lat: number; lon: number }, margin: number) => {
      for (let f = 0; f <= 0.8; f += 0.1) {
        const q = { lat: p.lat + (home.lat - p.lat) * f, lon: p.lon + (home.lon - p.lon) * f };
        if (!aaThreats.some((t) => distKm(t.lat, t.lon, q.lat, q.lon) < t.r + margin)) return q;
      }
      return null;
    };

    /* ---------- surface fleet: take and hold sea chokepoints ---------- */
    const seaNodes = v.nodes.filter((n) => n.kind !== 'land');
    const need = new Map<string, number>();
    for (const n of seaNodes) {
      const secure = n.owner === me && !n.contested && !enemies.some((e) => (e.domain === 'sea') && distKm(e.lat, e.lon, n.lat, n.lon) < 1500);
      need.set(n.id, secure ? 1 : 2);
    }
    for (const [uid, nid] of this.assign) {
      const u = mine.find((x) => x.id === uid);
      if (u && SURFACE.includes(u.type!)) need.set(nid, (need.get(nid) ?? 0) - 1);
    }
    const reassign = v.t - this.lastReassign > 30;
    if (reassign) this.lastReassign = v.t;
    for (const u of mine) {
      if (!SURFACE.includes(u.type!)) continue;
      const cur = this.assign.get(u.id);
      const idle = u.path.length === 0 && u.order.kind !== 'attack';
      if (cur && !(reassign && idle && (need.get(cur) ?? 0) < 0)) continue;
      if (!idle && cur) continue;
      let best: StrategicNode | null = null;
      let bestScore = 0;
      for (const n of seaNodes) {
        const nd = need.get(n.id) ?? 0;
        if (nd <= 0) continue;
        const sc = (nodeValue(n) * nd) / (1 + distKm(u.lat, u.lon, n.lat, n.lon) / 2500);
        if (sc > bestScore) {
          bestScore = sc;
          best = n;
        }
      }
      if (!best) continue;
      if (cur) need.set(cur, (need.get(cur) ?? 0) + 1);
      this.assign.set(u.id, best.id);
      need.set(best.id, (need.get(best.id) ?? 0) - 1);
      const jitter = u.type === 'carrier' ? 2.5 : 0.8;
      order(u, { type: 'order', unitIds: [u.id], order: { kind: 'move', lat: best.lat + this.rng.range(-jitter, jitter), lon: best.lon + this.rng.range(-jitter, jitter) } });
    }

    /* ---------- submarines: hunt high-value ships, else lurk at enemy nodes ---------- */
    for (const u of mine.filter((x) => x.type === 'submarine')) {
      if (u.order.kind === 'attack') continue;
      const prey = nearest(u, enemies.filter((e) => (e.domain === 'sea') && e.identified), 3500);
      if (prey) {
        order(u, { type: 'order', unitIds: [u.id], order: { kind: 'attack', targetId: prey.id } });
      } else if (u.path.length === 0) {
        const tgt = nearestNode(u, seaNodes.filter((n) => n.owner && n.owner !== me)) ?? nearestNode(u, seaNodes.filter((n) => n.owner !== me));
        if (tgt && distKm(u.lat, u.lon, tgt.lat, tgt.lon) > 300) {
          order(u, { type: 'order', unitIds: [u.id], order: { kind: 'move', lat: tgt.lat + this.rng.range(-1.5, 1.5), lon: tgt.lon + this.rng.range(-1.5, 1.5) } });
        }
      }
    }

    /* ---------- ground forces: land objectives ---------- */
    const landNodes = v.nodes.filter((n) => n.kind !== 'sea');
    for (const u of mine.filter((x) => x.type === 'armor')) {
      if (u.path.length || u.state === 'embarked') continue;
      const assigned = this.assign.get(u.id);
      const node = assigned ? landNodes.find((n) => n.id === assigned) : null;
      if (node && (node.owner !== me || node.contested)) {
        const lp = NODE_LAND_POINT[node.id] ?? [node.lat, node.lon];
        if (distKm(u.lat, u.lon, lp[0], lp[1]) > 150) order(u, { type: 'order', unitIds: [u.id], order: { kind: 'move', lat: lp[0], lon: lp[1] } });
        continue;
      }
      // enemy armor nearby? engage it
      const foe = nearest(u, enemies.filter((e) => e.type === 'armor'), 900);
      if (foe) {
        order(u, { type: 'order', unitIds: [u.id], order: { kind: 'attack', targetId: foe.id } });
        continue;
      }
      let best: StrategicNode | null = null;
      let bs = 0;
      for (const n of landNodes) {
        if (n.owner === me && !n.contested) continue;
        const sc = nodeValue(n) / (1 + distKm(u.lat, u.lon, n.lat, n.lon) / 1500);
        if (sc > bs) {
          bs = sc;
          best = n;
        }
      }
      if (best && bs > 0.8) {
        this.assign.set(u.id, best.id);
        const lp = NODE_LAND_POINT[best.id] ?? [best.lat, best.lon];
        order(u, { type: 'order', unitIds: [u.id], order: { kind: 'move', lat: lp[0], lon: lp[1] } });
      }
    }

    /* ---------- air: CAP over contested nodes, strikes on detected ships/armor ---------- */
    const myBases = v.bases.filter((b) => b.side === me);
    const homeOf = (u: UnitView) => myBases.find((b) => b.id === u.homeId) ?? mine.find((c) => c.id === u.homeId) ?? u;
    const radius = (u: UnitView) => ((CATALOG[u.type!].endurance ?? 0) * CATALOG[u.type!].speed) / 2.3;
    const capTargets = v.nodes
      .filter((n) => n.contested || (n.owner !== me && enemies.some((e) => distKm(e.lat, e.lon, n.lat, n.lon) < 1200)) || (n.owner === me && enemies.some((e) => (e.domain === 'air' || e.domain === 'drone') && distKm(e.lat, e.lon, n.lat, n.lon) < 1500)))
      .sort((a, b) => nodeValue(b) - nodeValue(a));
    const fighters = mine.filter((u) => u.type === 'fighter' && u.state === 'ready' && u.mission.kind === 'hold');
    const capCovered = new Set(mine.filter((u) => u.type === 'fighter' && u.mission.kind === 'patrol').map((u) => nearestNodeId(u.mission as { lat: number; lon: number }, v.nodes)));
    const keepHome = this.difficulty === 'recruit' ? 2 : 1;
    let spare = Math.max(0, fighters.length - keepHome);
    for (const n of capTargets) {
      if (!spare) break;
      if (capCovered.has(n.id)) continue;
      const f = fighters.find((u) => {
        const h = homeOf(u);
        return distKm(h.lat, h.lon, n.lat, n.lon) < radius(u);
      });
      if (!f) continue;
      const pt = safePoint(n, homeOf(f), 200);
      if (!pt) continue;
      fighters.splice(fighters.indexOf(f), 1);
      spare--;
      capCovered.add(n.id);
      order(f, { type: 'order', unitIds: [f.id], order: { kind: 'patrol', lat: pt.lat, lon: pt.lon } });
    }

    const strikers = mine.filter((u) => (u.type === 'bomber' || u.type === 'strike_drone') && u.state === 'ready' && u.mission.kind === 'hold');
    const prey = enemies
      .filter((e) => e.identified && (e.domain === 'sea' || e.domain === 'land') && e.type !== 'asat')
      .map((e) => {
        const nearNode = v.nodes.some((n) => distKm(e.lat, e.lon, n.lat, n.lon) < 1200);
        return { e, score: CATALOG[e.type!].value * (nearNode ? 1.6 : 1) * (e.hp < e.maxHp * 0.5 ? 1.3 : 1) };
      })
      .sort((a, b) => b.score - a.score);
    for (const { e } of prey) {
      const crew = strikers.filter((u) => {
        const h = homeOf(u);
        return distKm(h.lat, h.lon, e.lat, e.lon) < radius(u);
      });
      if (!crew.length) continue;
      const n = this.difficulty === 'elite' ? Math.min(2, crew.length) : 1;
      if (this.rng.next() > cfg.aggression) continue;
      const team = crew.slice(0, n);
      for (const u of team) strikers.splice(strikers.indexOf(u), 1);
      issue({ type: 'order', unitIds: team.map((u) => u.id), order: { kind: 'attack', targetId: e.id } });
    }
    // Elite: decapitation raid when bombers can reach the enemy HQ
    if (this.difficulty !== 'recruit' && v.t > 240) {
      const hq = v.bases.find((b) => b.side !== me && b.type === 'hq');
      const bombers = strikers.filter((u) => u.type === 'bomber');
      if (hq && bombers.length >= 2) {
        const crew = bombers.filter((u) => {
          const h = homeOf(u);
          return distKm(h.lat, h.lon, hq.lat, hq.lon) < radius(u);
        });
        if (crew.length >= 2 && this.rng.next() < (this.difficulty === 'elite' ? 0.5 : 0.2)) {
          issue({ type: 'order', unitIds: crew.map((u) => u.id), order: { kind: 'attack', targetId: hq.id } });
        }
      }
    }

    /* ---------- recon: put eyes on nodes we can't see ---------- */
    const watched = new Set(
      mine.filter((u) => (u.type === 'recon_drone' || u.type === 'awacs') && u.mission.kind === 'patrol')
        .map((u) => nearestNodeId(u.mission as { lat: number; lon: number }, v.nodes)),
    );
    for (const u of mine.filter((x) => (x.type === 'recon_drone' || x.type === 'awacs') && x.state === 'ready' && x.mission.kind === 'hold')) {
      const h = homeOf(u);
      const cands = v.nodes
        .filter((n) => !watched.has(n.id) && distKm(h.lat, h.lon, n.lat, n.lon) < radius(u))
        .sort((a, b) => nodeValue(b) - nodeValue(a));
      const n = cands[0];
      if (!n) continue;
      // stay outside known air defenses; AWACS keeps a bigger margin
      const pt = safePoint(n, h, u.type === 'awacs' ? 500 : 150);
      if (!pt) continue;
      watched.add(n.id);
      order(u, { type: 'order', unitIds: [u.id], order: { kind: 'patrol', lat: pt.lat, lon: pt.lon } });
    }

    /* ---------- space: ASAT shots ---------- */
    for (const site of mine.filter((u) => u.type === 'asat' && u.cd <= 0 && u.order.kind !== 'attack')) {
      if (this.difficulty === 'recruit' && this.rng.next() < 0.6) continue;
      const sats = enemies.filter((e) => e.domain === 'space').sort((a, b) => (a.type === 'recon_sat' ? -1 : 1) - (b.type === 'recon_sat' ? -1 : 1));
      const t = sats.find((s) => distKm(site.lat, site.lon, s.lat, s.lon) < CATALOG.asat.weapon!.rangeKm * 0.9);
      if (t) issue({ type: 'order', unitIds: [site.id], order: { kind: 'attack', targetId: t.id } });
    }

    /* ---------- requisition ---------- */
    this.requisition(v, mine, enemies, myBases, issue);
    return true;
  }

  private requisition(v: View, mine: UnitView[], enemies: UnitView[], bases: Base[], issue: (c: Command) => void) {
    const cfg = DIFFICULTY[this.difficulty];
    const cp = v.cp - cfg.reserve;
    if (cp <= 0) return;
    const count = (t: UnitType) => mine.filter((u) => u.type === t).length + v.units.filter((u) => u.side === this.side && u.type === t && u.state === 'building').length;
    const want: UnitType[] = [];
    if (count('comms_sat') === 0) want.push('comms_sat');
    if (count('destroyer') + count('carrier') < 4) want.push('destroyer');
    if (count('recon_sat') < 1) want.push('recon_sat');
    if (count('fighter') < 3) want.push('fighter');
    const landNodesOpen = v.nodes.filter((n) => n.kind !== 'sea' && n.owner !== this.side);
    if (landNodesOpen.length && count('armor') < 2) want.push('armor');
    const enemySurface = enemies.filter((e) => e.domain === 'sea').length;
    if (enemySurface > 2) want.push(this.rng.next() < 0.5 ? 'strike_drone' : 'submarine');
    if (!want.length) want.push(this.rng.pick(['destroyer', 'destroyer', 'strike_drone', 'fighter', 'bomber', 'submarine', 'recon_drone'] as UnitType[]));
    const type = want[0];
    const spec = CATALOG[type];
    if (spec.cost > cp) return;
    // spawn at the base closest to where the action is
    const focus = v.nodes.filter((n) => n.owner !== this.side || n.contested)[0] ?? v.nodes[0];
    const cands = bases.filter((b) => !b.disabled && spec.spawnAt.includes(b.type));
    cands.sort((a, b) => distKm(a.lat, a.lon, focus.lat, focus.lon) - distKm(b.lat, b.lon, focus.lat, focus.lon));
    if (cands[0]) issue({ type: 'buy', unitType: type, baseId: cands[0].id });
  }
}

function nearest(u: { lat: number; lon: number }, list: UnitView[], maxKm: number): UnitView | null {
  let best: UnitView | null = null;
  let bd = maxKm;
  for (const e of list) {
    const d = distKm(u.lat, u.lon, e.lat, e.lon);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function nearestNode(u: { lat: number; lon: number }, nodes: StrategicNode[]): StrategicNode | null {
  let best: StrategicNode | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    const d = distKm(u.lat, u.lon, n.lat, n.lon);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function nearestNodeId(p: { lat: number; lon: number }, nodes: StrategicNode[]): string | undefined {
  return nearestNode(p, nodes)?.id;
}

export const enemyOf = otherSide;
