import { AiCommander, DIFFICULTY, type Difficulty } from '../../shared/ai';
import { RULES } from '../../shared/catalog';
import { Engine } from '../../shared/engine';
import type { Command, Side, View } from '../../shared/types';
import type { CommandOutcome, GameSession } from './session';

/**
 * Runs the simulation in the browser. Used for solo play (human vs AI) and for the
 * AI-vs-AI "attract mode" behind the landing page.
 */
export class LocalSession implements GameSession {
  readonly canPause = true;
  engine: Engine;
  private ais: AiCommander[] = [];
  private raf = 0;
  private last = 0;
  private paused = false;
  private speed = 1;
  private disposed = false;
  private endedPublished = false;
  onView?: (v: View, intervalMs: number) => void;

  constructor(
    readonly kind: 'attract' | 'solo',
    readonly side: Side,
    opts: { seed?: number; difficulty?: Difficulty; onView: (v: View, intervalMs: number) => void },
  ) {
    const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.engine = Engine.create(seed);
    this.onView = opts.onView;
    const diff = opts.difficulty ?? 'veteran';
    if (kind === 'attract') {
      this.ais = [new AiCommander('blue', 'veteran', seed), new AiCommander('red', 'veteran', seed + 7)];
      this.speed = 2;
    } else {
      const enemy: Side = side === 'blue' ? 'red' : 'blue';
      this.ais = [new AiCommander(enemy, diff, seed + 3)];
      this.engine.s.cpMult = { blue: 1, red: 1, [enemy]: DIFFICULTY[diff].cpMult } as Record<Side, number>;
    }
    this.publish();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop(now: number) {
    if (this.disposed) return;
    const realDt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.engine.s.ended && !this.endedPublished) {
      this.endedPublished = true;
      this.publish();
    }
    if (!this.paused && !this.engine.s.ended) {
      const before = this.engine.s.tick;
      this.engine.step(realDt * this.speed);
      if (this.engine.s.tick !== before) {
        for (const ai of this.ais) {
          const v = this.engine.viewFor(ai.side);
          ai.update(v, (c) => this.engine.command(ai.side, c));
        }
        this.publish();
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  private publish() {
    const v = this.kind === 'attract' ? this.godView() : this.engine.viewFor(this.side);
    this.onView?.(v, (RULES.dt * 1000) / this.speed);
  }

  /** Attract mode shows both sides' forces. */
  private godView(): View {
    const b = this.engine.viewFor('blue');
    const r = this.engine.viewFor('red');
    const ids = new Set(b.units.map((u) => u.id));
    for (const u of r.units) if (u.side === 'red' && !ids.has(u.id)) b.units.push(u);
    for (const u of b.units) u.identified = true;
    b.ghosts = [];
    b.shots = [...b.shots, ...r.shots.filter((s) => s.side === 'red' && !b.shots.some((x) => x.id === s.id))];
    return b;
  }

  command(cmd: Command): CommandOutcome {
    return this.engine.command(this.side, cmd);
  }
  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.publish();
  }
  setSpeed(x: number) {
    this.speed = x;
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
  }
}
