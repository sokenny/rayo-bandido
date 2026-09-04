# Rayo Bandido

Browser arcade drift game. Drive an outlaw combustion GT86-like coupe through a dark JDM x cyberpunk
city, drift to charge lightning, fire it at the electric cars that replaced everything else, get paid.

Single player, desktop browser, keyboard. Two worlds from the main menu:

- **Test** — the free-roam city block: drift plaza, highway, JDM alley, six patrolling electric cars.
- **Race** — the *Bandido Loop*, a 1.4 km street circuit for 2-lap races of about a minute and a
  half: a highway straight to empty the nitro on, chained sweepers to drift through (no corner
  sharper than 60 degrees, none tighter than 36 m), two city "bays" with tighter streets, and two
  hidden alley shortcuts. Electric cars patrol the lap ahead of you. Checkpoints keep the laps
  honest; the clock is the opponent. Multiplayer races on this circuit are the next step.

## Run

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 for the main menu. The chosen world lives in the URL (`?mode=test` or
`?mode=race`), so a world can be opened directly and a race link can be shared later. Append
`?debug=1` to start with the performance overlay open, and `?scale=1` (any 0.7-1.5) to pin the
render scale instead of letting the resolution governor pick it.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build on 127.0.0.1:4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests for the gameplay rules |
| `npm run qa` | Automated browser drive: drives, drifts, fires, saves screenshots + metrics to `artifacts/` (needs the dev server running and Chrome or Edge installed). Drives the test city; pass `--url http://127.0.0.1:5173/?debug=1&mode=race` for the circuit |
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
| W / S or Up / Down | Throttle / brake (brake at standstill reverses) |
| A / D or Left / Right | Steer |
| Space | Handbrake (kick the rear out to start a drift) |
| Shift | Nitro (recharges gradually while driving) |
| E or left click | Fire lightning at the nearest electric car in the forward cone |
| R | Instant restart (in a race: back to the grid and a new countdown) |
| C | Cruise mode: the car drives itself around the city (or the lap) at a relaxed pace. Any driving input hands control back |
| Esc | Back to the main menu |
| F3 or ` | Toggle the debug overlay (FPS, draw calls, triangles) |

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

## Loop

Nitro gives speed. Drifting charges the lightning. Lightning destroys electric cars. Destroyed cars pay money.
On the circuit, the same loop runs inside a timed race: the electric cars are traffic ahead of you.

## Project layout

See `docs/PROGRESS.md` (architecture table, current state, measurements) and `AGENTS.md` (rules).
Product and scope documents live in `docs/`. Reference images and the unoptimized source model live in
`assets/` (the source GLB is never loaded at runtime).
