/** Every acronym and piece of military jargon shown in the UI, defined in plain language. */
export const GLOSSARY: Record<string, string> = {
  VP: 'Victory Points — earned every second for each objective you hold. First to 1,000 wins.',
  CP: 'Command Points — currency for reinforcements. Income: 2/s plus 1/s per objective held.',
  SITREP: 'Situation Report — ATLAS\'s periodic three-line summary: score, main threat, recommendation.',
  FLASH: 'Highest-priority alert: needs your decision now.',
  PRIORITY: 'Important and actionable soon.',
  CAUTION: 'Worth knowing; may need action.',
  ROUTINE: 'Background update; ATLAS filters these out of your brief.',
  ETA: 'Estimated Time of Arrival (real seconds at 1× speed).',
  RTB: 'Return To Base — aircraft fly home to refuel and rearm.',
  HQ: 'Headquarters — if it is destroyed, that side loses immediately.',
  AWACS: 'Airborne Warning And Control System — a radar aircraft that sees very far but is unarmed.',
  SAM: 'Surface-to-Air Missile battery — shoots down aircraft, drones and incoming missiles.',
  ASAT: 'Anti-SATellite weapon — a ground site that can shoot down enemy satellites passing overhead.',
  CAP: 'Combat Air Patrol — fighters circling an area to intercept enemy aircraft.',
  GPS: 'Global Positioning System — satellite navigation that improves weapon accuracy.',
  DDG: 'Guided-missile destroyer (hull prefix).',
  DD: 'Destroyer (hull prefix).',
  CVN: 'Nuclear-powered aircraft carrier (hull prefix).',
  CV: 'Aircraft carrier (hull prefix).',
  SSN: 'Nuclear-powered attack submarine (hull prefix).',
  SS: 'Attack submarine (hull prefix).',
  J2: 'Intelligence staff section (in military staffs J2 = intelligence).',
  'H+': 'Hours and minutes since the operation began (game clock; 1 real second = 2 game minutes).',
  ATLAS: 'Your Chief of Staff AI. Reads every staff report and briefs you only on what matters.',
  AEGIS: 'AEGIS Coalition — your faction (blue). Fictional.',
  HYDRA: 'HYDRA Directorate — the opposing faction (red). Fictional.',
  AI: 'Artificial Intelligence.',
  km: 'Kilometres.',
  bingo: '"Bingo fuel" — just enough fuel left to get home; the aircraft returns automatically.',
  winchester: '"Winchester" — out of munitions; the aircraft returns to rearm.',
  sealift: 'Ground forces carried across the sea by ship — slow and vulnerable until ashore.',
  contested: 'Both sides have forces in the zone, so control is frozen until one side clears the other.',
  chokepoint: 'A narrow sea passage (strait or canal) that shipping must pass through.',
};

/** Names, not acronyms: listed in the glossary but not underlined in running text. */
const NO_AUTO = new Set(['AEGIS', 'HYDRA', 'ATLAS', 'AI', 'km', 'FLASH', 'PRIORITY', 'CAUTION', 'ROUTINE']);
const KEYS = Object.keys(GLOSSARY).filter((k) => !NO_AUTO.has(k)).sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-sensitive for acronyms, case-insensitive for jargon words. */
export const GLOSS_RE = new RegExp(
  KEYS.map((k) => (k === 'H+' ? '(?<![\\w])H\\+(?=\\d)' : /^[A-Z0-9+]+$/.test(k) ? `(?<![\\w-])${esc(k)}(?![\\w])` : `(?<![\\w])[${k[0].toUpperCase()}${k[0]}]${esc(k.slice(1))}(?![\\w])`)).join('|'),
  'g',
);

export function define(term: string): string | undefined {
  return GLOSSARY[term] ?? GLOSSARY[term.toLowerCase()] ?? GLOSSARY[term.replace(/^H\+.*/, 'H+')];
}

/** Tooltip text listing definitions of any terms in `text` (for buttons, where nested <abbr> would steal taps). */
export function glossTitle(text: string): string | undefined {
  const defs = new Map<string, string>();
  for (const m of text.matchAll(GLOSS_RE)) {
    const d = define(m[0]);
    if (d) defs.set(m[0], d);
  }
  return defs.size ? [...defs].map(([k, d]) => `${k}: ${d}`).join('\n') : undefined;
}
