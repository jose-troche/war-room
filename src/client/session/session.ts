import type { Command, Side, View } from '../../shared/types';

export interface CommandOutcome { ok: boolean; error?: string }

/** Everything the UI needs from a running match, regardless of where it runs. */
export interface GameSession {
  readonly kind: 'attract' | 'solo' | 'pvp';
  readonly side: Side;
  command(cmd: Command): CommandOutcome;
  setPaused(p: boolean): void;
  setSpeed(x: number): void;
  readonly canPause: boolean;
  dispose(): void;
  onView?: (v: View, intervalMs: number) => void;
}

let current: GameSession | null = null;
export function session(): GameSession | null {
  return current;
}
export function setSession(s: GameSession | null) {
  current?.dispose();
  current = s;
}
