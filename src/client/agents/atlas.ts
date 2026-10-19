import { RULES } from '../../shared/catalog';
import type { Side, View } from '../../shared/types';
import { recommendations } from './coa';
import { dur, faction } from './text';
import type { BriefItem, Report, Severity, Sitrep } from './types';

const SEV_WEIGHT: Record<Severity, number> = { critical: 100, high: 40, medium: 12, low: 3, info: 0.5 };
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const MAX_BRIEF = 5;
const THROTTLE_MS = 3500;
const LIFETIME: Record<Severity, number> = { critical: 120, high: 75, medium: 50, low: 30, info: 0 };

export interface AtlasOutput {
  brief: BriefItem[];
  newlySurfaced: BriefItem[];
  sitrep: Sitrep | null;
  digest: { routine: number; windowStart: number };
}

/**
 * ATLAS — Chief of Staff agent. Ingests everything the staff reports and decides what the
 * commander sees: scored, de-duplicated, throttled, with recommended actions.
 */
export class Atlas {
  private brief = new Map<string, BriefItem>();
  private queue = new Map<string, BriefItem>();
  private recent = new Map<string, number[]>(); // subject → game times seen
  private lastSurfaceMs = 0;
  private lastSitrepT = -999;
  private routine = 0;
  private routineStart = 0;
  received = 0;
  surfaced = 0;
  sitrep: Sitrep | null = null;
  private vpHist: { t: number; vp: Record<Side, number> }[] = [];

  ingest(reports: Report[], v: View, nowMs: number): BriefItem[] {
    const fresh: BriefItem[] = [];
    for (const r of reports) {
      this.received++;
      if (r.severity === 'info') continue;
      if (r.severity === 'low') {
        this.routine++;
        // low items only refresh an existing card (e.g. capture progress), never create one
        const ex = this.brief.get(r.subject);
        if (ex) this.merge(ex, r, v);
        continue;
      }
      const times = (this.recent.get(r.subject) ?? []).filter((t) => v.t - t < 30);
      times.push(v.t);
      this.recent.set(r.subject, times);
      const novelty = Math.pow(0.5, times.length - 1);
      const score = SEV_WEIGHT[r.severity] * (r.weight ?? 1) * novelty * this.proximity(r, v);

      const existing = this.brief.get(r.subject);
      if (existing) {
        this.merge(existing, r, v, score);
        if (r.severity === 'critical' && SEV_RANK[existing.severity] < 4) existing.severity = 'critical';
        continue;
      }
      const item: BriefItem = {
        key: r.subject, severity: r.severity, agent: r.agent, text: r.text, t: v.t, count: 1, score,
        lat: r.lat, lon: r.lon, unitIds: r.unitIds, nodeId: r.nodeId, actions: r.actions, shownAt: 0,
      };
      const queued = this.queue.get(r.subject);
      if (queued) {
        queued.text = r.text;
        queued.count++;
        queued.t = v.t;
        queued.score = Math.max(queued.score, score);
        queued.actions = r.actions?.length ? r.actions : queued.actions;
        if (SEV_RANK[r.severity] > SEV_RANK[queued.severity]) queued.severity = r.severity;
        if (r.severity === 'critical') this.surface(queued, nowMs, fresh);
        continue;
      }
      if (r.severity === 'critical') this.surface(item, nowMs, fresh);
      else this.queue.set(r.subject, item);
    }
    this.expire(v);
    // throttle: at most one non-critical card per interval, only if it earns its place
    if (nowMs - this.lastSurfaceMs > THROTTLE_MS && this.queue.size) {
      const best = [...this.queue.values()].sort((a, b) => this.live(b, v) - this.live(a, v))[0];
      const shown = [...this.brief.values()];
      const weakest = shown.sort((a, b) => this.live(a, v) - this.live(b, v))[0];
      if (shown.length < MAX_BRIEF || (weakest && this.live(best, v) > this.live(weakest, v) * 1.2)) {
        this.surface(best, nowMs, fresh);
      }
    }
    return fresh;
  }

  private proximity(r: Report, v: View): number {
    if (r.lat === undefined) return 1;
    // threats near our nodes/HQ matter more
    let near = 1;
    for (const n of v.nodes) {
      const d = Math.hypot(n.lat - r.lat!, ((n.lon - r.lon! + 540) % 360) - 180);
      if (d < 12) near = Math.max(near, n.owner === v.side ? 1.4 : 1.2);
    }
    return near;
  }

  private merge(item: BriefItem, r: Report, v: View, score?: number) {
    item.text = r.text;
    item.count++;
    item.t = v.t;
    if (r.lat !== undefined) {
      item.lat = r.lat;
      item.lon = r.lon;
    }
    if (r.actions?.length) item.actions = r.actions;
    if (score !== undefined) item.score = Math.max(item.score * 0.8, score);
  }

  private surface(item: BriefItem, nowMs: number, fresh: BriefItem[]) {
    this.queue.delete(item.key);
    item.shownAt = nowMs;
    this.brief.set(item.key, item);
    this.surfaced++;
    this.lastSurfaceMs = nowMs;
    fresh.push(item);
    // keep at most MAX_BRIEF (+1 for a burst of FLASH traffic)
    while (this.brief.size > MAX_BRIEF) {
      const victim = [...this.brief.values()].filter((x) => x !== item).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.score - b.score)[0];
      if (!victim) break;
      this.brief.delete(victim.key);
    }
  }

  private live(i: BriefItem, v: View) {
    return i.score * Math.exp(-(v.t - i.t) / 45);
  }

  private expire(v: View) {
    for (const [k, i] of this.brief) {
      if (i.acted || v.t - i.t > LIFETIME[i.severity]) this.brief.delete(k);
    }
    for (const [k, i] of this.queue) {
      if (v.t - i.t > 20) this.queue.delete(k);
    }
    if (v.t - this.routineStart > 30) {
      this.routineStart = v.t;
      this.routine = 0;
    }
  }

  dismiss(key: string) {
    this.brief.delete(key);
  }
  markActed(key: string) {
    const i = this.brief.get(key);
    if (i) i.acted = true;
    this.brief.delete(key);
  }

  items(v: View): BriefItem[] {
    return [...this.brief.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || this.live(b, v) - this.live(a, v));
  }

  digest() {
    return { routine: this.routine, windowStart: this.routineStart };
  }

  private lastAdvice = -999;
  private opened = false;

  /**
   * ATLAS's own voice: opening orders at the start, and the best opportunity whenever the
   * brief is quiet — so the commander always has a sensible next move on screen.
   */
  advise(v: View): Report[] {
    const out: Report[] = [];
    if (!this.opened) {
      this.opened = true;
      const recs = recommendations(v).filter((r) => r.actions.length).slice(0, 3);
      if (recs.length) {
        const names = recs.map((r) => r.text.replace(/^(Take|Retake|Hold) /, '').replace(/[ :—.].*$/, ''));
        const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
        out.push({
          id: -1, t: v.t, agent: 'atlas', severity: 'high', subject: 'opening',
          text: `Opening orders: seize ${list} before HYDRA does. We hold Panama; they hold Malacca.`,
          actions: recs.map((r) => r.actions[0]).slice(0, 3), weight: 2,
        });
      }
      this.lastAdvice = v.t;
      return out;
    }
    const busy = [...this.brief.values()].filter((i) => SEV_RANK[i.severity] >= 2).length;
    if (v.t - this.lastAdvice < 22 || busy >= 3) return out;
    this.lastAdvice = v.t;
    const rec = recommendations(v).find((r) => r.actions.length && !this.brief.has(`rec:${r.text}`));
    if (rec) {
      out.push({ id: -1, t: v.t, agent: 'atlas', severity: 'medium', subject: `rec:${rec.text}`, text: `Opportunity: ${rec.text}`, actions: rec.actions.slice(0, 2), lat: rec.lat, lon: rec.lon, weight: 1.3 });
    }
    return out;
  }

  /** Builds a SITREP every 60s (or on demand). Returns it when a new one is produced. */
  maybeSitrep(v: View, force = false): Sitrep | null {
    if (this.vpHist.length === 0 || v.t - this.vpHist[this.vpHist.length - 1].t >= 5) this.vpHist.push({ t: v.t, vp: { ...v.vp } });
    if (this.vpHist.length > 30) this.vpHist.shift();
    if (!force && v.t - this.lastSitrepT < 60) return null;
    if (!force && v.t < 20) return null;
    this.lastSitrepT = v.t;
    this.surfaced++;
    this.sitrep = composeSitrep(v, this.items(v));
    return this.sitrep;
  }
}

export function projection(v: View): { text: string; trend: Sitrep['trend']; winner: Side | null; secs: number } {
  const me = v.side;
  const enemy: Side = me === 'blue' ? 'red' : 'blue';
  const left = RULES.timeLimit - v.t;
  const eta = (s: Side) => (v.vpRate[s] > 0 ? (RULES.vpTarget - v.vp[s]) / v.vpRate[s] : Infinity);
  const a = eta(me), b = eta(enemy);
  if (Math.min(a, b) > left) {
    const finalMe = v.vp[me] + v.vpRate[me] * left;
    const finalEn = v.vp[enemy] + v.vpRate[enemy] * left;
    const lead = finalMe >= finalEn;
    if (Math.abs(finalMe - finalEn) < 1) return { text: 'Dead even on current rates — we need another node.', trend: 'even', winner: null, secs: left };
    return {
      text: `On points at time limit: ${lead ? 'we win' : faction(enemy) + ' wins'} (${Math.round(finalMe)} vs ${Math.round(finalEn)}).`,
      trend: Math.abs(finalMe - finalEn) < 50 ? 'even' : lead ? 'winning' : 'losing', winner: lead ? me : enemy, secs: left,
    };
  }
  if (a <= b) return { text: `At current rates we reach ${RULES.vpTarget} VP in ${dur(a)}.`, trend: b - a < 30 ? 'even' : 'winning', winner: me, secs: a };
  return { text: `At current rates ${faction(enemy)} reaches ${RULES.vpTarget} VP in ${dur(b)}.`, trend: a - b < 30 ? 'even' : 'losing', winner: enemy, secs: b };
}

function composeSitrep(v: View, items: BriefItem[]): Sitrep {
  const me = v.side;
  const enemy: Side = me === 'blue' ? 'red' : 'blue';
  const held = (s: Side) => v.nodes.filter((n) => n.owner === s).length;
  const proj = projection(v);
  const lines: string[] = [];
  lines.push(`${faction(me)} ${Math.floor(v.vp[me])} vs ${faction(enemy)} ${Math.floor(v.vp[enemy])} VP · nodes ${held(me)}–${held(enemy)}. ${proj.text}`);
  const threat = items.find((i) => i.severity === 'critical' || i.severity === 'high');
  lines.push(threat ? `Main threat: ${threat.text}` : 'No immediate threats to our positions.');
  const rec = recommendations(v)[0];
  lines.push(rec ? `Recommend: ${rec.text}` : 'Recommend: hold positions and build CP.');
  return { t: v.t, lines, trend: proj.trend, projection: proj.text };
}
