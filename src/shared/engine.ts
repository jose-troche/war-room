import { BASE_SPECS, CATALOG, isAirborneType, RULES, type WeaponSpec } from './catalog';
import { cellCenter, cellOf, distKm, headingDeg, isLand, stepToward, wrapLon } from './geo';
import { findPath, nearestPassable, type Mover } from './path';
import { Rng } from './rng';
import { createInitialState, nextName } from './scenario';
import type {
  Base, Command, Contact, Domain, GameEvent, GameState, GhostView, LatLon, Order, Orbit, Shot, Side,
  StrategicNode, TargetClass, Unit, UnitType, UnitView, View,
} from './types';
import { otherSide, SIDES } from './types';

const RAD = Math.PI / 180;
const AT_BASE_KM = 40;
const REARM_SECONDS = 8;
const PATROL_RADIUS_KM = 140;
const HIGH_VALUE: UnitType[] = ['carrier', 'awacs', 'recon_sat', 'comms_sat', 'bomber'];

export function orbitPos(o: Orbit, t: number): { lat: number; lon: number } {
  const u = o.phase0 + (2 * Math.PI * t) / o.period;
  const inc = o.inc * RAD;
  const lat = Math.asin(Math.sin(inc) * Math.sin(u)) / RAD;
  const lon = o.lon0 + Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) / RAD - (22.5 / o.period) * t;
  return { lat, lon: wrapLon(lon) };
}

export const domainOf = (u: { type: UnitType }): Domain => CATALOG[u.type].domain;
const isAir = (u: Unit) => isAirborneType(u.type);
const isSat = (u: Unit) => domainOf(u) === 'space';
const moverOf = (u: Unit): Mover | null => {
  const d = domainOf(u);
  if (d === 'sea' || d === 'sub') return 'sea';
  if (d === 'land') return 'land';
  return null;
};

export interface CommandResult { ok: boolean; error?: string; unitId?: string }

export class Engine {
  s: GameState;
  rng: Rng;
  private acc = 0;
  private outbox: Record<Side, GameEvent[]> = { blue: [], red: [] };
  private byId = new Map<string, Unit>();
  private baseById = new Map<string, Base>();
  /** sides for which a contact is currently (this tick) detected */
  private seen: Record<Side, Set<string>> = { blue: new Set(), red: new Set() };
  private shotSeq = 1;

  constructor(state?: GameState, seed = Date.now() % 1e9) {
    this.s = state ?? createInitialState(seed);
    this.rng = new Rng(this.s.rngState);
    this.reindex();
    if (!state) {
      this.snapNavalStarts();
      this.updateSatellites();
      this.sense();
      // initial detections are not "news"
      this.outbox = { blue: [], red: [] };
    } else {
      this.sense();
    }
  }

  static create(seed: number): Engine {
    return new Engine(undefined, seed);
  }

  /* ------------------------------------------------------------------ helpers */

  private reindex() {
    this.byId.clear();
    for (const u of this.s.units) this.byId.set(u.id, u);
    this.baseById.clear();
    for (const b of this.s.bases) this.baseById.set(b.id, b);
  }

  unit(id: string): Unit | undefined {
    return this.byId.get(id);
  }
  base(id: string): Base | undefined {
    return this.baseById.get(id);
  }

  private emit(sides: Side[] | Side, ev: Omit<GameEvent, 't'>) {
    const e = { t: this.s.t, ...ev } as GameEvent;
    for (const s of Array.isArray(sides) ? sides : [sides]) this.outbox[s].push(e);
  }

  private unitEv(u: Unit) {
    return { side: u.side, unitId: u.id, unitType: u.type, unitName: u.name, lat: u.lat, lon: u.lon };
  }

  private snapNavalStarts() {
    for (const u of this.s.units) {
      if (moverOf(u) === 'sea' && isLand(u.lat, u.lon)) {
        const c = nearestPassable(u.lat, u.lon, { mover: 'sea' }, 6);
        if (c) [u.lat, u.lon] = cellCenter(c[0], c[1]);
      }
    }
  }

  hasComms(side: Side): boolean {
    return this.s.units.some((u) => u.side === side && u.type === 'comms_sat' && u.state !== 'building');
  }

  blockedCells(side: Side): Set<number> {
    const out = new Set<number>();
    for (const n of this.s.nodes) {
      if (n.canal && n.owner && n.owner !== side) {
        for (const [la, lo] of n.canal) {
          const [c, r] = cellOf(la, lo);
          out.add(r * 360 + c);
        }
      }
    }
    return out;
  }

  /** Homes an aircraft may return to: friendly airbases/HQ and (if capable) carriers. */
  homesFor(u: Unit): { id: string; lat: number; lon: number }[] {
    const out: { id: string; lat: number; lon: number }[] = [];
    for (const b of this.s.bases) {
      if (b.side === u.side && !b.disabled && (b.type === 'airbase' || b.type === 'hq')) out.push(b);
    }
    if (CATALOG[u.type].carrierCapable) {
      for (const c of this.s.units) if (c.side === u.side && c.type === 'carrier' && c.state !== 'building') out.push(c);
    }
    return out;
  }

  homePos(u: Unit): { lat: number; lon: number } | null {
    if (!u.homeId) return null;
    return this.baseById.get(u.homeId) ?? this.byId.get(u.homeId) ?? null;
  }

  private pickHome(u: Unit) {
    let best: { id: string; lat: number; lon: number } | null = null;
    let bestD = Infinity;
    const cur = this.homePos(u);
    for (const h of this.homesFor(u)) {
      const d = distKm(u.lat, u.lon, h.lat, h.lon);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    // prefer current home if it is still valid and not much farther
    if (cur && u.homeId && this.homesFor(u).some((h) => h.id === u.homeId)) {
      const dc = distKm(u.lat, u.lon, cur.lat, cur.lon);
      if (dc < bestD * 1.3) return;
    }
    if (best) u.homeId = best.id;
  }

  isGrounded(u: Unit): boolean {
    return isAir(u) && (u.state === 'ready' || u.state === 'rearming' || u.state === 'building');
  }

  /** Is `id` (unit or base) currently known to `side`? */
  visibleTo(side: Side, id: string): boolean {
    const u = this.byId.get(id);
    if (u) return u.side === side || this.seen[side].has(id);
    return !!this.baseById.get(id);
  }

  /* ------------------------------------------------------------------ commands */

  command(side: Side, cmd: Command): CommandResult {
    if (this.s.ended) return { ok: false, error: 'Match is over' };
    if (cmd.type === 'buy') return this.buy(side, cmd.unitType, cmd.baseId);
    const units = cmd.unitIds.map((id) => this.byId.get(id)).filter((u): u is Unit => !!u && u.side === side);
    if (!units.length) return { ok: false, error: 'No valid units selected' };
    const errors: string[] = [];
    let okCount = 0;
    for (const u of units) {
      const err = this.applyOrder(u, cmd.order);
      if (err) errors.push(`${u.name}: ${err}`);
      else okCount++;
    }
    if (okCount) this.s.stats[side].ordersIssued++;
    return okCount ? { ok: true, error: errors.length ? errors.join('; ') : undefined } : { ok: false, error: errors.join('; ') };
  }

  /** Validate + apply an order. Returns an error string or null. */
  applyOrder(u: Unit, order: Order): string | null {
    const spec = CATALOG[u.type];
    if (u.state === 'building') return 'still being deployed';
    if (spec.domain === 'space') return 'satellites follow fixed orbits';
    if (u.type === 'asat' && order.kind !== 'attack' && order.kind !== 'hold') return 'ASAT sites are fixed';

    if (order.kind === 'attack') {
      const tu = this.byId.get(order.targetId);
      const tb = this.baseById.get(order.targetId);
      if (!spec.weapon) return 'unarmed';
      if (tu) {
        if (tu.side === u.side) return 'cannot attack friendly units';
        if (!this.seen[u.side].has(tu.id)) return 'target not currently detected';
        if (!spec.weapon.targets.includes(domainOf(tu))) return `cannot engage ${CATALOG[tu.type].plural}`;
        if (u.type === 'asat' && domainOf(tu) !== 'space') return 'ASAT can only target satellites';
      } else if (tb) {
        if (tb.side === u.side) return 'cannot attack friendly bases';
        if (!spec.weapon.targets.includes('base')) return 'cannot strike bases';
      } else return 'unknown target';
      if (u.type === 'asat' && tu) {
        const d = distKm(u.lat, u.lon, tu.lat, tu.lon);
        if (d > spec.weapon.rangeKm) return `satellite out of range (${Math.round(d)} km)`;
      }
      u.mission = order;
      u.order = order;
      u.path = [];
      u.repathAt = 0;
      if (isAir(u) && this.isGrounded(u) && u.state === 'rearming') return null; // launches after rearm
      if (isAir(u) && this.isGrounded(u)) this.launch(u);
      return null;
    }

    if (order.kind === 'rtb') {
      if (isAir(u)) {
        u.mission = { kind: 'hold' };
        if (!this.isGrounded(u)) this.startRtb(u);
        return null;
      }
      const mover = moverOf(u);
      if (!mover) return 'cannot return to base';
      const types = mover === 'sea' ? ['port'] : ['hq', 'port', 'airbase'];
      let best: Base | null = null;
      let bd = Infinity;
      for (const b of this.s.bases) {
        if (b.side !== u.side || !types.includes(b.type)) continue;
        const d = distKm(u.lat, u.lon, b.lat, b.lon);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best) return 'no friendly base';
      return this.applyOrder(u, { kind: 'move', lat: best.lat, lon: best.lon });
    }

    if (order.kind === 'hold') {
      u.mission = order;
      if (isAir(u)) {
        if (!this.isGrounded(u)) this.startRtb(u);
        return null;
      }
      u.order = order;
      u.path = [];
      if (u.state !== 'embarked') u.state = 'ready';
      return null;
    }

    // move / patrol
    if (spec.speed <= 0) return 'cannot move';
    const lat = Math.max(-80, Math.min(80, order.lat));
    const lon = wrapLon(order.lon);
    if (isAir(u)) {
      const o: Order = { kind: 'patrol', lat, lon };
      const home = this.homePos(u);
      const range = (spec.endurance ?? 0) * spec.speed;
      if (home && distKm(home.lat, home.lon, lat, lon) * 2 > range * 1.05 && !this.homesNear(u, lat, lon, range)) {
        return `beyond combat radius (${Math.round(range / 2)} km)`;
      }
      u.mission = o;
      u.order = o;
      u.path = [[lat, lon]];
      if (this.isGrounded(u) && u.state === 'ready') this.launch(u);
      else if (!this.isGrounded(u)) u.state = 'moving';
      return null;
    }
    const mover = moverOf(u)!;
    let dest: LatLon = [lat, lon];
    if (mover === 'land' && !isLand(lat, lon)) {
      const c = nearestPassableLand(lat, lon);
      if (!c) return 'ground forces need a land destination';
      dest = c;
    }
    if (mover === 'sea' && isLand(lat, lon)) {
      const c = nearestPassable(lat, lon, { mover: 'sea' }, 6);
      if (!c) return 'ships need a sea destination';
      dest = cellCenter(c[0], c[1]);
    }
    const path = findPath([u.lat, u.lon], dest, { mover, blocked: mover === 'sea' ? this.blockedCells(u.side) : undefined });
    if (!path) return 'no route';
    u.mission = { kind: order.kind, lat: dest[0], lon: dest[1] };
    u.order = u.mission;
    u.path = path;
    if (u.state !== 'embarked') u.state = 'moving';
    return null;
  }

  private homesNear(u: Unit, lat: number, lon: number, range: number): boolean {
    // allowed if some other friendly home is within reach of the destination
    return this.homesFor(u).some((h) => distKm(h.lat, h.lon, lat, lon) < range * 0.45);
  }

  private launch(u: Unit) {
    u.state = 'moving';
    u.fuel = CATALOG[u.type].endurance ?? -1;
  }

  private startRtb(u: Unit) {
    this.pickHome(u);
    u.order = { kind: 'rtb' };
    u.state = 'rtb';
    const h = this.homePos(u);
    u.path = h ? [[h.lat, h.lon]] : [];
  }

  buy(side: Side, type: UnitType, baseId: string): CommandResult {
    const spec = CATALOG[type];
    const b = this.baseById.get(baseId);
    if (!b || b.side !== side) return { ok: false, error: 'Invalid base' };
    if (b.disabled) return { ok: false, error: `${b.name} is disabled` };
    if (!spec.spawnAt.includes(b.type)) return { ok: false, error: `${spec.label} cannot deploy at a ${BASE_SPECS[b.type].label}` };
    if (this.s.cp[side] < spec.cost) return { ok: false, error: `Need ${spec.cost} CP` };
    this.s.cp[side] -= spec.cost;
    const taken = new Set(this.s.units.map((u) => u.name));
    let lat = b.lat, lon = b.lon;
    if (moverOf({ type } as Unit) === 'sea') {
      const c = nearestPassable(lat, lon, { mover: 'sea' }, 6);
      if (c) [lat, lon] = cellCenter(c[0], c[1]);
    }
    const u: Unit = {
      id: `${side[0]}${this.s.nextId++}`,
      side, type, name: nextName(type, side, taken), lat, lon, heading: 0,
      hp: spec.hp, maxHp: spec.hp, fuel: spec.endurance ?? -1, ammo: spec.ammo,
      mission: { kind: 'hold' }, order: { kind: 'hold' }, path: [], state: 'building', cd: 0,
      buildLeft: spec.build, kills: 0,
      homeId: isAirborneType(type) ? b.id : undefined,
    };
    if (spec.domain === 'space') {
      u.orbit = {
        inc: 40 + this.rng.range(0, 30),
        lon0: b.lon,
        phase0: this.rng.range(0, Math.PI * 2),
        period: RULES.orbitPeriod + this.rng.range(-8, 12),
      };
      const p = orbitPos(u.orbit, this.s.t);
      u.lat = p.lat;
      u.lon = p.lon;
    }
    this.s.units.push(u);
    this.byId.set(u.id, u);
    this.s.stats[side].bought++;
    return { ok: true, unitId: u.id };
  }

  forfeit(side: Side) {
    if (this.s.ended) return;
    this.end(otherSide(side), 'forfeit');
  }

  /* ------------------------------------------------------------------ simulation */

  /** Advance by `dt` seconds of match time (fixed sub-steps). */
  step(dt: number) {
    if (this.s.ended) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= RULES.dt && n < 40) {
      this.acc -= RULES.dt;
      this.tick();
      n++;
      if (this.s.ended) break;
    }
  }

  tick() {
    const dt = RULES.dt;
    const s = this.s;
    s.t = +(s.t + dt).toFixed(3);
    s.tick++;
    this.build(dt);
    this.updateSatellites();
    for (const u of s.units) this.moveUnit(u, dt);
    this.sense();
    this.fire(dt);
    this.resolveShots();
    this.basesTick(dt);
    this.nodesTick(dt);
    this.score(dt);
    s.rngState = this.rng.state;
  }

  private build(dt: number) {
    for (const u of this.s.units) {
      if (u.state !== 'building') continue;
      u.buildLeft = (u.buildLeft ?? 0) - dt;
      if (u.buildLeft <= 0) {
        u.buildLeft = undefined;
        u.state = 'ready';
        this.emit(u.side, { kind: 'deployed', ...this.unitEv(u) });
      }
    }
  }

  private updateSatellites() {
    for (const u of this.s.units) {
      if (!u.orbit) continue;
      const p = orbitPos(u.orbit, this.s.t);
      u.heading = headingDeg(u.lat, u.lon, p.lat, p.lon);
      u.lat = p.lat;
      u.lon = p.lon;
    }
  }

  private targetPos(id: string, side: Side): { lat: number; lon: number } | null {
    const u = this.byId.get(id);
    if (u) {
      if (this.seen[side].has(id)) return u;
      const c = this.s.contacts[side][id];
      if (c && this.s.t - c.t < 10) return c;
      return null;
    }
    return this.baseById.get(id) ?? null;
  }

  private moveUnit(u: Unit, dt: number) {
    const spec = CATALOG[u.type];
    if (u.state === 'building' || isSat(u) || spec.speed <= 0) return;
    if (isAir(u)) return this.moveAir(u, dt);

    // ships & ground forces
    let speed = spec.speed;
    if (u.order.kind === 'attack') {
      const tp = this.targetPos(u.order.targetId, u.side);
      if (!tp) {
        u.order = { kind: 'hold' };
        u.mission = u.order;
        u.path = [];
        u.state = u.state === 'embarked' ? 'embarked' : 'ready';
      } else {
        const d = distKm(u.lat, u.lon, tp.lat, tp.lon);
        const standoff = (spec.weapon?.rangeKm ?? 100) * 0.8;
        if (d <= standoff) {
          u.path = [];
        } else if (!u.path.length || this.s.t >= (u.repathAt ?? 0)) {
          const mover = moverOf(u)!;
          const p = findPath([u.lat, u.lon], [tp.lat, tp.lon], { mover, blocked: mover === 'sea' ? this.blockedCells(u.side) : undefined });
          u.path = p ?? [];
          u.repathAt = this.s.t + 6;
        }
      }
    }
    if (!u.path.length) {
      if (u.state === 'moving') {
        u.state = 'ready';
        if (u.order.kind === 'move' || u.order.kind === 'patrol') this.emit(u.side, { kind: 'arrived', ...this.unitEv(u) });
      }
      if (u.state === 'embarked' && isLand(u.lat, u.lon)) u.state = 'ready';
      return;
    }
    const land = moverOf(u) === 'land';
    const atSea = land && !isLand(u.lat, u.lon);
    if (land) {
      if (atSea && u.state !== 'embarked') {
        u.state = 'embarked';
        this.emit(u.side, { kind: 'embarked', ...this.unitEv(u) });
      } else if (!atSea && u.state === 'embarked') u.state = 'moving';
      if (atSea) speed *= RULES.sealiftSpeedFactor;
    }
    if (u.state === 'ready') u.state = 'moving';
    this.followPath(u, speed * dt);
  }

  private followPath(u: Unit, km: number) {
    while (km > 0 && u.path.length) {
      const [la, lo] = u.path[0];
      const d = distKm(u.lat, u.lon, la, lo);
      const r = stepToward(u.lat, u.lon, la, lo, km);
      if (d > 0.5) u.heading = headingDeg(u.lat, u.lon, la, lo);
      u.lat = r.lat;
      u.lon = r.lon;
      km -= Math.min(km, d);
      if (r.arrived) u.path.shift();
    }
  }

  private moveAir(u: Unit, dt: number) {
    const spec = CATALOG[u.type];
    if (u.state === 'rearming') {
      const h = this.homePos(u);
      if (h) {
        u.lat = h.lat;
        u.lon = h.lon;
      }
      u.buildLeft = (u.buildLeft ?? REARM_SECONDS) - dt;
      if (u.buildLeft <= 0) {
        u.buildLeft = undefined;
        u.state = 'ready';
        u.fuel = spec.endurance ?? -1;
        u.ammo = spec.ammo;
        this.emit(u.side, { kind: 'rearmed', ...this.unitEv(u) });
        this.resumeMission(u);
      }
      return;
    }
    if (u.state === 'ready') {
      const h = this.homePos(u);
      if (h) {
        u.lat = h.lat;
        u.lon = h.lon;
      }
      // home lost (carrier sunk / base disabled) → relocate
      if (!h || (u.homeId && this.baseById.get(u.homeId)?.disabled)) {
        this.pickHome(u);
        if (u.homeId && this.homePos(u)) this.launchTo(u, { kind: 'rtb' });
      }
      this.autoScramble(u);
      return;
    }

    // airborne
    u.fuel -= dt;
    const home = this.homePos(u);
    if (!home) this.pickHome(u);
    const h = this.homePos(u);
    if (u.state !== 'rtb' && h) {
      const need = distKm(u.lat, u.lon, h.lat, h.lon) / spec.speed * 1.12 + 3;
      if (u.fuel <= need) {
        this.emit(u.side, { kind: 'bingo', ...this.unitEv(u), text: 'bingo fuel' });
        this.startRtb(u);
      } else if (u.ammo === 0) {
        this.emit(u.side, { kind: 'bingo', ...this.unitEv(u), text: 'winchester (out of munitions)' });
        this.startRtb(u);
      }
    }
    if (u.fuel <= 0) {
      this.kill(u, null, 'ran out of fuel');
      return;
    }

    if (u.state === 'rtb') {
      if (!h) return;
      u.path = [[h.lat, h.lon]];
      this.followPath(u, spec.speed * dt);
      if (distKm(u.lat, u.lon, h.lat, h.lon) < AT_BASE_KM) {
        u.state = 'rearming';
        u.buildLeft = isAirborneType(u.type) && domainOf(u) === 'drone' ? REARM_SECONDS * 0.75 : REARM_SECONDS;
        u.path = [];
      }
      return;
    }

    if (u.order.kind === 'attack') {
      const tp = this.targetPos(u.order.targetId, u.side);
      if (!tp || this.isDead(u.order.targetId)) {
        this.afterTargetGone(u);
        return;
      }
      u.state = 'engaged';
      const d = distKm(u.lat, u.lon, tp.lat, tp.lon);
      const standoff = (spec.weapon?.rangeKm ?? 100) * 0.75;
      if (d > standoff) {
        u.path = [[tp.lat, tp.lon]];
        this.followPath(u, Math.min(spec.speed * dt, d - standoff));
      } else {
        this.circle(u, tp, Math.min(standoff, 120), dt);
      }
      return;
    }

    if (u.order.kind === 'patrol') {
      const { lat, lon } = u.order;
      const d = distKm(u.lat, u.lon, lat, lon);
      if (u.state === 'moving' && d > PATROL_RADIUS_KM) {
        u.path = [[lat, lon]];
        this.followPath(u, spec.speed * dt);
      } else {
        if (u.state !== 'patrol') {
          u.state = 'patrol';
          this.emit(u.side, { kind: 'arrived', ...this.unitEv(u) });
        }
        this.circle(u, { lat, lon }, PATROL_RADIUS_KM, dt);
      }
      // fighters on CAP intercept nearby air threats
      if (u.type === 'fighter') this.intercept(u, { lat, lon }, 650);
      return;
    }
    // no meaningful order while airborne → go home
    this.startRtb(u);
  }

  private isDead(id: string) {
    const u = this.byId.get(id);
    if (u) return false;
    const b = this.baseById.get(id);
    return !b || b.disabled;
  }

  private afterTargetGone(u: Unit) {
    if (u.mission.kind === 'patrol') {
      u.order = u.mission;
      u.state = 'moving';
    } else {
      u.mission = { kind: 'hold' };
      this.startRtb(u);
    }
  }

  private circle(u: Unit, c: { lat: number; lon: number }, r: number, dt: number) {
    const spec = CATALOG[u.type];
    u.patrolAngle = (u.patrolAngle ?? 0) + (spec.speed * dt) / Math.max(30, r);
    const a = u.patrolAngle;
    const tl = c.lat + (r / 111.2) * Math.cos(a);
    const tn = c.lon + (r / (111.2 * Math.max(0.2, Math.cos(c.lat * RAD)))) * Math.sin(a);
    const st = stepToward(u.lat, u.lon, tl, tn, spec.speed * dt);
    u.heading = headingDeg(u.lat, u.lon, st.lat, st.lon);
    u.lat = st.lat;
    u.lon = st.lon;
  }

  private launchTo(u: Unit, order: Order) {
    if (order.kind === 'rtb') {
      // relocating to a new home: fly there as an RTB leg
      u.fuel = CATALOG[u.type].endurance ?? -1;
      this.startRtb(u);
      return;
    }
    u.order = order;
    this.launch(u);
  }

  private resumeMission(u: Unit) {
    const m = u.mission;
    if (m.kind === 'patrol') {
      u.order = m;
      this.launch(u);
    } else if (m.kind === 'attack') {
      if (this.targetPos(m.targetId, u.side) && !this.isDead(m.targetId)) {
        u.order = m;
        this.launch(u);
      } else {
        u.mission = { kind: 'hold' };
        u.order = u.mission;
      }
    }
  }

  private autoScramble(u: Unit) {
    if (u.type !== 'fighter' || u.mission.kind !== 'hold') return;
    const h = this.homePos(u);
    if (!h) return;
    const t = this.nearestThreat(u.side, h, RULES.autoScrambleKm, ['air', 'drone']);
    if (t) {
      u.order = { kind: 'attack', targetId: t.id };
      this.launch(u);
      u.state = 'engaged';
    }
  }

  private intercept(u: Unit, center: { lat: number; lon: number }, km: number) {
    const t = this.nearestThreat(u.side, center, km, ['air', 'drone']);
    if (t) {
      u.order = { kind: 'attack', targetId: t.id };
      u.state = 'engaged';
    }
  }

  private nearestThreat(side: Side, p: { lat: number; lon: number }, km: number, domains: Domain[]): Unit | null {
    let best: Unit | null = null;
    let bd = km;
    for (const id of this.seen[side]) {
      const e = this.byId.get(id);
      if (!e || !domains.includes(domainOf(e)) || this.isGrounded(e)) continue;
      const d = distKm(p.lat, p.lon, e.lat, e.lon);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ sensing */

  private sensorRange(sensor: Unit | Base, target: Unit): number {
    let range: number;
    if ('mission' in sensor) {
      if (sensor.state === 'building' || this.isGrounded(sensor)) return 0;
      range = CATALOG[sensor.type].sensorKm;
      if (domainOf(target) === 'sub') {
        if (sensor.type === 'destroyer' || sensor.type === 'submarine') return range * 0.6;
        if (domainOf(sensor) === 'space') return 0;
      }
    } else {
      range = BASE_SPECS[sensor.type].sensorKm;
    }
    return range * CATALOG[target.type].stealth;
  }

  sense() {
    const s = this.s;
    for (const side of SIDES) {
      const prev = this.seen[side];
      const now = new Set<string>();
      const contacts = s.contacts[side];
      const sensors: (Unit | Base)[] = [
        ...s.units.filter((u) => u.side === side && u.state !== 'building'),
        ...s.bases.filter((b) => b.side === side),
      ];
      for (const e of s.units) {
        if (e.side === side || e.state === 'building') continue;
        const sat = isSat(e);
        let best = Infinity; // best ratio dist/range
        if (sat) best = 0;
        else if (this.isGrounded(e)) {
          // aircraft on the ground at a base: visible only if the base area is watched closely
          best = Infinity;
        } else {
          for (const sn of sensors) {
            const r = this.sensorRange(sn, e);
            if (r <= 0) continue;
            const d = distKm(sn.lat, sn.lon, e.lat, e.lon);
            const ratio = d / r;
            if (ratio < best) best = ratio;
            if (best < 0.7) break;
          }
        }
        if (best > 1) continue;
        now.add(e.id);
        const prevC = contacts[e.id];
        const wasTracked = prev.has(e.id);
        const identified = best <= 0.7 || sat || (!!prevC?.identified && wasTracked);
        contacts[e.id] = {
          id: e.id, lat: e.lat, lon: e.lon, t: s.t, domain: domainOf(e),
          type: identified ? e.type : prevC?.type ?? null, identified,
        };
        if (!wasTracked && !sat) {
          this.emit(side, {
            kind: 'detected', side: e.side, unitId: e.id, lat: e.lat, lon: e.lon,
            unitType: identified ? e.type : undefined, unitName: identified ? e.name : undefined,
          });
        } else if (identified && prevC && !prevC.identified) {
          this.emit(side, { kind: 'identified', side: e.side, unitId: e.id, unitType: e.type, unitName: e.name, lat: e.lat, lon: e.lon });
        }
      }
      for (const id of prev) {
        if (!now.has(id) && this.byId.has(id)) {
          const c = contacts[id];
          this.emit(side, { kind: 'lost', side: otherSide(side), unitId: id, unitType: c?.type ?? undefined, lat: c?.lat, lon: c?.lon });
        }
      }
      // forget stale contacts
      for (const id of Object.keys(contacts)) {
        if (s.t - contacts[id].t > RULES.ghostSeconds || !this.byId.has(id)) delete contacts[id];
      }
      this.seen[side] = now;
    }
  }

  /* ------------------------------------------------------------------ combat */

  private targetClassOf(id: string): TargetClass | null {
    const u = this.byId.get(id);
    if (u) return domainOf(u);
    return this.baseById.get(id) ? 'base' : null;
  }

  private canEngage(w: WeaponSpec, id: string): boolean {
    const tc = this.targetClassOf(id);
    return !!tc && w.targets.includes(tc);
  }

  private fire(dt: number) {
    const s = this.s;
    for (const u of s.units) {
      const spec = CATALOG[u.type];
      if (u.cd > 0) u.cd = Math.max(0, u.cd - dt);
      const w = spec.weapon;
      if (!w || u.cd > 0 || u.state === 'building' || u.ammo === 0) continue;
      if (this.isGrounded(u) || u.state === 'rtb') continue;
      if (u.state === 'embarked') continue;
      let target: { id: string; lat: number; lon: number } | null = null;

      if (u.order.kind === 'attack' && this.canEngage(w, u.order.targetId)) {
        const tp = this.byId.get(u.order.targetId) ?? this.baseById.get(u.order.targetId);
        const visible = tp && (this.baseById.has(tp.id) || this.seen[u.side].has(tp.id));
        if (tp && visible && !(this.baseById.get(tp.id)?.disabled) && distKm(u.lat, u.lon, tp.lat, tp.lon) <= w.rangeKm) target = tp;
      }
      // ASAT and limited-ammo strike platforms only fire on their assigned target
      const conserve = u.type === 'asat' || (spec.ammo > 0 && u.type !== 'fighter');
      if (!target && !conserve) target = this.bestTarget(u, w);
      if (!target && conserve && u.order.kind !== 'attack' && u.type !== 'asat') target = this.bestTarget(u, w, true);
      if (!target) continue;
      this.launchShot(u.side, u.id, u.lat, u.lon, target, w);
      u.cd = w.reload;
      if (u.ammo > 0) u.ammo--;
    }
    for (const b of s.bases) {
      const w = BASE_SPECS[b.type].weapon;
      if (b.cd > 0) b.cd = Math.max(0, b.cd - dt);
      if (!w || b.cd > 0 || b.disabled) continue;
      const t = this.bestTarget(b, w);
      if (!t) continue;
      this.launchShot(b.side, b.id, b.lat, b.lon, t, w);
      b.cd = w.reload;
    }
  }

  /** Best detected enemy in range. `selfDefenseOnly` restricts to threats against the shooter's domain. */
  private bestTarget(u: Unit | Base, w: WeaponSpec, selfDefenseOnly = false): Unit | null {
    let best: Unit | null = null;
    let bestScore = 0;
    for (const id of this.seen[u.side]) {
      const e = this.byId.get(id);
      if (!e || this.isGrounded(e)) continue;
      const d = domainOf(e);
      if (!w.targets.includes(d)) continue;
      if (selfDefenseOnly && !(d === 'sea' || d === 'sub' || d === 'land')) continue;
      const dist = distKm(u.lat, u.lon, e.lat, e.lon);
      if (dist > w.rangeKm) continue;
      const score = CATALOG[e.type].value * (1.5 - dist / w.rangeKm) * (e.hp < e.maxHp * 0.5 ? 1.3 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private launchShot(side: Side, fromId: string, lat: number, lon: number, t: { id: string; lat: number; lon: number }, w: WeaponSpec) {
    const d = distKm(lat, lon, t.lat, t.lon);
    const shot: Shot = {
      id: this.shotSeq++, side, fromId, targetId: t.id,
      fromLat: lat, fromLon: lon, toLat: t.lat, toLon: t.lon,
      t0: this.s.t, t1: this.s.t + Math.max(0.5, d / w.speed),
      damage: w.damage,
      pHit: w.pHit * (this.hasComms(side) ? RULES.commsBonus : 1),
      interceptable: w.kind === 'missile' && this.targetClassOf(t.id) !== 'air' && this.targetClassOf(t.id) !== 'drone',
      weapon: w.kind,
    };
    this.s.shots.push(shot);
    const shooter = this.byId.get(fromId);
    const tu = this.byId.get(t.id);
    const tb = this.baseById.get(t.id);
    const targetSide = tu?.side ?? tb?.side ?? otherSide(side);
    const ev = {
      kind: 'shot' as const, side, unitId: fromId, unitType: shooter?.type, unitName: shooter?.name ?? this.baseById.get(fromId)?.name,
      otherId: t.id, otherType: tu?.type, otherName: tu?.name ?? tb?.name, lat: t.lat, lon: t.lon, baseId: tb?.id,
    };
    this.emit([side, targetSide], ev);
  }

  private interceptChance(targetSide: Side, lat: number, lon: number): number {
    let miss = 1;
    for (const u of this.s.units) {
      if (u.side !== targetSide || u.state === 'building') continue;
      const spec = CATALOG[u.type];
      if (!spec.intercept || !spec.weapon) continue;
      if (distKm(u.lat, u.lon, lat, lon) <= spec.weapon.rangeKm * 0.8) miss *= 1 - spec.intercept;
    }
    for (const b of this.s.bases) {
      if (b.side !== targetSide || b.disabled) continue;
      const spec = BASE_SPECS[b.type];
      if (spec.weapon && distKm(b.lat, b.lon, lat, lon) <= spec.weapon.rangeKm) miss *= 1 - spec.intercept;
    }
    return Math.min(0.8, 1 - miss);
  }

  private resolveShots() {
    const s = this.s;
    const keep: Shot[] = [];
    for (const sh of s.shots) {
      if (s.t < sh.t1) {
        // home in on moving targets
        const tu = this.byId.get(sh.targetId);
        if (tu) {
          sh.toLat = tu.lat;
          sh.toLon = tu.lon;
        }
        keep.push(sh);
        continue;
      }
      const tu = this.byId.get(sh.targetId);
      const tb = this.baseById.get(sh.targetId);
      if (!tu && !tb) continue;
      const tSide = (tu?.side ?? tb!.side) as Side;
      const pos = tu ?? tb!;
      const evBase = {
        side: tSide, unitId: tu?.id, unitType: tu?.type, unitName: tu?.name ?? tb?.name, baseId: tb?.id,
        otherId: sh.fromId, otherType: this.byId.get(sh.fromId)?.type, otherName: this.byId.get(sh.fromId)?.name ?? this.baseById.get(sh.fromId)?.name,
        lat: pos.lat, lon: pos.lon,
      };
      if (sh.interceptable && this.rng.next() < this.interceptChance(tSide, pos.lat, pos.lon)) {
        this.emit([sh.side, tSide], { kind: 'intercepted', ...evBase });
        continue;
      }
      let p = sh.pHit;
      if (tu && domainOf(tu) === 'sub') p *= 0.8;
      if (tu && this.isGrounded(tu)) p *= 0.5;
      if (this.rng.next() >= Math.min(0.95, p)) {
        this.emit([sh.side, tSide], { kind: 'miss', ...evBase });
        continue;
      }
      if (tu) {
        tu.hp -= sh.damage;
        this.emit([sh.side, tSide], { kind: 'hit', ...evBase, value: Math.max(0, tu.hp) });
        if (tu.hp <= 0) {
          const killer = this.byId.get(sh.fromId);
          if (killer) killer.kills++;
          this.kill(tu, sh.side, `destroyed by ${evBase.otherName ?? 'enemy fire'}`, sh.fromId);
        }
      } else if (tb && !tb.disabled) {
        tb.hp = Math.max(0, tb.hp - sh.damage);
        this.emit([sh.side, tSide], { kind: tb.type === 'hq' ? 'hq_hit' : 'base_hit', ...evBase, value: tb.hp });
        if (tb.hp <= 0) {
          if (tb.type === 'hq') {
            this.end(sh.side, 'decapitation');
          } else {
            tb.disabled = true;
            this.emit([sh.side, tSide], { kind: 'base_disabled', ...evBase });
          }
        }
      }
    }
    s.shots = keep;
  }

  private kill(u: Unit, by: Side | null, text: string, killerId?: string) {
    const s = this.s;
    s.units = s.units.filter((x) => x !== u);
    this.byId.delete(u.id);
    s.stats[u.side].losses[CATALOG[u.type].group]++;
    if (by) s.stats[by].kills++;
    const killer = killerId ? this.byId.get(killerId) : undefined;
    const vis: Side[] = [u.side];
    if (by || this.seen[otherSide(u.side)].has(u.id)) vis.push(otherSide(u.side));
    this.emit(vis, {
      kind: 'destroyed', ...this.unitEv(u), text,
      otherId: killerId, otherType: killer?.type, otherName: killer?.name,
    });
    for (const side of SIDES) {
      this.seen[side].delete(u.id);
      delete s.contacts[side][u.id];
    }
    // aircraft parked on a sunk carrier go down with it
    if (u.type === 'carrier') {
      for (const a of [...s.units]) {
        if (a.homeId === u.id) {
          if (this.isGrounded(a)) this.kill(a, by, `lost with ${u.name}`);
          else a.homeId = undefined;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ bases, nodes, score */

  private basesTick(dt: number) {
    for (const b of this.s.bases) {
      if (b.disabled) {
        b.hp = Math.min(b.maxHp, b.hp + 1.2 * dt);
        if (b.hp >= b.maxHp * 0.4) b.disabled = false;
      } else if (b.hp < b.maxHp) {
        b.hp = Math.min(b.maxHp, b.hp + 0.3 * dt);
      }
    }
    // repair: ships at ports, aircraft at home, ground units near friendly bases
    for (const u of this.s.units) {
      if (u.hp >= u.maxHp || u.state === 'building') continue;
      if (isAir(u)) {
        if (u.state === 'rearming' || u.state === 'ready') u.hp = Math.min(u.maxHp, u.hp + 3 * dt);
        continue;
      }
      for (const b of this.s.bases) {
        if (b.side !== u.side || b.disabled) continue;
        if (distKm(u.lat, u.lon, b.lat, b.lon) < 250) {
          u.hp = Math.min(u.maxHp, u.hp + 2 * dt);
          break;
        }
      }
    }
  }

  presence(n: StrategicNode): Record<Side, number> {
    const p: Record<Side, number> = { blue: 0, red: 0 };
    for (const u of this.s.units) {
      const cap = CATALOG[u.type].captures;
      if (!cap || u.state === 'building' || u.state === 'embarked') continue;
      if (n.kind !== 'both' && cap !== n.kind) continue;
      if (distKm(u.lat, u.lon, n.lat, n.lon) <= n.radiusKm) p[u.side] += u.hp / u.maxHp;
    }
    return p;
  }

  private nodesTick(dt: number) {
    for (const n of this.s.nodes) {
      const p = this.presence(n);
      const wasContested = n.contested;
      n.contested = p.blue > 0 && p.red > 0;
      if (n.contested && !wasContested) this.emit(SIDES, { kind: 'contested', nodeId: n.id, lat: n.lat, lon: n.lon, side: n.owner ?? undefined });
      if (n.contested) continue;
      const side: Side | null = p.blue > 0 ? 'blue' : p.red > 0 ? 'red' : null;
      if (!side) continue;
      const sign = side === 'blue' ? 1 : -1;
      const strength = Math.min(2, 1 + 0.25 * ((side === 'blue' ? p.blue : p.red) - 1));
      const before = n.control;
      n.control = Math.max(-100, Math.min(100, n.control + sign * RULES.captureRate * strength * dt));
      if (before === n.control) continue;
      // crossing zero: previous owner loses it
      if (n.owner && n.owner !== side && Math.sign(n.control) === sign && Math.sign(before) !== sign) {
        const lost = n.owner;
        n.owner = null;
        this.emit(SIDES, { kind: 'node_lost', nodeId: n.id, side: lost, lat: n.lat, lon: n.lon });
      }
      if (n.owner !== side && sign * n.control >= RULES.ownerThreshold) {
        n.owner = side;
        this.emit(SIDES, { kind: 'capture', nodeId: n.id, side, lat: n.lat, lon: n.lon });
        if (n.canal) this.emit(SIDES, { kind: 'canal_closed', nodeId: n.id, side, lat: n.lat, lon: n.lon });
      } else if (n.owner !== side && Math.floor(Math.abs(before) / 20) !== Math.floor(Math.abs(n.control) / 20) && Math.sign(n.control) === sign) {
        this.emit(SIDES, { kind: 'capturing', nodeId: n.id, side, lat: n.lat, lon: n.lon, value: n.control });
      }
    }
  }

  nodesHeld(side: Side): number {
    return this.s.nodes.filter((n) => n.owner === side).length;
  }

  vpRate(side: Side): number {
    const held = this.nodesHeld(side);
    return held * (held >= RULES.majorityNodes ? RULES.majorityBonus : 1);
  }

  cpRate(side: Side): number {
    return RULES.baseCp + RULES.cpPerNode * this.nodesHeld(side);
  }

  private score(dt: number) {
    const s = this.s;
    for (const side of SIDES) {
      s.vp[side] += this.vpRate(side) * dt;
      s.cp[side] += this.cpRate(side) * dt;
    }
    if (s.tick % Math.round(5 / RULES.dt) === 0) {
      for (const side of SIDES) {
        s.stats[side].vpHistory.push(Math.round(s.vp[side]));
        s.stats[side].nodesHistory.push(this.nodesHeld(side));
      }
    }
    const b = s.vp.blue >= RULES.vpTarget, r = s.vp.red >= RULES.vpTarget;
    if (b || r) {
      this.end(b && r ? (s.vp.blue >= s.vp.red ? 'blue' : 'red') : b ? 'blue' : 'red', 'dominance');
    } else if (s.t >= RULES.timeLimit) {
      if (s.vp.blue !== s.vp.red) this.end(s.vp.blue > s.vp.red ? 'blue' : 'red', 'time');
      else this.end(null, 'draw');
    }
  }

  private end(winner: Side | null, reason: string) {
    const s = this.s;
    if (s.ended) return;
    s.ended = true;
    s.winner = winner;
    s.reason = reason;
    for (const side of SIDES) {
      s.stats[side].vpHistory.push(Math.round(s.vp[side]));
      s.stats[side].nodesHistory.push(this.nodesHeld(side));
    }
    this.emit(SIDES, { kind: 'ended', side: winner ?? undefined, text: reason });
  }

  /* ------------------------------------------------------------------ views */

  viewFor(side: Side, drain = true): View {
    const s = this.s;
    const units: UnitView[] = [];
    for (const u of s.units) {
      if (u.side === side) {
        units.push(this.ownView(u));
      } else if (this.seen[side].has(u.id)) {
        const c = s.contacts[side][u.id];
        const idd = !!c?.identified;
        units.push({
          id: u.id, side: u.side, type: idd ? u.type : null, domain: domainOf(u),
          name: idd ? u.name : 'UNKNOWN', lat: u.lat, lon: u.lon, heading: u.heading,
          hp: idd ? u.hp : u.maxHp, maxHp: u.maxHp, fuel: -1, ammo: -1, state: idd ? u.state : 'moving',
          order: { kind: 'hold' }, mission: { kind: 'hold' }, path: [], orbit: idd ? u.orbit : undefined,
          identified: idd, kills: 0, cd: 0,
        });
      }
    }
    const ghosts: GhostView[] = [];
    for (const c of Object.values(s.contacts[side]) as Contact[]) {
      if (this.seen[side].has(c.id)) continue;
      ghosts.push({ id: c.id, side: otherSide(side), domain: c.domain, type: c.type, lat: c.lat, lon: c.lon, age: s.t - c.t });
    }
    const shots = s.shots.filter((sh) => {
      if (sh.side === side) return true;
      const tu = this.byId.get(sh.targetId);
      const tb = this.baseById.get(sh.targetId);
      return (tu?.side ?? tb?.side) === side;
    });
    const events = drain ? this.outbox[side] : [...this.outbox[side]];
    if (drain) this.outbox[side] = [];
    return {
      side, t: s.t, tick: s.tick,
      vp: { blue: s.vp.blue, red: s.vp.red },
      vpRate: { blue: this.vpRate('blue'), red: this.vpRate('red') },
      cp: s.cp[side], cpRate: this.cpRate(side),
      units, ghosts,
      bases: s.bases.map((b) => ({ ...b })),
      nodes: s.nodes.map((n) => ({ ...n })),
      shots: shots.map((x) => ({ ...x })),
      events,
      hasComms: { blue: this.hasComms('blue'), red: this.hasComms('red') },
      winner: s.winner, reason: s.reason, ended: s.ended,
      stats: s.stats,
    };
  }

  private ownView(u: Unit): UnitView {
    return {
      id: u.id, side: u.side, type: u.type, domain: domainOf(u), name: u.name,
      lat: u.lat, lon: u.lon, heading: u.heading, hp: u.hp, maxHp: u.maxHp, fuel: u.fuel, ammo: u.ammo,
      state: u.state, order: u.order, mission: u.mission, path: u.path.slice(0, 40), homeId: u.homeId,
      orbit: u.orbit, buildLeft: u.buildLeft, identified: true, kills: u.kills, cd: u.cd,
    };
  }

  /** Drop accumulated events (e.g. for a side nobody is watching). */
  drainEvents(side: Side) {
    this.outbox[side] = [];
  }

  isHighValue(t: UnitType) {
    return HIGH_VALUE.includes(t);
  }
}

function nearestPassableLand(lat: number, lon: number): LatLon | null {
  for (let ring = 1; ring <= 4; ring++) {
    let best: LatLon | null = null;
    let bd = Infinity;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const la = lat + ring * Math.cos(ang);
      const lo = lon + ring * Math.sin(ang);
      if (isLand(la, lo)) {
        const d = distKm(lat, lon, la, lo);
        if (d < bd) {
          bd = d;
          best = [la, lo];
        }
      }
    }
    if (best) return best;
  }
  return null;
}
