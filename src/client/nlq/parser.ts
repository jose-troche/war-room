import type { Domain, UnitType } from '../../shared/types';
import { REGIONS } from '../agents/text';

export type Intent =
  | 'help' | 'game' | 'view' | 'command' | 'buy' | 'threat' | 'recommend' | 'objectives'
  | 'status' | 'node' | 'locate' | 'unit' | 'unknown';

export type Verb = 'move' | 'attack' | 'patrol' | 'rtb' | 'hold' | 'launch' | 'capture';

export interface Parsed {
  raw: string;
  text: string;
  intent: Intent;
  verb?: Verb;
  game?: 'pause' | 'resume' | 'faster' | 'slower';
  enemy: boolean;
  own: boolean;
  all: boolean;
  types: UnitType[];
  domains: Domain[];
  /** second set of types after "attack/strike/at" — the target */
  targetTypes: UnitType[];
  targetDomains: Domain[];
  nodes: string[];
  regions: string[];
  callsigns: string[];
  bases: string[];
  count?: boolean;
}

const TYPE_WORDS: [RegExp, UnitType[] | Domain][] = [
  [/\b(fighters?|jets?|interceptors?|fighter jets?|cap)\b/, ['fighter']],
  [/\b(bombers?|bomber wings?)\b/, ['bomber']],
  [/\b(awacs|radar planes?|early warning)\b/, ['awacs']],
  [/\b(carriers?|carrier groups?|csgs?|flat ?tops?)\b/, ['carrier']],
  [/\b(destroyers?|ddgs?|warships?|escorts?)\b/, ['destroyer']],
  [/\b(subs?|submarines?|ssns?)\b/, ['submarine']],
  [/\b(tanks?|armou?r|armou?red|brigades?|ground forces|troops|army|infantry)\b/, ['armor']],
  [/\b(sams?|air defen[cs]es?|patriots?)\b/, ['sam']],
  [/\b(missile batter(y|ies)|missiles?|rockets?|artillery)\b/, ['missile']],
  [/\b(recon drones?|scout drones?|ravens?|ghosts?)\b/, ['recon_drone']],
  [/\b(strike drones?|attack drones?|swarms?|wasps?|hornets?|kamikaze)\b/, ['strike_drone']],
  [/\b(recon sat(ellite)?s?|spy sat(ellite)?s?|keyholes?|argus)\b/, ['recon_sat']],
  [/\b(comms? sat(ellite)?s?|gps|communications? sat(ellite)?s?)\b/, ['comms_sat']],
  [/\b(asats?|anti.?satellite)\b/, ['asat']],
  [/\b(drones?|uavs?|unmanned)\b/, 'drone'],
  [/\b(satellites?|sats?|space|orbit(al)?)\b/, 'space'],
  [/\b(aircraft|planes?|air ?force|air units?|air)\b/, 'air'],
  [/\b(navy|fleet|ships?|naval|vessels?|boats?|surface)\b/, 'sea'],
  [/\b(land|ground units?)\b/, 'land'],
];

export const NODE_ALIASES: Record<string, string[]> = {
  panama: ['panama', 'panama canal', 'the canal'],
  gibraltar: ['gibraltar', 'gib'],
  suez: ['suez', 'suez canal', 'egypt'],
  hormuz: ['hormuz', 'strait of hormuz', 'the gulf'],
  malacca: ['malacca', 'singapore', 'strait of malacca'],
  bering: ['bering', 'bering strait', 'alaska'],
  cape: ['cape', 'cape uplink', 'uplink', 'cape town', 'south africa', 'ground station'],
};

const SYN: [RegExp, string][] = [
  [/\bwhat's\b/g, 'what is'],
  [/\bwhere's\b/g, 'where is'],
  [/\bhow's\b/g, 'how is'],
  [/\bi'm\b/g, 'i am'],
  [/\bsit ?rep\b/g, 'sitrep'],
  [/\br\.?t\.?b\.?\b/g, 'rtb'],
];

export function parse(raw: string, callsigns: string[], baseNames: string[]): Parsed {
  let text = ` ${raw.toLowerCase().replace(/[“”"!?.,;:]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [re, rep] of SYN) text = text.replace(re, rep);
  const p: Parsed = {
    raw, text: text.trim(), intent: 'unknown', enemy: false, own: false, all: false,
    types: [], domains: [], targetTypes: [], targetDomains: [], nodes: [], regions: [], callsigns: [], bases: [],
  };
  const t = text;

  p.enemy = /\b(enemy|enemies|hostile|hostiles|their|them|red|hydra|opponent|adversary|opposing|bandits?)\b/.test(t);
  p.own = /\b(my|our|ours|friendly|blue|aegis|we)\b/.test(t);
  p.all = /\b(all|every|everything|entire|whole)\b/.test(t);
  p.count = /\bhow many\b/.test(t);

  // split subject and target around attack verbs so "send bombers to strike the enemy carrier" works
  const attackSplit = t.split(/\b(attack|strike|hit|bomb|engage|kill|sink|destroy|target|intercept|shoot down|shoot)\b/);
  let subjectPart = attackSplit[0];
  let targetPart = attackSplit.length > 2 ? attackSplit.slice(2).join(' ') : '';
  // "strike the carrier with bombers": what follows "with/using" is the subject
  const w = targetPart.split(/\b(?:with|using|by)\b/);
  if (w.length > 1) {
    targetPart = w[0];
    subjectPart += ' ' + w.slice(1).join(' ');
  }
  const scan = (s: string, types: UnitType[], domains: Domain[]) => {
    let rest = s;
    for (const [re, val] of TYPE_WORDS) {
      if (re.test(rest)) {
        if (Array.isArray(val)) types.push(...val);
        else domains.push(val);
        rest = rest.replace(re, ' ');
      }
    }
  };
  scan(subjectPart, p.types, p.domains);
  if (targetPart) scan(targetPart, p.targetTypes, p.targetDomains);

  for (const [id, aliases] of Object.entries(NODE_ALIASES)) {
    if (aliases.some((a) => t.includes(` ${a} `) || t.includes(` ${a}s `))) p.nodes.push(id);
  }
  for (const r of REGIONS) if (r.keys.some((k) => t.includes(` ${k} `))) p.regions.push(r.name);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tn = ` ${norm(t)} `;
  for (const c of callsigns) {
    const n = norm(c);
    const short = n.replace(/^(ddg|dd|cvn|cv|ssn|ss) /, '');
    if (tn.includes(` ${n} `) || (short.length > 3 && tn.includes(` ${short} `))) p.callsigns.push(c);
  }
  for (const b of baseNames) if (tn.includes(` ${norm(b)} `)) p.bases.push(b);

  // ---- intent ----
  if (/\b(help|what can (i|you)|commands|how do i use|examples?)\b/.test(t) && !/\bhow do i win\b/.test(t)) p.intent = 'help';
  else if (/\b(pause|freeze|hold on|wait)\b/.test(t) && !p.types.length && !p.callsigns.length) [p.intent, p.game] = ['game', 'pause'];
  else if (/\b(resume|unpause|continue|go on|carry on|play)\b/.test(t)) [p.intent, p.game] = ['game', 'resume'];
  else if (/\b(faster|speed up|double speed|hurry)\b/.test(t)) [p.intent, p.game] = ['game', 'faster'];
  else if (/\b(slower|slow down|half speed)\b/.test(t)) [p.intent, p.game] = ['game', 'slower'];
  else if (/\b(buy|build|requisition|purchase|produce|order new|deploy (a |an )?new|reinforce with)\b/.test(t)) p.intent = 'buy';
  else if (/\b(zoom|fit all|fit|show everything|whole world|world view|center on|centre on|go to|look at|pan to|show me the (map|world))\b/.test(t) && !/\b(send|move)\b/.test(t)) p.intent = 'view';
  else if (/\b(send|move|deploy|dispatch|go|head|sail|redirect|reposition|attack|strike|hit|bomb|engage|kill|sink|destroy|patrol|cover|defend|protect|guard|escort|return|rtb|recall|retreat|withdraw|fall back|pull back|hold|stop|halt|launch|fire|intercept|shoot|take|capture|seize|occupy|secure|retake)\b/.test(t)) {
    p.intent = 'command';
    if (/\b(attack|strike|hit|bomb|engage|kill|sink|destroy|intercept|shoot|fire at)\b/.test(t)) p.verb = 'attack';
    else if (/\b(launch|fire)\b/.test(t)) p.verb = 'launch';
    else if (/\b(return|rtb|recall|retreat|withdraw|fall back|pull back|come home|go home)\b/.test(t)) p.verb = 'rtb';
    else if (/\b(hold|stop|halt|stand down)\b/.test(t)) p.verb = 'hold';
    else if (/\b(patrol|cover|defend|protect|guard|escort|cap over)\b/.test(t)) p.verb = 'patrol';
    else if (/\b(take|capture|seize|occupy|secure|retake)\b/.test(t)) p.verb = 'capture';
    else p.verb = 'move';
  } else if (/\b(threats?|threaten\w*|danger|dangerous|attacking|under attack|threatening|risk|worr(y|ied)|incoming)\b/.test(t)) p.intent = 'threat';
  else if (/\b(should|advice|advise|recommend|suggest|next move|what now|what next|options|plan|help me decide|what do (i|we) do)\b/.test(t)) p.intent = 'recommend';
  else if (/\b(how (do|can) (i|we) win|objectives?|win conditions?|victory|goal|rules|how to win|mission)\b/.test(t)) p.intent = 'objectives';
  else if (/\b(sitrep|status|how are we|how is it going|situation|score|winning|losing|summary|overview|report|brief me|update)\b/.test(t) && !p.nodes.length && !p.callsigns.length && !p.types.length) p.intent = 'status';
  else if (p.nodes.length && !p.types.length && !p.domains.length && !p.callsigns.length) p.intent = 'node';
  else if (p.callsigns.length && !/\bwhere\b/.test(t)) p.intent = 'unit';
  else if (/\b(where|show|find|locate|list|how many|which|track|display|highlight|see)\b/.test(t) || p.types.length || p.domains.length) p.intent = 'locate';
  else if (p.regions.length) p.intent = 'view';
  return p;
}
