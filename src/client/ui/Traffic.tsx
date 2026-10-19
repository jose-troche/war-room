import { useState } from 'preact/hooks';
import { highlights, traffic, trafficOpen } from '../store';
import { AGENTS, agentMeta, SEVERITY_LABEL, type Severity } from '../agents/types';
import { clock } from '../agents/text';
import { mapCtl } from '../map/controller';
import { trafficFilter } from './Forces';

const SEVS: (Severity | 'all')[] = ['all', 'critical', 'high', 'medium', 'low', 'info'];

export function TrafficDrawer() {
  const [agent, setAgent] = useState<string | null>(trafficFilter.agent);
  const [sev, setSev] = useState<Severity | 'all'>('all');
  if (!trafficOpen.value) return null;
  const list = traffic.value.filter((r) => (!agent || r.agent === agent) && (sev === 'all' || r.severity === sev)).slice(0, 300);
  const close = () => {
    trafficFilter.agent = null;
    trafficOpen.value = false;
  };
  return (
    <aside class="drawer" aria-label="Raw staff traffic">
      <header>
        <div class="t">
          <h2>STAFF TRAFFIC</h2>
          <button class="icon-btn" aria-label="Close" onClick={close}>✕</button>
        </div>
        <div class="muted" style={{ fontSize: 12 }}>Everything your staff reports — the raw firehose ATLAS filters for you. Newest first.</div>
        <div class="chips">
          <button class="chip" style={!agent ? { borderColor: 'var(--accent)', color: 'var(--ink)' } : undefined} onClick={() => setAgent(null)}>All agents</button>
          {AGENTS.map((a) => (
            <button key={a.id} class="chip" style={agent === a.id ? { borderColor: 'var(--accent)', color: 'var(--ink)' } : undefined} onClick={() => setAgent(a.id)}>{a.callsign}</button>
          ))}
        </div>
        <div class="chips">
          {SEVS.map((s) => (
            <button key={s} class="chip" style={sev === s ? { borderColor: 'var(--accent)', color: 'var(--ink)' } : undefined} onClick={() => setSev(s)}>{s === 'all' ? 'All severities' : SEVERITY_LABEL[s]}</button>
          ))}
        </div>
      </header>
      <div class="feed scroll">
        {list.map((r) => (
          <div key={r.id} class={`r ${r.severity}`} onClick={() => {
            if (r.lat !== undefined) mapCtl.flyTo(r.lat, r.lon!, 4);
            if (r.unitIds) highlights.value = { ids: r.unitIds, until: performance.now() + 4000 };
          }}>
            <span class="tm">{clock(r.t)}</span>
            <span class="ag">{agentMeta(r.agent).callsign}</span>
            <span class="tx">{r.text}</span>
          </div>
        ))}
        {!list.length && <div class="empty" style={{ margin: 10 }}>No traffic yet.</div>}
      </div>
    </aside>
  );
}

export function Toast() {
  return null;
}
