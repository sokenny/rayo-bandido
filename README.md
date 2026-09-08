# Rayo Bandido

Browser arcade drift game. Drive an outlaw combustion GT86-like coupe through a dark JDM x cyberpunk
city, drift to charge lightning, fire it at the electric cars that replaced everything else, get paid.

Desktop browser with a keyboard or a pad — and a phone, held sideways, with the on-screen pad
(see [Phones](#phones)). Two ways in from the main menu:

- **Open World** — Bandido Bay, the big free-roam city, **and everybody else who is in it**: a
  viaduct on pillars round the whole map and out over the bay, four ramps, a skyway that climbs to
  24 m between the towers, a diagonal avenue, alleys, a screen-covered square, thirteen electric
  cars (four of them lapping the viaduct). There is no lobby and no code — every server holds one
  permanent city and picking OPEN WORLD drops you straight into it, up to eight cars at a time,
  each a different colour. See [The open world](#the-open-world).
- **Race** — the *Bandido Grid*, a 1.5 km street circuit cut through that same city: downtown,
  the waterfront and the viaduct out over the bay, barriered on both sides, two laps of roughly
  two minutes. Checkpoints keep the laps honest. Picking RACE asks one more question — who else
  is on it:
  - **Offline** — the circuit on your own, against the clock.
  - **Versus** — the same two laps against up to three friends. Open a room and send the link it
    gives you; leave it public for anyone on the server to join, or untick that and only the
    people you sent it to are on the grid. See [Multiplayer](#multiplayer).

Two more worlds are still built, and reached by address rather than by menu: `?mode=race` is the
*Bandido Loop*, the original 1.4 km standalone circuit (see [Race mode](#race-mode)), and
`?mode=test` is the original free-roam city block — drift plaza, highway, JDM alley, six
patrolling electric cars.

## Run

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 for the main menu. The chosen world lives in the URL (`?mode=city`,
`?mode=test`, `?mode=race`, `?mode=circuit`, `?race=1` for the race menu, or `?mp=1` for a versus
room), so a world can be opened directly and a room link can
be shared — `?mp=1` alone opens the room browser, `?mp=1&room=K7QP` goes straight into a room.
`?mode=circuit` is RACE > OFFLINE: the Bandido Grid on your own, which is how you practise it and
how the QA and perf scripts drive it. `?mode=race` is still the Bandido Loop, which is what the
perf gate measures.
`?mode=city` joins the shared open world; add `&solo=1` for a city with nobody else in it, which
is what the capture and QA scripts use.
Append `?debug=1` to start with the performance overlay open, and `?scale=1` (any 0.7-1.5) to pin
the render scale instead of letting the resolution governor pick it. For multiplayer use
`npm run dev:mp`, which starts the match server alongside Vite.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run dev:mp` | Multiplayer development: the Vite dev server **and** the match server together. Open `?mp=1` in one window, make a room, open its link in a second window to race yourself |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build on 127.0.0.1:4173 |
| `npm run serve` | Match server on :8080, serving `dist/` and the socket on the same port. This is what a tunnel points at |
| `npm run host` | Build, then `serve`. One command to go from a change to something shareable |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests for the gameplay rules |
| `npm run qa` | Automated browser drive: drives, drifts, fires, saves screenshots + metrics to `artifacts/` (needs the dev server running and Chrome or Edge installed). Drives the test city; pass `--url http://127.0.0.1:5173/?debug=1&mode=race` for the circuit |
| `npm run qa:mp` | **Multiplayer QA.** Starts its own match server, launches two headless Chromes, walks them through the lobby and races them on cruise control, then reports what the two screens disagree about: traffic position error, cars off the circuit, rival smoothness frame by frame, and whether each player is the same colour on both screens. Writes `artifacts/qa-mp*.json` and a screenshot of each screen. Needs the dev server running; `--url` to point elsewhere |
| `npm run qa:mp:lag` | The same through an 80 ms (+20 ms jitter) relay with `--chaos`: each car rams an electric car and both fire lightning, so the shoves and kills the screens must agree about actually happen. Also counts a car flickering between destroyed and alive |
| `npm run perf` | Performance probe: startup breakdown, worst frame while each effect appears for the first time, shaders compiled per phase, CPU/GPU ms per frame. Writes `artifacts/perf.json`. `npm run perf:headed` for vsync-limited numbers. `--mode race` probes the circuit; `--url http://127.0.0.1:4173/?debug=1&mode=test` probes the production build |
| `node scripts/track-preview.mjs` | Circuit design tool: prints the lap's straights, corners and an estimated lap time, and writes a top-down SVG of `src/world/raceSpec.ts` to `artifacts/track-preview.svg` |
| `node scripts/circuit-preview.mjs` | The same for the city circuit (`src/world/circuitSpec.ts`): lap length, corners, climb, estimated lap time, the largest radius each corner will take, and whether the whole ribbon — edge to edge, at its own height — stands on a real city road. Writes `artifacts/circuit-preview.svg` |
| `npm run perf:check` | **Perf gate.** Builds, serves `dist/` itself, probes it twice and fails on regressions that do not depend on the machine: any shader compiled mid-play, a frame over 33 ms while an effect first appears, more than 60 draw calls or 200k triangles, over 4 ms of main-thread work per frame, console errors. Run it before merging anything that touches rendering |

## Performance

Rules of the road are in `AGENTS.md`; the measured state is in `docs/PROGRESS.md`. The foundations:

- **Loading screen + warm-up** (`src/render/warmup.ts`): every shader is compiled and every texture
  and buffer uploaded behind the loading screen, including the effects that start hidden. Nothing
  compiles mid-play, so the first drift, boost and shot do not hitch. `npm run perf` proves it:
  `programs` must not grow after the `idle` phase.
- **Resolution governor** (`src/render/adaptiveResolution.ts`): the render scale starts at
  `min(devicePixelRatio, 1.5)` and steps down while the display is dropping frames on the GPU, then
  back up with measured headroom. It never reacts to CPU-bound frames or one-off hitches.
- **Debug overlay** (F3): FPS, avg/worst frame, `cpu sim/render` ms, `gpu` ms from a timer query,
  draw calls, triangles, program count, render scale. If `prog` rises during play, something
  compiled a shader mid-game; fix it in the warm-up.
- **Budgets**: ~30-50 draw calls, ~17k triangles in the test city and ~38k on the circuit, no
  per-frame allocation in sim, FX or HUD.
- **Regression gate**: `npm run perf:check` (thresholds in `CHECKS` at the top of
  `scripts/perf-probe.mjs`). Unit tests cannot drive a GPU, so this is the performance test. It
  judges invariants, never absolute FPS: headless Chrome is not vsync-limited and GPUs differ.
  Timing checks must fail in both runs to count; program-count and budget checks are strict.
  `?nowarm=1` skips the warm-up and is the gate's negative test (it must fail).

## Controls

| Key | Action |
| --- | --- |
| W / S or Up / Down | Throttle / brake (brake at standstill reverses). Braking mid-drift is a left-foot brake: it loads the front and tightens the line toward the apex rather than snapping the car straight |
| A / D or Left / Right | Steer. Throttle or steering holds a slide; counter-steering out of it recovers grip, and releasing everything regrips within about 1.5 s |
| Space, `/` or numpad 0 | Handbrake (kick the rear out to start a drift). `/` and numpad 0 are there for keyboards whose matrix ghosts Up + Left + Space — see [Controls](#controls) note below |
| T | Automatic / manual transmission (remembered). On manual you keep the gear through a corner and the limiter caps you at that gear's top speed. The box sets the tacho, the engine note and the limiter — it does not change how the car slides |
| X / Z | Shift up / down (manual). On a pad: RB / LB |
| Shift | Nitro (recharges gradually while driving) |
| E or left click (**hold**) | Charge and throw the lightning. It reaches further the longer you hold, up to 75 m at 1 s, and leaves when you let go — hold past a second and it simply waits at full reach. The bolt flies straight down the car's heading and hits nothing you have not lined up |
| R | Instant restart (in a race: back to the grid and a new countdown; in a multiplayer race: a rescue back onto the road at the last gate, clock still running) |
| C | Cruise mode: the car drives itself around the city (or the lap) at a relaxed pace. Any driving input hands control back |
| Esc | Back to the main menu |
| F3 or ` | Toggle the debug overlay (FPS, draw calls, triangles) |

Every action is bound to both hand positions at once, so you can swap between WASD and the
arrows mid-race without a settings screen.

> **If the handbrake stops responding while you are cornering**, your keyboard is ghosting, not
> dropping inputs in the game. Membrane keyboards wire their keys as a scan matrix, and certain
> three-key combinations share enough matrix lines that the third keypress is never reported to
> the OS at all — Up + Left + Space is a common one. The signature is that the same combination
> works on the other side (Up + Right + Space) and starts working again the moment you release
> one of the three. Three fixes, in order of effort: drive with WASD, which keyboards are
> explicitly designed to keep clean with Space; use `/` or numpad 0 for the handbrake instead;
> or use a keyboard with n-key rollover, which most mechanical boards have.

On a phone the same actions are on the on-screen pad — see [Phones](#phones).

## Phones

A phone gets the game turned sideways and a thumb pad, and nothing else changes: same city,
same physics, same HUD.

- **Landscape without asking.** The menus stay portrait, but the moment a world loads the whole
  game layer is rotated a quarter turn in CSS while the handset is held upright, so turning the
  phone sideways shows a picture that is already the right way up. The web cannot request an
  orientation outside fullscreen (and never on iOS), so the rotation is ours, not the OS's:
  `src/ui/viewport.ts` owns it, and the renderer and camera take their size from it rather than
  from the window.
- **Basic controls only** (`src/ui/touchControls.ts`): steer left / right, gas, brake, handbrake,
  nitro, and a small restart in the top-left corner. **Tapping anywhere else on the screen fires
  lightning** — the empty middle of the screen is the fire button, held the same way E is. Camera, cruise and the gearbox
  stay on the keyboard: a thumb pad with a control for everything is a control for nothing.
- **The HUD is trimmed to what is read while driving.** Only the lightning charge ring — moved up
  clear of the steer buttons — and the minimap, two fifths smaller and up in the top-right corner.
  The key legends, the money column (¥, destroyed, near misses, targets left) and the whole
  rev-counter cluster are hidden: the pad is the legend, and the gauges sat exactly where the GAS
  and BRAKE buttons are.
- The pad is an `InputSource` like the keyboard and the gamepad, combined in `src/game.ts`, so the
  simulation never learns which one is driving.
- `?touch=1` forces the phone treatment on a desktop browser and `?touch=0` turns it off, which is
  how it is tested without a handset.

## Race mode

RACE in the menu is the **Bandido Grid**, a lap of the open-world city — alone (OFFLINE) or
against a grid (VERSUS); see [The city circuit](#the-city-circuit) below. The **Bandido Loop**,
the standalone circuit RACE used to open, is still built and still driven by `?mode=race`; it is
what the perf gate measures. The rules below are the same on both.

Three-second countdown on the grid, then laps through five gates: the start/finish line and
four checkpoint arches, crossed in order. A gate crossed backwards has to be crossed again, and the
line re-crossed backwards takes the lap back, so reversing cannot mint laps. The two alleys leave
the main road on the outside of a corner, just where the guardrail starts to bend away, and rejoin
it after the bay they bypass; neither skips a gate, so they are legal. The HUD shows lap, total
time, last/best lap, checkpoint splits, a WRONG WAY warning and the results at the flag. The
minimap (top right) shows the lap, the line and the checkpoints, the electric cars and you; the
alleys are deliberately not drawn.

Both circuits are two laps. The circuit is data:
`src/world/raceSpec.ts` is a polygon with a fillet radius, width and zone per corner. `src/world/track.ts` turns it into a sampled path, `src/world/raceWorld.ts` derives the wall
colliders, gates, grid, patrols and the city blocks around the road, and the renderer draws
asphalt, guardrails, lamps and the rest from the same data. Change the spec, run
`node scripts/track-preview.mjs`, look at the SVG, run `npm test`.

## The city circuit

**Bandido Grid** is not a separate map: it is the open-world city with a race drawn inside it.
One racing line, a holographic barrier down each side of it, two laps of about 1.5 km, roughly
two minutes. This is what RACE runs, whichever way you enter it: OFFLINE puts you on it alone,
VERSUS fills the grid.

A lap, in order:

1. up st-west and east along blvd-center — the tight bit, barriers close on both sides,
2. **north up av-main**, a 150 m straight between the skyscrapers of downtown,
3. east along blvd-north, still in downtown, then south down av-east and east on st-n2,
4. **the highway.** Up the east on-ramp onto the viaduct, fifteen metres over the city, down
   its east leg, round the big south-east sweeper and west along the deck **over the bay**,
5. down the south off-ramp onto the waterfront, and into turn one again.

Sixteen corners, none sharper than a right angle, a 30 m climb and drop every lap, and about a
third of the lap spent on the elevated highway.

**It is a ribbon, not a street plan.** The lap is a filleted racing line
(`src/world/circuitSpec.ts`) and the barrier is simply its two edges, span by span — two
continuous curves round the whole lap. No branch, no stub, nothing standing across the road:
every side street is closed because the barrier sweeps past its mouth. Each span carries the
height of the road at both ends, so the barrier climbs the on-ramp and rides the deck with the
car, and its collider is bracketed to that level so a barrier on the viaduct is not a wall in
the street underneath it.

Because the racing line is invented rather than borrowed, the thing that has to be checked is
that it stands on real asphalt: `node scripts/circuit-preview.mjs` walks the ribbon edge to
edge, at its own height, against every road in `citySpec.ts` — streets, ramps and the viaduct —
and prints the largest radius each corner will take before it runs off. `tests/circuitWorld.test.ts`
checks the same thing, plus that the barrier is unbroken, that no span is in a building, and
that the whole lap can be driven.

**The barrier is low and mostly light** — a knee-high kerb unit, a chevron pointing the way the
lap goes, a hairline along the top and a thin holographic curtain above it. The point of racing
here instead of on the Bandido Loop is that it is the city out there, so nothing in it stands
between the driver and any of it. Amber on the outside of a corner, cyan everywhere else.

**The city keeps running around it.** The street traffic and the buses come out — they follow
fixed routes and do not steer around anything, so they would drive through the barrier — and
are replaced with cars on the lap itself. The viaduct keeps its traffic, thinned to the file
that runs the way the race does, because the lap shares that deck with it.

`src/world/circuitWorld.ts` calls `createCityWorld()` unchanged and edits the instance it gets
back; nothing in `citySpec.ts` or `cityWorld.ts` knows the circuit exists. Change the lap, run
`node scripts/circuit-preview.mjs`, look at the SVG, run `npm test`.

## Multiplayer

Two shapes of it, on the same server and the same socket: one permanent **open world** everybody
shares, and as many **versus** race rooms as people want to open.

### The open world

Free roam is not single player any more. Every match server holds one city, on a reserved room
code, from the moment it starts — so picking OPEN WORLD in the menu joins whoever is already
driving around in it. Nothing to create, no code to hand out, no lobby to sit in: the plain URL
is the invitation, and the main menu says how many cars are out there before you commit.

Up to **eight cars**, each in its own colour, taken at the door and given back when you quit. The
roster under the minimap says who is online and what colour they are; the minimap shows them as
dots in those colours; each car carries its name plate. Cars are solid here too, so you can shove
a friend off the viaduct. The electric-car traffic belongs to whoever has been connected longest
and is relayed to everyone else, exactly as in a race, so all eight screens agree about what is
on the road; when that player quits, the next-longest-connected one takes it over.

Nothing is timed and nothing is scored against anybody: there is no flag, no laps and no
classification. **R is a rescue**, not a restart — it puts your car back where you came into the
city rather than resetting a world other people are in.

If the server cannot be reached, the city is still a city: the game says so and drops you into it
alone. `?mode=city&solo=1` asks for that outright.

### Racing your friends

```bash
npm run host
```

That builds the game and starts one Node process on port 8080 which serves both the game and
the match socket. Then point a tunnel at it and send people the URL:

```bash
ngrok http 8080
```

Send the plain ngrok URL and whoever opens it can pick OPEN WORLD and be in the same city as you.
For a race instead, open that URL with `?mp=1` on the end — `https://something.ngrok-free.app/?mp=1`
— and you land on the **room browser**. Make a room, and the lobby shows the link to hand out, with a
**COPY** button next to it: it is the same URL with your room's code on it, and only that link
(or the code typed into the browser screen) puts a car in your room. That is the whole setup:
because one process serves the page and accepts the socket, the game connects back to whatever
address it was loaded from, so nothing has to be configured and nothing has to be redeployed
when the tunnel URL changes.

On a free ngrok tunnel your friends will see an interstitial warning page once; they click
through it and land in your lobby.

### Rooms

One server holds many rooms, so "clicking VERSUS first" no longer decides anything. The open world
is a room on that same server, but it is a place rather than a match, so it is kept out of this
list and reached from the main menu instead. The browser screen has three ways in:

- **MAKE A ROOM** — name it, and you get a four-character code (no I, O, 0 or 1 in it, because
  codes get read aloud). You are its host. **LIST IT PUBLICLY** is ticked by default, so the room
  shows up in the list below; untick it before creating and the room appears in no list at all,
  and the link is the only door.
- **HAVE A CODE?** — type the four characters a friend sent you.
- **PUBLIC ROOMS** — the rooms that ticked the box, with how full each one is and whether it is
  racing. The list refreshes while you look at it.

URLs, if you want to skip the screen: `?mp=1&room=K7QP` goes straight in and is what the COPY
button gives you; `?mp=1&create=1` opens a fresh room (`&listed=0` makes it private); and
`?mp=1&room=K7QP&create=1` joins K7QP or re-opens it under that code if it has since closed —
a link that keeps working, which is what the multiplayer QA harness uses.

A room is reaped two minutes after the last player leaves, so reloading or quitting to the menu
together does not lose the code. One server will hold 64 rooms before it starts turning
`create` away.

### The lobby

Type a name, and everyone in the room sees everyone else. The first person to connect to a room
is its **host**: they press START RACE (or ENTER), and everybody's circuit is built at once. The
server waits for the slowest machine to finish building, then picks one instant for GO and tells
every client in its own clock, so the grid launches together however far apart the players are.
READY is a signal to the host, not a gate — the host can start whenever they like, including
alone. If the host leaves, the next-longest-connected player takes over.

A room holds four; a fifth connection is turned away with "the room is full", and a code nobody
is hosting is turned away with "no room called K7QP". Someone who arrives mid-race waits in the
lobby and is on the grid for the next one. At the flag everyone lands back in the lobby with the
classification, and the host can start another race. ESC leaves the room and goes back to the
browser screen, not out of multiplayer.

### In the race

Every car in a match — yours included — is painted in its grid slot's colour: cyan, magenta,
acid, amber, with a colour strip along its sills and a bar across its roof. You are the same
colour on your own screen as on everybody else's, so "the magenta car" means the same driver to
everyone. Rivals also carry a name plate floating over them, a dot in their colour on the
minimap, and a row in the live standings under the minimap showing the gap in metres. Your own
minimap arrow is your colour too. **Cars are
solid**: you can lean on someone into a corner, and they can put you into a guardrail. Lightning
still charges from drifting and still kills electric cars for money, but it cannot be fired at
another player — the race is about driving.

**R is a rescue, not a restart.** Restarting would reset your race while everybody else kept
going, so in a match R puts you back on the road just past the last gate you crossed, with the
clock still running. ESC leaves the match and goes back to the main menu.

### How it works, and what that costs

Every browser simulates its own car and publishes it 20 times a second; the server relays and
owns the clock. Nothing about your own driving waits for the network, so the car feels exactly
as it does in single player. Rivals are drawn 110 ms in the past between two real samples, which
buys smooth motion for a small fixed amount of lag.

Two consequences worth knowing:

- **A hard hit does not look identical on both screens.** Each client can only move its own car,
  so each driver sees themselves knocked off line by a car that, on their screen, held its own.
  Both halves add up to a clean separation; the alternative was a server owning the physics and
  giving everyone input latency.
- **It is cheatable.** Lap times and positions are whatever a client says they are. It is a game
  for a lobby of friends and the trust model is written down in `src/net/protocol.ts`. Do not put
  anything you care about behind those numbers.

The twelve electric cars are the one thing that is not per-client: the host's browser owns them
and publishes them 10 times a second, and everyone else runs the same deterministic patrol and
eases their copy onto the host's, so the whole field dodges the same traffic. That keeps
`server/` a pure relay — it has no physics, no rules and no idea what the circuit looks like.
Each report is compared with the receiver's copy *at the moment the report was taken*, not with
where it has moved to since, so latency does not turn into a permanent tug backwards; the report
carries each car's patrol waypoint and knock velocity, so the two simulations steer for the same
corner; and a kill or a shove you make yourself stays yours until the host has had a round trip
to agree, instead of flickering back. A shoved electric car is stopped by the guardrails like
any other car, so it can no longer be punted out of the circuit.

### Layout

| File | Role |
| --- | --- |
| `server/index.mjs` | HTTP for `dist/` and `GET /rooms` + the `/ws` upgrade, on one port |
| `server/rooms.mjs` | The registry: which rooms exist, who may open one, when an empty one is reaped |
| `server/room.mjs` | One room: roster, host, ready flags, the phase machine, the clock, the classification |
| `server/protocol.mjs` | Copy of the wire contract, kept honest by `tests/protocol.test.ts` |
| `src/net/protocol.ts` | The wire contract itself, and the trust model |
| `src/net/connection.ts` | The socket, and the estimate of the server's clock |
| `src/net/session.ts` | The room as the game sees it. The only thing outside `src/net/` that anything imports |
| `src/net/rivals.ts` | Snapshots back into moving cars |
| `src/sim/rivalCollision.ts` | Contact between two players' cars |
| `src/sim/traffic.ts` | Folding the host's electric cars into the local copy |
| `src/ui/rooms.ts` | The room browser: make one, type a code, or join a public one |
| `src/ui/lobby.ts`, `src/ui/standings.ts`, `src/render/nameTags.ts` | Lobby and results, live classification, floating names |
| `src/render/scene/rivalCarVisual.ts` | The rival car: the same coupe in five draw calls |

`npm test` covers the rules and the interpolation without a socket; `tests/matchServer.test.ts`
starts a real server on a real port and drives it with real WebSocket clients.

## Loop

Nitro gives speed. Drifting charges the lightning. Lightning destroys electric cars. Destroyed cars pay money.
On the circuit, the same loop runs inside a timed race: the electric cars are traffic ahead of you.

## Project layout

See `docs/PROGRESS.md` (architecture table, current state, measurements) and `AGENTS.md` (rules).
Product and scope documents live in `docs/`. Reference images and the unoptimized source model live in
`assets/` (the source GLB is never loaded at runtime).
