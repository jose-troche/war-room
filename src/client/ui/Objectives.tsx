import { openNode } from '../actions';
import { faction } from '../agents/text';
import { view } from '../store';

export function ObjectiveChips() {
  const v = view.value;
  if (!v) return null;
  return (
    <>
      {v.nodes.map((n) => {
        const cls = n.contested ? 'contested' : n.owner === v.side ? 'mine' : n.owner ? 'theirs' : '';
        const c = n.control;
        const w = Math.abs(c) / 2;
        const full = n.contested ? 'contested' : n.owner ? faction(n.owner) : 'neutral';
        return (
          <button key={n.id} class={`obj ${cls}`} onClick={() => openNode(n.id)} aria-label={`${n.name}: ${full}, control ${Math.round(c)}`} title={`${n.name}: ${full}`}>
            <span class="top">
              <span>{n.short}</span>
              <span class="own" style={{ background: n.contested ? 'var(--unknown)' : n.owner === 'blue' ? 'var(--blue)' : n.owner === 'red' ? 'var(--red)' : 'var(--line-2)' }} aria-hidden="true" />
            </span>
            <span class="ctl">
              <i style={{ left: c >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: c >= 0 ? 'var(--blue)' : 'var(--red)' }} />
              <i style={{ left: '50%', width: '1px', background: 'rgba(255,255,255,.35)' }} />
            </span>
          </button>
        );
      })}
    </>
  );
}

export function ObjectivesStrip() {
  return (
    <footer class="objectives" data-tour="objectives" aria-label="Objectives">
      <div class="lbl">
        <span class="sec-title">Objectives</span>
        <span class="muted" style={{ fontSize: 11 }} title="Hold 4 or more objectives to earn +50% VP (Victory Points)">4+ = bonus</span>
      </div>
      <ObjectiveChips />
    </footer>
  );
}
