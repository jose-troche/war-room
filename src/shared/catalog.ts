import type { BaseType, Domain, ForceGroup, TargetClass, UnitType } from './types';

export interface WeaponSpec {
  rangeKm: number;
  damage: number;
  pHit: number;
  reload: number;
  targets: TargetClass[];
  kind: 'missile' | 'aam' | 'gun' | 'torpedo' | 'asat';
  /** projectile speed km/s */
  speed: number;
}

export interface UnitSpec {
  type: UnitType;
  domain: Domain;
  group: ForceGroup;
  label: string;
  plural: string;
  /** km per second of match time */
  speed: number;
  hp: number;
  sensorKm: number;
  /** multiplier applied to enemy sensor range when trying to see this unit */
  stealth: number;
  weapon?: WeaponSpec;
  /** seconds airborne before RTB is mandatory */
  endurance?: number;
  /** salvos before RTB (air / drones), -1 unlimited */
  ammo: number;
  /** intercept probability vs cruise missiles aimed at anything within weapon range */
  intercept?: number;
  cost: number;
  build: number;
  captures?: 'sea' | 'land';
  /** relative importance for ATLAS and the AI */
  value: number;
  /** may use a carrier as home */
  carrierCapable?: boolean;
  /** where reinforcements appear */
  spawnAt: BaseType[];
  blurb: string;
}

export const CATALOG: Record<UnitType, UnitSpec> = {
  fighter: {
    type: 'fighter', domain: 'air', group: 'air', label: 'Fighter Squadron', plural: 'fighters',
    speed: 120, hp: 60, sensorKm: 700, stealth: 0.9, endurance: 75, ammo: 4,
    weapon: { rangeKm: 320, damage: 45, pHit: 0.62, reload: 3, targets: ['air', 'drone'], kind: 'aam', speed: 700 },
    cost: 120, build: 12, value: 3, carrierCapable: true, spawnAt: ['airbase', 'hq'],
    blurb: 'Air superiority. Intercepts aircraft and drones. Auto-scrambles to defend its base.',
  },
  bomber: {
    type: 'bomber', domain: 'air', group: 'air', label: 'Bomber Wing', plural: 'bombers',
    speed: 85, hp: 70, sensorKm: 400, stealth: 0.8, endurance: 150, ammo: 2,
    weapon: { rangeKm: 900, damage: 70, pHit: 0.68, reload: 8, targets: ['sea', 'land', 'base'], kind: 'missile', speed: 260 },
    cost: 180, build: 16, value: 4, spawnAt: ['airbase', 'hq'],
    blurb: 'Long-range stand-off strike against ships, ground forces, bases and HQ.',
  },
  awacs: {
    type: 'awacs', domain: 'air', group: 'air', label: 'AWACS', plural: 'AWACS',
    speed: 70, hp: 50, sensorKm: 1900, stealth: 1.2, endurance: 220, ammo: -1,
    cost: 150, build: 15, value: 5, spawnAt: ['airbase', 'hq'],
    blurb: 'Flying radar with enormous coverage. Unarmed — keep it behind your fighters.',
  },
  carrier: {
    type: 'carrier', domain: 'sea', group: 'sea', label: 'Carrier Strike Group', plural: 'carriers',
    speed: 24, hp: 180, sensorKm: 950, stealth: 1.2, ammo: -1, intercept: 0.3,
    weapon: { rangeKm: 380, damage: 35, pHit: 0.55, reload: 2.5, targets: ['air', 'drone'], kind: 'aam', speed: 600 },
    cost: 420, build: 40, captures: 'sea', value: 8, spawnAt: ['port'],
    blurb: 'Mobile airbase with strong air defense. Fighters can rearm aboard.',
  },
  destroyer: {
    type: 'destroyer', domain: 'sea', group: 'sea', label: 'Destroyer', plural: 'destroyers',
    speed: 30, hp: 100, sensorKm: 650, stealth: 1, ammo: -1, intercept: 0.25,
    weapon: { rangeKm: 420, damage: 30, pHit: 0.55, reload: 3.5, targets: ['air', 'drone', 'sea', 'sub'], kind: 'missile', speed: 320 },
    cost: 160, build: 20, captures: 'sea', value: 4, spawnAt: ['port'],
    blurb: 'Sea-control workhorse: air defense, anti-ship, anti-sub. Captures chokepoints.',
  },
  submarine: {
    type: 'submarine', domain: 'sub', group: 'sea', label: 'Attack Submarine', plural: 'submarines',
    speed: 26, hp: 80, sensorKm: 500, stealth: 0.25, ammo: -1,
    weapon: { rangeKm: 260, damage: 65, pHit: 0.62, reload: 6, targets: ['sea', 'sub'], kind: 'torpedo', speed: 120 },
    cost: 200, build: 24, value: 5, spawnAt: ['port'],
    blurb: 'Stealthy ship-killer. Only destroyers and subs detect it beyond close range.',
  },
  armor: {
    type: 'armor', domain: 'land', group: 'land', label: 'Armored Brigade', plural: 'armor',
    speed: 14, hp: 100, sensorKm: 260, stealth: 0.9, ammo: -1,
    weapon: { rangeKm: 140, damage: 30, pHit: 0.6, reload: 4, targets: ['land', 'base'], kind: 'gun', speed: 400 },
    cost: 100, build: 15, captures: 'land', value: 3, spawnAt: ['hq', 'port'],
    blurb: 'Captures land objectives. Crosses oceans slowly by sealift — vulnerable at sea.',
  },
  sam: {
    type: 'sam', domain: 'land', group: 'land', label: 'SAM Battery', plural: 'SAMs',
    speed: 6, hp: 70, sensorKm: 520, stealth: 0.8, ammo: -1, intercept: 0.35,
    weapon: { rangeKm: 460, damage: 55, pHit: 0.6, reload: 3, targets: ['air', 'drone'], kind: 'missile', speed: 700 },
    cost: 90, build: 12, value: 3, spawnAt: ['hq', 'airbase', 'port'],
    blurb: 'Shoots down aircraft and drones; intercepts incoming missiles.',
  },
  missile: {
    type: 'missile', domain: 'land', group: 'land', label: 'Missile Battery', plural: 'missile batteries',
    speed: 6, hp: 60, sensorKm: 220, stealth: 0.8, ammo: -1,
    weapon: { rangeKm: 2300, damage: 60, pHit: 0.7, reload: 16, targets: ['sea', 'land', 'base'], kind: 'missile', speed: 320 },
    cost: 150, build: 18, value: 4, spawnAt: ['hq', 'airbase'],
    blurb: 'Long-range precision strike on anything your sensors can see.',
  },
  recon_drone: {
    type: 'recon_drone', domain: 'drone', group: 'drone', label: 'Recon Drone', plural: 'recon drones',
    speed: 42, hp: 25, sensorKm: 950, stealth: 0.6, endurance: 240, ammo: -1,
    cost: 50, build: 8, value: 2, carrierCapable: true, spawnAt: ['airbase', 'hq'],
    blurb: 'Long-endurance eyes. Cheap, quiet, fragile.',
  },
  strike_drone: {
    type: 'strike_drone', domain: 'drone', group: 'drone', label: 'Strike Drone Swarm', plural: 'strike drones',
    speed: 55, hp: 30, sensorKm: 380, stealth: 0.55, endurance: 130, ammo: 2,
    weapon: { rangeKm: 160, damage: 38, pHit: 0.66, reload: 5, targets: ['sea', 'land', 'base', 'sub'], kind: 'missile', speed: 220 },
    cost: 70, build: 10, value: 2, carrierCapable: true, spawnAt: ['airbase', 'hq'],
    blurb: 'Cheap swarm attack on ships, armor and bases.',
  },
  recon_sat: {
    type: 'recon_sat', domain: 'space', group: 'space', label: 'Recon Satellite', plural: 'recon satellites',
    speed: 0, hp: 40, sensorKm: 1300, stealth: 1, ammo: -1,
    cost: 260, build: 25, value: 6, spawnAt: ['hq'],
    blurb: 'Reveals a wide swath under its orbit. Ground track shown on the map.',
  },
  comms_sat: {
    type: 'comms_sat', domain: 'space', group: 'space', label: 'Comms/GPS Satellite', plural: 'comms satellites',
    speed: 0, hp: 40, sensorKm: 0, stealth: 1, ammo: -1,
    cost: 220, build: 25, value: 6, spawnAt: ['hq'],
    blurb: '+20% weapon accuracy for all your forces while any comms satellite is up.',
  },
  asat: {
    type: 'asat', domain: 'land', group: 'space', label: 'ASAT Site', plural: 'ASAT sites',
    speed: 0, hp: 60, sensorKm: 300, stealth: 1, ammo: -1,
    weapon: { rangeKm: 2600, damage: 100, pHit: 0.72, reload: 25, targets: ['space'], kind: 'asat', speed: 500 },
    cost: 200, build: 20, value: 4, spawnAt: ['hq'],
    blurb: 'Kills enemy satellites passing within range. Fires on your order.',
  },
};

export interface BaseSpec {
  label: string;
  hp: number;
  sensorKm: number;
  weapon?: WeaponSpec;
  intercept: number;
}

export const BASE_SPECS: Record<BaseType, BaseSpec> = {
  hq: {
    label: 'Headquarters', hp: 400, sensorKm: 900, intercept: 0.5,
    weapon: { rangeKm: 520, damage: 50, pHit: 0.62, reload: 2.5, targets: ['air', 'drone'], kind: 'missile', speed: 700 },
  },
  airbase: {
    label: 'Airbase', hp: 160, sensorKm: 600, intercept: 0.25,
    weapon: { rangeKm: 300, damage: 35, pHit: 0.5, reload: 4, targets: ['air', 'drone'], kind: 'missile', speed: 600 },
  },
  port: {
    label: 'Naval Port', hp: 160, sensorKm: 500, intercept: 0.2,
    weapon: { rangeKm: 260, damage: 35, pHit: 0.5, reload: 4, targets: ['air', 'drone'], kind: 'missile', speed: 600 },
  },
};

export const RULES = {
  dt: 0.25,
  vpTarget: 1000,
  timeLimit: 900,
  vpPerNode: 0.35,
  majorityNodes: 4,
  majorityBonus: 1.5,
  baseCp: 2,
  cpPerNode: 1,
  startCp: 300,
  captureRate: 6,
  ownerThreshold: 60,
  ghostSeconds: 30,
  commsBonus: 1.2,
  sealiftSpeedFactor: 0.75,
  /** 1 real second at 1x = this many game minutes on the H+ clock */
  clockMinutesPerSecond: 2,
  autoScrambleKm: 1000,
  orbitPeriod: 100,
};

export const isAirborneType = (t: UnitType) => {
  const d = CATALOG[t].domain;
  return d === 'air' || d === 'drone';
};
