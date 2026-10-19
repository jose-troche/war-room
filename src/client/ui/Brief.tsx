import { useEffect, useState } from 'preact/hooks';
import { highlights, brief, counters, sitrep, trafficOpen, view } from '../store';
import { agents } from '../agents/runner';
import { clock } from '../agents/text';
import { agentMeta, SEVERITY_ICON, SEVERITY_LABEL, type BriefItem } from '../agents/types';
import { mapCtl } from '../map/controller';
import { runAction } from './common';
import { Abbr, Gloss } from './Gloss';
import { glossTitle } from '../glossary';

function ago(t: number, now: number) {
  const s = Math.max(0, Math.round(now - t));
  return s < 5 ? 'now' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

export function BriefCard({ item, compact = false }: { item: BriefItem; compact?: boolean }) {
  const v = view.value;
  const [done, setDone] = useState<string[]>([]);
  const isNew = performance.now() - item.shownAt < 6000;
  const focus = () => {
    if (item.lat !== undefined) mapCtl.flyTo(item.lat, item.lon!, 4);
    if (item.unitIds?.length) highlights.value = { ids: item.unitIds, until: performance.now() + 4000 };
  };
  return (
    <article class={`card ${item.severity} ${isNew ? 'new' : ''}`} onClick={focus} aria-label={`${SEVERITY_LABEL[item.severity]} from ${agentMeta(item.agent).callsign}: ${item.text}`}>
      <div class="meta">
        <span class="sev"><Abbr term={SEVERITY_LABEL[item.severity]}>{SEVERITY_ICON[item.severity]} {SEVERITY_LABEL[item.severity]}</Abbr></span>
        <span>· {agentMeta(item.agent).callsign}</span>
        {item.count > 1 && <span class="count">×{item.count}</span>}
        <span>· {v ? ago(item.t, v.t) : ''}</span>
        {!compact && (
          <button class="x" aria-label="Dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); agents.dismiss(item.key); }}>×</button>
        )}
      </div>
      <div class="txt"><Gloss text={item.text} /></div>
      {!!item.actions?.length && (
        <div class="acts">
          {item.actions.slice(0, 3).map((a, _i, all) => {
            const isDone = done.includes(a.label);
            return (
              <button class="btn act sm" key={a.label} disabled={isDone} title={glossTitle(a.label)} onClick={(e) => {
                e.stopPropagation();
                const executable = all.filter((x) => x.cmd || x.cmds);
                const last = executable.filter((x) => !done.includes(x.label)).length <= 1;
                if (runAction(a, last ? item.key : undefined) && (a.cmd || a.cmds)) setDone([...done, a.label]);
              }}>{isDone ? `✓ ${a.label}` : a.label}</button>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function SignalNoise() {
  const c = counters.value;
  return (
    <button class="snr" onClick={() => (trafficOpen.value = true)} title="Reports received from staff vs items ATLAS surfaced to you. Click to open raw staff traffic." data-tour="snr">
      <div class="v"><span>{c.received.toLocaleString('en-US')}</span> <span class="muted">→</span> <span style={{ color: 'var(--accent)' }}>{c.surfaced}</span></div>
      <div class="k">reports → surfaced</div>
    </button>
  );
}

export function SitrepBlock() {
  const s = sitrep.value;
  const [open, setOpen] = useState(true);
  if (!s) return null;
  return (
    <section class="sitrep" aria-label="Situation report">
      <header>
        <b><Abbr term="SITREP" /> · <Gloss text={clock(s.t)} /></b>
        <span>
          <span class={`trend ${s.trend}`}>{s.trend === 'winning' ? '▲ WINNING' : s.trend === 'losing' ? '▼ LOSING' : '◆ EVEN'}</span>
          <button class="x" style={{ border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', marginLeft: 6 }} onClick={() => setOpen(!open)} aria-label={open ? 'Collapse SITREP' : 'Expand SITREP'}>{open ? '–' : '+'}</button>
        </span>
      </header>
      {open && s.lines.map((l) => <p key={l}><Gloss text={l} /></p>)}
    </section>
  );
}

export function BriefList({ max = 5 }: { max?: number }) {
  const items = brief.value.slice(0, max);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 2000);
    return () => clearInterval(id);
  }, []);
  const routine = agents.atlas.digest().routine;
  const flash = items.find((i) => i.severity === 'critical');
  return (
    <>
      <div class="sr-only" aria-live="assertive">{flash ? `Flash: ${flash.text}` : ''}</div>
      <div aria-live="polite" style={{ display: 'contents' }}>
        {items.length ? items.map((i) => <BriefCard key={i.key} item={i} />) : (
          <div class="empty">ATLAS is monitoring {counters.value.received ? `${counters.value.received.toLocaleString('en-US')} staff reports` : 'staff traffic'}. Nothing needs your decision right now.</div>
        )}
      </div>
      <div class="digest">
        <span>Routine: {routine} update{routine === 1 ? '' : 's'} (30s) filtered</span>
        <button onClick={() => (trafficOpen.value = true)}>Staff traffic ›</button>
      </div>
    </>
  );
}

export function BriefPanel() {
  const v = view.value;
  return (
    <>
      <div class="atlas-head" data-tour="brief">
        <div class="atlas-avatar" aria-hidden="true">A</div>
        <div>
          <h2>ATLAS</h2>
          <div class="sub">Chief of Staff</div>
        </div>
        <SignalNoise />
      </div>
      <div class="brief-list scroll">
        <SitrepBlock />
        <BriefList />
        {v && !v.ended && (
          <button class="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => agents.requestSitrep(v)}>↻ Request <Abbr term="SITREP" /></button>
        )}
      </div>
    </>
  );
}
