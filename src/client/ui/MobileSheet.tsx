import { useRef } from 'preact/hooks';
import { brief, panel, sheetSize, sheetTab, view } from '../store';
import { AskPanel } from './Ask';
import { BriefCard, BriefList, SignalNoise, SitrepBlock } from './Brief';
import { ForcePanel, NodeDetail } from './Forces';
import { ObjectiveChips } from './Objectives';

export function sheetHeight(size: 'peek' | 'half' | 'full', vh = window.innerHeight) {
  return size === 'peek' ? 168 : size === 'half' ? Math.round(vh * 0.48) : Math.round(vh * 0.86);
}

const TABS = [
  { id: 'brief', label: 'Brief' },
  { id: 'forces', label: 'Forces' },
  { id: 'objectives', label: 'Objectives' },
  { id: 'ask', label: 'Ask' },
] as const;

export function MobileSheet() {
  const v = view.value;
  const size = sheetSize.value;
  const tab = sheetTab.value;
  const drag = useRef<{ y: number; h: number } | null>(null);
  const flash = brief.value.filter((b) => b.severity === 'critical').length;
  if (!v) return null;

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetHeight(size) };
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) < 8) {
      sheetSize.value = size === 'peek' ? 'half' : size === 'half' ? 'full' : 'peek';
      return;
    }
    const target = d.h + dy;
    const opts = (['peek', 'half', 'full'] as const).map((s) => ({ s, h: sheetHeight(s) }));
    sheetSize.value = opts.sort((a, b) => Math.abs(a.h - target) - Math.abs(b.h - target))[0].s;
  };

  const pick = (id: typeof TABS[number]['id']) => {
    if (tab === id && size !== 'peek') sheetSize.value = 'peek';
    else {
      sheetTab.value = id;
      if (size === 'peek') sheetSize.value = id === 'ask' ? 'half' : 'half';
    }
  };

  const top = brief.value[0];
  return (
    <section class="sheet" style={{ height: sheetHeight(size) }} aria-label="Command panels">
      <div class="handle" onPointerDown={onDown as never} onPointerUp={onUp as never} role="button" aria-label="Resize panel" tabIndex={0}><i /></div>
      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)} data-tour={t.id === 'brief' ? 'brief' : t.id === 'forces' ? 'forces' : t.id === 'objectives' ? 'objectives' : 'ask'}>
            {t.label}
            {t.id === 'brief' && flash > 0 && <span class="badge">{flash}</span>}
          </button>
        ))}
      </nav>
      <div class="body scroll">
        {size === 'peek' ? (
          tab === 'ask' ? <AskPanel /> : top ? <div class="peek-item"><BriefCard item={top} compact /></div> : (
            <div class="peek-item"><div class="empty" style={{ padding: 10 }}>ATLAS: no decisions pending. <SignalNoise /></div></div>
          )
        ) : (
          <>
            {tab === 'brief' && (
              <div class="brief-list">
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><SignalNoise /></div>
                <SitrepBlock />
                <BriefList />
              </div>
            )}
            {tab === 'forces' && <ForcePanel hideHead />}
            {tab === 'objectives' && (
              <>
                {panel.value.kind === 'node' ? <NodeDetail v={v} id={panel.value.id} /> : null}
                <div class="m-objs"><ObjectiveChips /></div>
              </>
            )}
            {tab === 'ask' && <AskPanel autoFocus={false} />}
          </>
        )}
      </div>
    </section>
  );
}
