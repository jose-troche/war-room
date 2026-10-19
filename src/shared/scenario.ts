import { BASE_SPECS, CATALOG, RULES } from './catalog';
import type { Base, BaseType, GameState, Side, SideStats, StrategicNode, Unit, UnitType } from './types';

export const FACTIONS: Record<Side, { name: string; short: string; hq: string }> = {
  blue: { name: 'AEGIS Coalition', short: 'AEGIS', hq: 'NORTHSTAR' },
  red: { name: 'HYDRA Directorate', short: 'HYDRA', hq: 'IRONCROWN' },
};

type NodeDef = Omit<StrategicNode, 'control' | 'owner' | 'contested'> & { start?: number };

export const NODE_DEFS: NodeDef[] = [
  {
    id: 'panama', name: 'Panama Canal', short: 'Panama', lat: 9.1, lon: -79.7, kind: 'sea', radiusKm: 380,
    canal: [[9.5, -80.5], [8.5, -79.5], [9.5, -79.5]], start: 80,
    blurb: 'Links Atlantic and Pacific. Owner closes the canal to enemy shipping.',
  },
  {
    id: 'gibraltar', name: 'Strait of Gibraltar', short: 'Gibraltar', lat: 36.0, lon: -5.6, kind: 'sea', radiusKm: 380,
    blurb: 'Gateway between the Atlantic and the Mediterranean.',
  },
  {
    id: 'suez', name: 'Suez Canal', short: 'Suez', lat: 30.5, lon: 32.3, kind: 'both', radiusKm: 380,
    canal: [[31.5, 32.5], [30.5, 32.5], [29.5, 32.5]],
    blurb: 'Mediterranean to Indian Ocean shortcut. Taken by ships or ground forces; owner closes the canal.',
  },
  {
    id: 'hormuz', name: 'Strait of Hormuz', short: 'Hormuz', lat: 26.4, lon: 56.4, kind: 'sea', radiusKm: 380,
    blurb: 'Energy chokepoint at the mouth of the Gulf.',
  },
  {
    id: 'malacca', name: 'Strait of Malacca', short: 'Malacca', lat: 2.6, lon: 101.4, kind: 'sea', radiusKm: 380, start: -80,
    blurb: 'Busiest shipping lane between the Indian Ocean and the Pacific.',
  },
  {
    id: 'bering', name: 'Bering Strait', short: 'Bering', lat: 65.8, lon: -169.0, kind: 'sea', radiusKm: 420,
    blurb: 'Arctic gateway between the two powers.',
  },
  {
    id: 'cape', name: 'Cape Uplink', short: 'Cape', lat: -33.4, lon: 19.6, kind: 'land', radiusKm: 320,
    blurb: 'Southern-hemisphere satellite ground station. Taken by ground forces only.',
  },
];

/** Where ground forces should be sent to take a node (a land point inside the zone). */
export const NODE_LAND_POINT: Record<string, [number, number]> = {
  suez: [30.4, 31.2],
  cape: [-33.4, 19.6],
};

interface BaseDef { id: string; side: Side; type: BaseType; name: string; lat: number; lon: number }

export const BASE_DEFS: BaseDef[] = [
  { id: 'b-hq', side: 'blue', type: 'hq', name: 'NORTHSTAR', lat: 39.0, lon: -98.0 },
  { id: 'b-anvil', side: 'blue', type: 'airbase', name: 'ANVIL', lat: 35.3, lon: -79.0 },
  { id: 'b-sentinel', side: 'blue', type: 'airbase', name: 'SENTINEL', lat: 64.0, lon: -22.6 },
  { id: 'b-beacon', side: 'blue', type: 'airbase', name: 'BEACON', lat: -7.9, lon: -14.4 },
  { id: 'b-trident', side: 'blue', type: 'port', name: 'TRIDENT', lat: 36.9, lon: -76.0 },
  { id: 'b-harbor', side: 'blue', type: 'port', name: 'HARBOR', lat: 32.7, lon: -117.4 },
  { id: 'b-coral', side: 'blue', type: 'port', name: 'CORAL', lat: -12.4, lon: 130.8 },

  { id: 'r-hq', side: 'red', type: 'hq', name: 'IRONCROWN', lat: 48.0, lon: 68.0 },
  { id: 'r-talon', side: 'red', type: 'airbase', name: 'TALON', lat: 55.5, lon: 61.0 },
  { id: 'r-sirocco', side: 'red', type: 'airbase', name: 'SIROCCO', lat: -4.6, lon: 55.5 },
  { id: 'r-frost', side: 'red', type: 'airbase', name: 'FROST', lat: 64.7, lon: 177.5 },
  { id: 'r-kraken', side: 'red', type: 'port', name: 'KRAKEN', lat: 69.0, lon: 33.4 },
  { id: 'r-leviathan', side: 'red', type: 'port', name: 'LEVIATHAN', lat: 43.0, lon: 132.0 },
  { id: 'r-monsoon', side: 'red', type: 'port', name: 'MONSOON', lat: 6.9, lon: 79.8 },
];

/** [type, name, lat, lon, homeBaseId?] — air units with a home start grounded there. */
type UnitDef = [UnitType, string, number, number, string?];

const OOB: Record<Side, UnitDef[]> = {
  blue: [
    ['carrier', 'CVN RESOLUTE', 33.0, -58.0],
    ['fighter', 'VIPER-1', 35.3, -79.0, 'b-anvil'],
    ['fighter', 'VIPER-2', 64.0, -22.6, 'b-sentinel'],
    ['fighter', 'VIPER-3', 33.0, -58.0, 'CVN RESOLUTE'],
    ['bomber', 'HAMMER-1', 35.3, -79.0, 'b-anvil'],
    ['bomber', 'HAMMER-2', 35.3, -79.0, 'b-anvil'],
    ['awacs', 'SENTRY', 64.0, -22.6, 'b-sentinel'],
    ['destroyer', 'DDG HALBERD', 12.5, -77.5],
    ['destroyer', 'DDG SABRE', 7.0, -82.0],
    ['destroyer', 'DDG LANCE', 35.0, -20.0],
    ['destroyer', 'DDG PIKE', 51.0, -163.0],
    ['destroyer', 'DDG GLAIVE', 34.0, 24.0],
    ['destroyer', 'DDG SPEAR', 31.0, -121.0],
    ['submarine', 'SSN NAUTILUS', 50.0, -30.0],
    ['submarine', 'SSN SCORPION', 30.0, -140.0],
    ['armor', '1st ARMORED', -22.5, 17.5],
    ['armor', '2nd ARMORED', 30.5, 22.0],
    ['armor', '3rd ARMORED', 38.0, -96.0],
    ['sam', 'PATRIOT-HQ', 39.6, -97.2],
    ['sam', 'PATRIOT-ANVIL', 35.9, -78.6],
    ['missile', 'LONGBOW', 8.6, -80.4],
    ['asat', 'SKYSPEAR', 28.6, -81.2],
    ['recon_drone', 'RAVEN-1', -7.9, -14.4, 'b-beacon'],
    ['recon_drone', 'RAVEN-2', 35.3, -79.0, 'b-anvil'],
    ['strike_drone', 'WASP-1', -7.9, -14.4, 'b-beacon'],
    ['strike_drone', 'WASP-2', 35.3, -79.0, 'b-anvil'],
    ['recon_sat', 'KEYHOLE-1', 0, 0],
    ['recon_sat', 'KEYHOLE-2', 0, 0],
    ['comms_sat', 'ARC-1', 0, 0],
  ],
  red: [
    ['carrier', 'CV TEMPEST', 12.0, 64.0],
    ['fighter', 'MANTIS-1', 55.5, 61.0, 'r-talon'],
    ['fighter', 'MANTIS-2', 64.7, 177.5, 'r-frost'],
    ['fighter', 'MANTIS-3', 12.0, 64.0, 'CV TEMPEST'],
    ['bomber', 'SCYTHE-1', 55.5, 61.0, 'r-talon'],
    ['bomber', 'SCYTHE-2', 55.5, 61.0, 'r-talon'],
    ['awacs', 'OCULUS', -4.6, 55.5, 'r-sirocco'],
    ['destroyer', 'DD KRAIT', 8.0, 110.0],
    ['destroyer', 'DD COBRA', 5.0, 95.0],
    ['destroyer', 'DD MAMBA', 21.0, 62.5],
    ['destroyer', 'DD ASP', 52.0, 165.0],
    ['destroyer', 'DD ADDER', 66.0, 2.0],
    ['submarine', 'SS SHADOW', 60.0, -12.0],
    ['submarine', 'SS WRAITH', 25.0, 150.0],
    ['armor', '1st GUARDS', -25.5, 31.5],
    ['armor', '2nd GUARDS', 28.5, 40.0],
    ['armor', '3rd GUARDS', 48.5, 70.0],
    ['sam', 'BASTION-HQ', 48.6, 67.3],
    ['sam', 'BASTION-TALON', 55.9, 61.6],
    ['missile', 'TRIDENT-X', 26.8, 57.6],
    ['asat', 'STARFALL', 46.0, 63.3],
    ['recon_drone', 'GHOST-1', -4.6, 55.5, 'r-sirocco'],
    ['recon_drone', 'GHOST-2', 64.7, 177.5, 'r-frost'],
    ['strike_drone', 'HORNET-1', -4.6, 55.5, 'r-sirocco'],
    ['strike_drone', 'HORNET-2', 55.5, 61.0, 'r-talon'],
    ['recon_sat', 'ARGUS-1', 0, 0],
    ['recon_sat', 'ARGUS-2', 0, 0],
    ['comms_sat', 'LYRA-1', 0, 0],
  ],
};

const NAME_POOLS: Partial<Record<UnitType, Record<Side, string[]>>> = {
  fighter: { blue: ['VIPER'], red: ['MANTIS'] },
  bomber: { blue: ['HAMMER'], red: ['SCYTHE'] },
  awacs: { blue: ['SENTRY'], red: ['OCULUS'] },
  carrier: { blue: ['CVN VALIANT', 'CVN HORIZON', 'CVN AURORA'], red: ['CV MAELSTROM', 'CV KRAKEN', 'CV NADIR'] },
  destroyer: { blue: ['DDG CUTLASS', 'DDG RAPIER', 'DDG SPEAR', 'DDG ARROW', 'DDG TALWAR', 'DDG ESTOC'], red: ['DD TAIPAN', 'DD VIPERFISH', 'DD BOOMSLANG', 'DD SIDEWINDER', 'DD RATTLER', 'DD URCHIN'] },
  submarine: { blue: ['SSN TRITON', 'SSN BARRACUDA', 'SSN MARLIN'], red: ['SS PHANTOM', 'SS SPECTER', 'SS BANSHEE'] },
  armor: { blue: ['4th ARMORED', '5th ARMORED', '6th ARMORED', '7th ARMORED'], red: ['4th GUARDS', '5th GUARDS', '6th GUARDS', '7th GUARDS'] },
  sam: { blue: ['PATRIOT'], red: ['BASTION'] },
  missile: { blue: ['LONGBOW'], red: ['TRIDENT-X'] },
  recon_drone: { blue: ['RAVEN'], red: ['GHOST'] },
  strike_drone: { blue: ['WASP'], red: ['HORNET'] },
  recon_sat: { blue: ['KEYHOLE'], red: ['ARGUS'] },
  comms_sat: { blue: ['ARC'], red: ['LYRA'] },
  asat: { blue: ['SKYSPEAR'], red: ['STARFALL'] },
};

/** Pick a fresh callsign that isn't in use. */
export function nextName(type: UnitType, side: Side, taken: Set<string>): string {
  const pool = NAME_POOLS[type]?.[side] ?? [type.toUpperCase()];
  for (const n of pool) if (pool.length > 1 && !taken.has(n)) return n;
  const prefix = pool[0];
  for (let i = 1; i < 99; i++) {
    const n = `${prefix}-${i}`;
    if (!taken.has(n)) return n;
  }
  return `${prefix}-${taken.size}`;
}

const emptyStats = (): SideStats => ({
  vpHistory: [0],
  nodesHistory: [1],
  losses: { air: 0, sea: 0, land: 0, drone: 0, space: 0 },
  kills: 0,
  ordersIssued: 0,
  bought: 0,
});

export function createInitialState(seed: number): GameState {
  const bases: Base[] = BASE_DEFS.map((b) => {
    const spec = BASE_SPECS[b.type];
    return { ...b, hp: spec.hp, maxHp: spec.hp, disabled: false, cd: 0 };
  });
  const nodes: StrategicNode[] = NODE_DEFS.map(({ start = 0, ...n }) => ({
    ...n,
    control: start,
    owner: start >= RULES.ownerThreshold ? 'blue' : start <= -RULES.ownerThreshold ? 'red' : null,
    contested: false,
  }));
  const state: GameState = {
    version: 1,
    seed,
    rngState: seed >>> 0,
    t: 0,
    tick: 0,
    units: [],
    bases,
    nodes,
    shots: [],
    vp: { blue: 0, red: 0 },
    cp: { blue: RULES.startCp, red: RULES.startCp },
    contacts: { blue: {}, red: {} },
    stats: { blue: emptyStats(), red: emptyStats() },
    nextId: 1,
    winner: null,
    reason: null,
    ended: false,
  };

  for (const side of ['blue', 'red'] as Side[]) {
    const byName = new Map<string, string>();
    const defs = OOB[side];
    // ships first so carrier-homed aircraft can reference them
    const ordered = [...defs.filter((d) => !d[4]), ...defs.filter((d) => d[4])];
    let satIndex = 0;
    for (const [type, name, lat, lon, home] of ordered) {
      const spec = CATALOG[type];
      const id = `${side[0]}${state.nextId++}`;
      byName.set(name, id);
      const homeId = home ? (home.startsWith(side[0] + '-') ? home : byName.get(home)) : undefined;
      const u: Unit = {
        id, side, type, name, lat, lon,
        heading: side === 'blue' ? 90 : 270,
        hp: spec.hp, maxHp: spec.hp,
        fuel: spec.endurance ?? -1,
        ammo: spec.ammo,
        mission: { kind: 'hold' },
        order: { kind: 'hold' },
        path: [],
        state: 'ready',
        cd: 0,
        homeId,
        kills: 0,
      };
      if (spec.domain === 'space') {
        // spread satellites around the planet with different inclinations
        const k = satIndex++;
        u.orbit = {
          inc: [52, 63, 45][k % 3] * (side === 'blue' ? 1 : 1),
          lon0: (side === 'blue' ? -100 : 60) + k * 120,
          phase0: (side === 'blue' ? 0.3 : 2.1) + k * 2.2,
          period: RULES.orbitPeriod + k * 9,
        };
      }
      state.units.push(u);
    }
  }
  return state;
}
