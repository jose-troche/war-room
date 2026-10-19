import { CATALOG, RULES } from '../../shared/catalog';
import { FACTIONS } from '../../shared/scenario';
import type { Side, StrategicNode, UnitType, UnitView, View } from '../../shared/types';

/** Match clock shown as H+hh:mm (1 real second = 2 game minutes at 1x). */
export function clock(t: number): string {
  const mins = Math.floor(t * RULES.clockMinutesPerSecond);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `H+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Real-time duration, e.g. 45s, 2m10s. */
export function dur(sec: number): string {
  if (!isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m${String(r).padStart(2, '0')}s` : `${m}m`;
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const typeLabel = (t: UnitType | null) => (t ? CATALOG[t].label : 'unknown contact');
export const faction = (s: Side) => FACTIONS[s].short;

export function unitName(u: UnitView | undefined, me: Side): string {
  if (!u) return 'unit';
  if (u.side !== me && !u.identified) return `unidentified ${u.domain === 'sub' ? 'sub-surface' : u.domain} contact`;
  return u.name;
}

export function nearestNode(v: View, lat: number, lon: number, maxKm = 1500): StrategicNode | null {
  let best: StrategicNode | null = null;
  let bd = maxKm;
  for (const n of v.nodes) {
    const d = kmBetween(lat, lon, n.lat, n.lon);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** "near Gibraltar" / "1,200 km W of Panama" / "mid-Pacific" style location phrase. */
export function where(v: View, lat: number, lon: number): string {
  const n = nearestNode(v, lat, lon, 2500);
  if (n) {
    const d = kmBetween(lat, lon, n.lat, n.lon);
    if (d < n.radiusKm * 1.2) return `at ${n.short}`;
    return `${km(d)} ${compass(n.lat, n.lon, lat, lon)} of ${n.short}`;
  }
  return regionName(lat, lon);
}

export function km(d: number) {
  return `${Math.round(d / 50) * 50 >= 1000 ? (Math.round(d / 100) * 100).toLocaleString('en-US') : Math.round(d / 10) * 10} km`;
}

function compass(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dx = (((lon2 - lon1 + 540) % 360) - 180) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dy = lat2 - lat1;
  const a = (Math.atan2(dx, dy) * 180) / Math.PI;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, r = Math.PI / 180;
  const dl = ((((lon2 - lon1) % 360) + 540) % 360) - 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((dl * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function regionName(lat: number, lon: number): string {
  for (const r of REGIONS) {
    if (lat >= r.b[0] && lat <= r.b[1] && inLon(lon, r.b[2], r.b[3])) return r.name;
  }
  return lat > 66 ? 'the Arctic' : lat < -55 ? 'the Southern Ocean' : 'open ocean';
}

function inLon(lon: number, a: number, b: number) {
  return a <= b ? lon >= a && lon <= b : lon >= a || lon <= b;
}

/** Named regions for location phrases and for "zoom to X" queries. [minLat, maxLat, minLon, maxLon] */
export const REGIONS: { name: string; keys: string[]; b: [number, number, number, number] }[] = [
  { name: 'the Caribbean', keys: ['caribbean'], b: [8, 25, -90, -58] },
  { name: 'the Gulf of Mexico', keys: ['gulf of mexico'], b: [18, 31, -98, -80] },
  { name: 'the Mediterranean', keys: ['mediterranean', 'med'], b: [30, 46, -6, 37] },
  { name: 'the Persian Gulf', keys: ['persian gulf', 'gulf'], b: [23, 31, 47, 57] },
  { name: 'the Red Sea', keys: ['red sea'], b: [12, 30, 32, 44] },
  { name: 'the Arabian Sea', keys: ['arabian sea'], b: [5, 25, 55, 75] },
  { name: 'the Bay of Bengal', keys: ['bay of bengal', 'bengal'], b: [5, 23, 79, 95] },
  { name: 'the South China Sea', keys: ['south china sea'], b: [0, 23, 104, 121] },
  { name: 'the Sea of Japan', keys: ['sea of japan'], b: [34, 52, 127, 142] },
  { name: 'the Bering Sea', keys: ['bering sea'], b: [52, 66, 162, -157] },
  { name: 'the Norwegian Sea', keys: ['norwegian sea'], b: [62, 75, -10, 20] },
  { name: 'the North Sea', keys: ['north sea'], b: [51, 61, -4, 9] },
  { name: 'North America', keys: ['north america', 'america', 'usa', 'us'], b: [15, 72, -170, -52] },
  { name: 'South America', keys: ['south america', 'latin america'], b: [-56, 13, -82, -34] },
  { name: 'Europe', keys: ['europe'], b: [35, 71, -12, 45] },
  { name: 'Africa', keys: ['africa'], b: [-35, 37, -18, 52] },
  { name: 'the Middle East', keys: ['middle east', 'mideast'], b: [12, 42, 34, 63] },
  { name: 'Asia', keys: ['asia'], b: [5, 75, 60, 150] },
  { name: 'Oceania', keys: ['oceania', 'australia'], b: [-47, 0, 110, 180] },
  { name: 'the Arctic', keys: ['arctic'], b: [66, 85, -180, 180] },
  { name: 'the North Atlantic', keys: ['north atlantic'], b: [20, 66, -75, -5] },
  { name: 'the South Atlantic', keys: ['south atlantic'], b: [-55, 0, -60, 15] },
  { name: 'the Atlantic', keys: ['atlantic'], b: [-55, 66, -75, 15] },
  { name: 'the Indian Ocean', keys: ['indian ocean', 'indian'], b: [-45, 25, 40, 110] },
  { name: 'the North Pacific', keys: ['north pacific'], b: [20, 62, 140, -120] },
  { name: 'the South Pacific', keys: ['south pacific'], b: [-55, 0, 150, -75] },
  { name: 'the Pacific', keys: ['pacific'], b: [-55, 62, 120, -75] },
];

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
