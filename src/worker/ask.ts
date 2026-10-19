import type { Env } from './index';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

const SYSTEM = `You are ATLAS, Chief of Staff in a fictional real-time strategy game called WAR ROOM.
Answer the commander's question in at most 60 words: bottom line first, concise, plain language.
Use ONLY the situation summary provided. If the answer is not in it, say what to check instead.
Never invent units, numbers or places. This is a game; keep it about game strategy.`;

export async function handleAsk(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return Response.json({ error: 'AI not configured' }, { status: 501 });
  let body: { question?: unknown; summary?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : '';
  const summary = typeof body.summary === 'string' ? body.summary.slice(0, 2000) : '';
  if (!question) return Response.json({ error: 'Missing question' }, { status: 400 });
  try {
    const out = (await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `SITUATION:\n${summary}\n\nQUESTION: ${question}` },
      ],
      max_tokens: 160,
      temperature: 0.3,
    })) as { response?: string };
    const answer = (out.response ?? '').trim();
    return Response.json({ answer }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: 'AI unavailable', detail: String(err).slice(0, 200) }, { status: 503 });
  }
}
