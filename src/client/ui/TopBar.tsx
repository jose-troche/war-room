import { RULES } from '../../shared/catalog';
import { FACTIONS } from '../../shared/scenario';
import type { Side } from '../../shared/types';
import { openNode } from '../actions';
import { clock, mmss } from '../agents/text';
import { session } from '../session/session';
import { isMobile, mode, paused, settings, speed, tourStep, updateSettings, view } from '../store';
import { canSpeak, stopSpeaking } from '../voice';

export function togglePause() {
  const s = session();
  if (!s?.canPause || mode.value !== 'solo') return;
  paused.value = !paused.value;
  s.setPaused(paused.value);
}

export function setSpeed(x: number) {
  const s = session();
  if (!s?.canPause || mode.value !== 'solo') return;
  speed.value = x;
  s.setSpeed(x);
}

export function VpBar({ compact = false }: { compact?: boolean }) {
  const v = view.value;
  if (!v) return null;
  const me = v.side;
  const enemy: Side = me === 'blue' ? 'red' : 'blue';
  const b = v.vp.blue, r = v.vp.red;
  const bw = Math.min(50, (b / RULES.vpTarget) * 50);
  const rw = Math.min(50, (r / RULES.vpTarget) * 50);
  const rate = (s: Side) => `+${v.vpRate[s].toFixed(1)}/s`;
  return (
    <div class="vp" title={`First to ${RULES.vpTarget} VP wins. ${FACTIONS[me].short}: ${rate(me)}, ${FACTIONS[enemy].short}: ${rate(enemy)}`} data-tour="score">
      <div class="labels">
        <span class="blue">{compact ? 'AEGIS' : 'AEGIS'} {Math.floor(b)}</span>
        {!compact && <span class="mid">{rate('blue')} · first to {RULES.vpTarget} · {rate('red')}</span>}
        <span class="red">{Math.floor(r)} HYDRA</span>
      </div>
      <div class="bar" role="meter" aria-valuemin={0} aria-valuemax={RULES.vpTarget} aria-valuenow={Math.floor(v.vp[me])} aria-label="Victory points">
        <div class="b" style={{ width: `${bw}%` }} />
        <div class="r" style={{ width: `${rw}%` }} />
        <div class="tick" />
      </div>
    </div>
  );
}

export function NodePips() {
  const v = view.value;
  if (!v) return null;
  return (
    <div class="pips" aria-label="Strategic nodes">
      {v.nodes.map((n) => (
        <button
          key={n.id}
          class={`pip ${n.owner ?? ''} ${n.contested ? 'contested' : ''}`}
          title={`${n.name}: ${n.owner ? FACTIONS[n.owner].short : 'neutral'}${n.contested ? ' (contested)' : ''}`}
          aria-label={`${n.name}: ${n.owner ? FACTIONS[n.owner].short : 'neutral'}`}
          onClick={() => openNode(n.id)}
        />
      ))}
    </div>
  );
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const v = view.value;
  if (!v) return null;
  const left = Math.max(0, RULES.timeLimit - v.t);
  const solo = mode.value === 'solo';
  const s = settings.value;
  return (
    <header class="topbar">
      <div class="brand"><span class="dot" />WAR ROOM</div>
      <VpBar />
      <div class="stat" data-tour="nodes">
        <span class="k">Nodes {v.nodes.filter((n) => n.owner === v.side).length}/7</span>
        <NodePips />
      </div>
      <div class="stat" title="Match clock (game time) and real time remaining">
        <span class="k">{clock(v.t)}</span>
        <span class="v">{mmss(left)}</span>
      </div>
      <div class="stat" title="Command Points: spend them on reinforcements">
        <span class="k">CP +{v.cpRate}/s</span>
        <span class="v">{Math.floor(v.cp)}</span>
      </div>
      <div class="ctrls">
        {solo && (
          <>
            <button class={`icon-btn ${paused.value ? 'on' : ''}`} onClick={togglePause} title="Pause / resume (Space)" aria-label={paused.value ? 'Resume' : 'Pause'}>
              {paused.value ? '▶' : '❚❚'}
            </button>
            <div class="speed" role="group" aria-label="Game speed">
              {[0.5, 1, 2].map((x) => (
                <button key={x} class={speed.value === x ? 'on' : ''} onClick={() => setSpeed(x)} aria-pressed={speed.value === x}>{x}×</button>
              ))}
            </div>
          </>
        )}
        {canSpeak && (
          <button class={`icon-btn ${s.voice ? 'on' : ''}`} title="Voice briefings from ATLAS" aria-label="Toggle voice briefings" aria-pressed={s.voice}
            onClick={() => { if (s.voice) stopSpeaking(); updateSettings({ voice: !s.voice }); }}>
            {s.voice ? '🔊' : '🔈'}
          </button>
        )}
        <button class="icon-btn" title="How to play (?)" aria-label="Help tour" onClick={() => (tourStep.value = 0)}>?</button>
        <button class="icon-btn" title="Menu" aria-label="Menu" onClick={onMenu}>☰</button>
      </div>
    </header>
  );
}

export function MobileTop({ onMenu }: { onMenu: () => void }) {
  const v = view.value;
  if (!v || !isMobile.value) return null;
  const left = Math.max(0, RULES.timeLimit - v.t);
  return (
    <div class="m-top">
      <VpBar compact />
      <div class="clock">
        <div>{mmss(left)}</div>
        <div class="muted">CP {Math.floor(v.cp)}</div>
      </div>
      {mode.value === 'solo' && (
        <button class={`icon-btn ${paused.value ? 'on' : ''}`} onClick={togglePause} aria-label={paused.value ? 'Resume' : 'Pause'}>{paused.value ? '▶' : '❚❚'}</button>
      )}
      <button class="icon-btn" aria-label="Menu" onClick={onMenu}>☰</button>
    </div>
  );
}
