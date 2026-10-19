import { DurableObject } from 'cloudflare:workers';
import { RULES } from '../shared/catalog';
import { Engine } from '../shared/engine';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { GameState, Side } from '../shared/types';
import { SIDES } from '../shared/types';
import type { Env } from './index';

const TICK_MS = RULES.dt * 1000;
const PERSIST_EVERY_TICKS = 20; // 5s
const FORFEIT_MS = 60_000;

interface Meta { started: boolean; ended: boolean; createdAt: number; gone: Partial<Record<Side, number>> }

/**
 * One Durable Object per multiplayer room. Runs the authoritative engine at 4 Hz while a
 * match is live and sends each player only their own fog-of-war view.
 * Uses the WebSocket Hibernation API so idle lobbies cost nothing.
 */
export class GameRoom extends DurableObject<Env> {
  private engine: Engine | null = null;
  private meta: Meta = { started: false, ended: false, createdAt: Date.now(), gone: {} };
  private loop: ReturnType<typeof setInterval> | null = null;
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (meta) this.meta = meta;
    if (this.meta.started) {
      const st = await this.ctx.storage.get<GameState>('state');
      if (st) this.engine = new Engine(st);
      if (!this.meta.ended) this.startLoop();
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    await this.load();
    const taken = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as { side: Side } | null)?.side));
    // reconnecting players reclaim the side that is free
    const side = SIDES.find((s) => !taken.has(s));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!side) {
      this.ctx.acceptWebSocket(server, ['spectator']);
      server.send(JSON.stringify({ t: 'error', msg: 'Room is full.' } satisfies ServerMsg));
      server.close(1008, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server, [side]);
    server.serializeAttachment({ side });
    delete this.meta.gone[side];
    await this.ctx.storage.put('meta', this.meta);
    this.broadcastLobby();
    if (this.engine) this.sendView(server, side);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.load();
    const side = (ws.deserializeAttachment() as { side: Side } | null)?.side;
    if (!side) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong' } satisfies ServerMsg));
    } else if (m.t === 'hello') {
      this.broadcastLobby();
    } else if (m.t === 'start') {
      if (side !== 'blue' || this.meta.started) return;
      if (this.sockets().length < 2) {
        ws.send(JSON.stringify({ t: 'result', ok: false, error: 'Waiting for an opponent' } satisfies ServerMsg));
        return;
      }
      this.engine = Engine.create(Math.floor(Math.random() * 1e9));
      this.meta.started = true;
      await this.persist();
      this.broadcastLobby();
      this.startLoop();
    } else if (m.t === 'cmd' && this.engine && !this.meta.ended) {
      const r = this.engine.command(side, m.cmd);
      if (!r.ok || r.error) ws.send(JSON.stringify({ t: 'result', ok: r.ok, error: r.error } satisfies ServerMsg));
    } else if (m.t === 'leave') {
      if (this.engine && this.meta.started && !this.meta.ended) {
        this.engine.forfeit(side);
        this.finish();
      }
      ws.close(1000, 'left');
    }
  }

  async webSocketClose(ws: WebSocket) {
    const side = (ws.deserializeAttachment() as { side: Side } | null)?.side;
    if (side && this.meta.started && !this.meta.ended) this.meta.gone[side] = Date.now();
    await this.ctx.storage.put('meta', this.meta);
    this.broadcastLobby();
    if (!this.sockets().length && this.loop && this.meta.ended) this.stopLoop();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private sockets(): { ws: WebSocket; side: Side }[] {
    const out: { ws: WebSocket; side: Side }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const side = (ws.deserializeAttachment() as { side: Side } | null)?.side;
      if (side && ws.readyState === WebSocket.OPEN) out.push({ ws, side });
    }
    return out;
  }

  private broadcastLobby() {
    const socks = this.sockets();
    const players = new Set(socks.map((s) => s.side)).size;
    for (const { ws, side } of socks) {
      const status = this.meta.ended ? 'Match over' : this.meta.started ? 'Match in progress' : players < 2 ? 'Waiting for opponent' : side === 'blue' ? 'Opponent connected — start when ready' : 'Waiting for host to start';
      ws.send(JSON.stringify({ t: 'lobby', side, players, status, started: this.meta.started } satisfies ServerMsg));
    }
  }

  private sendView(ws: WebSocket, side: Side) {
    if (!this.engine) return;
    try {
      ws.send(JSON.stringify({ t: 'view', v: this.engine.viewFor(side), interval: TICK_MS } satisfies ServerMsg));
    } catch {
      /* socket closing */
    }
  }

  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private tick() {
    const e = this.engine;
    if (!e) return this.stopLoop();
    e.tick();
    const socks = this.sockets();
    const present = new Set(socks.map((s) => s.side));
    for (const side of SIDES) {
      if (present.has(side)) continue;
      const since = this.meta.gone[side] ?? (this.meta.gone[side] = Date.now());
      if (Date.now() - since > FORFEIT_MS) e.forfeit(side);
    }
    for (const side of SIDES) {
      const mine = socks.filter((s) => s.side === side);
      if (!mine.length) {
        e.drainEvents(side);
        continue;
      }
      const msg = JSON.stringify({ t: 'view', v: e.viewFor(side), interval: TICK_MS } satisfies ServerMsg);
      for (const s of mine) {
        try {
          s.ws.send(msg);
        } catch {
          /* closing */
        }
      }
    }
    if (e.s.ended) this.finish();
    else if (e.s.tick % PERSIST_EVERY_TICKS === 0) void this.persist();
  }

  private finish() {
    this.meta.ended = true;
    this.stopLoop();
    void this.persist();
    this.broadcastLobby();
  }

  private async persist() {
    await this.ctx.storage.put({ meta: this.meta, ...(this.engine ? { state: this.engine.s } : {}) });
  }
}
