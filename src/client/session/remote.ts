import type { ClientMsg, LobbyInfo, ServerMsg } from '../../shared/protocol';
import type { Command, Side, View } from '../../shared/types';
import { showToast } from '../store';
import type { CommandOutcome, GameSession } from './session';

/** Human-vs-human: the authoritative simulation runs in a Durable Object; we receive our side's view. */
export class RemoteSession implements GameSession {
  readonly kind = 'pvp' as const;
  readonly canPause = false;
  side: Side = 'blue';
  private ws: WebSocket | null = null;
  private closed = false;
  private retries = 0;
  private pingTimer = 0;
  onView?: (v: View, intervalMs: number) => void;

  constructor(
    readonly code: string,
    private handlers: { onView: (v: View, interval: number) => void; onLobby: (l: LobbyInfo) => void; onError: (msg: string) => void },
  ) {
    this.onView = handlers.onView;
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.send({ t: 'hello' });
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (m.t === 'view') {
        this.side = m.v.side;
        this.handlers.onView(m.v, m.interval);
      } else if (m.t === 'lobby') {
        this.side = m.side;
        this.handlers.onLobby(m);
      } else if (m.t === 'result' && !m.ok) {
        showToast(m.error ?? 'Order rejected', 'error');
      } else if (m.t === 'error') {
        this.closed = true;
        this.handlers.onError(m.msg);
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      if (this.retries++ < 5) {
        showToast('Connection lost — reconnecting…', 'warn');
        setTimeout(() => this.connect(), 1000 * this.retries);
      } else this.handlers.onError('Disconnected from the room.');
    };
  }

  private send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  command(cmd: Command): CommandOutcome {
    if (this.ws?.readyState !== WebSocket.OPEN) return { ok: false, error: 'Not connected' };
    this.send({ t: 'cmd', cmd });
    return { ok: true };
  }
  start() {
    this.send({ t: 'start' });
  }
  leave() {
    this.send({ t: 'leave' });
  }
  setPaused() {}
  setSpeed() {}
  dispose() {
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
