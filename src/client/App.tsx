import { useEffect, useState } from 'preact/hooks';
import type { Difficulty } from '../shared/ai';
import type { View } from '../shared/types';
import { clearSelection, orderUnits, selectedUnits, selectUnits } from './actions';
import { agents } from './agents/runner';
import { camera, mapCtl } from './map/controller';
import { MapView } from './map/MapView';
import { LocalSession } from './session/local';
import { RemoteSession } from './session/remote';
import { session, setSession } from './session/session';
import {
  clickMode, isMobile, mode, panel, paused, playerSide, pvp, screen, selection, settings, setView, sheetSize, speed, tourStep,
  trafficOpen, updateSettings, view, showToast,
} from './store';
import { AskPanel } from './ui/Ask';
import { BriefPanel } from './ui/Brief';
import { ForcePanel } from './ui/Forces';
import { AttractBadge, Legend, MapControls, ModeHint } from './ui/MapOverlay';
import { MobileSheet, sheetHeight } from './ui/MobileSheet';
import { ObjectivesStrip } from './ui/Objectives';
import { AAR, Briefing, HowToPlay, Landing, Lobby, Menu, PausedBadge, ToastView, Tour } from './ui/Screens';
import { MobileTop, setSpeed, togglePause, TopBar } from './ui/TopBar';
import { TrafficDrawer } from './ui/Traffic';

let firstView = true;
let briefingPending = false;
/** mobile needs the game insets in place before framing the opening view */
let pendingMobileFit = false;
let lastDifficulty: Difficulty = settings.value.difficulty;

function onView(v: View, interval: number) {
  setView(v, interval);
  agents.onView(v);
  if (firstView) {
    firstView = false;
    if (mode.value === 'attract') camera.whenSized(() => mapCtl.world(false));
    else if (isMobile.value) pendingMobileFit = true;
    else camera.whenSized(() => mapCtl.initial());
  }
  if (v.ended && screen.value === 'game') setTimeout(() => (screen.value = 'aar'), 1200);
}

function startAttract() {
  firstView = true;
  mode.value = 'attract';
  playerSide.value = 'blue';
  agents.reset();
  clearSelection();
  setSession(new LocalSession('attract', 'blue', { onView }));
  screen.value = 'landing';
  pvp.value = null;
}

function startSolo(d: Difficulty) {
  lastDifficulty = d;
  firstView = true;
  mode.value = 'solo';
  playerSide.value = 'blue';
  agents.reset();
  clearSelection();
  panel.value = { kind: 'forces' };
  paused.value = true;
  speed.value = 1;
  const s = new LocalSession('solo', 'blue', { difficulty: d, onView });
  s.setPaused(true);
  setSession(s);
  screen.value = 'briefing';
  briefingPending = true;
  history.replaceState(null, '', '/');
}

function beginOperation() {
  screen.value = 'game';
  briefingPending = false;
  paused.value = false;
  session()?.setPaused(false);
  if (!isMobile.value) mapCtl.fitAll();
}

async function createRoom() {
  try {
    const r = await fetch('/api/rooms', { method: 'POST' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { code } = (await r.json()) as { code: string };
    joinRoom(code, true);
  } catch (e) {
    showToast(`Could not create room: ${(e as Error).message}`, 'error');
  }
}

function joinRoom(code: string, host = false) {
  firstView = true;
  agents.reset();
  clearSelection();
  pvp.value = { code, status: 'Connecting…', players: 0, host };
  screen.value = 'lobby';
  history.replaceState(null, '', `/?room=${code}`);
  const s = new RemoteSession(code, {
    onView: (v, i) => {
      if (mode.value !== 'pvp') {
        mode.value = 'pvp';
        playerSide.value = v.side;
        agents.reset();
        firstView = true;
        screen.value = 'briefing';
        briefingPending = false;
      }
      onView(v, i);
    },
    onLobby: (l) => {
      pvp.value = { code, status: l.status, players: l.players, host: l.side === 'blue' };
    },
    onError: (msg) => {
      showToast(msg, 'error');
      if (screen.value === 'lobby') startAttract();
    },
  });
  setSession(s);
}

export function App() {
  const [menu, setMenu] = useState(false);
  const scr = screen.value;
  const mobile = isMobile.value;
  const inGame = scr === 'game' || scr === 'briefing' || scr === 'aar';

  useEffect(() => {
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[A-Z0-9]{4,6}$/i.test(room)) {
      startAttract();
      joinRoom(room.toUpperCase());
    } else startAttract();
  }, []);

  // after the guided tour that follows the briefing, start the clock
  useEffect(() => {
    if (tourStep.value === null && briefingPending && screen.value === 'game') beginOperation();
  }, [tourStep.value]);

  // camera insets for mobile chrome
  useEffect(() => {
    camera.insets = mobile && inGame
      ? { top: 56, right: 0, bottom: sheetHeight(sheetSize.value), left: 0 }
      : mobile && scr === 'landing' ? { top: 40, right: 0, bottom: Math.round(window.innerHeight * 0.55), left: 0 } : { top: 0, right: 0, bottom: 0, left: 0 };
    camera.clamp();
    if (mobile && scr === 'landing') camera.whenSized(() => mapCtl.world(false));
    if (mobile && inGame && pendingMobileFit && view.value) {
      pendingMobileFit = false;
      camera.whenSized(() => mapCtl.initial());
    }
  }, [mobile, inGame, scr, sheetSize.value, view.value === null]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') {
        if (tourStep.value !== null) tourStep.value = null;
        else if (trafficOpen.value) trafficOpen.value = false;
        else if (menu) setMenu(false);
        else if (selection.value.length || clickMode.value !== 'smart') clearSelection();
        else panel.value = { kind: 'forces' };
        return;
      }
      if (screen.value !== 'game' && screen.value !== 'landing') return;
      if (k === 'f' || k === 'F') mapCtl.fitAll();
      else if (k === 'w' || k === 'W') mapCtl.world();
      else if (k === '+' || k === '=') mapCtl.zoom(1.5);
      else if (k === '-' || k === '_') mapCtl.zoom(1 / 1.5);
      else if (k === 'l' || k === 'L') updateSettings({ legendOpen: !settings.value.legendOpen });
      else if (k === 'ArrowLeft') camera.panBy(120, 0);
      else if (k === 'ArrowRight') camera.panBy(-120, 0);
      else if (k === 'ArrowUp') camera.panBy(0, 120);
      else if (k === 'ArrowDown') camera.panBy(0, -120);
      if (screen.value !== 'game') return;
      if (k === ' ') {
        e.preventDefault();
        togglePause();
      } else if (k === '?') tourStep.value = 0;
      else if (k === '[') setSpeed(Math.max(0.5, speed.value / 2));
      else if (k === ']') setSpeed(Math.min(2, speed.value * 2));
      else if (k === 'h' || k === 'H') {
        const u = selectedUnits();
        if (u.length) orderUnits(u.map((x) => x.id), { kind: 'hold' }, 'Hold');
      } else if (k === 'r' || k === 'R') {
        const u = selectedUnits();
        if (u.length) orderUnits(u.map((x) => x.id), { kind: 'rtb' }, 'Return to base');
      } else if (k === 'a' || k === 'A') {
        if (selection.value.length) clickMode.value = 'attack';
      } else if (k === 'p' || k === 'P') {
        if (selection.value.length) clickMode.value = 'patrol';
      } else if (k === 'Tab') {
        e.preventDefault();
        const v = view.value;
        if (!v) return;
        const ready = v.units.filter((u) => u.side === v.side && u.domain !== 'space' && u.state !== 'building' && u.type !== 'asat');
        if (!ready.length) return;
        const cur = ready.findIndex((u) => u.id === selection.value[0]);
        const next = ready[(cur + (e.shiftKey ? -1 : 1) + ready.length) % ready.length];
        selectUnits([next.id]);
        mapCtl.flyTo(next.lat, next.lon);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const openMenu = () => {
    setMenu(true);
    if (mode.value === 'solo' && !paused.value) togglePause();
  };
  const closeMenu = () => {
    setMenu(false);
    if (mode.value === 'solo' && paused.value) togglePause();
  };
  const quit = () => {
    setMenu(false);
    if (mode.value === 'pvp') (session() as RemoteSession | null)?.leave?.();
    history.replaceState(null, '', '/');
    startAttract();
  };

  const desktopGame = inGame && !mobile;
  return (
    <div class={`app ${scr === 'landing' || scr === 'lobby' ? 'landing' : ''} ${mobile ? 'mobile' : ''}`}>
      {desktopGame && <TopBar onMenu={openMenu} />}
      {desktopGame && (
        <aside class="left panel-col" aria-label="ATLAS priority brief">
          <BriefPanel />
          <AskPanel />
        </aside>
      )}
      <main class="map-area">
        <MapView />
        <MapControls />
        {inGame && <Legend />}
        {!inGame && <AttractBadge />}
        {scr === 'game' && <ModeHint />}
        <PausedBadge />
        {inGame && mobile && <MobileTop onMenu={openMenu} />}
        {inGame && mobile && scr !== 'briefing' && <MobileSheet />}
        <TrafficDrawer />
        <ToastView />
        {scr === 'landing' && <Landing onSolo={startSolo} onCreateRoom={createRoom} onJoinRoom={(c) => joinRoom(c)} />}
      </main>
      {desktopGame && (
        <aside class="right panel-col" aria-label="Force status">
          <ForcePanel />
        </aside>
      )}
      {desktopGame && <ObjectivesStrip />}
      {scr === 'briefing' && (
        <Briefing side={playerSide.value} onStart={beginOperation} onTour={() => { screen.value = 'game'; tourStep.value = 0; }} />
      )}
      {scr === 'lobby' && <Lobby onStart={() => (session() as RemoteSession).start()} onLeave={quit} />}
      {scr === 'aar' && <AAR onRematch={() => startSolo(lastDifficulty)} onMenu={quit} />}
      {menu && <Menu onClose={closeMenu} onQuit={quit} onRestart={() => { setMenu(false); startSolo(lastDifficulty); }} />}
      {tourStep.value === -1 && <HowToPlay onClose={() => (tourStep.value = null)} />}
      <Tour />
    </div>
  );
}
