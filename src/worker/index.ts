import { isRoomCode, ROOM_ALPHABET } from '../shared/protocol';
import { handleAsk } from './ask';
import { GameRoom } from './room';

export interface Env {
  ASSETS: Fetcher;
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  AI?: Ai;
}

export { GameRoom };

function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/rooms' && request.method === 'POST') {
      return Response.json({ code: roomCode() }, { headers: { 'cache-control': 'no-store' } });
    }

    const m = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!isRoomCode(code)) return new Response('Bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.GAME_ROOM.getByName(code).fetch(request);
    }

    if (pathname === '/api/ask' && request.method === 'POST') return handleAsk(request, env);
    if (pathname === '/api/health') return Response.json({ ok: true });
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
