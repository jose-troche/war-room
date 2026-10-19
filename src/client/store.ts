import { computed, signal } from '@preact/signals';
import type { Difficulty } from '../shared/ai';
import type { Side, View } from '../shared/types';
import type { BriefItem, Report, Sitrep } from './agents/types';

export type Screen = 'landing' | 'briefing' | 'game' | 'aar' | 'lobby';
export type Mode = 'attract' | 'solo' | 'pvp';
export type Panel =
  | { kind: 'forces' }
  | { kind: 'domain'; group: string }
  | { kind: 'unit'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'base'; id: string }
  | { kind: 'requisition'; baseId?: string };

export type ClickMode = 'smart' | 'attack' | 'patrol';

export interface Settings {
  voice: boolean;
  autoPause: boolean;
  coverage: boolean;
  tracks: boolean;
  threats: boolean;
  legendOpen: boolean;
  tourSeen: boolean;
  difficulty: Difficulty;
}

const SETTINGS_KEY = 'warroom.settings.v1';
function loadSettings(): Settings {
  const defaults: Settings = {
    voice: false, autoPause: false, coverage: true, tracks: true, threats: true,
    legendOpen: typeof window !== 'undefined' ? window.innerWidth >= 1600 : true,
    tourSeen: false, difficulty: 'veteran',
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaults;
}

export const settings = signal<Settings>(loadSettings());
export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch {
    /* ignore */
  }
}

export const screen = signal<Screen>('landing');
export const mode = signal<Mode>('attract');
export const playerSide = signal<Side>('blue');
export const view = signal<View | null>(null);
export const paused = signal(false);
export const speed = signal(1);

export const selection = signal<string[]>([]);
export const hoverId = signal<string | null>(null);
export const panel = signal<Panel>({ kind: 'forces' });
export const clickMode = signal<ClickMode>('smart');
export const highlights = signal<{ ids: string[]; until: number }>({ ids: [], until: 0 });

export const brief = signal<BriefItem[]>([]);
export const traffic = signal<Report[]>([]);
export const sitrep = signal<Sitrep | null>(null);
export const counters = signal({ received: 0, surfaced: 0 });
export const staffStats = signal<Record<string, { n: number; worst: string; at: number }>>({});
/** strength baseline per force group, captured at match start */
export const baseline = signal<Record<string, number>>({});
export const toast = signal<{ text: string; tone: 'info' | 'warn' | 'error'; at: number } | null>(null);

export const trafficOpen = signal(false);
export const tourStep = signal<number | null>(null);
export const askOpen = signal(false);
export const pvp = signal<{ code: string; status: string; players: number; host: boolean } | null>(null);

export const isMobile = signal(typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches);
if (typeof window !== 'undefined') {
  window.matchMedia('(max-width: 899px)').addEventListener('change', (e) => (isMobile.value = e.matches));
}
export const sheetTab = signal<'brief' | 'forces' | 'objectives' | 'ask'>('brief');
export const sheetSize = signal<'peek' | 'half' | 'full'>('peek');

export const myUnits = computed(() => {
  const v = view.value;
  return v ? v.units.filter((u) => u.side === v.side) : [];
});

export function showToast(text: string, tone: 'info' | 'warn' | 'error' = 'info') {
  toast.value = { text, tone, at: performance.now() };
}

/** Render-loop data that must not trigger re-renders. */
export const frame = {
  prev: new Map<string, { lat: number; lon: number }>(),
  tView: 0,
  interval: 250,
  effects: [] as { kind: 'boom' | 'capture' | 'ping'; lat: number; lon: number; t0: number; color: string }[],
};

export function setView(v: View, intervalMs: number) {
  const old = view.value;
  if (old) {
    frame.prev = new Map(old.units.map((u) => [u.id, { lat: u.lat, lon: u.lon }]));
  }
  frame.tView = performance.now();
  frame.interval = intervalMs;
  view.value = v;
}
