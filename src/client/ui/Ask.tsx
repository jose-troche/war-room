import { useEffect, useRef, useState } from 'preact/hooks';
import { agents } from '../agents/runner';
import { mapCtl } from '../map/controller';
import { ask, EXAMPLES, summarize, type AskAnswer } from '../nlq/execute';
import { highlights, mode, settings, view } from '../store';
import { canListen, listen, speak, stopListening } from '../voice';
import { setSpeed, togglePause } from './TopBar';
import { paused, speed } from '../store';
import { runAction } from './common';

interface Exchange { q: string; a: AskAnswer; pending?: boolean }

let lastLlm = 0;

async function llmFallback(q: string): Promise<string | null> {
  const v = view.value;
  if (!v || performance.now() - lastLlm < 8000) return null;
  lastLlm = performance.now();
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q.slice(0, 300), summary: summarize(v) }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { answer?: string };
    return j.answer?.trim() || null;
  } catch {
    return null;
  }
}

/** Shared handler so voice, the input box and keyboard shortcuts behave the same. */
export async function handleQuery(q: string, set: (e: Exchange) => void) {
  const v = view.value;
  if (!v || !q.trim()) return;
  let a = ask(q, v);
  if (a.sitrep) {
    const rep = agents.requestSitrep(v);
    a = { text: rep ? rep.lines[0] : 'SITREP unavailable.', lines: rep?.lines.slice(1) };
  }
  if (a.game) {
    if (mode.value !== 'solo') a = { text: 'Game speed is fixed in multiplayer.' };
    else if (a.game === 'pause' && !paused.value) togglePause();
    else if (a.game === 'resume' && paused.value) togglePause();
    else if (a.game === 'faster') setSpeed(Math.min(2, speed.value * 2));
    else if (a.game === 'slower') setSpeed(Math.max(0.5, speed.value / 2));
  }
  if (a.fallback) {
    set({ q, a: { text: 'Thinking…' }, pending: true });
    const ans = await llmFallback(q);
    a = ans ? { text: ans } : { text: "I didn't catch that. Try one of these:", lines: EXAMPLES.slice(0, 5).map((e) => `“${e}”`) };
  }
  if (a.highlight?.length) highlights.value = { ids: a.highlight, until: performance.now() + 6000 };
  if (a.zoom === 1) mapCtl.world();
  else if (a.zoom && a.zoom < 0) mapCtl.zoom(-a.zoom);
  else if (a.focus) {
    if (a.focus.length === 0) mapCtl.fitAll();
    else mapCtl.fitPoints(a.focus, a.zoom ?? 6);
  }
  if (settings.value.voice) speak(a.text);
  set({ q, a });
}

export function AskPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [ex, setEx] = useState<Exchange | null>(null);
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === '/') {
        e.preventDefault();
        input.current?.focus();
      } else if ((e.key === 'm' || e.key === 'M') && canListen && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        mic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (q: string) => {
    setText('');
    handleQuery(q, setEx);
  };

  const mic = async () => {
    if (listening) {
      stopListening();
      return;
    }
    setListening(true);
    try {
      const t = await listen((partial) => setText(partial));
      if (t.trim()) submit(t);
    } catch (err) {
      setEx({ q: '🎤', a: { text: (err as Error).message } });
    } finally {
      setListening(false);
    }
  };

  return (
    <div class="ask" data-tour="ask">
      {ex && (
        <div class="ask-answer" role="status">
          <div class="q">You: {ex.q}</div>
          <div class="a"><b>ATLAS:</b> {ex.a.text}</div>
          {!!ex.a.lines?.length && <ul>{ex.a.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          {!!ex.a.actions?.length && (
            <div class="acts">
              {ex.a.actions.map((a) => (
                <button key={a.label} class={`btn sm ${a.label === 'Confirm' || a.label.startsWith('Confirm') ? 'primary' : 'act'}`} onClick={() => {
                  if (runAction(a) && (a.cmd || a.cmds)) setEx({ ...ex, a: { ...ex.a, actions: [] , text: `${ex.a.text} ✓ Ordered.` } });
                }}>{a.label}</button>
              ))}
              {ex.a.actions.some((a) => a.label === 'Confirm') && <button class="btn sm ghost" onClick={() => setEx(null)}>Cancel</button>}
            </div>
          )}
        </div>
      )}
      {!ex && (
        <div class="chips" aria-label="Example questions">
          {EXAMPLES.slice(0, 4).map((e) => (
            <button class="chip" key={e} onClick={() => submit(e)}>{e}</button>
          ))}
        </div>
      )}
      <form class="ask-row" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <input
          ref={input}
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          placeholder={listening ? 'Listening…' : 'Ask ATLAS — e.g. “what threatens Panama?”'}
          aria-label="Ask ATLAS a question or give an order"
          enterKeyHint="send"
          onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
        />
        {canListen && (
          <button type="button" class={`mic ${listening ? 'on' : ''}`} onClick={mic} aria-label={listening ? 'Stop listening' : 'Speak to ATLAS (M)'} title="Speak to ATLAS (M)">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" /></svg>
          </button>
        )}
        <button type="submit" class="btn primary" aria-label="Send">Ask</button>
      </form>
    </div>
  );
}
