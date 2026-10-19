import { CATALOG } from '../shared/catalog';
import type { Command, Order, UnitView } from '../shared/types';
import { mapCtl } from './map/controller';
import { session } from './session/session';
import { clickMode, isMobile, mode, panel, selection, sheetSize, sheetTab, showToast, view } from './store';

export const decisionLog: { t: number; text: string }[] = [];

export function issue(cmd: Command, describe?: string): boolean {
  const s = session();
  if (!s || mode.value === 'attract') return false;
  const r = s.command(cmd);
  if (!r.ok) {
    showToast(r.error ?? 'Order rejected', 'error');
    return false;
  }
  if (r.error) showToast(r.error, 'warn');
  else if (describe) showToast(describe, 'info');
  decisionLog.push({ t: view.value?.t ?? 0, text: describe ?? cmd.type });
  return true;
}

export function orderUnits(ids: string[], order: Order, describe?: string) {
  return issue({ type: 'order', unitIds: ids, order }, describe);
}

export function selectUnits(ids: string[], additive = false) {
  const cur = additive ? new Set(selection.value) : new Set<string>();
  for (const id of ids) {
    if (additive && cur.has(id) && ids.length === 1) cur.delete(id);
    else cur.add(id);
  }
  selection.value = [...cur];
  clickMode.value = 'smart';
  if (selection.value.length === 1) openUnit(selection.value[0]);
  else if (selection.value.length > 1) panel.value = { kind: 'forces' };
}

export function openUnit(id: string) {
  panel.value = { kind: 'unit', id };
  if (isMobile.value) {
    sheetTab.value = 'forces';
    if (sheetSize.value === 'peek') sheetSize.value = 'half';
  }
}

export function openNode(id: string, fly = true) {
  panel.value = { kind: 'node', id };
  const n = view.value?.nodes.find((x) => x.id === id);
  if (n && fly) mapCtl.flyTo(n.lat, n.lon, 4);
  if (isMobile.value) {
    sheetTab.value = 'objectives';
    if (sheetSize.value === 'peek') sheetSize.value = 'half';
  }
}

export function openBase(id: string) {
  panel.value = { kind: 'base', id };
  if (isMobile.value) {
    sheetTab.value = 'forces';
    if (sheetSize.value === 'peek') sheetSize.value = 'half';
  }
}

export function clearSelection() {
  selection.value = [];
  clickMode.value = 'smart';
}

export function selectedUnits(): UnitView[] {
  const v = view.value;
  if (!v) return [];
  const ids = new Set(selection.value);
  return v.units.filter((u) => ids.has(u.id) && u.side === v.side);
}

const movable = (u: UnitView) => !!u.type && CATALOG[u.type].speed > 0 && u.domain !== 'space';

/** Map click on empty space with a selection → move / patrol. */
export function commandMoveTo(lat: number, lon: number) {
  const units = selectedUnits().filter(movable);
  if (!units.length) return false;
  const kind = clickMode.value === 'patrol' ? 'patrol' : 'move';
  const ok = orderUnits(units.map((u) => u.id), { kind, lat, lon }, `${units.length === 1 ? units[0].name : units.length + ' units'}: ${kind === 'patrol' || units.every((u) => u.domain === 'air' || u.domain === 'drone') ? 'patrol' : 'move'} ordered`);
  if (ok) mapCtl.ping(lat, lon, '#e6edf6');
  clickMode.value = 'smart';
  return ok;
}

/** Click on a hostile unit or base with a selection → attack with whoever can engage it. */
export function commandAttack(targetId: string): boolean {
  const v = view.value;
  if (!v) return false;
  const tu = v.units.find((u) => u.id === targetId);
  const tb = v.bases.find((b) => b.id === targetId);
  const tClass = tu ? tu.domain : tb ? 'base' : null;
  if (!tClass) return false;
  const units = selectedUnits().filter((u) => u.type && CATALOG[u.type].weapon?.targets.includes(tClass as never));
  if (!units.length) {
    showToast('Selected units cannot engage that target', 'warn');
    return false;
  }
  const name = tu ? (tu.identified ? tu.name : 'unknown contact') : tb!.name;
  clickMode.value = 'smart';
  return orderUnits(units.map((u) => u.id), { kind: 'attack', targetId }, `${units.length === 1 ? units[0].name : units.length + ' units'} → attack ${name}`);
}

export function canAttack(targetId: string): boolean {
  const v = view.value;
  if (!v) return false;
  const tu = v.units.find((u) => u.id === targetId);
  const tb = v.bases.find((b) => b.id === targetId);
  const tClass = tu ? tu.domain : tb ? 'base' : null;
  return selectedUnits().some((u) => u.type && CATALOG[u.type].weapon?.targets.includes(tClass as never));
}
