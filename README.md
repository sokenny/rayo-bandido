# Rayo Bandido

Browser arcade drift game. Drive an outlaw combustion GT86-like coupe through a dark JDM x cyberpunk
city, drift to charge lightning, fire it at the electric cars that replaced everything else, get paid.

Desktop browser with a keyboard or a pad — and a phone, held sideways, with the on-screen pad
(see [Phones](#phones)). Three ways in from the main menu:

- **Test** — the free-roam city block: drift plaza, highway, JDM alley, six patrolling electric cars.
- **Race** — the *Bandido Loop*, a 1.4 km street circuit for 2-lap races of about a minute and a
  half: a highway straight to empty the nitro on, chained sweepers to drift through (no corner
  sharper than 60 degrees, none tighter than 36 m), two city "bays" with tighter streets, and two
  hidden alley shortcuts. Electric cars patrol the lap ahead of you. Checkpoints keep the laps
  honest; the clock is the opponent.
- **Versus** — the same circuit against up to three friends. Open a room and send the link it
  gives you; leave it public for anyone on the server to join, or untick that and only the people
  you sent it to are on the grid. See [Multiplayer](#multiplayer).

## Run

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 for the main menu. The chosen world lives in the URL (`?mode=test`,
`?mode=race`, or `?mp=1` for multiplayer), so a world can be opened directly and a room link can
be shared — `?mp=1` alone opens the room browser, `?mp=1&room=K7QP` goes straight into a room.
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
| W / S or Up / Down | Throttle / brake (brake at standstill reverses). Mid-drift, tap the throttle to hold the needle in the tacho's torque band: pinned, the car over-revs and walks out; lifted, it regrips |
| A / D or Left / Right | Steer. Released in a slide, the wheel self-steers to counter-steer (watch the wheel glyph by the gear). Hold the arrow into the slide too long and the car spins; tap it to hold an angle |
| Space | Handbrake (kick the rear out to start a drift). Full lock plus a tapped throttle from a standstill is a first-gear donut — on the manual box; the automatic shifts up from under it |
| T | Automatic / manual transmission (remembered). Manual is the drifting box: you keep the gear, so the engine can sit in the torque band at any speed |
| X / Z | Shift up / down (manual). On a pad: RB / LB |
| Shift | Nitro (recharges gradually while driving) |
| E or left click | Fire lightning at the nearest electric car in the forward cone |
| R | Instant restart (in a race: back to the grid and a new countdown; in a multiplayer race: a rescue back onto the road at the last gate, clock still running) |
| C | Cruise mode: the car drives itself around the city (or the lap) at a relaxed pace. Any driving input hands control back |
| Esc | Back to the main menu |
| F3 or ` | Toggle the debug overlay (FPS, draw calls, triangles) |

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
  lightning** — the empty middle of the screen is the fire button. Camera, cruise and the gearbox
  stay on the keyboard: a thumb pad with a control for everything is a control for nothing.
- The pad is an `InputSource` like the keyboard and the gamepad, combined in `src/game.ts`, so the
  simulation never learns which one is driving. The HUD's key legend hides itself while it is up.
- `?touch=1` forces the phone treatment on a desktop browser and `?touch=0` turns it off, which is
  how it is tested without a handset.

## Race mode

Three-second countdown on the grid, then two laps through five gates: the start/finish line and
four checkpoint arches, crossed in order. A gate crossed backwards has to be crossed again, and the
line re-crossed backwards takes the lap back, so reversing cannot mint laps. The two alleys leave
the main road on the outside of a corner, just where the guardrail starts to bend away, and rejoin
it after the bay they bypass; neither skips a gate, so they are legal. The HUD shows lap, total
time, last/best lap, checkpoint splits, a WRONG WAY warning and the results at the flag. The
minimap (top right) shows the lap, the line and the checkpoints, the electric cars and you; the
alleys are deliberately not drawn.

The circuit is data: `src/world/raceSpec.ts` is a polygon with a fillet radius, width and zone per
corner. `src/world/track.ts` turns it into a sampled path, `src/world/raceWorld.ts` derives the wall
colliders, gates, grid, patrols and the city blocks around the road, and the renderer draws
asphalt, guardrails, lamps and the rest from the same data. Change the spec, run
`node scripts/track-preview.mjs`, look at the SVG, run `npm test`.

## Multiplayer

Up to four cars on the Bandido Loop, in as many rooms as people want to open.

### Racing your friends

```bash
npm run host
```

That builds the game and starts one Node process on port 8080 which serves both the game and
the match socket. Then point a tunnel at it and send people the URL:

```bash
ngrok http 8080
```

Open the ngrok URL with `?mp=1` on the end — `https://something.ngrok-free.app/?mp=1` — and you
land on the **room browser**. Make a room, and the lobby shows the link to hand out, with a
**COPY** button next to it: it is the same URL with your room's code on it, and only that link
(or the code typed into the browser screen) puts a car in your room. That is the whole setup:
because one process serves the page and accepts the socket, the game connects back to whatever
address it was loaded from, so nothing has to be configured and nothing has to be redeployed
when the tunnel URL changes.

On a free ngrok tunnel your friends will see an interstitial warning page once; they click
through it and land in your lobby.

### Rooms

One server holds many rooms, so "clicking VERSUS first" no longer decides anything. The browser
screen has three ways in:

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
