# WAR ROOM: Implementation Plan (Cloudflare free tier, TypeScript)

This document describes how [SPEC.md](./SPEC.md) is built and deployed. Everything runs on the
**Cloudflare Workers free plan**: a single Worker that serves static assets, hosts one Durable
Object class for multiplayer rooms, and optionally uses Workers AI for open-ended questions.

---

## 1. Architecture overview

```
 Browser (desktop / mobile)                               Cloudflare (free plan)
┌──────────────────────────────────────────────┐        ┌────────────────────────────────────┐
│  UI (Preact + signals)    Map (Canvas 2D)    │        │ Worker "war-room"                  │
│        ▲  ▲                     ▲            │ HTTPS  │  ├─ Static assets (Vite build)     │
│        │  └──── Staff agents ───┤            │───────▶│  ├─ POST /api/rooms   → create code│
│        │        ATLAS (CoS)     │            │        │  ├─ POST /api/ask     → Workers AI │
│        │           ▲            │            │   WS   │  └─ GET  /api/rooms/:code/ws ──┐   │
│   GameSession (view per side)   │            │◀──────▶│                                │   │
│    ├─ LocalSession: Engine + AI (solo)       │        │ Durable Object "GameRoom" ◀─────┘   │
│    └─ RemoteSession: WebSocket (PvP)         │        │  └─ authoritative Engine (shared)  │
└──────────────────────────────────────────────┘        └────────────────────────────────────┘
                  ▲ shared TypeScript (src/shared) used by both ▲
```

Key decisions:

| Decision | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | One simulation codebase shared by client (solo) and Durable Object (PvP) |
| UI | Preact + `@preact/signals` | Small (about 5KB), fast fine-grained updates for panels that change several times per second |
| Map | Hand-written Canvas 2D renderer, equirectangular projection | Full control over level of detail, wrap-around and performance; no tile server or API keys (free) |
| Geography | Natural Earth via `world-atlas` TopoJSON (110m default, 50m lazy-loaded when zoomed) | Accurate, free and small |
| Terrain for movement | Pre-computed 1° land/sea bitmask (64,800 bits ≈ 8KB) built at build time | Same pathing on client and server, with no geometry at runtime |
| Solo mode | Simulation and AI run in the browser | Zero server cost, works offline once loaded |
| PvP | One Durable Object per room (SQLite-backed, WebSocket Hibernation API) | Free-plan eligible, strongly consistent, server-authoritative |
| NL queries | Local rule-based intent parser; Workers AI fallback for open questions | Instant, free and deterministic for commands; LLM only where it adds value |
| Voice | Web Speech API (`SpeechRecognition`, `speechSynthesis`) | Free and on-device; degrades gracefully |
| Build | Vite (client) + Wrangler (Worker bundle) | Standard and fast |
| Tests | Vitest (engine, agents, parser), Playwright (desktop and mobile UI) | |

---

## 2. Repository layout

```
war-room/
├─ docs/                     SPEC.md, IMPLEMENTATION.md
├─ index.html                Vite entry (map-first landing)
├─ public/                   favicon, og-image, geo/land-50m.json (lazy)
├─ scripts/
│  └─ build-geo.ts           builds src/shared/geo/mask.ts + client geo bundles from world-atlas
├─ src/
│  ├─ shared/                runtime-agnostic (no DOM, no Workers APIs)
│  │  ├─ types.ts            Unit, Base, Node, GameState, View, Order, Event, Report …
│  │  ├─ rng.ts              seeded PRNG (mulberry32)
│  │  ├─ geo.ts              haversine, bearing, interpolation, lon wrap
│  │  ├─ geo/mask.ts         generated land bitmask + isLand(lat, lon)
│  │  ├─ path.ts             A* over the 1° grid (sea / land / sealift costs, chokepoint denial)
│  │  ├─ catalog.ts          unit stats (speed, hp, sensors, weapons, cost, endurance)
│  │  ├─ scenario.ts         bases, nodes, initial order of battle for both factions
│  │  ├─ engine.ts           Engine class: step(dt), applyOrder(), viewFor(side)
│  │  ├─ ai.ts               machine commander (difficulty levels)
│  │  ├─ protocol.ts         client/server WebSocket messages
│  │  └─ names.ts            callsign generation
│  ├─ client/
│  │  ├─ main.tsx            boot, routing (landing / briefing / game / AAR)
│  │  ├─ session/            LocalSession, RemoteSession, AttractSession (AI vs AI)
│  │  ├─ agents/             staff agents (vigil, falcon, …), atlas.ts (Chief of Staff)
│  │  ├─ nlq/                intent parser, entity lexicon, executor
│  │  ├─ map/                camera.ts, renderer.ts, icons.ts, picking.ts, geoData.ts
│  │  ├─ ui/                 TopBar, Brief, ForceStatus, Objectives, UnitDetail, NodeDetail,
│  │  │                      StaffTraffic, Legend, Ask, Tour, Briefing, Landing, AAR, MobileSheet
│  │  ├─ voice.ts            speech recognition / synthesis wrappers
│  │  ├─ store.ts            signals: view, selection, camera, settings, brief
│  │  └─ styles.css          design tokens + layout (CSS grid, container queries)
│  └─ worker/
│     ├─ index.ts            fetch router (assets, /api/*)
│     ├─ room.ts             GameRoom Durable Object
│     └─ ask.ts              Workers AI fallback endpoint
├─ tests/
│  ├─ unit/                  vitest: engine, path, ai, atlas, nlq
│  └─ e2e/                   playwright: landing, solo flow, tour, ask, mobile
├─ wrangler.jsonc
├─ vite.config.ts
├─ playwright.config.ts
└─ package.json
```

---

## 3. Simulation engine (`src/shared/engine.ts`)

### 3.1 State model
All state is plain JSON-serializable data, so it can be snapshotted to Durable Object storage
and sent over WebSocket.

```ts
type Side = 'blue' | 'red';
type Domain = 'air' | 'sea' | 'sub' | 'land' | 'drone' | 'space';

interface Unit {
  id: string; side: Side; type: UnitType; name: string;
  lat: number; lon: number; heading: number;
  hp: number;                     // 0..100
  fuel?: number;                  // seconds of endurance left (air/drone)
  order: Order;                   // current tasking
  path?: [number, number][];      // remaining waypoints (lat, lon)
  state: 'ready'|'moving'|'engaged'|'rtb'|'rearming'|'embarked'|'building'|'destroyed';
  cooldowns: Record<string, number>;
  orbit?: { inc: number; lon0: number; phase: number }; // satellites
  homeId?: string;               // base or carrier for RTB
}
interface StrategicNode { id; name; lat; lon; kind: 'sea'|'land'|'both'; radiusKm; control: number /* -100..100 */; owner: Side|null }
interface GameState { t; seed; speed; units; bases; nodes; vp: {blue, red}; cp: {blue, red}; events; winner?; reason? }
```

### 3.2 Tick
A fixed timestep of **0.25s of match time**. `step()` runs these phases in order:

1. **Orders → motion**: follow the path at `catalog.speed` (km/s). Satellites advance their
   orbit. Air units and drones burn fuel and switch to RTB at bingo fuel (distance to home ÷
   speed + 10% reserve).
2. **Sensing**: compute each side's detections. A contact is detected when it is within a sensor
   radius, with submarines at ×0.25 unless the sensor is a destroyer or a sub. The result is per-side
   `contacts` (id → last seen time and position). Ghosts last 30s.
3. **Combat**: each armed unit with weapons off cooldown picks the best detected target in
   range by `targetPriority × (1/distance)`. Hit probability is
   `pHit × (comms sat alive ? 1.2 : 1) × (target in friendly SAM/destroyer umbrella ? 0.6 : 1)`.
   Long-range shots create a short-lived `strike` event (an arc on the map).
4. **Bases**: units at a friendly base repair, refuel and rearm. Reinforcements finish building.
5. **Nodes**: presence strength of capable units within `radiusKm`. An uncontested side moves
   `control` toward ±100 at 10/s. Owner flips at ±60.
6. **Score**: VP += nodes held × 1/s (×1.5 with 4 or more nodes). CP += 2/s + 1/s per node.
7. **Victory**: VP ≥ 1000, enemy HQ destroyed, or t ≥ 900s.

The RNG is seeded, so a given seed and order list always produce the same match. That makes
tests reproducible.

### 3.3 Pathing (`path.ts`)
- The grid is 360×180 at 1°. Longitude wraps. Moves are 8-neighbor.
- **Sea units**: water cells only, plus hand-carved canal and strait cells (Panama, Suez,
  Gibraltar, Bosporus, Malacca, Bering) because the 1° raster closes them. Cells within a
  chokepoint node owned by the enemy are impassable, so ships must route around.
- **Land units**: land cells cost 1. Water cells cost 4 and switch the unit to `embarked`
  (sealift), which runs at 40% speed and is vulnerable.
- **Air, drones, missiles**: direct great-circle-ish interpolation (shortest longitude wrap).
- Paths are smoothed by line-of-sight pruning on the grid to keep waypoint counts low.

### 3.4 Views and fog of war
`engine.viewFor(side)` returns:

- All own units, bases and nodes.
- Detected enemy units with full data.
- Ghosts with last known position.
- Events visible to that side (combat it saw, its own losses, captures).
- Score, CP and the clock.

The clients (solo and PvP) and the agents only ever consume a `View`. This keeps the agents
honest: ATLAS knows only what the staff knows.

### 3.5 Machine commander (`ai.ts`)
A utility-based planner runs every *reaction interval* (8s, 5s or 3s by difficulty):

1. **Assess**: node values (base + proximity + current owner), threats near own HQ and bases,
   and detected high-value enemy targets.
2. **Allocate**: assign idle sea groups to the highest-value reachable sea nodes, armor to land
   nodes (embarking if needed), fighters to combat air patrol over contested nodes or escorting
   bombers, bombers and strike drones to the best detected targets (Elite coordinates strikes),
   recon drones to scout the nearest unknown nodes, and the ASAT site to fire at satellites in
   range.
3. **Requisition**: spend CP on the domain whose strength ratio vs the enemy is lowest.

The same AI also drives **attract mode** (AI vs AI) on the landing page.

---

## 4. Agents (client side, `src/client/agents`)

The agents run in the browser on top of the player's `View` stream. This works the same way
for solo and PvP, with no server cost.

```ts
interface StaffAgent { id: AgentId; callsign: string; observe(prev: View|null, next: View, events: GameEvent[]): Report[] }
interface Report { id; t; agent; severity: 'critical'|'high'|'medium'|'low'|'info'; category; subject; text; lat?; lon?; unitIds?; nodeId?; actions?: SuggestedAction[] }
```

- Each staff agent diffs consecutive views and events. It emits routine telemetry (fuel,
  position, contact updates) as well as significant reports (new contact, engagement, loss,
  capture, bingo, satellite pass, reinforcement ready). This produces the firehose.
- **ATLAS** (`atlas.ts`) ingests every report and keeps a working set keyed by `subject`.
  - **Score** each report as `sevWeight[severity] × relevance × proximity × novelty`.
    - `relevance`: node within 1,500km ×1.6, HQ ×2.5, high-value unit (carrier, AWACS, satellite) ×1.4.
    - `novelty`: decays ×0.5 for each repeat of the same subject within 30s. Repeats merge into
      the existing card with a "×N" count.
  - **Throttle**: one surfaced card every 4s at most (FLASH bypasses this). Show the top 5 by
    score with time decay `exp(-age/45s)`.
  - **Digest**: routine items that aren't surfaced are counted into a 30s "Routine digest" card.
  - **COA generation** (`coa.ts`): for a threat at a location, find the nearest idle capable
    friendly units (anti-ship for ships, fighters/SAMs for air, destroyers for subs, armor for
    land). Build up to two `SuggestedAction`s with ETAs. Each action is an `Order`, so the
    button calls `session.order(...)` directly.
  - **SITREP** every 60s (and on demand). It is composed from a template: score and trend,
    the top threat, and the recommended focus node.
  - Counters `received` and `surfaced` feed the Signal vs Noise meter.

---

## 5. Natural-language queries (`src/client/nlq`)

1. **Normalize**: lowercase the text, strip punctuation and expand synonyms ("jets" →
   fighter, "boats" → ship, "sats" → satellite).
2. **Entity extraction** against lexicons:
   - Unit types and domains.
   - Faction words ("my", "our", "enemy", "hostile").
   - Node names and aliases ("panama", "the canal" → Panama when ambiguous).
   - Regions ("europe", "pacific", "atlantic", "indian ocean", … mapped to bounding boxes).
   - Unit callsigns.
3. **Intent classification** uses keyword rules with priorities, over these intents: `command`
   (send/move/attack/strike/patrol/return), `locate` (where/show/find), `threat`, `node`,
   `status`, `recommend`, `objectives`, `view`, `game`, `help`.
4. **Execution** returns `{ answer: string, focus?: bbox|units, actions?: SuggestedAction[] }`.
   Commands show a confirmation card listing the units that will be tasked, with one tap to
   confirm.
5. **Fallback**: `POST /api/ask` with `{ question, summary }`, where `summary` is under 1.5KB of
   text built from the View. If it fails or isn't configured, ATLAS answers with examples.

Voice input uses `webkitSpeechRecognition`/`SpeechRecognition` and puts the transcript into the
same pipeline. The mic button is hidden if the API is missing.

---

## 6. Map renderer (`src/client/map`)

- **Camera**: `{ cx, cy, zoom }` in world-pixel space. The base world is 1024×512 px at zoom 1
  (equirectangular). `fit(bbox, padding)` handles longitude wrap by choosing the minimal
  enclosing arc. `flyTo` animates with easing, and is instant under `prefers-reduced-motion`.
- **Layers** (bottom to top):
  1. Ocean gradient
  2. Graticule
  3. Land fill and coastline stroke
  4. Country borders (faint)
  5. Day/night terminator (subtle)
  6. Sensor coverage (own side, low alpha)
  7. Threat rings (selected enemy or SAM)
  8. Satellite ground tracks
  9. Node zones and control arcs
  10. Paths of selected units
  11. Strike arcs
  12. Ghosts
  13. Unit markers (with clustering at low zoom)
  14. Labels
  15. Selection halo
- **Static geography** is pre-projected once into `Path2D` at base scale and drawn with
  `ctx.setTransform` for each visible world copy (up to 3 copies for wrap), so no
  re-projection happens per frame. The 50m land file lazy-loads after the first frame and is
  used above zoom 3.
- **Icons**: SVG path strings (24×24) shared by the canvas (`new Path2D(d)`) and the DOM
  legend and panels. That guarantees identical symbols everywhere.
- **Picking**: a screen-space search over projected markers, tolerance 14px (22px on touch).
- **Interpolation**: positions are interpolated between the last two View snapshots using
  `performance.now()`, so motion is smooth at 60fps from 4Hz simulation snapshots.
- **HiDPI**: the canvas is sized to `devicePixelRatio` (capped at 2). A `ResizeObserver` drives
  layout changes.

---

## 7. UI implementation notes

- **Design tokens** live in CSS custom properties: `--bg`, `--panel`, `--ink`, `--blue`, `--red`,
  `--sev-critical`, and so on. The theme is dark-only, which suits a war room.
- **Layout**: CSS grid with areas `top / brief map forces / objectives`. Below 768px it switches
  to a full-bleed map with a bottom-sheet component (drag handle, three snap points, tabs).
- **Fonts**: system UI stack for text, `ui-monospace` for numbers, and one display font
  (Google Fonts "Rajdhani") for headings.
- **State**: `store.ts` holds signals (`view`, `selection`, `camera`, `brief`, `settings`). Panels
  re-render only on the signals they read. The map reads directly in its own `requestAnimationFrame` loop.
- **Tour**: a coach-mark component that targets elements by `data-tour` attributes. Its
  completion is stored in `localStorage`.
- **Settings** (persisted in `localStorage`): voice, auto-pause on FLASH, layers, legend
  collapsed, tour seen.

---

## 8. Server (`src/worker`)

### 8.1 Worker routes

| Route | Handler |
| --- | --- |
| `GET /*` | Static assets (SPA fallback to `index.html`) |
| `POST /api/rooms` | Generates a 5-letter code (excluding confusable letters). Returns `{ code }`. |
| `GET /api/rooms/:code/ws` | WebSocket upgrade, forwarded to `GAME_ROOM.getByName(code)` |
| `POST /api/ask` | Validates input (question ≤ 300 chars, summary ≤ 2KB). Calls `env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', …)` with a strict system prompt (≤ 60 words, use only the summary). Returns `{ answer }`. If the `AI` binding is missing, returns 501. |

### 8.2 `GameRoom` Durable Object
- SQLite-backed (`new_sqlite_classes`), which is required on the free plan.
- Uses the **WebSocket Hibernation API** (`ctx.acceptWebSocket(ws, [side])`, with tags giving each
  socket's side). The lobby stays idle and hibernates for free until both players are present.
- When the match starts, a `setInterval` steps the engine at 4Hz and sends each socket its
  `viewFor(side)`. The interval stops when the match ends or both players disconnect.
- The state snapshot is written to storage every 5s, so an evicted object can resume the
  match.
- Messages (`protocol.ts`):
  - Client → server: `hello{name}`, `start`, `order{order}`, `ping`.
  - Server → client: `lobby{players, side}`, `view{view}`, `ended{winner, reason}`, `error{msg}`.
- Orders are validated server-side: the unit must belong to the sender's side and the order
  must be legal for that unit type.
- Disconnects: if a side is absent for more than 60s during a match, the other side wins by forfeit.

### 8.3 `wrangler.jsonc`

```jsonc
{
  "name": "war-room",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-19",
  "assets": { "directory": "./dist", "binding": "ASSETS",
              "not_found_handling": "single-page-application",
              "run_worker_first": ["/api/*"] },
  "durable_objects": { "bindings": [{ "name": "GAME_ROOM", "class_name": "GameRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }],
  "ai": { "binding": "AI" },
  "observability": { "enabled": true }
}
```

---

## 9. Free-tier budget

| Resource | Free limit | Expected use |
| --- | --- | --- |
| Worker requests | 100,000/day | Static asset requests are free and unmetered. API calls happen only on room create, WS connect and ask. |
| Durable Objects | SQLite-backed objects included in the free plan, 100,000 requests/day, 13,000 GB-s/day | A 15-minute PvP match is about 115 GB-s, which allows roughly 100 PvP matches/day. Incoming WS messages bill at 20:1. |
| DO storage | 5GB, 100,000 row writes/day | 180 snapshot writes per match |
| Workers AI | 10,000 neurons/day | Fallback only. Short prompts on an 8B model; client-side cooldown of 1 request per 10s. |
| Static assets | Unlimited requests | Solo play costs nothing. |

Solo play (the main mode) runs entirely in the browser, so it scales without server cost.

---

## 10. Build, test, deploy

```bash
npm install
npm run geo          # scripts/build-geo.ts → src/shared/geo/mask.ts, public/geo/*
npm run dev          # vite (client) with /api proxied to `wrangler dev`
npm test             # vitest unit tests
npm run build        # vite build → dist/
npm run e2e          # playwright against `wrangler dev` serving dist/ (desktop + mobile)
npm run deploy       # build + wrangler deploy → https://war-room.<account>.workers.dev
```

Playwright projects: `desktop-chromium` (1440×900) and `mobile` (Pixel 7 and iPhone 14
emulation). The tests cover these flows:

- The landing page renders the map canvas with drawn pixels.
- A solo match starts and the briefing shows the objectives.
- The tour steps through every panel.
- Selecting a unit and ordering a move changes its order.
- Fit-all changes the camera.
- An Ask ATLAS query highlights units.
- The mobile bottom sheet switches tabs.
- Screenshots are captured for visual review.

---

## 11. Milestones

1. Scaffold, geo build and land mask, then the map renderer with camera, fit-all and legend
   (the landing map).
2. Engine: catalog, scenario, motion, pathing, sensing, combat, nodes, score and victory, with unit tests.
3. AI commander and attract mode.
4. Game UI: top bar, force status, objectives strip, unit and node details, selection and orders.
5. Agents: staff, ATLAS prioritization, COA buttons, SITREP, traffic drawer.
6. Ask ATLAS: parser, executor, voice, Workers AI fallback.
7. Briefing, tour and After-Action Report.
8. Mobile layout and bottom sheet.
9. Multiplayer: Durable Object rooms and RemoteSession.
10. Playwright pass and UI polish, then deploy.
