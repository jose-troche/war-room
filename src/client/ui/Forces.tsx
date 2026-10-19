import { CATALOG } from '../../shared/catalog';
import { NODE_LAND_POINT } from '../../shared/scenario';
import type { Base, ForceGroup, UnitType, UnitView, View } from '../../shared/types';
import { FORCE_GROUPS } from '../../shared/types';
import { clearSelection, openBase, openNode, openUnit, orderUnits, selectedUnits, selectUnits, issue } from '../actions';
import { available, buySuggestion, counterTo, etaTo, reinforceNode } from '../agents/coa';
import { dur, faction, kmBetween, typeLabel, where } from '../agents/text';
import { AGENTS } from '../agents/types';
import { mapCtl } from '../map/controller';
import { COLORS, glyphFor, GLYPHS, sideColor } from '../map/icons';
import { baseline, clickMode, panel, selection, staffStats, trafficOpen, view, type Panel } from '../store';
import { GROUP_META, hpColor, Icon, runAction, stateLabel, statusLight } from './common';
import { Abbr, Gloss } from './Gloss';
import { glossTitle } from '../glossary';

const SEV_LIGHT: Record<string, string> = { critical: 'bad', high: 'warn', medium: 'warn', low: 'ok', info: 'ok' };
export const trafficFilter = { agent: null as string | null };

function crumbsFor(p: Panel, v: View): { label: string; to?: Panel }[] {
  const root = { label: 'Forces', to: { kind: 'forces' } as Panel };
  if (p.kind === 'domain') return [root, { label: GROUP_META[p.group as ForceGroup].label }];
  if (p.kind === 'unit') {
    const u = v.units.find((x) => x.id === p.id);
    if (!u) return [root];
    if (u.side !== v.side) return [root, { label: 'Contact' }];
    const g = CATALOG[u.type!].group;
    return [root, { label: GROUP_META[g].label, to: { kind: 'domain', group: g } }, { label: u.name }];
  }
  if (p.kind === 'node') return [{ label: 'Objectives', to: { kind: 'forces' } }, { label: v.nodes.find((n) => n.id === p.id)?.short ?? '' }];
  if (p.kind === 'base') return [root, { label: v.bases.find((b) => b.id === p.id)?.name ?? 'Base' }];
  if (p.kind === 'requisition') return [root, { label: 'Requisition' }];
  return [root];
}

export function ForcePanel({ hideHead = false }: { hideHead?: boolean }) {
  const v = view.value;
  const p = panel.value;
  if (!v) return null;
  const crumbs = crumbsFor(p, v);
  return (
    <>
      {!hideHead && (
        <div class="col-head" data-tour="forces">
          {crumbs.length === 1 ? <h2>Force Status</h2> : (
            <nav class="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 && <span>›</span>}
                  {c.to && i < crumbs.length - 1 ? <button onClick={() => (panel.value = c.to!)}>{c.label}</button> : <b>{c.label}</b>}
                </span>
              ))}
            </nav>
          )}
          {crumbs.length > 1 && <button class="icon-btn" style={{ marginLeft: 'auto' }} aria-label="Close" onClick={() => (panel.value = { kind: 'forces' })}>✕</button>}
        </div>
      )}
      {hideHead && crumbs.length > 1 && (
        <nav class="crumbs" style={{ padding: '8px 12px 0' }} aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span>›</span>}
              {c.to && i < crumbs.length - 1 ? <button onClick={() => (panel.value = c.to!)}>{c.label}</button> : <b>{c.label}</b>}
            </span>
          ))}
        </nav>
      )}
      <div class="scroll" style={{ flex: 1, minHeight: 0 }}>
        {p.kind === 'forces' && <Overview v={v} />}
        {p.kind === 'domain' && <DomainList v={v} group={p.group as ForceGroup} />}
        {p.kind === 'unit' && <UnitDetail v={v} id={p.id} />}
        {p.kind === 'node' && <NodeDetail v={v} id={p.id} />}
        {p.kind === 'base' && <BaseDetail v={v} id={p.id} />}
        {p.kind === 'requisition' && <Requisition v={v} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ overview */

function Overview({ v }: { v: View }) {
  const mine = v.units.filter((u) => u.side === v.side);
  const sel = selectedUnits();
  return (
    <>
      {sel.length > 1 && (
        <div class="detail" style={{ paddingBottom: 0 }}>
          <div class="blurb">
            <b>{sel.length} units selected.</b> Click the map to move/patrol, click an enemy to attack.
            <div class="actions" style={{ marginTop: 8 }}>
              <button class="btn sm" onClick={() => orderUnits(sel.map((u) => u.id), { kind: 'hold' }, 'Hold')}>Hold</button>
              <button class="btn sm" onClick={() => orderUnits(sel.map((u) => u.id), { kind: 'rtb' }, 'Return to base')}>Return to base</button>
              <button class="btn sm" onClick={() => mapCtl.fitUnits(sel.map((u) => u.id))}>Center</button>
              <button class="btn sm ghost" onClick={clearSelection}>Clear</button>
            </div>
          </div>
        </div>
      )}
      <div class="forces">
        {FORCE_GROUPS.map((g) => {
          const us = mine.filter((u) => u.type && CATALOG[u.type].group === g);
          const hp = us.reduce((a, u) => a + u.hp, 0);
          const base = baseline.value[g] || us.reduce((a, u) => a + u.maxHp, 0) || 1;
          const strength = Math.min(1, hp / base);
          const engaged = us.filter((u) => u.state === 'engaged' || u.order.kind === 'attack').length;
          const moving = us.filter((u) => u.state === 'moving' || u.state === 'patrol' || u.state === 'embarked').length;
          const resting = us.filter((u) => u.state === 'rtb' || u.state === 'rearming' || u.state === 'building').length;
          const light = us.some((u) => statusLight(u) === 'bad') || strength < 0.4 ? 'bad' : engaged ? 'warn' : 'ok';
          return (
            <button key={g} class="dcard" onClick={() => (panel.value = { kind: 'domain', group: g })} onDblClick={() => mapCtl.fitUnits(us.map((u) => u.id))}
              aria-label={`${GROUP_META[g].label}: ${us.length} units, ${Math.round(strength * 100)}% strength`}>
              <span class="ic"><Icon d={GROUP_META[g].glyph} size={26} color={COLORS.blue} /></span>
              <span class="nm"><span class={`light ${light}`} />{GROUP_META[g].label}</span>
              <span class="cnt">{us.length} · {Math.round(strength * 100)}%</span>
              <span class="bar"><i style={{ width: `${strength * 100}%`, background: hpColor(strength) }} /></span>
              <span class="sub">
                {us.length - moving - engaged - resting > 0 && <span>{us.length - moving - engaged - resting} ready</span>}
                {moving > 0 && <span>{moving} en route</span>}
                {engaged > 0 && <span style={{ color: 'var(--sev-high)' }}>{engaged} engaged</span>}
                {resting > 0 && <span>{resting} rearming</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div class="cp-row" data-tour="cp">
        <div>
          <div class="sec-title">Command Points</div>
          <div class="mono" style={{ fontSize: 18 }}>{Math.floor(v.cp)} <span class="muted" style={{ fontSize: 12 }}>+{v.cpRate}/s</span></div>
        </div>
        <button class="btn sm act" onClick={() => (panel.value = { kind: 'requisition' })}>Requisition ›</button>
      </div>
      <div class="staff" data-tour="staff">
        <div class="sec-title" style={{ padding: '10px 6px 4px' }}>Staff agents</div>
        {AGENTS.map((a) => {
          const s = staffStats.value[a.id];
          const recent = s && v.t - s.at < 20;
          return (
            <button class="staff-row" key={a.id} onClick={() => { trafficFilter.agent = a.id; trafficOpen.value = true; }} title={`${a.role}: ${a.watches}. Click for raw traffic.`}>
              <span class={`light ${recent ? SEV_LIGHT[s.worst] : 'idle'}`} />
              <span class="cs">{a.callsign}</span>
              <span class="role"><Gloss text={a.role} /></span>
              <span class="n">{s?.n ?? 0}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ lists */

function UnitRow({ u }: { u: UnitView }) {
  const f = u.hp / u.maxHp;
  const sel = selection.value.includes(u.id);
  return (
    <button class={`urow ${sel ? 'sel' : ''}`} onClick={(e) => { selectUnits([u.id], e.shiftKey); const p = u; mapCtl.flyTo(p.lat, p.lon); }}>
      <Icon d={glyphFor(u.type, u.domain)} size={20} color={sideColor(u.side)} />
      <span style={{ minWidth: 0 }}>
        <div class="nm"><Gloss text={u.name} /></div>
        <div class="st"><span class={`light ${statusLight(u)}`} /> <Gloss text={stateLabel(u)} /></div>
      </span>
      <span class="hp" title={`${Math.round(f * 100)}%`}><i style={{ width: `${f * 100}%`, background: hpColor(f) }} /></span>
    </button>
  );
}

function DomainList({ v, group }: { v: View; group: ForceGroup }) {
  const us = v.units.filter((u) => u.side === v.side && u.type && CATALOG[u.type].group === group);
  const order: UnitType[] = Object.keys(CATALOG) as UnitType[];
  us.sort((a, b) => order.indexOf(a.type!) - order.indexOf(b.type!) || a.name.localeCompare(b.name));
  const enemies = v.units.filter((u) => u.side !== v.side && (u.type ? CATALOG[u.type].group === group : group === (u.domain === 'sub' ? 'sea' : u.domain)));
  return (
    <div class="ulist">
      <div style={{ display: 'flex', gap: 6, padding: '2px 4px 6px' }}>
        <button class="btn sm" onClick={() => selectUnits(us.filter((u) => u.state !== 'building').map((u) => u.id))}>Select all</button>
        <button class="btn sm" onClick={() => mapCtl.fitUnits(us.map((u) => u.id))}>Show on map</button>
      </div>
      {us.length ? us.map((u) => <UnitRow key={u.id} u={u} />) : <div class="empty">No {GROUP_META[group].label.toLowerCase()} units.</div>}
      {enemies.length > 0 && (
        <>
          <div class="sec-title" style={{ padding: '10px 6px 4px' }}>Detected hostile ({enemies.length})</div>
          {enemies.map((u) => (
            <button key={u.id} class="urow" onClick={() => { openUnit(u.id); mapCtl.flyTo(u.lat, u.lon); }}>
              <Icon d={glyphFor(u.type, u.domain)} size={20} color={u.identified ? COLORS.red : COLORS.unknown} />
              <span style={{ minWidth: 0 }}>
                <div class="nm">{u.identified ? u.name : 'Unidentified contact'}</div>
                <div class="st">{where(v, u.lat, u.lon)}</div>
              </span>
              <span />
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ unit detail */

function UnitDetail({ v, id }: { v: View; id: string }) {
  const u = v.units.find((x) => x.id === id);
  if (!u) return <div class="detail"><div class="empty">Unit no longer tracked (destroyed or lost contact).</div></div>;
  const own = u.side === v.side;
  if (!own) return <EnemyDetail v={v} u={u} />;
  const spec = CATALOG[u.type!];
  const air = u.domain === 'air' || u.domain === 'drone';
  const f = u.hp / u.maxHp;
  const fuel = spec.endurance && u.fuel >= 0 ? u.fuel / spec.endurance : null;
  const home = v.bases.find((b) => b.id === u.homeId) ?? v.units.find((x) => x.id === u.homeId);
  const target = u.order.kind === 'attack' ? v.units.find((x) => x.id === (u.order as { targetId: string }).targetId) ?? v.bases.find((b) => b.id === (u.order as { targetId: string }).targetId) : undefined;
  const dest = u.path.length ? u.path[u.path.length - 1] : null;
  const eta = dest ? kmBetween(u.lat, u.lon, dest[0], dest[1]) * (air ? 1 : 1.15) / (spec.speed * (u.state === 'embarked' ? 0.75 : 1)) : null;
  // suggested targets in reach
  const targets = spec.weapon
    ? v.units
        .filter((e) => e.side !== v.side && spec.weapon!.targets.includes(e.domain) && (u.type !== 'asat' || e.domain === 'space'))
        .map((e) => ({ e, eta: u.type === 'asat' || spec.speed <= 6 ? (kmBetween(u.lat, u.lon, e.lat, e.lon) <= spec.weapon!.rangeKm ? 0 : Infinity) : etaTo(v, u, e.lat, e.lon, spec.weapon!.rangeKm * 0.8) }))
        .filter((x) => isFinite(x.eta) && x.eta < 200)
        .sort((a, b) => a.eta - b.eta)
        .slice(0, 3)
    : [];
  const canMove = spec.speed > 0 && u.domain !== 'space' && u.type !== 'asat';
  const pickMode = (m: 'smart' | 'attack' | 'patrol') => {
    selectUnits([u.id]);
    clickMode.value = m;
  };
  return (
    <div class="detail">
      <div class="hero">
        <div class="ic"><Icon d={glyphFor(u.type, u.domain)} size={30} color={COLORS.blue} /></div>
        <div>
          <h3><Gloss text={u.name} /></h3>
          <div class="t"><Gloss text={spec.label} /> · <span class={`light ${statusLight(u)}`} /> <Gloss text={stateLabel(u)} /></div>
        </div>
      </div>
      <div>
        <div class="kv"><dt>Integrity</dt><dd>{Math.round(f * 100)}%</dd></div>
        <div class="meter"><i style={{ width: `${f * 100}%`, background: hpColor(f) }} /></div>
      </div>
      {fuel !== null && u.state !== 'ready' && u.state !== 'rearming' && (
        <div>
          <div class="kv"><dt>Fuel / endurance</dt><dd>{Math.round(fuel * 100)}% · {dur(u.fuel)}</dd></div>
          <div class="meter"><i style={{ width: `${fuel * 100}%`, background: fuel < 0.25 ? COLORS.high : COLORS.low }} /></div>
        </div>
      )}
      <dl class="kv">
        <dt>Location</dt><dd>{where(v, u.lat, u.lon)}</dd>
        {spec.weapon && <><dt>Weapon range</dt><dd>{spec.weapon.rangeKm.toLocaleString('en-US')} km</dd></>}
        {spec.weapon && <><dt>Engages</dt><dd>{spec.weapon.targets.join(', ')}</dd></>}
        {spec.ammo > 0 && <><dt>Munitions</dt><dd>{u.ammo}/{spec.ammo} salvos</dd></>}
        {spec.weapon && u.cd > 0 && <><dt>Reloading</dt><dd>{Math.ceil(u.cd)}s</dd></>}
        <dt>Sensor</dt><dd>{spec.sensorKm ? `${spec.sensorKm.toLocaleString('en-US')} km` : '—'}</dd>
        {home && <><dt>Home</dt><dd>{home.name}</dd></>}
        {target && <><dt>Target</dt><dd>{'domain' in target ? (target.identified ? target.name : 'contact') : target.name}</dd></>}
        {eta !== null && isFinite(eta) && <><dt><Abbr term="ETA" /></dt><dd>{dur(eta)}</dd></>}
        {u.kills > 0 && <><dt>Kills</dt><dd>{u.kills}</dd></>}
      </dl>
      <div class="blurb"><Gloss text={spec.blurb} /></div>
      {u.state !== 'building' && (
        <div class="actions">
          {canMove && <button class="btn" onClick={() => pickMode(air ? 'patrol' : 'smart')}>{air ? 'Patrol…' : 'Move…'}</button>}
          {spec.weapon && <button class="btn" onClick={() => pickMode('attack')}>Attack…</button>}
          {canMove && !air && <button class="btn" onClick={() => orderUnits([u.id], { kind: 'hold' }, `${u.name}: hold`)}>Hold</button>}
          {(air || canMove) && <button class="btn" onClick={() => orderUnits([u.id], { kind: 'rtb' }, `${u.name}: return to base`)}>{air ? 'Return to base' : 'To port/base'}</button>}
          <button class="btn" onClick={() => mapCtl.flyTo(u.lat, u.lon, 5)}>Center</button>
        </div>
      )}
      {targets.length > 0 && (
        <div>
          <div class="sec-title" style={{ marginBottom: 6 }}>Targets in reach</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {targets.map(({ e, eta: t }) => (
              <button key={e.id} class="btn act sm" title={glossTitle('ETA')} style={{ justifyContent: 'space-between' }} onClick={() => orderUnits([u.id], { kind: 'attack', targetId: e.id }, `${u.name} → attack ${e.identified ? e.name : 'contact'}`)}>
                <span>{u.type === 'asat' ? 'Launch at' : 'Attack'} {e.identified ? e.name : `unidentified ${e.domain}`}</span>
                <span class="muted">{t > 0 ? `ETA ${dur(t)}` : 'in range'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EnemyDetail({ v, u }: { v: View; u: UnitView }) {
  const spec = u.type ? CATALOG[u.type] : null;
  const acts = counterTo(v, u, 3);
  const f = u.hp / u.maxHp;
  return (
    <div class="detail">
      <div class="hero">
        <div class="ic"><Icon d={glyphFor(u.type, u.domain)} size={30} color={u.identified ? COLORS.red : COLORS.unknown} /></div>
        <div>
          <h3>{u.identified ? u.name : 'Unidentified contact'}</h3>
          <div class="t">{faction(u.side)} · {spec ? spec.label : `${u.domain} track`}</div>
        </div>
      </div>
      {u.identified && (
        <div>
          <div class="kv"><dt>Estimated integrity</dt><dd>{Math.round(f * 100)}%</dd></div>
          <div class="meter"><i style={{ width: `${f * 100}%`, background: hpColor(f) }} /></div>
        </div>
      )}
      <dl class="kv">
        <dt>Location</dt><dd>{where(v, u.lat, u.lon)}</dd>
        <dt>Heading</dt><dd>{Math.round(u.heading)}°</dd>
        {spec?.weapon && <><dt>Threat range</dt><dd>{spec.weapon.rangeKm.toLocaleString('en-US')} km</dd></>}
        {spec?.weapon && <><dt>Threatens</dt><dd>{spec.weapon.targets.join(', ')}</dd></>}
      </dl>
      {spec && <div class="blurb">{spec.blurb}</div>}
      {!u.identified && <div class="blurb">Classification needs a closer look: bring a sensor within ~70% of its detection range.</div>}
      <div>
        <div class="sec-title" style={{ marginBottom: 6 }}>Counter options</div>
        {acts.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {acts.map((a) => <button key={a.label} class="btn act sm" title={glossTitle(a.label)} onClick={() => runAction(a)}>{a.label}</button>)}
          </div>
        ) : <div class="muted" style={{ fontSize: 12.5 }}>No available unit can engage it right now.</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ node */

export function NodeDetail({ v, id }: { v: View; id: string }) {
  const n = v.nodes.find((x) => x.id === id);
  if (!n) return null;
  const me = v.side;
  const inZone = (u: UnitView) => u.domain !== 'space' && kmBetween(u.lat, u.lon, n.lat, n.lon) <= n.radiusKm * 1.3;
  const ours = v.units.filter((u) => u.side === me && inZone(u));
  const theirs = v.units.filter((u) => u.side !== me && inZone(u));
  const ctl = n.control; // -100 red .. +100 blue
  const pos = ((ctl + 100) / 200) * 100;
  const acts = [...reinforceNode(v, n, 2), ...(theirs.find((t) => t.identified) ? counterTo(v, theirs.find((t) => t.identified)!, 1) : [])];
  return (
    <div class="detail">
      <div class="hero">
        <div class="ic"><Icon d={GLYPHS.node} size={30} color={n.owner ? sideColor(n.owner) : COLORS.neutral} /></div>
        <div>
          <h3>{n.name}</h3>
          <div class="t">{n.owner ? (n.owner === me ? 'Held by us' : `Held by ${faction(n.owner)}`) : 'Neutral'}{n.contested ? ' · CONTESTED' : ''}</div>
        </div>
      </div>
      <div>
        <div class="kv"><dt>Control</dt><dd>{ctl > 0 ? `AEGIS ${Math.round(ctl)}` : ctl < 0 ? `HYDRA ${Math.round(-ctl)}` : 'even'}</dd></div>
        <div class="ctl-meter" aria-label="Control meter">
          <span class="th" style={{ left: '20%' }} /><span class="th" style={{ left: '50%' }} /><span class="th" style={{ left: '80%' }} />
          <i style={{ left: `${pos}%` }} />
        </div>
        <div class="kv" style={{ fontSize: 11 }}><dt class="red">HYDRA owns ≤ −60</dt><dd class="blue">AEGIS owns ≥ +60</dd></div>
      </div>
      <div class="blurb">{n.blurb} Captured by <b>{n.kind === 'sea' ? 'surface ships' : n.kind === 'land' ? 'ground forces' : 'surface ships or ground forces'}</b> within {n.radiusKm} km.</div>
      <div>
        <div class="sec-title" style={{ marginBottom: 4 }}>In the zone</div>
        <div class="ulist" style={{ padding: 0 }}>
          {ours.map((u) => <UnitRow key={u.id} u={u} />)}
          {theirs.map((u) => (
            <button key={u.id} class="urow" onClick={() => openUnit(u.id)}>
              <Icon d={glyphFor(u.type, u.domain)} size={20} color={u.identified ? COLORS.red : COLORS.unknown} />
              <span><div class="nm">{u.identified ? u.name : 'Unidentified'}</div><div class="st">hostile</div></span><span />
            </button>
          ))}
          {!ours.length && !theirs.length && <div class="muted" style={{ fontSize: 12.5 }}>No forces detected in the zone.</div>}
        </div>
      </div>
      {acts.length > 0 && (
        <div>
          <div class="sec-title" style={{ marginBottom: 6 }}>ATLAS recommends</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {acts.map((a) => <button key={a.label} class="btn act sm" onClick={() => runAction(a)}>{a.label}</button>)}
          </div>
        </div>
      )}
      {selection.value.length > 0 && (
        <button class="btn" onClick={() => {
          const units = selectedUnits().filter((u) => u.type && CATALOG[u.type].speed > 0);
          for (const u of units) {
            const lp = u.domain === 'land' ? NODE_LAND_POINT[n.id] ?? [n.lat, n.lon] : [n.lat, n.lon];
            orderUnits([u.id], { kind: 'move', lat: lp[0], lon: lp[1] }, `${u.name} → ${n.short}`);
          }
        }}>Send selected units here</button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bases & requisition */

function BaseDetail({ v, id }: { v: View; id: string }) {
  const b = v.bases.find((x) => x.id === id);
  if (!b) return null;
  const own = b.side === v.side;
  const f = b.hp / b.maxHp;
  const parked = v.units.filter((u) => u.side === v.side && u.homeId === b.id && (u.state === 'ready' || u.state === 'rearming' || u.state === 'building'));
  const label = b.type === 'hq' ? 'Headquarters' : b.type === 'port' ? 'Naval port' : 'Airbase';
  return (
    <div class="detail">
      <div class="hero">
        <div class="ic"><Icon d={GLYPHS[b.type]} size={30} color={sideColor(b.side)} /></div>
        <div>
          <h3>{b.name}</h3>
          <div class="t">{faction(b.side)} {label}{b.disabled ? ' · DISABLED' : ''}</div>
        </div>
      </div>
      <div>
        <div class="kv"><dt>Integrity</dt><dd>{Math.round(f * 100)}%</dd></div>
        <div class="meter"><i style={{ width: `${f * 100}%`, background: hpColor(f) }} /></div>
      </div>
      {b.type === 'hq' && <div class="blurb">{own ? 'If our HQ is destroyed we lose immediately. Keep fighters and SAMs nearby.' : 'Destroying their HQ wins the match outright — but it is heavily defended.'}</div>}
      {own ? (
        <>
          {parked.length > 0 && (
            <div>
              <div class="sec-title" style={{ marginBottom: 4 }}>At this base</div>
              <div class="ulist" style={{ padding: 0 }}>{parked.map((u) => <UnitRow key={u.id} u={u} />)}</div>
            </div>
          )}
          <RequisitionGrid v={v} base={b} />
        </>
      ) : (
        <div>
          <div class="sec-title" style={{ marginBottom: 6 }}>Strike options</div>
          {counterTo(v, b, 3).map((a) => <button key={a.label} class="btn act sm" style={{ width: '100%', marginBottom: 5 }} onClick={() => runAction(a)}>{a.label}</button>)}
          {!counterTo(v, b, 3).length && <div class="muted" style={{ fontSize: 12.5 }}>No strike asset can reach it right now.</div>}
        </div>
      )}
    </div>
  );
}

function RequisitionGrid({ v, base }: { v: View; base: Base }) {
  const types = (Object.keys(CATALOG) as UnitType[]).filter((t) => CATALOG[t].spawnAt.includes(base.type));
  return (
    <div>
      <div class="sec-title" style={{ marginBottom: 6 }}>Deploy here · {Math.floor(v.cp)} <Abbr term="CP" /></div>
      <div class="req-grid">
        {types.map((t) => {
          const s = CATALOG[t];
          return (
            <button key={t} class="req" disabled={v.cp < s.cost || base.disabled} onClick={() => issue({ type: 'buy', unitType: t, baseId: base.id }, `Requisitioned ${s.label} at ${base.name}`)} title={s.blurb}>
              <Icon d={GLYPHS[t]} size={22} color={COLORS.blue} />
              <span>{s.label}<small>ready in {s.build}s · {s.cost} CP</small></span>
              <span class="c">{s.cost}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Requisition({ v }: { v: View }) {
  const sugg = buySuggestion(v);
  const bases = v.bases.filter((b) => b.side === v.side && !b.disabled);
  return (
    <div class="detail">
      <div class="blurb">Spend Command Points (<Abbr term="CP" />) to deploy reinforcements at a base. Income: +{v.cpRate} <Abbr term="CP" />/s (2 base + 1 per node held).</div>
      {sugg && (
        <div>
          <div class="sec-title" style={{ marginBottom: 6 }}>QUARTERMASTER suggests</div>
          <div class="muted" style={{ fontSize: 12.5, marginBottom: 6 }}><Gloss text={sugg.why} /></div>
          <button class="btn act sm" style={{ width: '100%' }} onClick={() => runAction(sugg.action)}>{sugg.action.label}</button>
        </div>
      )}
      <div class="sec-title">Choose a base</div>
      <div class="ulist" style={{ padding: 0 }}>
        {bases.map((b) => (
          <button key={b.id} class="urow" onClick={() => openBase(b.id)}>
            <Icon d={GLYPHS[b.type]} size={20} color={COLORS.blue} />
            <span><div class="nm">{b.name}</div><div class="st">{b.type === 'hq' ? 'HQ · ground, missiles, satellites' : b.type === 'port' ? 'Port · ships, ground' : 'Airbase · aircraft, drones'}</div></span>
            <span class="muted">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { openNode, typeLabel, available };
