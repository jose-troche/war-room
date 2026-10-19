import { describe, expect, it } from 'vitest';
import { AiCommander, DIFFICULTY, type Difficulty } from '../../src/shared/ai';
import { Engine } from '../../src/shared/engine';
import type { GameEvent } from '../../src/shared/types';

export function runMatch(seed: number, blue: Difficulty, red: Difficulty, maxT = 900) {
  const e = Engine.create(seed);
  e.s.cpMult = { blue: DIFFICULTY[blue].cpMult, red: DIFFICULTY[red].cpMult };
  const ai = { blue: new AiCommander('blue', blue, seed), red: new AiCommander('red', red, seed + 1) };
  const counts: Record<string, number> = {};
  let errors = 0;
  while (!e.s.ended && e.s.t < maxT) {
    e.tick();
    for (const side of ['blue', 'red'] as const) {
      const v = e.viewFor(side);
      for (const ev of v.events as GameEvent[]) counts[ev.kind] = (counts[ev.kind] ?? 0) + 1;
      ai[side].update(v, (c) => {
        const r = e.command(side, c);
        if (!r.ok) errors++;
      });
    }
  }
  return { e, counts, errors };
}

describe('AI commander', () => {
  it('plays a full match to a result', () => {
    const { e, counts } = runMatch(11, 'veteran', 'veteran');
    expect(e.s.ended).toBe(true);
    expect(counts.capture ?? 0).toBeGreaterThan(1);
    expect(counts.destroyed ?? 0).toBeGreaterThan(3);
  }, 60000);
});
