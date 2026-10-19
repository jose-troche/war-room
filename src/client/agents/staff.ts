import { CATALOG, RULES } from '../../shared/catalog';
import type { Domain, GameEvent, Side, UnitType, UnitView, View } from '../../shared/types';
import { aaThreatsAt, buySuggestion, counterTo, nodeActions } from './coa';
import { dur, faction, kmBetween, typeLabel, where } from './text';
import type { AgentId, Report, Severity, SuggestedAction } from './types';

let seq = 1;

const AGENT_FOR_DOMAIN: Record<Domain, AgentId> = {
  air: 'falcon', drone: 'swarm', sea: 'trident', sub: 'trident', land: 'bulwark', space: 'orbit',
};
const HV: UnitType[] = ['carrier', 'awacs', 'bomber', 'recon_sat', 'comms_sat'];

/**
 * The staff: seven specialist agents that watch the battlespace and report — a lot.
 * Each `observe` call diffs the new View against the previous one and emits structured reports.
 */
export class StaffRoom {
  private lastTelemetry = new Map<string, number>();
  private asatWindows = new Map<string, number>();
  private satPass = new Map<string, string>();
  private aaWarned = new Map<string, number>();
  private sealiftWarned = new Map<string, number>();
  private cpMark = 300;
  private warnedProjection = 0;
  private lastStatus = 0;

  observe(prev: View | null, v: View): Report[] {
    const out: Report[] = [];
    const me = v.side;
    const R = (agent: AgentId, severity: Severity, subject: string, text: string, extra: Partial<Report> = {}) =>
      out.push({ id: seq++, t: v.t, agent, severity, subject, text, ...extra });
    const unit = (id?: string) => (id ? v.units.find((u) => u.id === id) ?? prev?.units.find((u) => u.id === id) : undefined);
    const focus = (lat?: number, lon?: number): SuggestedAction[] => (lat === undefined ? [] : [{ label: 'Show', focus: { lat, lon: lon!, zoom: 4 } }]);

    for (const e of v.events) this.onEvent(e, v, prev, R, unit, focus);

    /* ---------- periodic telemetry: the firehose ---------- */
    for (const u of v.units) {
      if (!u.type || u.state === 'building') continue;
      const last = this.lastTelemetry.get(u.id) ?? -Math.random() * 10;
      const own = u.side === me;
      const period = own ? (u.domain === 'air' || u.domain === 'drone' ? 7 : u.domain === 'space' ? 20 : 12) : 9;
      if (v.t - last < period) continue;
      if (own && (u.domain === 'air' || u.domain === 'drone') && (u.state === 'ready')) continue;
      this.lastTelemetry.set(u.id, v.t);
      if (own) {
        const agent = AGENT_FOR_DOMAIN[u.domain];
        const hp = Math.round((u.hp / u.maxHp) * 100);
        let status = '';
        if (u.domain === 'air' || u.domain === 'drone') {
          const f = u.fuel >= 0 && CATALOG[u.type].endurance ? Math.round((u.fuel / CATALOG[u.type].endurance!) * 100) : 100;
          status = `${u.name}: fuel ${f}%, ${u.state === 'rtb' ? 'returning to base' : u.state === 'patrol' ? 'on station' : u.state}, ${where(v, u.lat, u.lon)}.`;
        } else if (u.domain === 'space') {
          status = `${u.name}: nominal, over ${where(v, u.lat, u.lon)}.`;
        } else {
          status = `${u.name}: ${hp}% integrity, ${u.path.length ? 'under way' : 'holding'} ${where(v, u.lat, u.lon)}.`;
        }
        R(agent, 'info', `telemetry:${u.id}`, status, { lat: u.lat, lon: u.lon, unitIds: [u.id] });
      } else if (u.domain !== 'space') {
        R('vigil', 'info', `track:${u.id}`, `Track update: ${u.identified ? u.name : 'unidentified ' + u.domain} ${where(v, u.lat, u.lon)}, heading ${Math.round(u.heading)}°.`, { lat: u.lat, lon: u.lon, unitIds: [u.id] });
      }
    }

    /* ---------- FALCON / SWARM: aircraft inside enemy air defenses ---------- */
    for (const u of v.units) {
      if (u.side !== me || !(u.domain === 'air' || u.domain === 'drone') || u.state === 'ready' || u.state === 'rearming' || u.state === 'rtb') continue;
      if (u.type === 'bomber' || u.type === 'strike_drone') continue; // strike packages accept risk
      const th = aaThreatsAt(v, u.lat, u.lon);
      if (!th.length) continue;
      if (v.t - (this.aaWarned.get(u.id) ?? -99) < 30) continue;
      this.aaWarned.set(u.id, v.t);
      const name = th[0].identified ? th[0].name : 'an enemy ship';
      R(AGENT_FOR_DOMAIN[u.domain], u.type === 'awacs' ? 'critical' : 'high', `aa:${u.id}`, `${u.name} is inside ${name}'s air-defense umbrella. Pull back?`, {
        lat: u.lat, lon: u.lon, unitIds: [u.id], weight: u.type === 'awacs' ? 1.5 : 1,
        actions: [{ label: `Pull ${u.name} back`, cmd: { type: 'order', unitIds: [u.id], order: { kind: 'rtb' } }, describe: `${u.name} RTB` }, ...counterTo(v, th[0], 1)],
      });
    }

    /* ---------- BULWARK: armor at sea near hostile ships ---------- */
    for (const u of v.units) {
      if (u.side !== me || u.state !== 'embarked') continue;
      const threat = v.units.find((e) => e.side !== me && (e.domain === 'sea' || e.domain === 'sub') && kmBetween(e.lat, e.lon, u.lat, u.lon) < 900);
      if (!threat || v.t - (this.sealiftWarned.get(u.id) ?? -99) < 40) continue;
      this.sealiftWarned.set(u.id, v.t);
      R('bulwark', 'high', `sealift:${u.id}`, `${u.name} is at sea with ${threat.identified ? threat.name : 'a hostile vessel'} ${Math.round(kmBetween(threat.lat, threat.lon, u.lat, u.lon) / 10) * 10} km away. Escort or strike first.`, {
        lat: u.lat, lon: u.lon, unitIds: [u.id], actions: counterTo(v, threat, 2),
      });
    }

    /* ---------- ORBIT: satellite passes and ASAT windows ---------- */
    for (const s of v.units) {
      if (s.domain !== 'space') continue;
      if (s.side === me && s.type === 'recon_sat') {
        const n = v.nodes.find((x) => kmBetween(x.lat, x.lon, s.lat, s.lon) < 1300);
        const key = n?.id ?? '';
        if (key && this.satPass.get(s.id) !== key) {
          R('orbit', 'low', `pass:${s.id}`, `${s.name} imaging ${n!.short} now.`, { lat: s.lat, lon: s.lon, unitIds: [s.id] });
        }
        this.satPass.set(s.id, key);
      }
      if (s.side !== me) {
        const site = v.units.find((a) => a.side === me && a.type === 'asat' && a.cd <= 0 && a.order.kind !== 'attack' && kmBetween(a.lat, a.lon, s.lat, s.lon) < CATALOG.asat.weapon!.rangeKm * 0.92);
        const lastW = this.asatWindows.get(s.id) ?? -99;
        if (site && v.t - lastW > 25) {
          this.asatWindows.set(s.id, v.t);
          R('orbit', 'high', `asat:${s.id}`, `${s.name} (${s.type === 'recon_sat' ? 'their eyes' : 'their comms/GPS'}) is in ${site.name} range — window ~20s.`, {
            lat: s.lat, lon: s.lon, unitIds: [s.id], weight: 1.3,
            actions: [{ label: `Launch ${site.name}`, cmd: { type: 'order', unitIds: [site.id], order: { kind: 'attack', targetId: s.id } }, describe: `ASAT launch at ${s.name}` }],
          });
        }
      }
    }

    /* ---------- QUARTERMASTER: CP thresholds ---------- */
    if (v.cp >= this.cpMark + 150) {
      this.cpMark = Math.floor(v.cp / 150) * 150;
      const buy = buySuggestion(v);
      R('quartermaster', buy ? 'medium' : 'low', 'cp', buy ? buy.why : `${Math.floor(v.cp)} CP banked.`, { actions: buy ? [buy.action] : undefined });
    } else if (v.cp < this.cpMark - 150) this.cpMark = Math.floor(v.cp / 150) * 150;

    /* ---------- strategic projection ---------- */
    const enemy: Side = me === 'blue' ? 'red' : 'blue';
    const eta = (s: Side) => (v.vpRate[s] > 0 ? (RULES.vpTarget - v.vp[s]) / v.vpRate[s] : Infinity);
    const theirs = eta(enemy), ours = eta(me);
    if (theirs < ours && theirs < 120 && v.t - this.warnedProjection > 45 && theirs < RULES.timeLimit - v.t) {
      this.warnedProjection = v.t;
      R('vigil', 'critical', 'projection', `${faction(enemy)} reaches ${RULES.vpTarget} VP in ${dur(theirs)} at current rates. Take a node from them now.`, { weight: 1.5 });
    }
    if (v.t - this.lastStatus > 20) {
      this.lastStatus = v.t;
      R('quartermaster', 'info', 'status', `Status: ${Math.floor(v.cp)} CP (+${v.cpRate.toFixed(0)}/s), ${v.units.filter((u) => u.side === me).length} units in theater.`);
    }
    return out;
  }

  private onEvent(
    e: GameEvent, v: View, prev: View | null,
    R: (agent: AgentId, severity: Severity, subject: string, text: string, extra?: Partial<Report>) => void,
    unit: (id?: string) => UnitView | undefined,
    focus: (lat?: number, lon?: number) => SuggestedAction[],
  ) {
    const me = v.side;
    const ours = e.side === me;
    const dom = e.unitType ? CATALOG[e.unitType].domain : 'sea';
    const agent = AGENT_FOR_DOMAIN[dom];
    const node = e.nodeId ? v.nodes.find((n) => n.id === e.nodeId) : undefined;
    const loc = e.lat !== undefined ? where(v, e.lat, e.lon!) : '';
    const at = { lat: e.lat, lon: e.lon };
    switch (e.kind) {
      case 'detected': {
        if (ours) return;
        const u = unit(e.unitId);
        const t = e.unitType;
        const nearNode = v.nodes.find((n) => e.lat !== undefined && kmBetween(n.lat, n.lon, e.lat, e.lon!) < 1200);
        const sev: Severity = t && HV.includes(t) ? 'high' : dom === 'sub' ? 'high' : nearNode && nearNode.owner === me ? 'high' : t ? 'medium' : 'low';
        const label = t ? `${typeLabel(t).toLowerCase()} ${e.unitName}` : `unidentified ${dom === 'sub' ? 'sub-surface' : dom} contact`;
        const threat = nearNode && nearNode.owner === me ? ` — threat to ${nearNode.short}` : '';
        const acts = u ? counterTo(v, u, 1) : [];
        R(dom === 'sub' ? 'trident' : dom === 'air' || dom === 'drone' ? 'falcon' : 'vigil', sev, `contact:${e.unitId}`,
          `New contact: ${faction(e.side!)} ${label}, ${loc}${threat}.`,
          { ...at, unitIds: e.unitId ? [e.unitId] : undefined, actions: [...focus(e.lat, e.lon), ...acts].slice(0, 2), weight: nearNode ? 1.4 : 1 });
        return;
      }
      case 'identified':
        R('vigil', e.unitType && HV.includes(e.unitType) ? 'high' : 'low', `contact:${e.unitId}`, `Contact classified: ${typeLabel(e.unitType!)} ${e.unitName}, ${loc}.`, { ...at, unitIds: [e.unitId!] });
        return;
      case 'lost':
        R('vigil', 'low', `lost:${e.unitId}`, `Lost track of ${e.unitType ? typeLabel(e.unitType).toLowerCase() : 'contact'} ${loc}.`, at);
        return;
      case 'shot': {
        if (ours) {
          R(agent, 'low', `fire:${e.unitId}`, `${e.unitName} engaging ${e.otherName ?? 'target'} ${loc}.`, { ...at, unitIds: [e.unitId!] });
        } else {
          // enemy shooting at us
          const victim = e.baseId ? v.bases.find((b) => b.id === e.baseId) : unit(e.otherId);
          const isHq = e.baseId && v.bases.find((b) => b.id === e.baseId)?.type === 'hq';
          const vName = e.otherName ?? 'our unit';
          const hv = e.otherType && HV.includes(e.otherType);
          const sev: Severity = isHq ? 'critical' : e.baseId || hv ? 'high' : 'medium';
          const shooter = unit(e.unitId);
          const acts = shooter && shooter.side !== me ? counterTo(v, shooter, 2) : [];
          R(e.baseId ? 'quartermaster' : AGENT_FOR_DOMAIN[e.otherType ? CATALOG[e.otherType].domain : 'land'], sev, `attack:${e.otherId}`,
            `${vName} under attack${e.unitName ? ` from ${e.unitName}` : ''} ${loc}.`,
            { ...at, unitIds: victim && 'domain' in victim ? [victim.id] : undefined, actions: acts, weight: isHq ? 2.5 : 1 });
        }
        return;
      }
      case 'hit': {
        if (e.side === me) {
          const pct = e.value !== undefined && e.unitType ? Math.round((e.value / CATALOG[e.unitType].hp) * 100) : undefined;
          const sev: Severity = pct !== undefined && pct < 35 ? 'high' : 'medium';
          R(agent, sev, `damage:${e.unitId}`, `${e.unitName} hit${pct !== undefined ? ` — ${pct}% integrity` : ''}${pct !== undefined && pct < 35 ? '. Consider withdrawing to port' : ''}.`, {
            ...at, unitIds: [e.unitId!],
            actions: pct !== undefined && pct < 35 && dom !== 'air' && dom !== 'drone' && dom !== 'space' ? [{ label: `Withdraw ${e.unitName}`, cmd: { type: 'order', unitIds: [e.unitId!], order: { kind: 'rtb' } }, describe: `${e.unitName} withdraws` }] : undefined,
          });
        } else {
          R(AGENT_FOR_DOMAIN[e.otherType ? CATALOG[e.otherType].domain : 'sea'], 'low', `bda:${e.unitId}`, `Hit confirmed on ${e.unitName ?? 'target'} by ${e.otherName}.`, at);
        }
        return;
      }
      case 'miss':
        R(AGENT_FOR_DOMAIN[e.otherType ? CATALOG[e.otherType].domain : 'sea'], 'info', `miss:${e.otherId}`, `${e.otherName ?? 'Shot'} missed ${e.unitName ?? 'target'}.`, at);
        return;
      case 'intercepted':
        R(ours ? 'quartermaster' : 'vigil', 'low', `intercept:${e.unitId ?? e.baseId}`, ours ? `Air defenses intercepted a missile aimed at ${e.unitName}.` : `${e.unitName} intercepted our missile.`, at);
        return;
      case 'destroyed': {
        if (ours) {
          const hv = e.unitType && HV.includes(e.unitType);
          const killer = unit(e.otherId);
          const acts = killer && killer.side !== me ? counterTo(v, killer, 2) : [];
          R(agent, e.unitType === 'carrier' || e.unitType === 'comms_sat' ? 'critical' : hv ? 'high' : 'high', `loss:${e.unitId}`,
            `LOST: ${e.unitName} (${typeLabel(e.unitType!).toLowerCase()})${e.otherName ? ` to ${e.otherName}` : e.text ? ` — ${e.text}` : ''}, ${loc}.`,
            { ...at, actions: acts, weight: hv ? 1.4 : 1 });
          if (e.unitType === 'comms_sat' && !v.hasComms[me]) {
            R('orbit', 'critical', 'comms', 'Comms/GPS constellation down: our weapons lose the +20% accuracy bonus. Replace it.', { actions: buySuggestion(v) ? [buySuggestion(v)!.action] : undefined });
          }
        } else {
          R(e.unitType ? AGENT_FOR_DOMAIN[CATALOG[e.unitType].domain] : 'vigil', e.unitType && HV.includes(e.unitType) ? 'high' : 'medium', `kill:${e.unitId}`,
            `KILL: ${faction(e.side!)} ${e.unitType ? typeLabel(e.unitType).toLowerCase() : 'unit'} ${e.unitName ?? ''} destroyed${e.otherName ? ` by ${e.otherName}` : ''}.`.replace(/\s+/g, ' '),
            at);
        }
        return;
      }
      case 'base_hit':
      case 'hq_hit': {
        const b = v.bases.find((x) => x.id === e.baseId);
        if (!b) return;
        const pct = Math.round((b.hp / b.maxHp) * 100);
        if (b.side === me) {
          const raiders = v.units.filter((u) => u.side !== me && (u.domain === 'air' || u.domain === 'drone') && kmBetween(u.lat, u.lon, b.lat, b.lon) < 1500);
          const acts = raiders[0] ? counterTo(v, raiders[0], 2) : [];
          R('quartermaster', e.kind === 'hq_hit' ? 'critical' : 'high', `basehit:${b.id}`, `${b.name} ${e.kind === 'hq_hit' ? 'HQ' : 'base'} struck — ${pct}% integrity.${e.kind === 'hq_hit' ? ' If it falls, we lose.' : ''}`, { lat: b.lat, lon: b.lon, actions: acts, weight: e.kind === 'hq_hit' ? 2.5 : 1.2 });
        } else {
          R('vigil', e.kind === 'hq_hit' ? 'high' : 'medium', `basehit:${b.id}`, `Strike on ${faction(b.side)} ${b.name}: ${pct}% integrity.`, { lat: b.lat, lon: b.lon });
        }
        return;
      }
      case 'base_disabled': {
        const b = v.bases.find((x) => x.id === e.baseId);
        if (!b) return;
        R('quartermaster', b.side === me ? 'critical' : 'high', `basehit:${b.id}`, b.side === me ? `${b.name} is knocked out — no rearming or reinforcements there until repaired.` : `${faction(b.side)} ${b.name} knocked out.`, { lat: b.lat, lon: b.lon });
        return;
      }
      case 'capture': {
        if (!node) return;
        const held = v.nodes.filter((n) => n.owner === e.side).length;
        if (ours) R(node.kind === 'land' ? 'bulwark' : 'trident', 'high', `node:${node.id}`, `${node.name} secured. We hold ${held}/${v.nodes.length}${held >= RULES.majorityNodes ? ' — majority bonus active' : ''}.`, { lat: node.lat, lon: node.lon, nodeId: node.id, weight: 1.6 });
        else R(node.kind === 'land' ? 'bulwark' : 'trident', held >= RULES.majorityNodes ? 'critical' : 'high', `node:${node.id}`, `${faction(e.side!)} took ${node.name}. They hold ${held}/${v.nodes.length}${held >= RULES.majorityNodes ? ' and earn the majority bonus' : ''}.`, { lat: node.lat, lon: node.lon, nodeId: node.id, actions: nodeActions(v, node), weight: 1.6 });
        return;
      }
      case 'node_lost': {
        if (!node || e.side !== me) return;
        R(node.kind === 'land' ? 'bulwark' : 'trident', 'critical', `node:${node.id}`, `We lost ${node.name}. Enemy forces control the zone.`, { lat: node.lat, lon: node.lon, nodeId: node.id, actions: nodeActions(v, node), weight: 1.6 });
        return;
      }
      case 'contested': {
        if (!node) return;
        const mineHeld = node.owner === me;
        R(node.kind === 'land' ? 'bulwark' : 'trident', mineHeld ? 'high' : 'medium', `node:${node.id}`, `${node.name} contested — both sides in the zone${mineHeld ? '; our hold is at risk' : ''}.`, { lat: node.lat, lon: node.lon, nodeId: node.id, actions: nodeActions(v, node), weight: 1.4 });
        return;
      }
      case 'capturing': {
        if (!node) return;
        const pct = Math.round(Math.abs(e.value ?? 0));
        if (ours) R(node.kind === 'land' ? 'bulwark' : 'trident', 'low', `node:${node.id}`, `Taking ${node.short}: control ${pct}%.`, { lat: node.lat, lon: node.lon, nodeId: node.id });
        else R(node.kind === 'land' ? 'bulwark' : 'trident', node.owner === me ? 'critical' : 'high', `node:${node.id}`, `${faction(e.side!)} is taking ${node.short} (${pct}%).`, { lat: node.lat, lon: node.lon, nodeId: node.id, actions: nodeActions(v, node), weight: 1.5 });
        return;
      }
      case 'bingo':
        R(agent, dom === 'drone' ? 'low' : 'medium', `bingo:${e.unitId}`, `${e.unitName} ${e.text}, returning to base.`, { ...at, unitIds: [e.unitId!] });
        return;
      case 'rearmed':
        R(agent, 'low', `rearm:${e.unitId}`, `${e.unitName} refueled and rearmed.`, { ...at, unitIds: [e.unitId!] });
        return;
      case 'deployed':
        R('quartermaster', 'low', `deploy:${e.unitId}`, `${e.unitName} (${typeLabel(e.unitType!).toLowerCase()}) ready for tasking.`, { ...at, unitIds: [e.unitId!], actions: [{ label: 'Select', select: [e.unitId!], focus: { lat: e.lat!, lon: e.lon!, zoom: 4 } }] });
        return;
      case 'embarked':
        R('bulwark', 'medium', `sealift:${e.unitId}`, `${e.unitName} embarked for sealift — slow and vulnerable until ashore.`, { ...at, unitIds: [e.unitId!] });
        return;
      case 'arrived':
        R(agent, 'low', `arrive:${e.unitId}`, `${e.unitName} on station ${loc}.`, { ...at, unitIds: [e.unitId!] });
        return;
      case 'canal_closed':
        if (!node) return;
        R('trident', 'high', `canal:${node.id}`, e.side === me ? `${node.short} canal closed to ${faction(me === 'blue' ? 'red' : 'blue')} shipping.` : `${node.short} canal closed to our ships — they must route around.`, { lat: node.lat, lon: node.lon, nodeId: node.id });
        return;
      default:
        return;
    }
  }
}

export const prevViewFor = { last: null as View | null };
export type { Side };
