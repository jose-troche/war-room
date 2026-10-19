import type { Command, Side, View } from './types';

export type ClientMsg =
  | { t: 'hello' }
  | { t: 'start' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'leave' }
  | { t: 'ping' };

export interface LobbyInfo { side: Side; players: number; status: string; started: boolean }

export type ServerMsg =
  | ({ t: 'lobby' } & LobbyInfo)
  | { t: 'view'; v: View; interval: number }
  | { t: 'result'; ok: boolean; error?: string }
  | { t: 'error'; msg: string }
  | { t: 'pong' };

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const isRoomCode = (s: string) => /^[A-Z0-9]{4,6}$/.test(s);
