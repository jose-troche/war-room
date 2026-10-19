# WAR ROOM — Global Command

> **"Your staff reads 500 reports a minute. You read five. Make them count."**

WAR ROOM is a real-time, browser-based strategy game that puts the player in the chair of a
theater commander. The player doesn't micromanage. They lead a staff of AI officers and decide.
Seven specialist **staff agents** watch air, sea, land, unmanned, space, intelligence and
logistics. Their reports flow to **ATLAS**, the Chief of Staff agent, who turns that
traffic into a short, prioritized, actionable brief.

The game shows a multi-agent command-and-control loop: **sense → report → prioritize →
brief → decide → act**. The player sees how much information there is and how a
good prioritizing agent makes it possible to act on.

This document is the product and game-design specification. The technical design is in
[IMPLEMENTATION.md](./IMPLEMENTATION.md).

---

## 1. Design pillars

| Pillar | What it means in practice |
| --- | --- |
| **Big picture at a glance** | One main screen shows the score, the objectives, the threats and force health without clicking anything. |
| **Drill down on demand** | Every summary element (a domain card, a brief item, a map marker, an objective) opens its details in one click or tap. |
| **Signal over noise** | The raw report firehose is always available, but the commander sees ATLAS's prioritized brief first. A visible counter shows *reports received* vs *surfaced to you*. |
| **Meaningful decisions, not twitch** | The game moves continuously but slowly enough to think. It has pause (solo), speed control, decision cards with countdowns, and a pace of roughly one important decision every 15–30 seconds. |
| **Simple input, powerful effect** | Select, then tap a destination or target. One-click recommended actions. Natural-language commands by text or voice. A small set of keyboard shortcuts. |
| **Calm, high-quality visuals** | A dark war-room look. Color is used only to carry meaning (side, severity, status). No gratuitous animation. |

---

## 2. Setting and factions

A fictional near-future global crisis is played out on a real map of Earth. Both factions are
fictional and do not represent real nations.

| Faction | Color | Home region | HQ codename |
| --- | --- | --- | --- |
| **AEGIS Coalition** (Blue) | Blue `#4DA3FF` | Western Hemisphere and Atlantic | NORTHSTAR |
| **HYDRA Directorate** (Red) | Red `#FF4D5E` | Eurasia and Indian Ocean | IRONCROWN |

In a solo game the human always commands AEGIS for the first release and the machine commands HYDRA.
In a two-player game the room creator commands AEGIS and the guest commands HYDRA.

---

## 3. Objectives and win conditions

Objectives appear on the briefing screen before the match starts. They also stay visible in the top
bar for the whole match.

**Primary objective: control the world's strategic chokepoints.**

Seven **Strategic Nodes** are on the map:

| # | Node | Kind | Captured by |
| --- | --- | --- | --- |
| 1 | Panama Canal | Sea chokepoint | Surface ships |
| 2 | Strait of Gibraltar | Sea chokepoint | Surface ships |
| 3 | Suez Canal | Sea and land chokepoint | Surface ships **or** ground forces |
| 4 | Strait of Hormuz | Sea chokepoint | Surface ships |
| 5 | Strait of Malacca | Sea chokepoint | Surface ships |
| 6 | Bering Strait | Sea chokepoint | Surface ships |
| 7 | Cape Uplink (ground station) | Land site | Ground forces |

**Victory conditions** (whichever happens first):

1. **Dominance**: reach **1,000 Victory Points (VP)**. Each held node earns +0.35 VP per
   second (tuned so matches last 8–12 minutes). Holding a majority (4 or more nodes)
   earns a +50% bonus.
2. **Decapitation**: destroy the enemy HQ (very heavily defended, and reachable only by
   bombers, missiles and strike drones).
3. **Time limit**: after **15:00** of match time, the side with more VP wins.

**Secondary effects** of holding nodes:

- A held sea chokepoint **blocks enemy surface ships** from passing through it. They must route
  around, so Suez and Panama are worth a lot.
- Each held node adds **+1 Command Point (CP)/s** of income.

---

## 4. Forces

Every unit belongs to one of five domains. Domain is shown by **icon shape**. Faction is shown by
**color**.

| Domain | Unit | Role | Notes |
| --- | --- | --- | --- |
| **Air** | Fighter Squadron | Air superiority, intercepts aircraft and drones | Limited endurance. Returns to base automatically at bingo fuel. |
| | Bomber Wing | Long-range strike on ships, ground forces, bases and HQ | Vulnerable to fighters and SAMs |
| | AWACS | Very large radar coverage | Unarmed and high value |
| **Sea** | Carrier Strike Group | Mobile airbase with strong air defense | Fighters can rearm at a carrier |
| | Destroyer | Air defense, anti-ship, anti-sub; captures chokepoints | The workhorse of sea control |
| | Submarine | Stealthy ship killer | Hard to detect. Only destroyers and subs see it beyond close range. |
| **Land** | Armored Brigade | Captures land nodes and fights ground forces | Crosses oceans slowly as **sealift** and is vulnerable at sea |
| | SAM Battery | Shoots down aircraft, drones and missiles in range | Can't move far |
| | Missile Battery | Long-range precision strike | Slow reload |
| **Unmanned** | Recon Drone | Long-endurance ISR with a wide sensor | Cheap and fragile |
| | Strike Drone Swarm | Cheap attack on ships and ground | Fragile |
| **Space** | Recon Satellite | Orbits the planet and reveals a wide swath under it | Orbit shown as a ground track |
| | Comms/GPS Satellite | +20% weapon accuracy for its faction while operational | |
| | ASAT Site (ground) | Shoots down enemy satellites that pass within range | One of the few counters to space assets |

**Fixed installations**: HQ (one per side), Airbases (aircraft and drones rearm here and
reinforcements arrive here), and Naval Ports (ships repair here and naval reinforcements arrive
here).

### 4.1 Fog of war and sensing
- A faction sees only what its sensors detect: unit sensors, bases, AWACS, drones and
  satellite swaths.
- Lost contacts stay on the map as **fading "last known position" ghosts** for 30 seconds.
- Submarines are stealthy. Most sensors detect them only at 25% of normal range.

### 4.2 Combat (automatic)
- Units engage detected enemies in range automatically, following their rules of engagement.
- Weapons have range, hit probability, damage and reload time. Air defenses can intercept
  incoming missiles and aircraft.
- Strikes show briefly on the map as arcs. Destroyed units leave a short marker.
- The player decides **where** forces go and **what** they target. Combat resolves itself.

### 4.3 Economy and reinforcements
- **Command Points (CP)** accrue at a base rate plus +1/s per held node.
- The **Requisition** drawer lets the player spend CP to deploy new units at a friendly base
  or port after a short build time.

---

## 5. The staff: a multi-agent war room

### 5.1 Staff agents (reporters)

| Agent | Callsign | Watches | Typical reports |
| --- | --- | --- | --- |
| J2 Intelligence | **VIGIL** | Enemy contacts, movements, concentrations | "New contact: hostile surface group, 2 ships, heading for Malacca" |
| Air Operations | **FALCON** | Aircraft, air engagements, fuel | "VIPER-1 bingo fuel, returning to base" |
| Maritime Operations | **TRIDENT** | Ships, subs, chokepoints | "Sonar contact near Gibraltar" |
| Land Operations | **BULWARK** | Ground forces, sealift, captures | "Armor 2 embarked, at sea, unescorted" |
| Unmanned Systems | **SWARM** | Drones | "Recon drone RAVEN-2 on station over Hormuz" |
| Space Operations | **ORBIT** | Satellites, ASAT threats, coverage | "Recon sat KH-A passing over Indian Ocean in 20s" |
| Logistics | **QUARTERMASTER** | CP, reinforcements, damage, rearming | "Destroyer deployed at TRIDENT port" |

Each agent emits structured reports:
`{ agent, severity, category, subject, location?, text, unitIds?, nodeId?, actions? }`.

Agents report **a lot**, by design. This is the firehose. It typically runs to tens of
reports a minute and can pass 100 a minute in heavy fighting. All of it is
available in the **Staff Traffic** drawer, which can be filtered by agent.

### 5.2 Chief of Staff agent (ATLAS)

ATLAS is the main agent and the player's point of contact. Its job is to be **concise, relevant
and timely**.

ATLAS decides what reaches the commander:

1. **Scoring**: `priority = severity × objectiveRelevance × proximityToFriendlyAssets ×
   novelty × timeDecay`.
   - *objectiveRelevance* rises when a report concerns a node, the HQ or a high-value unit.
   - *novelty* drops for repeats of the same subject. Repeats merge into one card
     ("×3") instead of appearing as new items.
2. **Throttling**: no more than one new surfaced item every few seconds, except FLASH items.
   The brief shows the **top 5 items** at most. Older ones roll into history.
3. **Escalation tiers**:
   - **FLASH** (critical): needs a decision now. It may pause the game in solo if
     *Auto-pause on FLASH* is on. Optional voice readout.
   - **PRIORITY** (high): important and actionable soon.
   - **ROUTINE**: batched into a digest every 30s ("4 routine updates").
4. **Recommendations**: ATLAS runs a **planning cell**, a memory-less shadow commander for the
   player's side (the same planner the machine opponent uses), every 2.5 seconds. Its intended
   moves become one-click recommendations. They are coherent, units already under way are
   never re-tasked, and advice the player ignored is simply proposed again. In addition, when
   it surfaces a threat or an opportunity, ATLAS proposes one or two
   **courses of action** with one-click buttons. The proposals are computed from available
   friendly assets. For example: *"Send destroyer HALBERD to Panama, ETA 35s"* or
   *"Strike with bomber wing ANVIL-1"*.
5. **SITREP** every 60s, also available on request. It is three short lines: score and
   trend, main threat, and recommended focus.
6. **Signal vs noise meter**: always visible, for example *"1,284 reports → 37 surfaced"*.

ATLAS's writing rules:

- Lead with the bottom line.
- At most 120 characters per line.
- Use codenames and node names, never internal IDs.
- Give times as ETAs or countdowns.
- Never surface the same fact twice without new information.

### 5.3 Natural-language inquiries ("Ask ATLAS")

The player can type or speak (using the microphone button or the `M` key) to ATLAS.
Supported intents:

| Intent | Examples | Result |
| --- | --- | --- |
| Status | "sitrep", "how are we doing?" | SITREP |
| Locate | "where are my carriers?", "show enemy subs" | Units highlighted, map fits to them, short list answer |
| Threats | "what threatens Panama?", "biggest threat" | Ranked threats with distance/ETA |
| Node info | "status of Suez" | Node card, map flies there |
| Command | "send bombers to Suez", "move armor to Cape Uplink", "fighters patrol Gibraltar", "drones return to base" | Confirmation card, then orders issued |
| Recommend | "what should I do?" | Top 3 recommendations with action buttons |
| Objectives | "how do I win?" | Objective summary |
| View | "zoom to Europe", "show the Pacific", "fit all" | Map camera change |
| Game | "pause", "faster", "slower" | Game control |

A local intent parser handles these offline. If an open-ended question isn't recognized, it
goes to an optional server-side LLM endpoint, given a compact situation summary, for a
concise answer. If that isn't available, ATLAS lists example questions instead.

Spoken input uses the browser's speech recognition where it's supported, and the
mic button is hidden where it isn't. ATLAS can read FLASH items and SITREPs aloud (*Voice* toggle).

---

## 6. Screens and user interface

### 6.1 Landing page (map first)
- The **live world map** fills the screen behind a translucent title card. An AI-vs-AI
  "attract mode" match runs in the background, so the first thing visitors see is the
  game itself.
- The title card has **Play vs AI** (difficulty: Recruit, Veteran, Elite), **Play vs Human**
  (create a room or join one by code, plus a share link), and **How to play**.
- Visiting a URL with `?room=CODE` goes straight to joining that room.

### 6.2 Mission briefing and intro tour
- Before the first match, a **Mission Briefing** card states the objectives, the win
  conditions and the time limit in plain language.
- Next, an optional **guided tour** (coach marks, 7 steps, skippable, reopened with `?`)
  highlights each panel and explains its purpose:
  1. Map and legend
  2. Top bar (score, objectives, clock, CP)
  3. ATLAS Priority Brief
  4. Force Status cards
  5. Objectives strip
  6. Ask ATLAS (text and voice)
  7. Controls (select, order, fit-all, shortcuts)

### 6.3 Main screen layout (desktop, at least 1024px wide)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ WAR ROOM  │ VP ████████░░ 412 vs 365 ░░ │ Nodes ●●●○○◐○ │ 07:42 │ CP 240 │ ⏸ 1x ? │  ← Top bar
├──────────────┬───────────────────────────────────────────────┬────────────────┤
│ ATLAS BRIEF  │                                               │ FORCE STATUS   │
│ ▲ FLASH ...  │                                               │ ✈ Air    ███▉  │
│ ● PRIORITY.. │                 WORLD MAP                     │ ⚓ Sea    ███   │
│ ● PRIORITY.. │        (units, nodes, coverage, arcs)         │ ▣ Land   ████  │
│ ○ Routine ×4 │                                               │ ⌖ Drones ██    │
│              │   [Legend]                  [⤢ Fit all][+][-] │ ✦ Space  ███   │
│ 1,284 → 37   │                                               │ ─ Staff ─────  │
│ [Ask ATLAS 🎤]│                                               │ VIGIL ● 312    │
├──────────────┴───────────────────────────────────────────────┴────────────────┤
│ OBJECTIVES: Panama ███ │ Gibraltar ░█ │ Suez ◐ │ Hormuz ░░ │ Malacca ░ │ ...   │  ← Objectives strip
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar**: a tug-of-war VP bar between the factions, node pips colored by owner, the match
  clock with time remaining, CP, pause/speed controls, the voice toggle and help.
- **Left: ATLAS Priority Brief**: up to 5 cards, sorted by priority. Each card has a severity
  stripe, an agent badge, one line of text, an age, a "×N" merge count and up to two action
  buttons. Clicking a card flies the map to its subject. Below the cards are the signal vs noise
  meter, the SITREP button and the **Ask ATLAS** input with a microphone.
- **Right: Force Status**: one card per domain with a strength bar (current vs. initial), unit
  counts (ready/engaged/returning), and a status light. Clicking a card opens the domain's unit
  list, and clicking a unit opens the **Unit Detail** sheet. Below the cards is the **Staff**
  list: each agent's status light and report count. Clicking an agent opens its raw traffic.
- **Bottom: Objectives strip**: one chip per node with a control meter (−100 Red … +100 Blue),
  an owner color and a contest indicator. Clicking a chip opens the node detail and flies to it.
- **Map overlays**: the legend (collapsible, collapsed by default on small screens), fit-all,
  zoom ±, and layer toggles (sensor coverage, satellite tracks, threat rings).

### 6.4 Mobile layout (360–899px wide)
- The map fills the screen. A compact top bar shows the VP bar, clock and pause.
- The opening view frames the theater around the player's own forces at a legible zoom.
  Edge markers point to off-screen objectives, and *Fit all* still frames everything.
- A **bottom sheet** has tabs: **Brief** (default) · **Forces** · **Objectives** · **Ask**.
  The sheet has three heights: peek, half and full. Peek shows the top FLASH or PRIORITY item.
- Touch: tap selects, tap on an empty map area while something is selected orders a move, tap an
  enemy to attack, pinch to zoom, one-finger drag to pan. Map controls use touch targets of at
  least 44px.

### 6.5 Drill-down views
- **Unit Detail**: name, type, domain, health, fuel or endurance, weapons and readiness,
  current order, ETA, nearby threats, and action buttons (Move, Attack, Patrol, Hold,
  Return to base, plus Launch for an ASAT site).
- **Node Detail**: control meter, owner, capture requirement, friendly and enemy forces within
  the zone, and ATLAS's recommendation.
- **Domain list**: a sortable unit list with status chips. Clicking a unit selects it and
  centers the map on it.
- **Staff Traffic**: the raw report feed, filterable by agent and severity, newest first,
  showing up to 300 entries.

### 6.6 After-Action Report
- Winner, how the match was won, a VP-over-time chart, nodes held over time, losses by domain,
  the reports-vs-surfaced ratio, and decisions taken.
- **Share** (Web Share API, falling back to copying the link) with a short brag line.
  **Rematch** and **Back to the war room** buttons.

---

### 6.7 Glossary
- Every acronym and piece of jargon shown in the UI has a definition. This covers VP, CP,
  SITREP, ETA, RTB, HQ, AWACS, SAM, ASAT, CAP, GPS, the DDG/DD/CVN/CV/SSN/SS hull prefixes,
  J2, the H+ clock, and terms like bingo, winchester, sealift, contested and chokepoint.
- On desktop the definition appears on hover. On touch devices, tapping the term shows it.
  Buttons carry the definitions in their tooltip. The full glossary is in *How to play* and
  in the menu.

## 7. Map and camera

- The map is a real Earth rendered from Natural Earth data: coastlines, faint national borders
  and a graticule. It uses an equirectangular projection with seamless horizontal wrap.
  More detailed coastlines load when zoomed in.
- **Default zoom** fits the whole theater, which is all nodes plus all friendly and known enemy
  assets, to the available viewport.
- **⤢ Fit all** (key `F`) zooms to include all relevant assets. Double-clicking a domain card
  fits to that domain's units. Brief cards and objectives fly the camera to their subject.
- Zoom ranges from 1× (whole world) to about 40× (regional). Use the mouse wheel, pinch, the
  ± buttons or the `+`/`-` keys. Zoom is cursor-anchored.
- **Level of detail**: at world zoom, units of the same faction and domain that sit close
  together are drawn as one marker with a count badge. Unit labels appear only when zoomed in.

### 7.1 Iconography and color code

| Meaning | Encoding |
| --- | --- |
| Faction | Marker ring color: **Blue** friendly AEGIS, **Red** hostile HYDRA, **Amber** unknown contact (a sensor hit that isn't yet classified), **Gray** ghost (last known position) |
| Domain | Icon glyph: aircraft (air), ship hull (sea), submarine (sub-surface), square with a track (land), delta with dots (drone), satellite (space), star (HQ), runway (airbase), anchor (port), diamond (strategic node) |
| Severity | **Red** FLASH/critical · **Orange** PRIORITY/high · **Yellow** caution/medium · **Teal** routine · **Slate** info |
| Status | Green ready · Amber engaged or low fuel · Red damaged (under 35%) · Gray returning or rearming |

The legend lists every icon and color in use. It can be collapsed to a small chip so it
doesn't cover the map.

---

## 8. Controls

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Select unit | Left-click | Tap | `Tab` cycles through ready units |
| Add to selection | Shift-click / shift-drag box | Long-press | — |
| Move / patrol / attack | Click a destination or an enemy with units selected | Tap | — |
| Context actions | Buttons in the Unit Detail sheet | Same | `A` attack mode, `P` patrol, `H` hold, `R` return to base |
| Pan / zoom | Drag / wheel | Drag / pinch | Arrow keys / `+` `-` |
| Fit all | ⤢ button | ⤢ button | `F` |
| Pause / speed (solo) | Top bar | Top bar | `Space` / `[` `]` |
| Ask ATLAS | Input box | Ask tab | `/` to focus, `M` for microphone |
| Deselect / close | Click empty map with nothing selected / ✕ | ✕ | `Esc` |
| Legend / help | Buttons | Buttons | `L` / `?` |

---

## 9. Pace and difficulty

- At 1× speed one real second is two minutes of game time. The clock shows `H+hh:mm`.
- A match lasts at most 15 minutes of real time at 1×. Solo players can pause or play at
  0.5×, 1× or 2×.
- Target pacing is one PRIORITY or FLASH item every 15–30 seconds on average, and no more than one
  FLASH every 10 seconds.
- **AI difficulty**:

| Level | First move | Reaction interval | Logistics (CP income) | Behavior |
| --- | --- | --- | --- | --- |
| Recruit | after 25s | 15s | 50% | Cautious, rarely strikes |
| Veteran | after 8s | 7s | 80% | Balanced |
| Elite | after 2s | 3s | 100% (mirror strength) | Coordinated strikes, decapitation raids, hunts satellites |

A human acts on a handful of things at a time, so the lower levels compensate. The levels
were tuned with headless simulations of a player who follows ATLAS's recommendations.

---

## 10. Multiplayer (human vs human)

- **Create room** returns a 5-letter code and a share link. The guest joins with the code or the link.
- The match starts when both players are connected and the host presses **Start**.
- The server runs the authoritative simulation. Each client receives only its own faction's
  fog-of-war view.
- Speed is fixed at 1× and there is no pause. If a player disconnects for more than 60s, they forfeit.

---

## 11. Accessibility and quality bar

- Color is never the only signal. Severity also uses icons and labels (▲ FLASH, ● PRIORITY,
  ○ ROUTINE). The faction marker shape differs too: friendly units are circles and hostile
  units are diamonds.
- Text contrast is at least 4.5:1. Every button has a label or an `aria-label`. The brief is an ARIA live region
  (polite, assertive for FLASH).
- `prefers-reduced-motion` disables camera fly animations and pulsing.
- Performance: 60fps map rendering with 150 or more markers on a mid-range laptop, and 30fps or better on a
  mid-range phone. The first load is under 400KB gzipped, excluding the high-detail coastline file.

---

## 12. Virality hooks

- The map-first landing page shows the game working immediately.
- A shareable result line: *"Held 5/7 chokepoints and won by Decapitation at H+16:40. ATLAS
  filtered 1,912 reports down to 41. Can you command? war-room…"*.
- Challenge links (`?room=CODE`) for one-click human-vs-human matches.
- Short matches (15 minutes or less) and difficulty tiers for replay.

---

## 13. Out of scope (first release)

Playing as HYDRA in solo, more than two players, persistent accounts and leaderboards,
cyber or electronic-warfare domains, and replays.
