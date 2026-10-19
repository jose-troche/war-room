import type { View } from '../../shared/types';
import { session } from '../session/session';
import { baseline, brief, counters, frame, mode, paused, settings, showToast, sitrep, staffStats, traffic } from '../store';
import { CATALOG } from '../../shared/catalog';
import { speak } from '../voice';
import { Atlas } from './atlas';
import { StaffRoom } from './staff';
import { resetPlanner } from './coa';
import type { BriefItem, Report } from './types';

const TRAFFIC_MAX = 300;

/** Wires the staff agents and ATLAS to the View stream and publishes results to the UI. */
export class AgentRunner {
  staff = new StaffRoom();
  atlas = new Atlas();
  private prev: View | null = null;
  private trafficBuf: Report[] = [];

  reset() {
    this.staff = new StaffRoom();
    this.atlas = new Atlas();
    resetPlanner();
    this.prev = null;
    this.trafficBuf = [];
    brief.value = [];
    traffic.value = [];
    sitrep.value = null;
    counters.value = { received: 0, surfaced: 0 };
    staffStats.value = {};
    baseline.value = {};
  }

  onView(v: View) {
    addEffects(v);
    if (mode.value === 'attract') {
      this.prev = v;
      return;
    }
    const now = performance.now();
    if (!Object.keys(baseline.value).length) {
      const b: Record<string, number> = {};
      for (const u of v.units) if (u.side === v.side && u.type) b[CATALOG[u.type].group] = (b[CATALOG[u.type].group] ?? 0) + u.maxHp;
      baseline.value = b;
    }
    const reports = [...this.staff.observe(this.prev, v), ...this.atlas.advise(v)];
    if (reports.length) {
      const st = { ...staffStats.value };
      const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
      for (const r of reports) {
        const cur = st[r.agent] ?? { n: 0, worst: 'info', at: 0 };
        const stale = v.t - cur.at > 20;
        st[r.agent] = { n: cur.n + 1, worst: stale || rank[r.severity] >= rank[cur.worst] ? r.severity : cur.worst, at: stale || rank[r.severity] >= rank[cur.worst] ? v.t : cur.at };
      }
      staffStats.value = st;
    }
    this.prev = v;
    const fresh = this.atlas.ingest(reports, v, now);
    if (reports.length) {
      this.trafficBuf = [...reports.reverse(), ...this.trafficBuf].slice(0, TRAFFIC_MAX);
      traffic.value = this.trafficBuf;
    }
    const rep = this.atlas.maybeSitrep(v);
    if (rep) {
      sitrep.value = rep;
      if (settings.value.voice) speak(`Sitrep. ${rep.lines[0]} ${rep.lines[2]}`);
    }
    brief.value = this.atlas.items(v);
    counters.value = { received: this.atlas.received, surfaced: this.atlas.surfaced };
    this.announce(fresh);
  }

  requestSitrep(v: View) {
    const rep = this.atlas.maybeSitrep(v, true);
    sitrep.value = rep;
    counters.value = { received: this.atlas.received, surfaced: this.atlas.surfaced };
    return rep;
  }

  private announce(fresh: BriefItem[]) {
    const flash = fresh.filter((i) => i.severity === 'critical');
    if (!flash.length) {
      const pri = fresh.find((i) => i.severity === 'high');
      if (pri && settings.value.voice) speak(pri.text);
      return;
    }
    if (settings.value.voice) speak(`Flash. ${flash[0].text}`, true);
    if (settings.value.autoPause && mode.value === 'solo' && !paused.value) {
      paused.value = true;
      session()?.setPaused(true);
      showToast('Auto-paused on FLASH — press Space to resume', 'warn');
    }
  }

  dismiss(key: string) {
    this.atlas.dismiss(key);
    if (this.prev) brief.value = this.atlas.items(this.prev);
  }
  acted(key: string) {
    this.atlas.markActed(key);
    if (this.prev) brief.value = this.atlas.items(this.prev);
  }
}

export const agents = new AgentRunner();

function addEffects(v: View) {
  const now = performance.now();
  for (const e of v.events) {
    if (e.lat === undefined) continue;
    if (e.kind === 'destroyed') frame.effects.push({ kind: 'boom', lat: e.lat, lon: e.lon!, t0: now, color: '#ff8a3d' });
    else if (e.kind === 'capture') frame.effects.push({ kind: 'capture', lat: e.lat, lon: e.lon!, t0: now, color: e.side === 'blue' ? '#4da3ff' : '#ff4d5e' });
    else if (e.kind === 'hit' || e.kind === 'hq_hit' || e.kind === 'base_hit') frame.effects.push({ kind: 'ping', lat: e.lat, lon: e.lon!, t0: now, color: '#ffd23f' });
  }
}
