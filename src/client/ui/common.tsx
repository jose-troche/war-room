import { CATALOG } from '../../shared/catalog';
import type { ForceGroup, UnitView } from '../../shared/types';
import { issue, selectUnits } from '../actions';
import { agents } from '../agents/runner';
import type { SuggestedAction } from '../agents/types';
import { mapCtl } from '../map/controller';
import { COLORS, GLYPHS } from '../map/icons';

export function Icon({ d, size = 20, color = 'currentColor', title }: { d: string; size?: number; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d} fill={color} />
    </svg>
  );
}

export const GROUP_META: Record<ForceGroup, { label: string; glyph: string }> = {
  air: { label: 'Air', glyph: GLYPHS.fighter },
  sea: { label: 'Sea', glyph: GLYPHS.destroyer },
  land: { label: 'Land', glyph: GLYPHS.armor },
  drone: { label: 'Drones', glyph: GLYPHS.recon_drone },
  space: { label: 'Space', glyph: GLYPHS.recon_sat },
};

/** Execute a suggested action from ATLAS, a staff report or an Ask answer. */
export function runAction(a: SuggestedAction, briefKey?: string) {
  let ok = true;
  const cmds = a.cmds ?? (a.cmd ? [a.cmd] : []);
  for (const c of cmds) ok = issue(c, a.describe ?? a.label) && ok;
  if (a.select?.length) selectUnits(a.select);
  if (a.focus) mapCtl.flyTo(a.focus.lat, a.focus.lon, a.focus.zoom);
  else if (cmds.length && ok) {
    const ids = cmds.flatMap((c) => (c.type === 'order' ? c.unitIds : []));
    if (ids.length) selectUnits(ids);
  }
  if (briefKey && cmds.length && ok) agents.acted(briefKey);
  return ok;
}

export function hpColor(f: number) {
  return f < 0.35 ? COLORS.critical : f < 0.7 ? COLORS.medium : COLORS.ok;
}

export function stateLabel(u: UnitView): string {
  const air = u.domain === 'air' || u.domain === 'drone';
  if (u.state === 'building') return `deploying · ${Math.ceil(u.buildLeft ?? 0)}s`;
  if (air && u.state === 'ready') return u.mission.kind === 'hold' ? 'ready at base' : 'ready';
  if (u.state === 'rearming') return `rearming · ${Math.ceil(u.buildLeft ?? 0)}s`;
  if (u.state === 'rtb') return 'returning to base';
  if (u.state === 'patrol') return 'on patrol';
  if (u.state === 'engaged') return 'engaging';
  if (u.state === 'embarked') return 'sealift (at sea)';
  if (u.state === 'moving') return u.order.kind === 'attack' ? 'closing on target' : 'en route';
  if (u.domain === 'space') return 'in orbit';
  return u.order.kind === 'attack' ? 'engaging' : 'holding';
}

export function statusLight(u: UnitView): 'ok' | 'warn' | 'bad' | 'idle' {
  const f = u.hp / u.maxHp;
  if (f < 0.35) return 'bad';
  if (u.state === 'engaged' || u.order.kind === 'attack' || f < 0.7) return 'warn';
  if (u.type && CATALOG[u.type].endurance && u.fuel >= 0 && u.state !== 'ready' && u.state !== 'rearming' && u.fuel / CATALOG[u.type].endurance! < 0.25) return 'warn';
  if (u.state === 'rtb' || u.state === 'rearming' || u.state === 'building') return 'idle';
  return 'ok';
}
