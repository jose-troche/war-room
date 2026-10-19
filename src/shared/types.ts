export type Side = 'blue' | 'red';
export const SIDES: Side[] = ['blue', 'red'];
export const otherSide = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

/** Physical domain: drives movement, sensing and which weapons can engage. */
export type Domain = 'air' | 'sea' | 'sub' | 'land' | 'drone' | 'space';
/** UI grouping used by Force Status cards (submarines are part of Sea). */
export type ForceGroup = 'air' | 'sea' | 'land' | 'drone' | 'space';
export const FORCE_GROUPS: ForceGroup[] = ['air', 'sea', 'land', 'drone', 'space'];

export type UnitType =
  | 'fighter' | 'bomber' | 'awacs'
  | 'carrier' | 'destroyer' | 'submarine'
  | 'armor' | 'sam' | 'missile'
  | 'recon_drone' | 'strike_drone'
  | 'recon_sat' | 'comms_sat' | 'asat';

export type BaseType = 'hq' | 'airbase' | 'port';
export type TargetClass = Domain | 'base';

export type UnitState =
  | 'ready' | 'moving' | 'patrol' | 'engaged' | 'rtb' | 'rearming'
  | 'embarked' | 'building' | 'destroyed';

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; lat: number; lon: number }
  | { kind: 'patrol'; lat: number; lon: number }
  | { kind: 'attack'; targetId: string }
  | { kind: 'rtb' };

export type Command =
  | { type: 'order'; unitIds: string[]; order: Order }
  | { type: 'buy'; unitType: UnitType; baseId: string };

export type LatLon = [number, number];

export interface Orbit { inc: number; lon0: number; phase0: number; period: number }

export interface Unit {
  id: string;
  side: Side;
  type: UnitType;
  name: string;
  lat: number;
  lon: number;
  heading: number;
  hp: number;
  maxHp: number;
  /** seconds of endurance left (air / drones), -1 when not applicable */
  fuel: number;
  ammo: number;
  /** what the commander asked for; persists across RTB cycles */
  mission: Order;
  /** what the unit is doing right now */
  order: Order;
  path: LatLon[];
  state: UnitState;
  cd: number;
  homeId?: string;
  orbit?: Orbit;
  buildLeft?: number;
  kills: number;
  /** time of last re-path for moving targets */
  repathAt?: number;
  patrolAngle?: number;
}

export interface Base {
  id: string;
  side: Side;
  type: BaseType;
  name: string;
  lat: number;
  lon: number;
  hp: number;
  maxHp: number;
  disabled: boolean;
  cd: number;
}

export type NodeKind = 'sea' | 'land' | 'both';

export interface StrategicNode {
  id: string;
  name: string;
  short: string;
  lat: number;
  lon: number;
  kind: NodeKind;
  radiusKm: number;
  /** -100 (red) .. +100 (blue) */
  control: number;
  owner: Side | null;
  contested: boolean;
  /** canal cells closed to the enemy of the owner */
  canal?: LatLon[];
  blurb: string;
}

export interface Shot {
  id: number;
  side: Side;
  fromId: string;
  targetId: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  t0: number;
  t1: number;
  damage: number;
  pHit: number;
  /** cruise missiles can be intercepted, direct-fire can't */
  interceptable: boolean;
  weapon: 'missile' | 'aam' | 'gun' | 'torpedo' | 'asat';
}

export interface Contact {
  id: string;
  lat: number;
  lon: number;
  t: number;
  domain: Domain;
  type: UnitType | null;
  identified: boolean;
}

export type GameEventKind =
  | 'detected' | 'identified' | 'lost' | 'shot' | 'hit' | 'miss' | 'intercepted'
  | 'destroyed' | 'base_hit' | 'base_disabled' | 'hq_hit'
  | 'capture' | 'node_lost' | 'contested' | 'capturing'
  | 'bingo' | 'rearmed' | 'deployed' | 'embarked' | 'arrived' | 'sat_pass'
  | 'canal_closed' | 'ended';

export interface GameEvent {
  t: number;
  kind: GameEventKind;
  /** side owning the subject (unit/base/node owner) */
  side?: Side;
  unitId?: string;
  unitType?: UnitType;
  unitName?: string;
  otherId?: string;
  otherType?: UnitType;
  otherName?: string;
  nodeId?: string;
  baseId?: string;
  lat?: number;
  lon?: number;
  value?: number;
  text?: string;
}

export interface SideStats {
  vpHistory: number[];
  nodesHistory: number[];
  losses: Record<ForceGroup, number>;
  kills: number;
  ordersIssued: number;
  bought: number;
}

export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  t: number;
  tick: number;
  units: Unit[];
  bases: Base[];
  nodes: StrategicNode[];
  shots: Shot[];
  vp: Record<Side, number>;
  cp: Record<Side, number>;
  contacts: Record<Side, Record<string, Contact>>;
  stats: Record<Side, SideStats>;
  nextId: number;
  /** income multiplier per side (AI difficulty handicap) */
  cpMult?: Record<Side, number>;
  winner: Side | null;
  reason: string | null;
  ended: boolean;
}

/* ---------- Views (what a side is allowed to see) ---------- */

export interface UnitView {
  id: string;
  side: Side;
  type: UnitType | null;
  domain: Domain;
  name: string;
  lat: number;
  lon: number;
  heading: number;
  hp: number;
  maxHp: number;
  fuel: number;
  ammo: number;
  state: UnitState;
  order: Order;
  mission: Order;
  path: LatLon[];
  homeId?: string;
  orbit?: Orbit;
  buildLeft?: number;
  identified: boolean;
  kills: number;
  cd: number;
}

export interface GhostView {
  id: string;
  side: Side;
  domain: Domain;
  type: UnitType | null;
  lat: number;
  lon: number;
  age: number;
}

export interface View {
  side: Side;
  t: number;
  tick: number;
  vp: Record<Side, number>;
  vpRate: Record<Side, number>;
  cp: number;
  cpRate: number;
  units: UnitView[];
  ghosts: GhostView[];
  bases: Base[];
  nodes: StrategicNode[];
  shots: Shot[];
  events: GameEvent[];
  hasComms: Record<Side, boolean>;
  winner: Side | null;
  reason: string | null;
  ended: boolean;
  stats: Record<Side, SideStats>;
}
