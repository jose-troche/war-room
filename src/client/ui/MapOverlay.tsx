import type { UnitType } from '../../shared/types';
import { clearSelection, selectedUnits } from '../actions';
import { mapCtl } from '../map/controller';
import { COLORS, GLYPHS } from '../map/icons';
import { clickMode, isMobile, mode, selection, settings, updateSettings, view } from '../store';
import { Icon } from './common';
import { Abbr } from './Gloss';

export function MapControls() {
  const s = settings.value;
  return (
    <div class="map-ctrls" data-tour="controls">
      <div class="grp">
        <button class="fit-btn" onClick={() => mapCtl.fitAll()} title="Fit all relevant assets (F)" aria-label="Fit all relevant assets">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h7v2H5v5H3V3Zm11 0h7v7h-2V5h-5V3ZM3 14h2v5h5v2H3v-7Zm16 0h2v7h-7v-2h5v-5Z" /></svg>
          {!isMobile.value && 'Fit all'}
        </button>
      </div>
      <div class="grp">
        <button onClick={() => mapCtl.zoom(1.6)} aria-label="Zoom in (+)" title="Zoom in (+)">+</button>
        <button onClick={() => mapCtl.zoom(1 / 1.6)} aria-label="Zoom out (-)" title="Zoom out (−)">−</button>
        {!isMobile.value && <button onClick={() => mapCtl.world()} aria-label="Whole world" title="Whole world (W)">🌐</button>}
      </div>
      {mode.value !== 'attract' && !isMobile.value && (
        <div class="grp">
          <button class={s.coverage ? 'on' : ''} onClick={() => updateSettings({ coverage: !s.coverage })} aria-pressed={s.coverage} title="Sensor coverage layer" aria-label="Toggle sensor coverage">◎</button>
          <button class={s.threats ? 'on' : ''} onClick={() => updateSettings({ threats: !s.threats })} aria-pressed={s.threats} title="Enemy air-defense rings" aria-label="Toggle threat rings">⚠</button>
          <button class={s.tracks ? 'on' : ''} onClick={() => updateSettings({ tracks: !s.tracks })} aria-pressed={s.tracks} title="Satellite ground tracks" aria-label="Toggle satellite tracks">✦</button>
        </div>
      )}
    </div>
  );
}

export function ModeHint() {
  if (mode.value === 'attract') return null;
  const sel = selectedUnits();
  if (!sel.length) return null;
  const air = sel.every((u) => u.domain === 'air' || u.domain === 'drone');
  const m = clickMode.value;
  const name = sel.length === 1 ? sel[0].name : `${sel.length} units`;
  const verb = m === 'attack' ? 'click an enemy to attack' : air || m === 'patrol' ? 'click map to patrol · enemy to attack' : 'click map to move · enemy to attack';
  return (
    <div class="mode-hint" role="status">
      <b>{name}</b>
      <span class="muted">{verb}</span>
      <button class="btn sm ghost" onClick={clearSelection} aria-label="Clear selection (Esc)">✕</button>
    </div>
  );
}

const SHORT: Record<UnitType, string> = {
  fighter: 'Fighter', bomber: 'Bomber', awacs: 'AWACS', carrier: 'Carrier', destroyer: 'Destroyer', submarine: 'Submarine',
  armor: 'Armor', sam: 'SAM', missile: 'Missiles', asat: 'ASAT site', recon_drone: 'Recon drone', strike_drone: 'Strike drone',
  recon_sat: 'Recon sat', comms_sat: 'Comms sat',
};

const UNIT_ROWS: UnitType[] = ['fighter', 'bomber', 'awacs', 'carrier', 'destroyer', 'submarine', 'armor', 'sam', 'missile', 'asat', 'recon_drone', 'strike_drone', 'recon_sat', 'comms_sat'];

export function Legend() {
  const open = settings.value.legendOpen;
  if (mode.value === 'attract' && !open) return null;
  if (!open) {
    return (
      <button class="legend-chip" onClick={() => updateSettings({ legendOpen: true })} aria-label="Show map legend (L)" data-tour="legend">
        <span class="light ok" style={{ background: COLORS.blue }} /><span class="light" style={{ background: COLORS.red }} /> Legend
      </button>
    );
  }
  return (
    <aside class="legend scroll" aria-label="Map legend" data-tour="legend">
      <header>
        <h3>Legend</h3>
        <button class="icon-btn" style={{ width: 26, height: 26 }} onClick={() => updateSettings({ legendOpen: false })} aria-label="Hide legend (L)" title="Hide (L)">–</button>
      </header>
      <section>
        <h4>Affiliation</h4>
        <div class="grid">
          <span class="row"><span class="sw" style={{ border: `2px solid ${COLORS.blue}` }} />Friendly (AEGIS)</span>
          <span class="row"><span class="sw dia" style={{ border: `2px solid ${COLORS.red}` }} />Hostile (HYDRA)</span>
          <span class="row"><span class="sw dia" style={{ border: `2px solid ${COLORS.unknown}` }} />Unidentified</span>
          <span class="row"><span class="sw dia" style={{ border: `2px dashed ${COLORS.ghost}` }} />Last known pos.</span>
        </div>
      </section>
      <section>
        <h4>Units</h4>
        <div class="grid g3">
          {UNIT_ROWS.map((t) => (
            <span class="row" key={t}><Icon d={GLYPHS[t]} size={15} color={COLORS.inkDim} /><Abbr term={SHORT[t].split(' ')[0]}>{SHORT[t]}</Abbr></span>
          ))}
        </div>
      </section>
      <section>
        <h4>Map</h4>
        <div class="grid">
          <span class="row"><Icon d={GLYPHS.node} size={15} color={COLORS.neutral} />Objective</span>
          <span class="row"><Icon d={GLYPHS.hq} size={15} color={COLORS.inkDim} /><Abbr term="HQ" /></span>
          <span class="row"><Icon d={GLYPHS.airbase} size={15} color={COLORS.inkDim} />Airbase</span>
          <span class="row"><Icon d={GLYPHS.port} size={15} color={COLORS.inkDim} />Naval port</span>
          <span class="row"><span class="sw" style={{ background: 'rgba(77,163,255,.25)' }} />Our sensor cover</span>
          <span class="row"><span class="sw" style={{ border: '1px dashed rgba(255,77,94,.8)' }} />Enemy air defense</span>
          <span class="row"><span style={{ width: 14, borderTop: '2px dotted rgba(77,163,255,.7)' }} />Satellite track</span>
          <span class="row"><span class="sw" style={{ border: '2px solid #ffc53d' }} />Contested</span>
          <span class="row"><span class="pill" style={{ fontSize: 9, padding: '0 4px', color: COLORS.ink }}>3</span>Group / parked</span>
          <span class="row"><span style={{ width: 14, height: 3, background: COLORS.ok }} />Health bar</span>
        </div>
      </section>
      <section>
        <h4>Brief severity</h4>
        <div class="grid g3" style={{ gridTemplateColumns: 'repeat(4, auto)' }}>
          <span class="row" style={{ color: COLORS.critical }}><Abbr term="FLASH">▲ FLASH</Abbr></span>
          <span class="row" style={{ color: COLORS.high }}><Abbr term="PRIORITY">● PRIORITY</Abbr></span>
          <span class="row" style={{ color: COLORS.medium }}><Abbr term="CAUTION">◆ CAUTION</Abbr></span>
          <span class="row" style={{ color: COLORS.low }}><Abbr term="ROUTINE">○ ROUTINE</Abbr></span>
        </div>
      </section>
    </aside>
  );
}

export function AttractBadge() {
  if (mode.value !== 'attract' || !view.value) return null;
  return <div class="attract-badge"><span class="light ok" /> LIVE · AI vs AI simulation</div>;
}

export { selection };
