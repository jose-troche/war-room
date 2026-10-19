import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/shared/engine';
import { AiCommander } from '../../src/shared/ai';
import { Atlas } from '../../src/client/agents/atlas';
import { StaffRoom } from '../../src/client/agents/staff';
import type { Report } from '../../src/client/agents/types';
import type { View } from '../../src/shared/types';

const rep = (subject: string, severity: Report['severity'], t = 1): Report => ({ id: Math.random(), t, agent: 'vigil', severity, subject, text: subject });

describe('ATLAS', () => {
  it('surfaces FLASH immediately and merges duplicates', () => {
    const e = Engine.create(3);
    const v = e.viewFor('blue') as View;
    const a = new Atlas();
    const fresh = a.ingest([rep('hq', 'critical'), rep('hq', 'critical')], v, 1000);
    expect(fresh.length).toBe(1);
    const items = a.items(v);
    expect(items[0].count).toBe(2);
  });

  it('throttles non-critical items and keeps info out of the brief', () => {
    const e = Engine.create(3);
    const v = e.viewFor('blue') as View;
    const a = new Atlas();
    a.ingest([rep('a', 'high'), rep('b', 'high'), rep('c', 'medium'), rep('x', 'info')], v, 10_000);
    expect(a.items(v).length).toBe(1);
    a.ingest([], v, 10_500);
    expect(a.items(v).length).toBe(1); // still throttled
    a.ingest([], v, 14_000);
    expect(a.items(v).length).toBe(2);
    expect(a.items(v).some((i) => i.key === 'x')).toBe(false);
  });

  it('filters a real match down to a digestible brief', () => {
    const e = Engine.create(5);
    const red = new AiCommander('red', 'veteran', 5);
    const blue = new AiCommander('blue', 'veteran', 6);
    const staff = new StaffRoom();
    const atlas = new Atlas();
    let prev: View | null = null;
    let now = 0;
    let maxBrief = 0;
    for (let i = 0; i < 4 * 240; i++) {
      e.tick();
      red.update(e.viewFor('red'), (c) => e.command('red', c));
      const v = e.viewFor('blue');
      blue.update(v, (c) => e.command('blue', c));
      now += 250;
      atlas.ingest([...staff.observe(prev, v), ...atlas.advise(v)], v, now);
      maxBrief = Math.max(maxBrief, atlas.items(v).length);
      prev = v;
    }
    expect(atlas.received).toBeGreaterThan(300);
    expect(atlas.surfaced).toBeLessThan(atlas.received / 4);
    expect(maxBrief).toBeLessThanOrEqual(6);
  });
});
