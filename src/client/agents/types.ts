import type { Command } from '../../shared/types';

export type AgentId = 'atlas' | 'vigil' | 'falcon' | 'trident' | 'bulwark' | 'swarm' | 'orbit' | 'quartermaster';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'FLASH',
  high: 'PRIORITY',
  medium: 'CAUTION',
  low: 'ROUTINE',
  info: 'INFO',
};
export const SEVERITY_ICON: Record<Severity, string> = {
  critical: '▲',
  high: '●',
  medium: '◆',
  low: '○',
  info: '·',
};

export interface AgentMeta { id: AgentId; callsign: string; role: string; watches: string; glyph: string }

export const AGENTS: AgentMeta[] = [
  { id: 'vigil', callsign: 'VIGIL', role: 'J2 Intelligence', watches: 'Enemy contacts & movements', glyph: 'recon_sat' },
  { id: 'falcon', callsign: 'FALCON', role: 'Air Operations', watches: 'Aircraft, air battles, fuel', glyph: 'fighter' },
  { id: 'trident', callsign: 'TRIDENT', role: 'Maritime Ops', watches: 'Ships, subs, chokepoints', glyph: 'destroyer' },
  { id: 'bulwark', callsign: 'BULWARK', role: 'Land Operations', watches: 'Ground forces & sealift', glyph: 'armor' },
  { id: 'swarm', callsign: 'SWARM', role: 'Unmanned Systems', watches: 'Recon & strike drones', glyph: 'strike_drone' },
  { id: 'orbit', callsign: 'ORBIT', role: 'Space Operations', watches: 'Satellites & ASAT', glyph: 'comms_sat' },
  { id: 'quartermaster', callsign: 'QUARTERMASTER', role: 'Logistics', watches: 'CP, reinforcements, damage', glyph: 'port' },
];
export const ATLAS_META: AgentMeta = { id: 'atlas', callsign: 'ATLAS', role: 'Chief of Staff', watches: 'Everything', glyph: 'hq' };
export const agentMeta = (id: AgentId) => (id === 'atlas' ? ATLAS_META : AGENTS.find((a) => a.id === id)!);

export interface SuggestedAction {
  label: string;
  cmd?: Command;
  /** several commands executed together (e.g. ships to a node + armor to its land point) */
  cmds?: Command[];
  /** fly the camera here */
  focus?: { lat: number; lon: number; zoom?: number };
  /** select these units */
  select?: string[];
  /** plain-language description recorded as a decision */
  describe?: string;
}

export interface Report {
  id: number;
  t: number;
  agent: AgentId;
  severity: Severity;
  /** dedup key: same subject merges into one brief card */
  subject: string;
  text: string;
  lat?: number;
  lon?: number;
  unitIds?: string[];
  nodeId?: string;
  actions?: SuggestedAction[];
  /** extra relevance multiplier (objective, HQ, high-value) */
  weight?: number;
}

export interface BriefItem {
  key: string;
  severity: Severity;
  agent: AgentId;
  text: string;
  t: number;
  count: number;
  score: number;
  lat?: number;
  lon?: number;
  unitIds?: string[];
  nodeId?: string;
  actions?: SuggestedAction[];
  /** wall-clock ms when it was surfaced (for "new" styling) */
  shownAt: number;
  acted?: boolean;
}

export interface Sitrep {
  t: number;
  lines: string[];
  trend: 'winning' | 'losing' | 'even';
  projection: string;
}
