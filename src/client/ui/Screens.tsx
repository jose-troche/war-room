import { useEffect, useState } from 'preact/hooks';
import { DIFFICULTY, type Difficulty } from '../../shared/ai';
import { RULES } from '../../shared/catalog';
import { FACTIONS } from '../../shared/scenario';
import type { Side } from '../../shared/types';
import { decisionLog } from '../actions';
import { clock, faction, mmss } from '../agents/text';
import {
  counters, isMobile, mode, paused, pvp, settings, sheetSize, sheetTab, toast, tourStep, updateSettings, view,
} from '../store';

/* ------------------------------------------------------------------ landing */

export function Landing({ onSolo, onCreateRoom, onJoinRoom }: { onSolo: (d: Difficulty) => void; onCreateRoom: () => void; onJoinRoom: (code: string) => void }) {
  const [diff, setDiff] = useState<Difficulty>(settings.value.difficulty);
  const [pvpOpen, setPvpOpen] = useState(false);
  const [code, setCode] = useState('');
  return (
    <section class="landing-card" aria-label="War Room">
      <div class="kicker"><span class="light bad" /> GLOBAL CRISIS · LIVE THEATER</div>
      <h1>WAR <span>ROOM</span></h1>
      <p class="tag">Your staff reads <b>hundreds of reports a minute</b>. You read five. Command air, sea, land, drone and space forces — and seize the world's chokepoints.</p>
      {!pvpOpen ? (
        <>
          <div class="sec-title">Opponent: machine</div>
          <div class="diff" role="radiogroup" aria-label="Difficulty">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button key={d} role="radio" aria-checked={diff === d} class={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>
                <b>{DIFFICULTY[d].label}</b>
                {!isMobile.value && <small>{DIFFICULTY[d].blurb}</small>}
              </button>
            ))}
          </div>
          {isMobile.value && <p class="muted" style={{ fontSize: 12, margin: '-4px 0 10px' }}>{DIFFICULTY[diff].blurb}</p>}
          <button class="btn primary big-btn" onClick={() => { updateSettings({ difficulty: diff }); onSolo(diff); }}>▶ TAKE COMMAND</button>
          <div class="row-btns">
            <button class="btn" onClick={() => setPvpOpen(true)}>⚔ Play vs a human</button>
            <button class="btn" onClick={() => (tourStep.value = -1)}>How to play</button>
          </div>
        </>
      ) : (
        <>
          <div class="sec-title" style={{ marginBottom: 8 }}>Human vs human</div>
          <p class="muted" style={{ marginTop: 0, fontSize: 13 }}>Create a room and send the link to a friend. The host commands AEGIS (blue); the guest commands HYDRA (red).</p>
          <button class="btn primary big-btn" onClick={onCreateRoom}>CREATE ROOM</button>
          <div class="sec-title" style={{ margin: '14px 0 6px' }}>Or join with a code</div>
          <form class="join" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 4) onJoinRoom(code.trim().toUpperCase()); }}>
            <input value={code} maxLength={6} placeholder="CODE" aria-label="Room code" onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
            <button class="btn" type="submit" disabled={code.trim().length < 4}>Join</button>
          </form>
          <div class="row-btns"><button class="btn ghost" onClick={() => setPvpOpen(false)}>‹ Back</button></div>
        </>
      )}
      <p class="muted" style={{ fontSize: 11.5, margin: '14px 0 0', textAlign: 'center' }}>Fictional factions on a real map · desktop & mobile · voice commands where supported</p>
    </section>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div class="overlay">
      <div class="backdrop" onClick={onClose} />
      <div class="modal" role="dialog" aria-label="How to play">
        <h2>HOW TO PLAY</h2>
        <p class="lead">You are the theater commander. Your AI staff watches everything; you decide.</p>
        <Objectives />
        <div class="row-btns"><button class="btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}

function Objectives() {
  return (
    <div class="objectives-list">
      <div class="o"><span class="n">1</span><div><b>CONTROL THE CHOKEPOINTS</b><p>Seven strategic nodes — Panama, Gibraltar, Suez, Hormuz, Malacca, Bering and the Cape Uplink. Ships capture sea nodes, ground forces capture land nodes. Each node you hold earns VP every second; hold 4+ for a 50% bonus. Holding Panama or Suez closes that canal to enemy ships.</p></div></div>
      <div class="o"><span class="n">2</span><div><b>WIN THE WAR</b><p>First to <b>{RULES.vpTarget} VP</b> wins — or destroy the enemy HQ — or lead on VP when the 15:00 clock runs out.</p></div></div>
      <div class="o"><span class="n">3</span><div><b>TRUST YOUR STAFF</b><p>Seven staff agents report everything (air, sea, land, drones, space, intel, logistics). <b>ATLAS</b>, your Chief of Staff, surfaces only what needs a decision — with one-click recommended actions.</p></div></div>
      <div class="o"><span class="n">4</span><div><b>GIVE ORDERS</b><p>Select a unit, then click the map to move or click an enemy to attack. Or just ask ATLAS: <i>“send destroyers to Gibraltar”</i>, <i>“what threatens Panama?”</i> — typed or spoken.</p></div></div>
    </div>
  );
}

export function Briefing({ side, onTour, onStart }: { side: Side; onTour: () => void; onStart: () => void }) {
  const enemy: Side = side === 'blue' ? 'red' : 'blue';
  return (
    <div class="overlay">
      <div class="backdrop" />
      <div class="modal" role="dialog" aria-label="Mission briefing">
        <div class="kicker" style={{ font: '700 12px var(--display)', letterSpacing: '0.3em', color: 'var(--sev-critical)' }}>TOP SECRET // MISSION BRIEFING</div>
        <h2>OPERATION <span class={side}>CHOKEHOLD</span></h2>
        <p class="lead">You command the <b class={side}>{FACTIONS[side].name}</b> from {FACTIONS[side].hq}. The <b class={enemy}>{FACTIONS[enemy].name}</b> is moving on the world's shipping lanes.</p>
        <Objectives />
        <div class="row-btns">
          <button class="btn primary big-btn" style={{ flex: '2 1 200px' }} onClick={onStart}>BEGIN OPERATION</button>
          <button class="btn" onClick={onTour}>Tour the war room</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tour */

interface Step { target: string; title: string; text: string; mobileTab?: 'brief' | 'forces' | 'objectives' | 'ask' }
const STEPS: Step[] = [
  { target: 'map', title: '1 · The battle map', text: 'A live map of Earth. Your forces are blue circles, detected hostiles red diamonds, unidentified contacts amber. Hexagons are the 7 objectives. Drag to pan, scroll or pinch to zoom.' },
  { target: 'score', title: '2 · The score at a glance', text: 'The tug-of-war bar shows Victory Points for both sides (first to 1,000 wins) and VP per second. Next to it: nodes held, the clock and your Command Points.' },
  { target: 'brief', title: '3 · ATLAS priority brief', text: 'Your Chief of Staff. ATLAS reads every staff report and shows only the top items that need you — FLASH (red) first. Click a card to fly there; use its buttons to act in one click.', mobileTab: 'brief' },
  { target: 'snr', title: '4 · Signal vs noise', text: 'Reports received → items surfaced to you. Click it to open the raw staff traffic and see what ATLAS filtered out.', mobileTab: 'brief' },
  { target: 'forces', title: '5 · Force status', text: 'Health of your Air, Sea, Land, Drone and Space forces. Click a domain to drill into units, then a unit for details and orders. Staff agents and their report counts are listed below.', mobileTab: 'forces' },
  { target: 'objectives', title: '6 · Objectives', text: 'Each chokepoint with its control meter (blue right, red left). Contested nodes pulse amber. Click one for details and ATLAS recommendations.', mobileTab: 'objectives' },
  { target: 'ask', title: '7 · Ask ATLAS', text: 'Type or speak (mic or M key): “sitrep”, “where are my carriers?”, “send bombers to Suez”, “what should I do?”. Orders ask for confirmation.', mobileTab: 'ask' },
  { target: 'controls', title: '8 · Controls', text: 'Fit all (F) frames every relevant asset. Toggle sensor coverage, threat rings and satellite tracks. Keys: Space pause · Esc deselect · / ask · L legend · ? help.' },
];

export function Tour() {
  const step = tourStep.value;
  const [, tick] = useState(0);
  const s = step !== null && step >= 0 ? STEPS[step] : null;
  // switch the mobile sheet to the panel being explained
  useEffect(() => {
    if (s && isMobile.value && s.mobileTab) {
      sheetTab.value = s.mobileTab;
      sheetSize.value = 'half';
    }
  }, [step]);
  // re-measure while open so the highlight follows layout changes
  useEffect(() => {
    if (!s) return;
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [step]);
  if (step === null || step < 0 || !s) return null;
  const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${s.target}"]`)].find((e) => e.getBoundingClientRect().width > 0);
  const rect = el?.getBoundingClientRect() ?? null;
  const close = () => {
    tourStep.value = null;
    updateSettings({ tourSeen: true });
  };
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(340, vw - 24);
  const tipH = 230;
  let left = (vw - w) / 2, top = (vh - tipH) / 2;
  if (isMobile.value) {
    // dock the tip where it doesn't cover the highlighted element
    top = rect && rect.top > vh / 2 ? 70 : vh - tipH - 16;
    if (rect && rect.height > vh * 0.6) top = vh * 0.42;
  } else if (rect) {
    const big = rect.width > vw * 0.5 && rect.height > vh * 0.5;
    if (big) top = Math.min(vh - tipH, rect.top + 70);
    else if (rect.right + w + 24 < vw) [left, top] = [rect.right + 14, Math.max(12, Math.min(vh - tipH, rect.top))];
    else if (rect.left - w - 24 > 0) [left, top] = [rect.left - w - 14, Math.max(12, Math.min(vh - tipH, rect.top))];
    else if (rect.bottom + tipH < vh) [left, top] = [Math.max(12, Math.min(vw - w - 12, rect.left)), rect.bottom + 12];
    else [left, top] = [Math.max(12, Math.min(vw - w - 12, rect.left)), Math.max(12, rect.top - tipH)];
  }
  const hole = rect
    ? { left: Math.max(2, rect.left - pad), top: Math.max(2, rect.top - pad), width: Math.min(vw - 4, rect.width + pad * 2), height: Math.min(vh - 4, rect.height + pad * 2) }
    : { left: vw / 2, top: vh / 2, width: 0, height: 0 };
  return (
    <>
      <div class="tour-hole" style={{ left: `${hole.left}px`, top: `${hole.top}px`, width: `${hole.width}px`, height: `${hole.height}px` }} />
      <div class="tour-tip" role="dialog" aria-label={s.title} style={{ left: `${left}px`, top: `${top}px`, width: `${w}px` }}>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
        <footer>
          <span class="dots">{STEPS.map((_, i) => <i key={i} class={i === step ? 'on' : ''} />)}</span>
          <button class="btn sm ghost" onClick={close}>Skip</button>
          {step > 0 && <button class="btn sm" onClick={() => (tourStep.value = step - 1)}>Back</button>}
          <button class="btn sm primary" onClick={() => (step < STEPS.length - 1 ? (tourStep.value = step + 1) : close())}>{step < STEPS.length - 1 ? 'Next' : 'Done'}</button>
        </footer>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ after action */

const REASON: Record<string, (w: string) => string> = {
  dominance: (w) => `${w} reached ${RULES.vpTarget} VP`,
  decapitation: (w) => `${w} destroyed the enemy HQ`,
  time: (w) => `${w} led on VP at the time limit`,
  forfeit: (w) => `${w} won by forfeit`,
  draw: () => 'Dead even at the time limit',
};

export function AAR({ onRematch, onMenu }: { onRematch: () => void; onMenu: () => void }) {
  const v = view.value;
  const [copied, setCopied] = useState(false);
  if (!v) return null;
  const me = v.side;
  const enemy: Side = me === 'blue' ? 'red' : 'blue';
  const won = v.winner === me;
  const draw = !v.winner;
  const st = v.stats;
  const lost = Object.values(st[me].losses).reduce((a, b) => a + b, 0);
  const killed = Object.values(st[enemy].losses).reduce((a, b) => a + b, 0);
  const held = v.nodes.filter((n) => n.owner === me).length;
  const reason = v.reason ? REASON[v.reason]?.(v.winner ? faction(v.winner) : '') ?? v.reason : '';
  const c = counters.value;
  const brag = `${won ? 'I won' : draw ? 'I fought to a draw in' : 'I lost'} WAR ROOM ${won ? `— ${reason.toLowerCase()} ` : ''}at ${clock(v.t)}, holding ${held}/7 chokepoints. ATLAS filtered ${c.received.toLocaleString('en-US')} staff reports down to ${c.surfaced}. Can you command?`;
  const url = location.origin;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'WAR ROOM', text: brag, url });
      else {
        await navigator.clipboard.writeText(`${brag} ${url}`);
        setCopied(true);
      }
    } catch {
      /* user cancelled */
    }
  };
  const hb = st.blue.vpHistory, hr = st.red.vpHistory;
  const n = Math.max(hb.length, hr.length, 2);
  const maxV = Math.max(RULES.vpTarget * 0.5, ...hb, ...hr);
  const pts = (h: number[]) => h.map((y, i) => `${(i / (n - 1)) * 300},${140 - (y / maxV) * 130}`).join(' ');
  const durS = v.t;
  return (
    <div class="overlay">
      <div class="backdrop" />
      <div class="modal aar" role="dialog" aria-label="After-action report">
        <div class="sec-title">After-action report · {mmss(durS)} real time</div>
        <h2 class={won ? 'win' : 'lose'}>{won ? 'VICTORY' : draw ? 'STALEMATE' : 'DEFEAT'}</h2>
        <p class="lead">{reason}.</p>
        <div class="grid3">
          <div class="tile"><div class="k">Final VP</div><div class="v"><span class="blue">{Math.floor(v.vp.blue)}</span> <span class="muted">/</span> <span class="red">{Math.floor(v.vp.red)}</span></div></div>
          <div class="tile"><div class="k">Nodes held</div><div class="v">{held}/7</div></div>
          <div class="tile"><div class="k">Kills / losses</div><div class="v">{killed} / {lost}</div></div>
          <div class="tile"><div class="k">Staff reports</div><div class="v">{c.received.toLocaleString('en-US')}</div></div>
          <div class="tile"><div class="k">Surfaced by ATLAS</div><div class="v">{c.surfaced}</div></div>
          <div class="tile"><div class="k">Your decisions</div><div class="v">{decisionLog.length}</div></div>
        </div>
        <div class="chart">
          <div class="lg"><span class="blue">━ AEGIS VP</span><span class="red">━ HYDRA VP</span><span>over time</span></div>
          <svg viewBox="0 0 300 145" preserveAspectRatio="none" aria-label="Victory points over time">
            <line x1="0" x2="300" y1={140 - (RULES.vpTarget / maxV) * 130} y2={140 - (RULES.vpTarget / maxV) * 130} stroke="rgba(255,255,255,.2)" stroke-dasharray="4 4" />
            <polyline points={pts(hb)} fill="none" stroke="#4da3ff" stroke-width="2.2" vector-effect="non-scaling-stroke" />
            <polyline points={pts(hr)} fill="none" stroke="#ff4d5e" stroke-width="2.2" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
        <p class="muted" style={{ fontSize: 13 }}>Losses — {Object.entries(st[me].losses).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`).join(' · ') || 'none'}</p>
        <div class="row-btns">
          <button class="btn primary" onClick={share}>{copied ? '✓ Copied' : '↗ Share result'}</button>
          {mode.value === 'solo' && <button class="btn" onClick={onRematch}>Rematch</button>}
          <button class="btn" onClick={onMenu}>Main menu</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lobby (pvp) */

export function Lobby({ onStart, onLeave }: { onStart: () => void; onLeave: () => void }) {
  const p = pvp.value;
  const [copied, setCopied] = useState(false);
  if (!p) return null;
  const link = `${location.origin}/?room=${p.code}`;
  return (
    <div class="overlay">
      <div class="backdrop" />
      <div class="modal" role="dialog" aria-label="Multiplayer lobby">
        <h2>ROOM <span class="mono" style={{ color: 'var(--accent)' }}>{p.code}</span></h2>
        <p class="lead">{p.host ? 'You command AEGIS (blue). Send this link to your opponent:' : 'You command HYDRA (red). Waiting for the host to start.'}</p>
        {p.host && (
          <div class="join" style={{ marginBottom: 12 }}>
            <input readOnly value={link} style={{ letterSpacing: 0, fontSize: 13, textTransform: 'none' }} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button class="btn" onClick={async () => { try { if (navigator.share) await navigator.share({ title: 'WAR ROOM challenge', text: 'Command HYDRA against me in WAR ROOM', url: link }); else { await navigator.clipboard.writeText(link); setCopied(true); } } catch { /* cancelled */ } }}>{copied ? '✓ Copied' : 'Share'}</button>
          </div>
        )}
        <div class="blurb">Players connected: <b>{p.players}/2</b> · {p.status}</div>
        <div class="row-btns" style={{ marginTop: 14 }}>
          {p.host && <button class="btn primary" disabled={p.players < 2} onClick={onStart}>{p.players < 2 ? 'Waiting for opponent…' : 'START MATCH'}</button>}
          <button class="btn" onClick={onLeave}>Leave</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ menu & toast */

export function Menu({ onClose, onQuit, onRestart }: { onClose: () => void; onQuit: () => void; onRestart: () => void }) {
  const s = settings.value;
  return (
    <div class="overlay">
      <div class="backdrop" onClick={onClose} />
      <div class="modal" role="dialog" aria-label="Menu" style={{ width: 'min(400px,100%)' }}>
        <h2>MENU</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.voice} onChange={() => updateSettings({ voice: !s.voice })} /> Voice briefings (ATLAS speaks FLASH items & SITREPs)</label>
          {mode.value === 'solo' && <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.autoPause} onChange={() => updateSettings({ autoPause: !s.autoPause })} /> Auto-pause on FLASH</label>}
          <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.legendOpen} onChange={() => updateSettings({ legendOpen: !s.legendOpen })} /> Show legend</label>
          <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.coverage} onChange={() => updateSettings({ coverage: !s.coverage })} /> Map: our sensor coverage</label>
          <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.threats} onChange={() => updateSettings({ threats: !s.threats })} /> Map: enemy air-defense rings</label>
          <label class="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.tracks} onChange={() => updateSettings({ tracks: !s.tracks })} /> Map: satellite tracks</label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button class="btn primary" onClick={onClose}>Resume</button>
          <button class="btn" onClick={() => { onClose(); tourStep.value = 0; }}>Tour the war room</button>
          {mode.value === 'solo' && <button class="btn" onClick={onRestart}>Restart match</button>}
          <button class="btn danger" onClick={onQuit}>{mode.value === 'pvp' ? 'Leave match (forfeit)' : 'Quit to title'}</button>
        </div>
      </div>
    </div>
  );
}

export function ToastView() {
  const t = toast.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => tick((x) => x + 1), 3200);
    return () => clearTimeout(id);
  }, [t]);
  if (!t || performance.now() - t.at > 3000) return null;
  return <div class={`toast ${t.tone}`} role="status">{t.text}</div>;
}

export function PausedBadge() {
  if (!paused.value || mode.value !== 'solo') return null;
  return <div class="attract-badge" style={{ left: '50%', transform: 'translateX(-50%)', top: isMobile.value ? 'auto' : 60, bottom: isMobile.value ? 200 : 'auto', color: 'var(--sev-medium)' }}>❚❚ PAUSED · Space to resume</div>;
}
