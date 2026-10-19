import { CATALOG, RULES } from '../../shared/catalog';
import { NODE_LAND_POINT, NODE_DEFS } from '../../shared/scenario';
import type { Base, Command, LatLon, Side, TargetClass, UnitType, UnitView, View } from '../../shared/types';
import { available, buySuggestion, counterTo, etaTo, recommendations, reinforceNode } from '../agents/coa';
import { projection } from '../agents/atlas';
import { dur, faction, kmBetween, REGIONS, typeLabel, where } from '../agents/text';
import type { SuggestedAction } from '../agents/types';
import { parse, type Parsed } from './parser';

export interface AskAnswer {
  text: string;
  lines?: string[];
  actions?: SuggestedAction[];
  focus?: LatLon[];
  highlight?: string[];
  game?: 'pause' | 'resume' | 'faster' | 'slower';
  zoom?: number;
  sitrep?: boolean;
  /** not understood locally — try the server-side LLM */
  fallback?: boolean;
  parsed?: Parsed;
}

export const EXAMPLES = [
  'sitrep',
  'where are my carriers?',
  'what threatens Panama?',
  'send destroyers to Gibraltar',
  'strike the enemy carrier with bombers',
  'what should I do?',
  'show enemy subs',
  'zoom to Europe',
];

const isAirLike = (u: UnitView) => u.domain === 'air' || u.domain === 'drone';
const nodeName = (id: string) => NODE_DEFS.find((n) => n.id === id)?.short ?? id;

export function ask(q: string, v: View): AskAnswer {
  const callsigns = v.units.filter((u) => u.identified || u.side === v.side).map((u) => u.name);
  const p = parse(q, callsigns, v.bases.map((b) => b.name));
  const a = route(p, v);
  a.parsed = p;
  return a;
}

function route(p: Parsed, v: View): AskAnswer {
  switch (p.intent) {
    case 'help':
      return { text: 'Ask me about status, threats, locations or give orders. Try:', lines: EXAMPLES.map((e) => `“${e}”`) };
    case 'game':
      return { text: { pause: 'Paused.', resume: 'Resuming.', faster: 'Speeding up.', slower: 'Slowing down.' }[p.game!], game: p.game };
    case 'status':
      return { text: 'SITREP', sitrep: true };
    case 'objectives':
      return objectives(v);
    case 'recommend':
      return recommend(v);
    case 'threat':
      return threats(p, v);
    case 'node':
      return nodeStatus(p.nodes[0], v);
    case 'unit':
      return unitStatus(p, v);
    case 'locate':
      return locate(p, v);
    case 'view':
      return viewAnswer(p, v);
    case 'buy':
      return buy(p, v);
    case 'command':
      return command(p, v);
    default:
      return { text: '', fallback: true };
  }
}

function objectives(v: View): AskAnswer {
  const me = v.side;
  const held = v.nodes.filter((n) => n.owner === me).length;
  return {
    text: `Win by reaching ${RULES.vpTarget} VP first, destroying the enemy HQ, or leading on VP at 15:00.`,
    lines: [
      `Each held chokepoint earns VP every second; ${RULES.majorityNodes}+ nodes earns a +50% bonus.`,
      `Holding Panama or Suez closes that canal to enemy ships.`,
      `We hold ${held}/7 nodes. ${projection(v).text}`,
    ],
  };
}

function recommend(v: View): AskAnswer {
  const recs = recommendations(v).slice(0, 3);
  if (!recs.length) return { text: 'Hold positions and bank CP — nothing urgent right now.' };
  return {
    text: recs[0].text,
    lines: recs.slice(1).map((r) => r.text),
    actions: recs.flatMap((r) => r.actions.slice(0, r === recs[0] ? 2 : 1)).slice(0, 4),
    focus: recs.filter((r) => r.lat !== undefined).map((r) => [r.lat!, r.lon!] as LatLon),
  };
}

function enemySpeed(u: UnitView) {
  return u.type ? CATALOG[u.type].speed : u.domain === 'air' ? 100 : u.domain === 'drone' ? 45 : 25;
}

function threats(p: Parsed, v: View): AskAnswer {
  const me = v.side;
  const enemies = v.units.filter((e) => e.side !== me && e.domain !== 'space');
  let anchors: { name: string; lat: number; lon: number }[];
  if (p.nodes.length) anchors = v.nodes.filter((n) => p.nodes.includes(n.id)).map((n) => ({ name: n.short, lat: n.lat, lon: n.lon }));
  else if (p.callsigns.length) anchors = v.units.filter((u) => p.callsigns.includes(u.name)).map((u) => ({ name: u.name, lat: u.lat, lon: u.lon }));
  else anchors = [
    ...v.nodes.filter((n) => n.owner === me).map((n) => ({ name: n.short, lat: n.lat, lon: n.lon })),
    ...v.bases.filter((b) => b.side === me && b.type === 'hq').map((b) => ({ name: b.name, lat: b.lat, lon: b.lon })),
    ...v.units.filter((u) => u.side === me && u.type === 'carrier').map((u) => ({ name: u.name, lat: u.lat, lon: u.lon })),
  ];
  const rows: { e: UnitView; d: number; anchor: string; score: number }[] = [];
  for (const e of enemies) {
    let best: { d: number; anchor: string } | null = null;
    for (const a of anchors) {
      const d = kmBetween(e.lat, e.lon, a.lat, a.lon);
      if (!best || d < best.d) best = { d, anchor: a.name };
    }
    if (!best || best.d > 2500) continue;
    const val = e.type ? CATALOG[e.type].value : 2;
    rows.push({ e, ...best, score: val * (1 - best.d / 2600) });
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 4);
  if (!top.length) return { text: p.nodes.length ? `No hostile forces detected near ${nodeName(p.nodes[0])}.` : 'No hostile forces detected near our positions. Note: undetected forces may exist — keep recon up.', focus: anchors.map((a) => [a.lat, a.lon]) };
  const lines = top.map((r) => {
    const eta = r.d / enemySpeed(r.e);
    return `${r.e.identified ? `${r.e.name} (${typeLabel(r.e.type).toLowerCase()})` : `Unidentified ${r.e.domain} contact`} — ${Math.round(r.d / 10) * 10} km from ${r.anchor}, ~${dur(eta)} out.`;
  });
  const lead = top[0];
  return {
    text: `${top.length} threat${top.length > 1 ? 's' : ''}${p.nodes.length ? ` near ${nodeName(p.nodes[0])}` : ''}. Biggest: ${lines[0]}`,
    lines: lines.slice(1),
    actions: counterTo(v, lead.e, 2),
    focus: [...top.map((r) => [r.e.lat, r.e.lon] as LatLon), ...anchors.slice(0, 1).map((a) => [a.lat, a.lon] as LatLon)],
    highlight: top.map((r) => r.e.id),
  };
}

function nodeStatus(id: string, v: View): AskAnswer {
  const n = v.nodes.find((x) => x.id === id);
  if (!n) return { text: 'Unknown objective.' };
  const me = v.side;
  const inZone = (u: UnitView) => kmBetween(u.lat, u.lon, n.lat, n.lon) <= n.radiusKm * 1.3 && u.domain !== 'space';
  const ours = v.units.filter((u) => u.side === me && inZone(u));
  const theirs = v.units.filter((u) => u.side !== me && inZone(u));
  const owner = n.owner ? (n.owner === me ? 'held by us' : `held by ${faction(n.owner)}`) : 'neutral';
  const ctl = Math.round(me === 'blue' ? n.control : -n.control);
  const acts = n.owner === me && !theirs.length ? [] : reinforceNode(v, n);
  const strike = theirs.find((t) => t.identified);
  if (strike) acts.push(...counterTo(v, strike, 1));
  return {
    text: `${n.name}: ${owner}${n.contested ? ', CONTESTED' : ''}. Our control ${ctl > 0 ? '+' : ''}${ctl}.`,
    lines: [
      `In zone — ours: ${ours.length ? ours.map((u) => u.name).join(', ') : 'none'}; hostile: ${theirs.length ? theirs.map((u) => (u.identified ? u.name : 'unknown')).join(', ') : 'none detected'}.`,
      `Captured by ${n.kind === 'sea' ? 'surface ships' : n.kind === 'land' ? 'ground forces' : 'ships or ground forces'}.${n.canal ? ' Owner closes the canal to enemy shipping.' : ''}`,
    ],
    actions: acts.slice(0, 3),
    focus: [[n.lat, n.lon]],
    highlight: [...ours, ...theirs].map((u) => u.id),
  };
}

function unitStatus(p: Parsed, v: View): AskAnswer {
  const u = v.units.find((x) => x.name === p.callsigns[0]);
  if (!u) return { text: 'No such unit.' };
  if (u.side !== v.side) {
    return { text: `${u.name}: ${faction(u.side)} ${typeLabel(u.type).toLowerCase()}, ${where(v, u.lat, u.lon)}, ${Math.round((u.hp / u.maxHp) * 100)}% integrity.`, actions: counterTo(v, u, 2), focus: [[u.lat, u.lon]], highlight: [u.id] };
  }
  const spec = CATALOG[u.type!];
  const bits = [`${Math.round((u.hp / u.maxHp) * 100)}% integrity`];
  if (u.fuel >= 0 && spec.endurance && u.state !== 'ready') bits.push(`fuel ${Math.round((u.fuel / spec.endurance) * 100)}%`);
  const doing = u.state === 'ready' && isAirLike(u) ? 'on the ground, ready' : u.state === 'rtb' ? 'returning to base' : u.order.kind === 'attack' ? 'attacking' : u.path.length ? 'under way' : u.state;
  return {
    text: `${u.name} (${spec.label}): ${doing}, ${where(v, u.lat, u.lon)}. ${bits.join(', ')}.`,
    actions: [{ label: `Select ${u.name}`, select: [u.id], focus: { lat: u.lat, lon: u.lon, zoom: 4 } }],
    focus: [[u.lat, u.lon]],
    highlight: [u.id],
  };
}

function inRegion(name: string, lat: number, lon: number) {
  const r = REGIONS.find((x) => x.name === name);
  if (!r) return true;
  const [a, b, c, d] = r.b;
  const inLon = c <= d ? lon >= c && lon <= d : lon >= c || lon <= d;
  return lat >= a && lat <= b && inLon;
}

function matchesKind(u: UnitView, types: UnitType[], domains: string[]) {
  if (!types.length && !domains.length) return u.domain !== 'space';
  if (u.type && types.includes(u.type)) return true;
  if (domains.includes(u.domain)) return true;
  if (domains.includes('sea') && u.domain === 'sub') return true;
  if (!u.type && types.some((t) => CATALOG[t].domain === u.domain)) return true; // unidentified contacts of that domain
  return false;
}

function locate(p: Parsed, v: View): AskAnswer {
  const side: Side = p.enemy && !p.own ? (v.side === 'blue' ? 'red' : 'blue') : v.side;
  const enemy = side !== v.side;
  let list = v.units.filter((u) => u.side === side && u.state !== 'building' && matchesKind(u, p.types, p.domains));
  if (p.regions.length) list = list.filter((u) => p.regions.some((r) => inRegion(r, u.lat, u.lon)));
  if (p.nodes.length) list = list.filter((u) => p.nodes.some((id) => { const n = v.nodes.find((x) => x.id === id)!; return kmBetween(u.lat, u.lon, n.lat, n.lon) < 1500; }));
  const what = p.types.length ? p.types.map((t) => CATALOG[t].plural).join(' & ') : p.domains.length ? p.domains.map((d) => (d === 'sea' ? 'naval forces' : d === 'air' ? 'aircraft' : d === 'space' ? 'satellites' : d === 'drone' ? 'drones' : 'ground forces')).join(' & ') : 'forces';
  const who = enemy ? `detected ${faction(side)}` : 'our';
  if (!list.length) {
    return { text: enemy ? `No ${who} ${what} on our sensors. Send recon (drones, AWACS) or wait for a satellite pass.` : `We have no ${what}${p.regions.length ? ' there' : ''}.` };
  }
  const shown = list.slice(0, 6);
  const lines = shown.map((u) => `${u.identified || !enemy ? u.name : 'Unidentified'} — ${where(v, u.lat, u.lon)}${!enemy ? `, ${u.state === 'ready' && isAirLike(u) ? 'ready at base' : u.state}` : ''}.`);
  if (list.length > shown.length) lines.push(`…and ${list.length - shown.length} more.`);
  return {
    text: `${p.count ? '' : 'Showing '}${list.length} ${who} ${what}${p.regions.length ? ` in ${p.regions[0]}` : ''}.`,
    lines,
    focus: list.map((u) => [u.lat, u.lon] as LatLon),
    highlight: list.map((u) => u.id),
    actions: !enemy && list.length <= 8 ? [{ label: `Select ${list.length === 1 ? list[0].name : 'all ' + list.length}`, select: list.map((u) => u.id) }] : enemy && list[0].identified ? counterTo(v, list[0], 1) : undefined,
  };
}

function viewAnswer(p: Parsed, v: View): AskAnswer {
  if (/\b(fit all|everything|all assets|fit)\b/.test(p.text)) return { text: 'Fitting all relevant assets.', focus: [] };
  if (/\b(whole world|world view|zoom out fully|show me the (map|world))\b/.test(p.text)) return { text: 'Whole-world view.', zoom: 1 };
  if (p.nodes.length) {
    const n = v.nodes.find((x) => x.id === p.nodes[0])!;
    return { text: `Showing ${n.name}.`, focus: [[n.lat, n.lon]], zoom: 4 };
  }
  if (p.regions.length) {
    const r = REGIONS.find((x) => x.name === p.regions[0])!;
    const [a, b, c, d] = r.b;
    return { text: `Showing ${r.name}.`, focus: [[a, c], [b, d > c ? d : d + 360]] };
  }
  if (p.callsigns.length) {
    const u = v.units.find((x) => x.name === p.callsigns[0]);
    if (u) return { text: `Showing ${u.name}.`, focus: [[u.lat, u.lon]], highlight: [u.id], zoom: 4 };
  }
  if (/\bzoom in\b/.test(p.text)) return { text: 'Zooming in.', zoom: -2 };
  if (/\bzoom out\b/.test(p.text)) return { text: 'Zooming out.', zoom: -0.5 };
  return { text: 'Fitting all relevant assets.', focus: [] };
}

function buy(p: Parsed, v: View): AskAnswer {
  const t = p.types[0];
  if (!t) {
    const s = buySuggestion(v);
    return s ? { text: s.why, actions: [s.action] } : { text: `You have ${Math.floor(v.cp)} CP. Name a unit type, e.g. "build a destroyer".` };
  }
  const spec = CATALOG[t];
  let bases = v.bases.filter((b) => b.side === v.side && !b.disabled && spec.spawnAt.includes(b.type));
  if (p.bases.length) bases = bases.filter((b) => p.bases.includes(b.name));
  const focus = p.nodes.length ? v.nodes.find((n) => n.id === p.nodes[0])! : v.nodes.find((n) => n.owner !== v.side) ?? v.nodes[0];
  bases.sort((a, b) => kmBetween(a.lat, a.lon, focus.lat, focus.lon) - kmBetween(b.lat, b.lon, focus.lat, focus.lon));
  const b = bases[0];
  if (!b) return { text: `No base can deploy a ${spec.label} right now.` };
  if (v.cp < spec.cost) return { text: `${spec.label} costs ${spec.cost} CP; we have ${Math.floor(v.cp)}. ETA to afford: ${dur((spec.cost - v.cp) / v.cpRate)}.` };
  return {
    text: `Deploy a ${spec.label} at ${b.name} for ${spec.cost} CP (ready in ${spec.build}s)?`,
    actions: [{ label: `Confirm · ${spec.cost} CP`, cmd: { type: 'buy', unitType: t, baseId: b.id }, describe: `Requisitioned ${spec.label} at ${b.name}` }],
    focus: [[b.lat, b.lon]],
  };
}

/* ------------------------------------------------------------------ commands */

interface Dest { name: string; lat: number; lon: number; nodeId?: string; rtb?: boolean }

function destination(p: Parsed, v: View): Dest | null {
  if (p.verb === 'rtb' || /\b(home|base)\b/.test(p.text) && !p.nodes.length && !p.bases.length && p.verb !== 'attack') return { name: 'base', lat: 0, lon: 0, rtb: true };
  if (p.nodes.length) {
    const n = v.nodes.find((x) => x.id === p.nodes[p.nodes.length - 1])!;
    return { name: n.short, lat: n.lat, lon: n.lon, nodeId: n.id };
  }
  if (p.bases.length) {
    const b = v.bases.find((x) => x.name === p.bases[0])!;
    return { name: b.name, lat: b.lat, lon: b.lon };
  }
  if (p.regions.length) {
    const r = REGIONS.find((x) => x.name === p.regions[0])!;
    const [a, b, c, d] = r.b;
    const lon = c <= d ? (c + d) / 2 : ((c + d + 360) / 2 + 540) % 360 - 180;
    return { name: r.name, lat: (a + b) / 2, lon };
  }
  return null;
}

function pickSubjects(p: Parsed, v: View, test: (u: UnitView) => boolean, dest?: { lat: number; lon: number }): UnitView[] {
  const mine = v.units.filter((u) => u.side === v.side && u.state !== 'building');
  if (p.callsigns.length) return mine.filter((u) => p.callsigns.includes(u.name) && test(u));
  if (!p.types.length && !p.domains.length) return [];
  let list = mine.filter((u) => matchesKind(u, p.types, p.domains) && test(u));
  if (!p.all) {
    const avail = list.filter(available);
    if (avail.length) list = avail;
    if (dest) {
      list = list
        .map((u) => ({ u, eta: etaTo(v, u, dest.lat, dest.lon) }))
        .filter((x) => isFinite(x.eta) || !isAirLike(x.u))
        .sort((a, b) => a.eta - b.eta)
        .map((x) => x.u);
    }
    list = list.slice(0, 3);
  }
  return list;
}

function command(p: Parsed, v: View): AskAnswer {
  const verb = p.verb ?? 'move';

  if (verb === 'attack' || verb === 'launch') return attack(p, v);

  if (verb === 'hold') {
    const subs = pickSubjects({ ...p, all: true }, v, (u) => !!u.type && CATALOG[u.type].speed > 0);
    if (!subs.length) return { text: 'Which units should hold? Name them, e.g. "destroyers hold".' };
    return confirm(`Hold position: ${subs.map((u) => u.name).join(', ')}?`, [{ type: 'order', unitIds: subs.map((u) => u.id), order: { kind: 'hold' } }], subs, `${subs.length} units hold`);
  }

  const dest = destination(p, v);
  if (verb === 'rtb' || dest?.rtb) {
    const subs = pickSubjects({ ...p, all: true }, v, (u) => !!u.type && CATALOG[u.type].speed > 0 && u.state !== 'ready' && u.state !== 'rearming');
    if (!subs.length) return { text: 'No airborne or deployed units match. Name them, e.g. "fighters return to base".' };
    return confirm(`Return to base: ${subs.map((u) => u.name).join(', ')}?`, [{ type: 'order', unitIds: subs.map((u) => u.id), order: { kind: 'rtb' } }], subs, `${subs.length} units RTB`);
  }
  if (!dest) return { text: 'Where to? Name a chokepoint (e.g. Gibraltar), a base or a region.', lines: ['Example: “send destroyers to Gibraltar”'] };

  const node = dest.nodeId ? v.nodes.find((n) => n.id === dest.nodeId) : undefined;
  let subs = pickSubjects(p, v, (u) => !!u.type && CATALOG[u.type].speed > 0, dest);
  if (!subs.length && node && (verb === 'capture' || verb === 'move' || verb === 'patrol') && !p.types.length && !p.domains.length) {
    // "take Suez" with no subject: let ATLAS choose capable units
    const acts = reinforceNode(v, node, 3);
    if (!acts.length) return { text: `No available units can reach ${node.short} soon.` };
    return { text: `Recommended forces for ${node.short}:`, actions: acts, focus: [[node.lat, node.lon]] };
  }
  if (!subs.length) return { text: `No available ${p.types.length ? p.types.map((t) => CATALOG[t].plural).join('/') : 'units'} can reach ${dest.name}.` };
  if (verb === 'patrol' && !subs.some(isAirLike)) {
    // ships/armor "defend X" → move into the zone
  }
  const cmds: Command[] = [];
  const air = subs.filter(isAirLike);
  const land = subs.filter((u) => u.domain === 'land');
  const sea = subs.filter((u) => !isAirLike(u) && u.domain !== 'land');
  if (air.length) cmds.push({ type: 'order', unitIds: air.map((u) => u.id), order: { kind: 'patrol', lat: dest.lat, lon: dest.lon } });
  if (sea.length) cmds.push({ type: 'order', unitIds: sea.map((u) => u.id), order: { kind: 'move', lat: dest.lat, lon: dest.lon } });
  if (land.length) {
    const lp = node ? NODE_LAND_POINT[node.id] ?? [dest.lat, dest.lon] : [dest.lat, dest.lon];
    cmds.push({ type: 'order', unitIds: land.map((u) => u.id), order: { kind: 'move', lat: lp[0], lon: lp[1] } });
  }
  const etas = subs.map((u) => `${u.name} (${isFinite(etaTo(v, u, dest.lat, dest.lon)) ? 'ETA ' + dur(etaTo(v, u, dest.lat, dest.lon)) : 'out of range'})`);
  const warn = node && node.kind === 'land' && sea.length && !land.length ? ' Note: only ground forces can capture it.' : node && node.kind === 'sea' && land.length && !sea.length ? ' Note: only surface ships can capture it.' : '';
  return confirm(`${air.length && !sea.length && !land.length ? 'Patrol' : 'Move'} to ${dest.name}: ${etas.join(', ')}.${warn}`, cmds, subs, `${subs.map((u) => u.name).join(', ')} → ${dest.name}`, [dest.lat, dest.lon]);
}

function attack(p: Parsed, v: View): AskAnswer {
  const me = v.side;
  const enemies = v.units.filter((u) => u.side !== me);
  let target: UnitView | Base | null = null;
  const tTypes = p.targetTypes.length || p.targetDomains.length ? p.targetTypes : p.types;
  const tDomains = p.targetTypes.length || p.targetDomains.length ? p.targetDomains : p.domains;
  const enemyCall = p.callsigns.map((c) => enemies.find((e) => e.name === c)).find(Boolean);
  if (enemyCall) target = enemyCall;
  if (!target && p.verb === 'launch' || (!target && (tTypes.includes('recon_sat') || tTypes.includes('comms_sat') || tDomains.includes('space') || tTypes.includes('asat')))) {
    const sites = v.units.filter((u) => u.side === me && u.type === 'asat');
    const sats = enemies.filter((e) => e.domain === 'space');
    for (const s of sats.sort((a, b) => (a.type === 'recon_sat' ? -1 : 1) - (b.type === 'recon_sat' ? -1 : 1))) {
      const site = sites.find((x) => x.cd <= 0 && kmBetween(x.lat, x.lon, s.lat, s.lon) < CATALOG.asat.weapon!.rangeKm);
      if (site) return confirm(`Launch ${site.name} at ${s.name} (${typeLabel(s.type).toLowerCase()})?`, [{ type: 'order', unitIds: [site.id], order: { kind: 'attack', targetId: s.id } }], [site], `ASAT launch at ${s.name}`, [s.lat, s.lon]);
    }
    if (p.verb === 'launch' || tDomains.includes('space')) return { text: sites.length ? 'No enemy satellite is within ASAT range right now. ORBIT will flag the next window.' : 'We have no ASAT site.' };
  }
  const baseHit = p.bases.map((n) => v.bases.find((b) => b.name === n && b.side !== me)).find(Boolean)
    ?? (/\b(hq|headquarters|capital|command)\b/.test(p.text) && p.enemy ? v.bases.find((b) => b.side !== me && b.type === 'hq') : undefined);
  if (!target && baseHit) target = baseHit;
  if (!target) {
    let cands = enemies.filter((e) => e.domain !== 'space' && (tTypes.length || tDomains.length ? matchesKind(e, tTypes, tDomains as string[]) : true));
    if (p.nodes.length) {
      const n = v.nodes.find((x) => x.id === p.nodes[0])!;
      cands = cands.filter((e) => kmBetween(e.lat, e.lon, n.lat, n.lon) < n.radiusKm * 2);
    }
    cands.sort((a, b) => (b.type ? CATALOG[b.type].value : 1) - (a.type ? CATALOG[a.type].value : 1));
    target = cands[0] ?? null;
  }
  if (!target) return { text: `No matching enemy target is currently detected${p.nodes.length ? ` near ${nodeName(p.nodes[0])}` : ''}. Get eyes on it first (recon drone, AWACS or satellite).` };
  const tClass: TargetClass = 'domain' in target ? target.domain : 'base';
  const tName = 'domain' in target ? (target.identified ? target.name : 'unidentified contact') : target.name;
  const ownCalls = p.callsigns.filter((c) => v.units.some((u) => u.name === c && u.side === me));
  const subjectGiven = ownCalls.length > 0 || ((p.targetTypes.length > 0 || p.targetDomains.length > 0) && (p.types.length > 0 || p.domains.length > 0));
  if (subjectGiven) {
    const subs = pickSubjects({ ...p, callsigns: ownCalls }, v, (u) => !!u.type && !!CATALOG[u.type].weapon?.targets.includes(tClass), target);
    if (subs.length) {
      const etas = subs.map((u) => `${u.name}${isFinite(etaTo(v, u, target!.lat, target!.lon)) ? ' (ETA ' + dur(etaTo(v, u, target!.lat, target!.lon, CATALOG[u.type!].weapon!.rangeKm * 0.8)) + ')' : ''}`);
      return confirm(`Attack ${tName} with ${etas.join(', ')}?`, [{ type: 'order', unitIds: subs.map((u) => u.id), order: { kind: 'attack', targetId: target.id } }], subs, `${subs.map((u) => u.name).join(', ')} → attack ${tName}`, [target.lat, target.lon], [target.id]);
    }
  }
  const acts = counterTo(v, target, 2);
  if (!acts.length) return { text: `Nothing available can reach ${tName} right now.`, focus: [[target.lat, target.lon]], highlight: 'domain' in target ? [target.id] : undefined };
  return { text: `Options against ${tName}, ${where(v, target.lat, target.lon)}:`, actions: acts, focus: [[target.lat, target.lon]], highlight: 'domain' in target ? [target.id] : undefined };
}

function confirm(text: string, cmds: Command[], subs: UnitView[], describe: string, at?: LatLon, extraHl: string[] = []): AskAnswer {
  return {
    text,
    actions: [{ label: 'Confirm', cmds, describe }],
    focus: [...subs.map((u) => [u.lat, u.lon] as LatLon), ...(at ? [at] : [])],
    highlight: [...subs.map((u) => u.id), ...extraHl],
  };
}

/** Compact text summary of the View for the server-side LLM fallback (< 1.5KB). */
export function summarize(v: View): string {
  const me = v.side;
  const enemy: Side = me === 'blue' ? 'red' : 'blue';
  const lines: string[] = [];
  lines.push(`You command ${faction(me)} vs ${faction(enemy)}. Time ${Math.round(v.t)}s of ${RULES.timeLimit}s. VP ${Math.floor(v.vp[me])} vs ${Math.floor(v.vp[enemy])} (target ${RULES.vpTarget}). CP ${Math.floor(v.cp)}.`);
  lines.push('Nodes: ' + v.nodes.map((n) => `${n.short}=${n.owner ? (n.owner === me ? 'ours' : 'theirs') : 'neutral'}${n.contested ? '(contested)' : ''}`).join(', '));
  const count = (side: Side) => {
    const m = new Map<string, number>();
    for (const u of v.units) if (u.side === side && u.type) m.set(CATALOG[u.type].plural, (m.get(CATALOG[u.type].plural) ?? 0) + 1);
    return [...m].map(([k, n]) => `${n} ${k}`).join(', ');
  };
  lines.push(`Our forces: ${count(me)}.`);
  lines.push(`Detected enemy: ${count(enemy) || 'none'}.`);
  lines.push(projection(v).text);
  return lines.join('\n').slice(0, 1500);
}
