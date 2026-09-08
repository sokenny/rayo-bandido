# Progress log

## Current state (2026-09-03, handoff from the Fable lead session)

The complete day-one loop runs in the browser with real art: drive the GT86-like proxy through the
JDM x cyberpunk arena, handbrake into a drift, charge the lightning, lock and fire at a patrolling
electric car, watch it die, get paid, press R. Typecheck, 53 unit tests and the production build are
green. The session was stopped by Juan before the final tuning and QA pass; the pending items below
are the next work, in priority order.

## Local run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 (add `?debug=1` for the performance overlay).

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, 24 files: the gameplay rules, the three worlds' contracts (arena, race circuit, the City), track geometry and heights, net protocol |
| `npm run build` | Typecheck + production build to `dist/` (606 kB JS, 165 kB gzip) |
| `npm run preview` | Serve `dist/` on 127.0.0.1:4173 |
| `npm run qa` | Headless Chrome drive of the whole loop; writes `artifacts/*.png` and `artifacts/qa-metrics.json` (needs the dev server running) |
| `npm run qa:headed` | Same, in a visible Chrome window (use this for a real, vsync-limited FPS number) |

Controls: WASD / arrows drive, Space (or `/` or numpad 0) handbrake, Shift nitro, E or left click fires lightning,
R restarts, M mutes audio, F3 or backquote toggles the debug overlay, F4 reads the world
coordinate under the crosshair and copies the whole readout to the clipboard.

The debug overlay's second block is a world readout in the same metres every spec in
`src/world` is written in (x east, z south, y up, heading 0 = north): the car, the camera, the
ground point under the crosshair, and - on F4 - the visible surface there, named by the collider
it belongs to (`blk-38 [-52..-36 x -50..-24]`). Use it to report a place by coordinate instead
of by description. `window.__rb.where()` returns the same reading to a script.
Gamepad (Xbox-style, standard mapping) follows NFS Underground 2's default layout: RT throttle,
LT brake/reverse, left stick or d-pad steers, A handbrake, B nitro, Y camera. What NFSU2 has no
counterpart for takes the buttons it leaves free: X lightning, View cruise, Start restart. The
pad and the keyboard are both live at once - no setting to flip - and A/Start confirms in the
main menu and the lobby. The
browser only reveals a pad after the first button press on it, so it starts working as soon as
it is used. Typing a room code still needs a keyboard. Browser automation hook: `window.__rb`
(`state`, `layout`, `metrics`, `inject(partialCommand, ticks)`, `pending()`).

Node was not installed on this machine; Node 24.19 LTS was installed via winget during the session.
It is on PATH for new shells; an already-open shell may need `$env:PATH = "C:\Program Files\nodejs;" + $env:PATH`.

## PENDING ITEMS (do these next, in order)

1. **Re-run the QA drive after the script patch.** `scripts/qa-drive.mjs` was patched at the very end
   (waits for `__rb.pending()` to drain between phases, teleports the lightning check into the open
   plaza, gentler drift input) but was NOT re-run afterwards. Start `npm run dev`, run `npm run qa`,
   confirm every check passes (the previous run failed only `nitroRecharges`, caused by the script
   reading state before its queued input had finished, not by the game). Then run `npm run qa:headed`
   and record the FPS numbers below.
2. **Chase-camera occlusion.** `artifacts/05-lightning.png` (pre-patch run) shows a building between
   the camera and the car after a QA teleport next to a block. Add a 2D segment-vs-AABB test in
   `src/render/camera/chaseCamera.ts` from the car to the ideal camera position against
   `layout.colliders` (add an optional `setObstacles(boxes: ObstacleBox[])` to `ChaseCamera`, wire it
   once in `src/game.ts`) and pull the camera in to the hit point minus ~0.5 m. Also worth testing by
   reversing into a wall.
3. **Hand-feel pass on the drift.** The vehicle controller has 15 headless tests (0-100 km/h in 3.95 s,
   handbrake flick to ~36 deg slip, drift active in ~0.28 s, charge 50 in ~3 s, regrip in 0.42 s) but
   nobody has driven it with a keyboard yet. The scripted full-lock drift in `03-drift.png` reached
   81 deg slip and scrubbed to a stop; decide whether that is the intended "abusive input" ceiling or
   too loose. Levers in `src/config/tuning.ts`: `VEHICLE.powerSlideGain` (0.95, lower for less slide on
   sweepers), `spinGuardGain`, `driftStability`, `handbrakeYawKick`.
4. **Lightning arc legibility.** The 0.45 s arc never landed in a screenshot. Set charge to 100 via
   `__rb.state.lightning.charge = 100`, face a target, `__rb.inject({fire:true})`, and eyeball the arc
   in the in-app browser. Consider `LIGHTNING.arcDuration` 0.45 -> 0.6 and a bigger glow (`lightningArc.ts`).
5. **Visual tuning in a real browser.** Things every art agent flagged as unverified: `scene.environment`
   intensity (0.35, set in `environment.ts`) lifting the car and target materials; car livery
   `emissiveIntensity 0.14` and body `metalness 0.28 / roughness 0.38`; tire smoke point sprites
   vanishing when their center leaves the viewport (fix: optional `setCamera(camera)` on `EffectsSystem`
   and billboard quads); CJK sign glyphs fall back to tofu on machines without a Japanese font;
   `RENDER.fogFar` 230 -> ~280 for a more present skyline.
6. **Five-minute soak.** Acceptance asks for responsiveness after five minutes of continuous play. The
   QA script only stresses for ~15 s (heap stayed ~18 MB, FPS unchanged). Extend the stress loop or
   play by hand and watch `heap` / `worst frame` in the overlay.
7. **P2 backlog:** placeholder WebAudio engine/tire/nitro/lightning sounds (RB-017), preview deployment
   (RB-018; no hosting credentials were found in the environment).

## Measurements so far

Machine: Windows 11 Home, Intel integrated graphics (ANGLE D3D11, device 0x7D67), Chrome 151.

| Context | FPS | Frame ms | Draw calls | Triangles | Heap |
| --- | --- | --- | --- | --- | --- |
| Headless Chrome 1600x900, driving (not vsync-limited, so not a final number) | avg 326, min 234 | 3.3 | 30 | 17,288 | ~18 MB |
| Headless, after 15 s drift/nitro/fire stress | 326 | 3.1 | 32-38 | 17,600-18,100 | ~18 MB |
| Placeholder-scene in-app browser (pre-art) | 238 | 4.2 | 22 | 624 | - |

Budget check: the whole scene is ~17-18k triangles and 30-38 draw calls, far under the 200k / performance
rules. Worst frame in headless runs was 54-83 ms, at startup while procedural textures are generated.
Real vsync-limited numbers on the in-app browser are still to be recorded (pending item 1).

## What each workstream delivered

| Workstream | Files | Result |
| --- | --- | --- |
| Lead: skeleton, contracts, loop, rules, integration | `src/core/**`, `src/config/tuning.ts`, `src/sim/{gameState,collision,nitro,lightning,targeting,targets,economy}.ts`, `src/render/{renderer,sync}.ts`, `src/game.ts`, `src/main.ts`, `scripts/qa-drive.mjs`, `tests/{math,rules}.test.ts` | Fixed 60 Hz sim, plain-data state, all gameplay rules with tests |
| Vehicle feel + camera (Opus) | `src/sim/vehicle.ts`, `src/sim/drift.ts`, `src/render/camera/chaseCamera.ts`, VEHICLE/DRIFT/CAMERA in `tuning.ts`, `tests/{vehicle,drift}.test.ts` | Stateless arcade controller with grip/drift blend, self-aligning yaw, spin guard; low chase camera with drift follow and FOV 60->70 |
| Environment (Opus) | `src/world/arenaLayout.ts`, `src/render/scene/environment.ts`, `src/render/scene/env/*`, `tests/arena.test.ts` | 240x240 m arena: corporate highway west, urban streets north/centre with 50x50 m drift plaza, JDM alley south-east; 17 AABB colliders, 6 patrol loops; 11.1k triangles, 15 draw calls, 2 lights, procedural textures |
| Car art (Opus) | `src/render/scene/carVisual.ts`, `src/render/scene/electricCarVisual.ts`, `src/render/scene/vehicles/*`, `tests/vehicleVisual.test.ts` | GT86-like lofted coupe with wide body, wing, diffuser, procedural livery, reactive underglow/exhaust/lights, instanced wheels (3,304 tris, 8 draw calls); white crossover targets with sag-on-hit and lock reticle (584 tris, 4 draw calls each) |
| FX (Opus) | `src/render/fx/*`, `tests/fx.test.ts` | Pooled tire smoke (220), skid marks (600 quads), nitro flames + trail, jagged lightning arc with branches and flashes, shock-ring explosion, collision sparks; 10 draw calls worst case, no per-frame allocation |
| HUD (Opus) | `src/ui/{hud,ringGauge,icons,debugOverlay}.ts`, `src/styles.css` | Floating HUD: cyan charge ring + READY, magenta nitro ring, speed, drift chip with chain decay, TARGET LOCKED reticle, yen counter with +100 flash, controls card that fades, cooldown arc; debug overlay with worst frame and heap |

## Architecture

| Layer | Files | Notes |
| --- | --- | --- |
| Contracts | `src/core/types.ts`, `src/core/math.ts` | Plain-data state, compass heading convention, no Three.js |
| Tuning | `src/config/tuning.ts` | Every gameplay constant |
| Loop | `src/core/loop.ts` | Fixed step, max 5 steps/frame, alpha for interpolation |
| Input | `src/core/input/keyboard.ts` | Keyboard -> `PlayerCommand`, edge-triggered fire/restart |
| World data | `src/world/arenaLayout.ts` | Roads, blocks, spawns, patrols and AABB colliders shared by sim and renderer |
| Simulation | `src/sim/*.ts` | `gameState.ts` orchestrates vehicle, collision, drift, nitro, targets, lightning, economy |
| Presentation | `src/render/**` | Renderer, environment, car proxy, electric cars, chase camera, pooled FX, `sync.ts` (only place mapping heading to Three rotation) |
| UI | `src/ui/*`, `src/styles.css` | DOM only, reads `HudSnapshot` and `GameEvent`s |
| Composition | `src/game.ts`, `src/main.ts` | Wires layers, exposes `window.__rb` |
| Networking | `src/net/*` | The socket, the server clock, the room, and rival interpolation. Nothing outside `src/net/` imports a socket |
| Match server | `server/*` | Plain JavaScript under Node: HTTP for `dist/` plus the `/ws` room, on one port. No physics, no rules, no knowledge of the circuit |

Multiplayer (delivered 2026-09-04): `PlayerCommand` is a serializable intent, `GameState` is plain
data, rules live in `src/sim`, and rendering and UI only read state — which is what made the
networked race a layer that could be added beside the game rather than through it. `createGame`
with no session behaves exactly as it did before. See the Multiplayer section in `README.md` and
the decisions table in `docs/DECISIONS.md`.

## Known risks

- Drift feel is verified only by headless tests and one scripted run; needs a human on a keyboard.
- Chase camera has no obstacle avoidance (pending item 2).
- The source GLB is never loaded; the proxy car is built from lofted primitives. No local decimation
  tool (gltfpack / gltf-transform) was installed.
- Headless FPS numbers are not vsync-limited; treat them as headroom, not the shipped frame rate.
- Multiplayer is a future requirement with no selected mode or networking model.

## Updates

### 2026-09-04 — Main menu, racing circuit ("Race"), race mode, minimap

- **Two worlds behind a main menu.** `src/main.ts` shows the menu (`src/ui/mainMenu.ts`) when
  the URL has no `mode`; picking Test or Race writes `?mode=` and reloads into that world, and
  Esc returns to the menu. A reload per world switch keeps disposal trivial and gives every
  world a shareable URL (a race lobby link later). `?mode=` also drives the QA and perf scripts
  (`--mode race` on the perf probe).
- **The circuit is data.** `src/world/raceSpec.ts` is a 17-corner polygon with a fillet radius,
  width and zone per corner, plus two open alley paths and five checkpoint points.
  `src/world/track.ts` (pure, no imports) builds the sampled path — straights and arcs, station,
  tangent, half width, curvature — and projects points onto it. Lap 1396 m, longest straight
  148 m (the west highway), corners between 36 and 110 m radius, no arc over 61 degrees (the
  brief forbade right-angle corners: every direction change is a chained sweeper). Estimated
  lap ~50 s at 105 km/h average; the autopilot's lap at 47 km/h takes 121 s. Two laps.
  `node scripts/track-preview.mjs` prints the geometry and writes `artifacts/track-preview.svg`.
- **World generation** (`src/world/raceWorld.ts`): ribbon edges become 800+ wall segments
  (a new `ObstacleWall` collider type, circle-vs-capsule in `src/sim/collision.ts`), with gaps
  wherever another ribbon runs through — that is how the alleys join; city blocks are a 46 m
  grid recursively split and dropped wherever a road plus a zone shoulder (9 m highway, 3.6 m
  city, 3 m old town, 1.2 m alley) cuts through, so the diagonal and curved roads read as
  avenues cut through a grid; the six electric cars patrol the lap itself, in the direction of
  travel and in alternating lanes, spread round the lap away from the grid; cruise mode
  follows the centreline.
- **Hidden shortcuts.** Each alley leaves the main road on the outside of a corner, exactly
  where the guardrail starts to bend away, runs behind the buildings across the mouth of a
  "bay" (a four-corner dip into the city), and rejoins after it: 167 m vs 199 m and 163 m vs
  197 m of main road, 8 m wide between 2.7 m concrete walls. A flickering blade sign marks each
  mouth; the minimap does not draw them.
- **Race rules** (`src/sim/race.ts`, `RaceState` in `GameState`, tuning in `RACE`): 3 s
  countdown with the car held on the handbrake (the orchestrator swaps in a hold command, so a
  future multiplayer host launches everyone on the same tick); gates crossed in order from the
  car's motion segment; a gate crossed backwards must be re-crossed, the line crossed backwards
  right after a lap takes the lap back; lap times, best/last, finish; `progress` in laps for
  ranking; wrong-way detection against the local tangent; shortcut-aware station. Events:
  raceCountdown/raceStart (with beeps), checkpoint (split), lapComplete, raceFinish, wrongWay.
- **Renderer refactor.** The environment now reads a `CityPlan` (`src/world/cityPlan.ts`):
  roads, ribbons, rails, blocks, walls, barriers, gates, billboards, cables, pylons, plaza, the
  WANTED board pose and the three placement predicates. `cityBuilder`, `propsBuilder` and the
  new `trackBuilder` (asphalt ribbon with station UVs, curve-following lane paint, one oriented
  box per rail collider — guardrail / jersey barrier / striped barrier / alley wall by zone —,
  lamps outside the rails, start gantry + checkered line, checkpoint arches, alley dressing)
  all draw from it; the test city's plan is built from the same ARENA_* rectangles as before,
  so it is unchanged. Still fifteen merged meshes: the circuit renders in 37-39 draw calls and
  ~38k triangles with the same 28 shader programs (nothing compiles mid-play), the test city
  in 34 draws / 15.8k triangles.
- **HUD + minimap.** Race readout (lap, total, last/best, splits), countdown, WRONG WAY, results
  panel; the controls card gained ESC. `src/ui/minimap.ts`: north-up canvas, roads drawn once
  into an offscreen layer, per-frame dots for the cars and a cyan arrow for the player, the line
  in magenta and checkpoints in cyan. Both worlds have one.
- **Automation.** `__rb.mode`, `__rb.step(ticks)` (advance the sim and render one frame — the
  in-app Browser pane throttles rAF when hidden, so scripted screenshots use this) and
  `__rb.teleport(x, z, heading)` (with a camera snap).
- **Tests**: 197 (was 165). New: `track.test.ts` (fillet geometry, projection, open paths),
  `race.test.ts` (countdown, laps, skipped checkpoint, backwards over the line, wrong way,
  progress), `raceWorld.test.ts` (design brief: length, radii, no 90-degree corner, straight
  length, widths, shortcut savings and gate placement; contract: road clear of colliders, rails
  never inside a road, alley mouths open, grid and patrols on the road; a full autopilot lap
  with zero wall contacts and every checkpoint), circuit environment budget.
- **Interpretation of the brief.** "90-degree turns forbidden" is read as no sharp corner:
  every corner is a fillet arc of ≥ 36 m radius and ≤ 61 degrees; direction reversals are
  chains of 45-60 degree sweepers with straights between them.
- **Perf gate** (`npm run perf:check`, production build, headless Chrome 1600x900, Intel
  integrated graphics, two runs each; headless is not vsync-limited so averages are headroom):

  | Map | Programs (start -> play) | Draws | Worst frame in play | Steady cpu sim + render | Steady gpu | Startup long tasks |
  | --- | --- | --- | --- | --- | --- | --- |
  | Test city | 28 -> 28 | 29-49 | 33 ms once (nitro, run 1 only), 29 ms | 0.02 + 0.6 ms | 2.3-2.6 ms | 356-627 ms |
  | Circuit | 28 -> 28 | 33-43 | 29 ms (first lightning) | 0.02 + 0.5 ms | 2.1-2.2 ms | 336-627 ms |

  Both pass: no mid-play shader compile, budgets kept, no console errors. The circuit's steady
  frame is cheaper than the city's despite 2.4x the triangles: fewer additive glow quads in view.
- Verification: `npm run typecheck`, `npm test` (197 passed), `npm run build`, the perf gate
  above, both maps and the menu checked in the in-app browser with no console errors (cruise
  mode drove a full counted lap in-browser: 121 s at 47 km/h, zero wall contacts).
- **Not done / next**: nobody has driven the circuit with a keyboard yet — the 90 s target is an
  estimate (`scripts/track-preview.mjs`: 50 s per lap at 105 km/h average; real players will
  brake more and nitro more), so expect to tune corner radii and widths in `raceSpec.ts` after
  a hand-feel pass. The alleys' risk/reward has the same caveat. Multiplayer: `RaceState` is
  plain data with `progress` for ranking and the countdown is a sim rule, but there is still no
  networking, no lobby and no remote cars; `RaceCourse.grid` has 8 slots ready for it.

### 2026-09-04 12:30 — Performance audit: loading screen, GPU warm-up, resolution governor, perf probe

- **Root cause of the early-frame glitches.** Three compiles a material's shader the first time an
  object using it is drawn, and most effects start hidden. So the first drift (smoke, skid marks),
  the first boost (flames, trail, speed blur) and the first shot (bolt, sparks, rings, score pop)
  each stalled for a compile; the sign atlas, sky cubemap and environment PMREM were built on the
  first frame; and the WANTED board re-rasterized its 1024 px canvas and re-uploaded it a moment
  after start when the portrait image arrived. Measured with the new probe on the previous commit:
  19 programs at start, 27 after the first shot, worst frame 33 ms during the first lightning.
- **Fix: loading screen + warm-up.** `index.html` carries a static loading screen (inline CSS,
  compositor-animated shimmer, so it paints before the bundle arrives and keeps moving while the
  city is built). `src/main.ts` boots in stages: build (`createGame`), `warmUp` (compile every
  material including hidden ones via `renderer.compileAsync`, wait for the portrait, one render with
  every object forced visible to upload buffers/textures and build the cubemaps, warm the speed-blur
  pass), then `start`. `src/render/warmup.ts`, `src/ui/loadingScreen.ts`. The billboard now draws
  its panel exactly once (`wantedBillboard.ready`, 2.5 s timeout).
- **Resolution governor** (`src/render/adaptiveResolution.ts`, `RENDER.*` in tuning, 11 tests):
  render scale starts at `min(dpr, 1.5)` and steps down x0.85 (floor 0.7) when the display drops
  frames on the GPU for 1.5 s; steps back up with measured headroom; ignores CPU-bound frames,
  hitches and the second after any change. `?scale=` pins it; `__rb.scale()` reads/sets it.
- **Measurement foundation.** `src/core/loop.ts` times sim and render per frame;
  `src/render/gpuTimer.ts` reads real GPU frame time via `EXT_disjoint_timer_query_webgl2`; the
  debug overlay shows `cpu sim/render`, `gpu`, program count and render scale. `npm run perf`
  (`scripts/perf-probe.mjs`) records startup long tasks and `performance.measure` stages, the worst
  frame while each effect first appears, programs compiled per phase and CPU/GPU ms; `--headed`
  for vsync-limited numbers, `--url` for the production build. `.claude/launch.json` gained a
  `rayo-bandido-preview` config.
- **Results** (Intel integrated graphics, Chrome 152, 1600x900; headless is capped at 240 Hz so
  averages are headroom, worst frames and program counts are the comparison):

  | | Before | After |
  | --- | --- | --- |
  | Programs compiled during play (after the first frame) | 8 (19 -> 27) | 0 (28 at start) |
  | Worst frame, first lightning shot | 33.3 / 16.7 ms | 8.3 / 8.4 ms |
  | Worst frame, first drift | 8.3 ms | 4.4 ms |
  | Worst frame over the whole scripted session | 33.3 ms | 12.5 ms (idle, right after the fade) |
  | Main-thread work before the first playable frame | 940 ms cold / 241 ms warm, on screen | 555-621 ms cold / 192 ms warm, behind the loading screen |
  | Steady state, production build | - | cpu 0.3 ms + gpu 2.4 ms per frame at scale 1.0, 28-48 draws, 16.5-17.3k tris |

  Start-up breakdown (prod, cold): renderer/context 175 ms, environment 54 ms, audio 45 ms,
  compile 218 ms, warm render 99 ms. All of it now happens under the loading screen.
- **QA script**: waits for `__rb.ready()`, and `accelerates` judges the fastest sample (the
  240-tick throttle ends exactly at the last sample). `driftActivates`, `chargeFromDrift` and
  `nitroRecharges` fail on this commit and on the previous one alike: the scripted drift inputs
  predate the current vehicle tuning (max slip 1.7 deg). Left for the drift hand-feel pass.
- **Perf gate**: `npm run perf:check` builds, serves `dist/`, probes it twice and fails on any
  mid-play shader compile, a frame over 33 ms in a play phase, more than 60 draws / 200k tris, over
  4 ms main-thread per frame, or console errors (`CHECKS` in `scripts/perf-probe.mjs`). Timing
  checks must repeat in every run to fail. Negative test: the gate against `?nowarm=1` fails with
  8 programs compiled mid-play. This is the performance regression test; vitest cannot drive a GPU.
- Verification: `npm run typecheck`, `npm test` (165 passed), `npm run build`, `npm run perf`
  on dev and on the preview build (2 runs each), `npm run perf:headed`, `npm run qa`; loading
  screen and game checked in the in-app browser with no console errors.

### 2026-09-03 20:25 — Near miss points (sim + hud + audio)

- New rule: shaving past an electric car at speed without touching it pays money. `src/sim/nearMiss.ts`
  owns it; `NEAR_MISS` in `tuning.ts` owns every number.
- How a pass works: it opens when the player comes inside `radius` (4 m centre-to-centre) of an active
  target and closes when they leave `exitRadius` (4.6 m, so skimming the edge cannot split one pass into
  two awards). The pass keeps its closest approach and the speed the player was doing **at that moment**
  (not the peak over the pass, so flooring it once the car is behind you does not pay). Touching the car
  voids the pass — a near miss has to be a miss.
- Closest approach is measured swept across the tick, not sampled at its end: at 50 m/s the car covers
  0.8 m per step, so an end-of-tick sample would make a graze a matter of luck instead of skill.
- Award: `10 + 40 * quality`, `quality = (closeness^1.5 * speed01^1.3)^1.35`, rounded, hard-clamped to
  10..50. Closeness saturates 0.15 m off the collision proxies; speed saturates at 52 m/s, which is above
  the un-boosted top speed. Measured: 3.5 m at 180 km/h = 14, 2.8 m = 31, 2.4 m = 48; 50 needs a graze
  **and** nitro, and even 2.35 m at 216 km/h came back 46 in the live app. 6 m pays nothing.
- Money flows through `applyRewards` like every other payout. `state.nearMiss` tracks count and best.
- Paid at the APEX of the pass (the tick the gap reopens by `apexSlack`), not on the way out of the
  radius. That is what makes the world-space pop possible: at the apex the shaved car is still
  alongside and on screen, where by the exit radius it is metres behind the camera. A pass that never
  shows an apex is still settled on the way out, and only leaving `exitRadius` re-arms it.
- Feedback, three layers: a cyan captioned `NEAR MISS / +43` pop floating next to the car that was
  just shaved (same pooled sprite as a kill pop — `scorePopup.ts` grew a `ScorePopupStyle`, so a kill
  is a bare acid number and a pass is cyan and captioned, one pool, one animation, different raster);
  a cyan `NEAR MISS +¥N` flash in the money column, drifting DOWN (kills rise) so the frequent
  near-miss flash never covers the counters; a `near miss N` counter in the meta row; and a doppler
  whoosh one-shot (`oneShots.nearMiss`) that gets louder, brighter and shorter with the quality.
- Verification: 22 tests in `tests/nearMiss.test.ts` (scoring curve, swept distance, apex timing, pass
  state machine, plus four end-to-end runs through the real `stepGame` and arena) and 2 more in
  `tests/fx.test.ts` for the popup styles. Confirmed live in the in-app browser at
  http://127.0.0.1:5173 — scripted passes at 2.4/2.8/3.5/6.0 m returned 48/31/14/0 points, money and
  the `near miss` counter moved, the award fired 1.3 m past the target (i.e. at the apex), and the
  `NEAR MISS +43` pop rendered in the world beside the passed car with the HUD flash below the money.
  (The preview pane keeps `document.hidden` true, which freezes rAF; the loop was driven by patching
  `requestAnimationFrame` onto `setTimeout` in the page for the duration of the test.)
- Not mine, seen in the tree while working: `tests/vehicleVisual.test.ts` "keeps the wheel contract and
  stays inside the budget" fails on a clean checkout too (draw calls 9 > 8), and `src/audio/tireScreech.ts`
  has a `Float32Array<ArrayBufferLike>` typecheck error from a concurrent session. Neither is touched here.

### 2026-09-03 20:45 — Nitro speed blur (fx)

- **What**: a radial (zoom) motion blur that opens up from the edges of the frame while the boost
  is lit, so the city tears past the car instead of merely moving faster. New
  `src/render/post/speedBlur.ts`, tuned by a new `SPEED_BLUR` block in `config/tuning.ts` and
  wired at the one place that used to call `renderer.render` (`game.ts`).
- **It smears the finished frame, and grades nothing.** The scene still renders straight to the
  canvas with its own tone mapping, additive blending and MSAA; the result is copied into a
  `FramebufferTexture` and averaged along the radial direction. The first cut did the textbook
  thing instead — scene into an HDR render target, tone mapped in the blur shader — and Juan
  immediately called it: the colour tone of the objects changed and it looked clunky and
  aggressive. Two causes, both real: Three turns tone mapping off when a scene renders into a
  render target, so the neon blending **and** the multisample resolve happened in linear light
  and were compressed afterwards, brightening every antialiased edge in the frame; and the pass
  was tinting the streaks violet on top of that. The tint is gone and the HDR buffer is gone.
- **Gated on boost *and* speed**: `speedBlurStrength(nitro, speed)` multiplies the already-eased
  `nitroVisual` (the same 0..1 that drives the tailpipe flames and the camera FOV punch) by a
  speed ramp from 18 to 37 m/s. Nitro held at a crawl does not blur — the effect sells speed, so
  speed has to earn it — and because it rides `nitroVisual` it fades in and out with the flames.
- **Readability first**: the smear is masked out of the middle of the frame (`centerClear`), so
  the car, the road ahead and the locked target stay sharp. The HUD is DOM and is never touched.
- **Cheap and optional**, per the performance rules: with the boost cold this is exactly the old
  `renderer.render` call and no texture is allocated at all. Boosting costs one full-screen copy
  and one full-screen triangle, 8 taps, +1 draw call. `renderer.info.autoReset` is turned off
  around the second pass so the debug overlay keeps reporting the scene's own numbers.
- Verification:
  - **Grade fidelity, measured.** In the sharp middle the smear amount is exactly zero, so the
    pass must reproduce the frame the game drew. Interleaved blur-off/blur-on captures (the scene
    animates constantly, so drift is averaged out) over a centred disc: blur-on differs from
    blur-off by mean signed RGB `[+0.02, -0.30, -0.35]` out of 255 and mean |Δ| 2.3, *less* than
    two blur-off frames differ from each other (`[-0.13, -0.19, -0.45]`, mean |Δ| 3.7). No shift.
    For reference the HDR version measured `[-1.3, +3.9, +4.5]` in the same sharp region.
  - Headless A/B from the same spawn pose: `artifacts/blur-ab/a-no-nitro.png` (139 km/h, cold) vs
    `artifacts/blur-ab/b-nitro.png` (206 km/h, boosting). Buildings streak, road and car sharp,
    colours unchanged, no console errors.
  - `npm run typecheck` clean, `npm test` 146 passed (4 new `speedBlurStrength` cases in
    `tests/fx.test.ts`). Cost at 1600x900 headless: ~7.9 ms/frame cold vs ~8.6 ms boosting.
- Not verified: how it feels on a real GPU with a human driving (the preview pane is hidden in
  this session, which pauses rAF), and whether `maxShift` 0.05 / `centerClear` 0.26 hold up at
  other aspect ratios. Both are one-line tuning.
- Pre-existing and untouched: `tests/vehicleVisual.test.ts` fails its 8-draw-call budget with 9.

### 2026-09-03 17:50 — Tire scrub rebuilt (audio)

- The old scrub sounded like riffling a deck of cards, and the cause was literally in the code: an
  **11 Hz amplitude tremolo** on broadband noise. ~11 Hz is about where the ear stops hearing a
  texture and starts hearing separate events. Measured on the old voice, the amplitude envelope
  had a single dominant spike at 11 Hz (depth 0.092, ~5x the next rate).
- Rebuilt `src/audio/tireScreech.ts` as three layers off the one noise loop:
  - **Scrub** (~220-520 Hz): the low roar of rubber tearing asphalt. The old "body" sat at
    1300-2100 Hz, which is hiss — there was no weight anywhere in the effect.
  - **Squeal**: noise through two bandpasses **in series** at the same frequency. Stacking them
    rings hard enough that the noise turns pitched (a howl, not a "shhh") while keeping real
    grain; a plain oscillator here sounds synthetic. Costs a lot of level, hence the big make-up
    gains.
  - **Partial** at a deliberately inharmonic 2.37x, because whole-number ratios sound musical.
- Pitch now wanders on an **aperiodic random walk driven from the frame update**, not an LFO —
  stick-slip in a real tire drifts continuously and never repeats on a clock. New envelope
  spectrum is flat: strongest rate 4 Hz at depth 0.040, with no peak standing out.
- New pure helper `squealHz(intensity, speedFrac)` in `dsp.ts` (speed raises the pitch only while
  actually sliding, so it is multiplied by intensity rather than added), with 4 unit tests.
- Level curve bent to `intensity^0.6`. A straight multiply left the most common state in play —
  a latched low-angle drift, which `skidIntensity` pins at its 0.35 floor — nearly inaudible.
- Verification: `npm run typecheck` clean, `npm run build` green (641 kB / 176 kB gzip);
  `npm test` 88 of 89 passed (4 new; the one failure is pre-existing). Rendered offline against a
  rebuild of the old voice for a like-for-like A/B — low-frequency content (below 800 Hz) went
  from a flat 10-15% at every angle to 62% on a tidy slide / 26% on a big one, i.e. it now
  changes character with angle instead of being hiss throughout. RMS: silent 0.0000 when
  gripping, 0.0133 at the drift floor (old: 0.0139, so no regression in the common case), 0.109
  at full slide (old: 0.049, +7 dB). Live in the in-app browser: a handbrake drift at 67 km/h ran
  34 frames with peak lateral 11.1 m/s — past `LATERAL_FULL`, so the full squeal was exercised —
  AudioContext `running`, no console errors.
- Not verified by ear (see the rAF note below); `AUDIO.tireVolume` (0.32) is the mix knob if the
  louder big-slide end sits too hot against the engine.

### 2026-09-03 18:05 — Turbo flutter only when it is earned (audio)

- Juan: the "stututu" was "almost always on", and a single one ran on for seconds. Both come from
  the same place — the old trigger was `prevThrottle - throttle > 0.35 && spool > 0.45` inside
  `engine.update`, i.e. a *rate of change of the pedal*. Arcade cornering is made of on/off
  tapping, so nearly every release qualified, nothing stopped two bursts overlapping, and the
  overlap is what reads as a continuous drone.
- New `src/audio/turboFlutter.ts` holds both halves, the way `backfire.ts` does:
  `createTurboFlutterTrigger()` (pure, allocation-free) and `fireTurboFlutter()` (the sound,
  moved out of `engine.ts`).
- The fix is to model the thing the sound is made of. `boost` is now a real state variable —
  it builds only under load (`SPOOL_UP` 0.55 s), bleeds off the throttle (`BLEED` 0.3 s), and is
  **vented by the flutter itself** down to `VENT_TO` (0.12). A surge needs all of: a snap drop
  (`LIFT_DROP` 0.35), a genuinely *shut* plate (`CLOSED_THROTTLE` 0.15 — trailing off to half
  throttle keeps the air flowing and stays silent), pressure behind it (`FIRE_BOOST` 0.45), and
  `MIN_INTERVAL` 1.1 s since the last one. Strength is how far past `FIRE_BOOST` the boost got,
  so a long pull into a corner sounds different from a short one.
- Gated on road speed (`MIN_SPEED_FRAC` 0.08 → `FULL_SPEED_FRAC` 0.3), not the engine note, for
  the same reason `backfire.ts` is: the fake gearbox sweeps past redline once per gear, so rpm
  would make a surge a coincidence of when you happened to lift. First tuning pass used 0.12/0.4
  with `FIRE_BOOST` 0.55 and measured **zero** flutters across 19 s of real driving — boost peaked
  at 0.51 because it needed ~63 km/h *and* a long pull; the current numbers ask for ~41 km/h and
  roughly a second on the gas.
- Burst length is now a time budget, not a chuff count: `chuffTimes(strength)` lays out chuffs
  until `MIN_BURST`..`MAX_BURST` (0.32 s → 0.85 s) is spent, so the burst is cut off at its
  allotted time instead of running as long as its chuffs happen to take. Measured 4 chuffs /
  0.24 s at the weak end, 9 / 0.73 s at full boost — under a second by construction, and a unit
  test pins it below `MIN_INTERVAL` so two can never overlap into the drone Juan heard.
- The same `boost` now drives the turbo whine, replacing the separate `spool` in `engine.ts` —
  one model, so the whine and the flutter can never disagree about how spooled the car is. The
  whine keeps a gear flavour by tinting its pitch with `rpm01`.
- Verification: `npm run typecheck` clean, `npm run build` green (642 kB / 176 kB gzip);
  `npm test` 110 of 111 passed (12 new flutter cases in `tests/audio.test.ts`; the one failure is
  the pre-existing draw-call budget in `tests/vehicleVisual.test.ts`). `node scripts/qa-drive.mjs`
  ran the whole loop with `noConsoleErrors` PASS. Live A/B in headless Chrome against the dev
  server, running a shadow copy of the real module on the real per-frame speed/throttle: over the
  same 17.7 s drive the old rule fired **9** times and the new one **4** — the three deliberate
  long-pull lifts at 74 km/h (boost 0.93, s=0.88) and the nitro lift at 151 km/h (boost 0.96,
  s=0.93), while a 12-tap chicane burst produced 12 closed-throttle lifts at boost 0.19-0.32 and
  **none** of them fired. AudioContext `running`.
- Not verified by ear (same rAF note as below). `AUDIO.turboFlutterVolume` (0.5) is the mix knob;
  `FIRE_BOOST` is the one to move if it should be rarer or more eager, `MAX_BURST` if the
  stututu should run longer.

### 2026-09-03 17:20 — Exhaust pops and bangs (audio + fx)

- Added `src/audio/backfire.ts`, holding both halves of the effect: `createBackfireTrigger()`, a
  pure allocation-free trigger, and `fireBackfire()`, the sound. One trigger lives in `game.ts` and
  feeds `audio.backfire(s)` and `effects.backfire(s)` on the same frame, so the bang and the flame
  can never drift apart.
- Two ways to make it bang, matching a real anti-lag tune. **Overrun**: the throttle snaps shut
  (>0.3 in a frame) and three decaying cracks fire ~85 ms apart. **Crackle**: pinned near the
  limiter, or on nitro, it pops sporadically. Tuned deliberately sparse — measured 2.6/s at
  redline, 3.1/s on nitro, with a hard 70 ms floor between pops. An earlier pass ran at roughly
  double that and the pops stopped reading as punctuation and became texture; same reasoning cut
  the embers per bang from 9 to 5.
- The overrun bang is gated on *road speed*, not the engine note. The fake gearbox sweeps past
  redline once per gear, so gating the burst on rpm made it a coincidence of when you happened to
  lift — measured in-game: zero bursts across several full-throttle runs. Speed is the better proxy
  for how heat-soaked the pipes are; rpm now only sets how angry the bang is.
- Sound is a **blast**: noise through a low resonant bandpass (~240 Hz) slammed into a shared hard
  clipper, plus a 30 ms bright crack, a burning-off tail, and a clean sine sub that bypasses the
  clipper so the thump keeps its weight. Filtering low *before* the distortion is the whole trick —
  the first version highpassed broadband noise and sounded like tearing paper, because the ear
  reads high-frequency noise as air rather than pressure. Measured: 2.7% of energy below 800 Hz
  before, 63% after. Loudness comes from sustained low-mid energy, not a taller peak, since the
  master limiter flattens peaks anyway. `AUDIO.backfireVolume` (0.9) is the mix knob; timings live
  in `BACKFIRE` next to the code, as `SKID` does in `dsp.ts`.
- Visual is a short-lived combustion event, not a puff. The two nitro flame billboards spike red
  (`nitroExhaust.backfire()`, ~110 ms, tinted toward `1, 0.34, 0.1` so a bang never reads as more
  boost), wrapped in a blast flash and embers from the **shared spark/flash pools** in `fx/index.ts`
  — the same ones the explosions use, so gravity, shrink-as-they-burn and a fast fade come for
  free and there are **no new draw calls**. The first pass put embers in the nitro trail pool,
  which is buoyant and *grows* as it fades: correct for a boost plume, but it read as dust.
  One pipe leads and the other answers, so a twin exit never flashes in lockstep.
- Also hoisted `REF_SPEED` into `dsp.ts` so the engine voice and the trigger agree on redline.
- Verification: `npm run typecheck` clean; `npm run build` green (640 kB / 176 kB gzip, +~23 kB);
  `npm test` 84 of 85 passed (14 new: 8 trigger cases in `tests/audio.test.ts`, 6 real-three.js
  flash/tint/decay cases in `tests/fx.test.ts`; the one failure is pre-existing). Live in the
  in-app browser: crackles fire at gear tops (s≈0.33-0.40 at 60-64 km/h); a lift-off at 67 km/h
  produced the burst 0.67 -> 0.48 -> 0.35 (ratio 0.72 = `LIFT_FALLOFF`); a frame frozen mid-pop at
  139 km/h with nitro cold shows the lead tip at alpha 0.78 and full ignition red (1, 0.34, 0.1)
  with both spark pools live — photographed from a close inspection camera. Audio rendered offline
  through a copy of the real master+limiter bus: strong bang RMS 0.165 over its first 200 ms
  (peak 0.545, 264 ms), mid 0.104, weak 0.060.
- Note: `requestAnimationFrame` is throttled in the in-app browser pane, which freezes the game
  loop (same limitation recorded in the 11:07 entry). Driving was verified by shimming rAF onto
  timers from the console. `tests/vehicleVisual.test.ts` still fails its unrelated pre-existing
  budget assertion (player car draw calls 9 > 8); confirmed failing on `HEAD` before this change.

### 2026-09-03 15:35 — Floating "+X" score pops on a kill (fx)

- Added `src/render/fx/scorePopup.ts`: a pooled, shooter-style "+100" that punches in over the
  wreck, rises ~1.6 m and fades over 1.1 s. One billboarded `THREE.Sprite` per slot (5 slots),
  each with its own small canvas label that is only re-rasterized on spawn; depth test off so the
  number is never buried inside its own explosion. Colour is the HUD money acid green, not
  lightning cyan, so points read as points.
- Wired through `EffectsSystem.scorePopup(x, z, amount)` (`src/render/fx/index.ts`) and fired from
  the `targetDestroyed` case in `src/game.ts` using the reward the economy filled in.
- Verification: `npm run typecheck` clean; `npx vitest run tests/fx.test.ts` 13 passed (4 new cases
  cover the label format and the scale/alpha/rise curves); observed in the in-app browser with no
  console errors — the pop appears at the hit target, rises and fades. Cost measured live: +1 draw
  call per popup on screen (43 idle -> 44 with one live), no triangle or heap change worth noting.
- Note: `tests/vehicleVisual.test.ts` fails on an unrelated pre-existing budget assertion
  (player car draw calls 9 > 8); nothing in this change touches `carVisual.ts`.

### 2026-09-03 11:07 — Sound effects (RB-017, partial)

- Added a procedural Web Audio SFX system under `src/audio/` (no asset files, matching the
  procedural-textures/livery approach). Wired into `src/game.ts` alongside the existing FX:
  `audio.onEvent(ev)` next to `hud.onEvent`, `audio.update(...)` each render frame, disposed in
  `dispose()`, and exposed on `window.__rb.audio` for QA.
- Voices:
  - **Player car — gas engine with turbo** (`engine.ts`): a looped train of baked combustion
    pulses (two detuned "banks" for thickness) driven through a soft-clip waveshaper for
    exhaust/header rasp and a load-opening lowpass, with a firing-locked sine sub for body.
    Revving changes the loop's *playbackRate*, not an oscillator frequency — that's the fix for
    the first version's "zipper/electric" tone (sweeping a sawtooth's harmonics literally sounds
    like a zip; pitching a pulse train sounds like a car). A fake 6-speed gearbox
    (`AUDIO.gearBounds`) makes it rise-and-shift instead of an endless siren. Turbo whine spools
    with rpm×throttle; a sharp throttle lift fires turbo flutter (compressor surge, the "stututu"
    — a decaying burst of resonant chuffs, `turboFlutter()`); `nitroStart` fires a spool whoosh.
  - **Tire scrub while drifting** (`tireScreech.ts`): a continuous noise voice — broadband
    "hiss" body + a resonant high-Q "squeal" that brightens with slip, plus a slow tremolo.
    Level tracks `skidIntensity()` in `dsp.ts`, which mirrors the smoke emission thresholds in
    `render/fx/index.ts`, so the screech and the tire smoke rise and fall together. Fed skid
    state via a new `SkidInput` param on `audio.update`.
  - **Electric cars — near-silent hover hum** (`electricHum.ts`): one spatialized voice per
    target (two beating sines + faint shimmer + air noise + vibrato), attenuated by distance and
    panned by bearing to the listener. Silent unless a car glides close.
  - **Lightning zap** (`oneShots.ts`): low thump + a bright saw diving through a resonant lowpass
    + a high crack + a sizzling noise tail.
  - **Electric vehicle out of service** (`oneShots.ts` `shutdown`): descending spin-down glide +
    electrical fizzle + a final thunk, fired on `targetDestroyed`.
- Autoplay: the context stays suspended until the first keydown/pointer/touch, then resumes. `M`
  toggles mute. Pure DSP math (gearbox curve, distance falloff, stereo pan) is in `dsp.ts` with
  10 unit tests in `tests/audio.test.ts`.
- Verification: `npm run typecheck` clean, `npm test` 63 passed (was 53), `npm run build` green
  (617 kB / 169 kB gzip, +~9 kB, all synthesis code). In the in-app browser: no load errors,
  AudioContext reaches `running`, 6 hum voices for 6 targets, and every synthesis path (engine
  sweep across all gears, blow-off, reverse, hums, lightning, shutdown, nitro, mute, restart)
  runs without throwing. Could NOT verify the live driving loop by ear or watch the note change
  with real speed: the preview pane was `hidden`, which pauses requestAnimationFrame and freezes
  the game loop — needs a human with the tab focused. Volumes in `AUDIO` (`tuning.ts`) are a
  first pass and want a mix/tuning pass at real levels.
- Note: developed concurrently with another session adding a background **theme song**
  (`src/audio/theme.ts`, wired as `theme` in `game.ts`). The two are independent (music vs SFX)
  and coexist; the combined tree typechecks, tests and builds green.

### 2026-09-03 20:30 — Cruise mode (C)

- `C` toggles an autopilot that drives the car around a scenic loop of the city at ~47 km/h, for
  leaving the game running in the background. Any driving input (WASD, Space, Shift) hands control
  straight back; `E` still fires, so the player can shoot from the passenger seat.
- Architecture: cruise is a *command source*, not a simulation rule. `src/sim/cruise.ts` writes a
  `PlayerCommand` exactly like the keyboard does and `src/game.ts` swaps between the two, so the car
  keeps the same physics, collisions, drift detection, audio and FX. `stepGame` is untouched.
- The route lives with the rest of the arena data (`CRUISE_ROUTE` in `src/world/arenaLayout.ts`,
  surfaced as `ArenaLayout.cruiseRoute`): highway -> north street -> east avenue -> a weave through
  the drift plaza -> JDM south street -> service alley -> home. All three zones, ~1 km, ~106 s a lap.
- Tuning is in `CRUISE` (`src/config/tuning.ts`). HUD: a quiet `CRUISE` badge top-centre.
- Verification: `tests/cruise.test.ts` drives a full lap through the real simulation with the real
  colliders - 0 collisions, closest approach 2.97 m (the JDM alley), peak 44.3 km/h, never reverses.
  `npm run typecheck` clean; 8 new tests green. In-browser: `C` engages, the badge shows, the car pulls away.
- Note: `tests/vehicleVisual.test.ts` fails on the car draw-call budget (9 > 8) from another
  session’s concurrent exhaust work; unrelated to cruise mode and left alone.
### 2026-09-03 09:05 — Session stopped by Juan; handoff written (lead)

- What works: full loop in the browser (drive, handbrake drift, charge, lock, fire, destroy, pay,
  restart) with the real arena, car, targets, FX and HUD. Gate green.
- Files changed since the last update: everything listed under "What each workstream delivered", plus
  `README.md`, `docs/DECISIONS.md` (implementation decisions), `scripts/qa-drive.mjs`, `.claude/launch.json`.
- Verification performed: `npm run typecheck`, `npm test` (53 passed), `npx vite build`; headless
  QA drive on the integrated build (19 of 20 checks passed; the one failure was a script timing bug,
  since patched but not re-run); in-app browser inspection of the integrated scene with no console errors.
- Performance measurements: see table above.
- Known issues: pending items 1-6.
- Next three tasks:
  1. Re-run `npm run qa` and `npm run qa:headed`; record real FPS.
  2. Camera occlusion against colliders.
  3. Keyboard hand-feel pass on drift and lightning arc legibility, then re-check the acceptance list.

### 2026-09-02 21:30 — Skeleton runs end to end (lead)

- Vite + TS + Three skeleton, fixed-step loop, rules in `src/sim` with 12 tests, placeholder visuals,
  QA automation script, browser launch verified.

## Multiplayer (2026-09-04)

Up to four cars race the Bandido Loop over one shared link. `npm run host` builds the game and
starts one Node process that serves both `dist/` and the match socket on port 8080, so
`ngrok http 8080` produces a single URL that is the game *and* the server: the client connects
back to whatever origin it was loaded from and needs no configuration. Full description in
`README.md`; the reasoning behind each choice is in `docs/DECISIONS.md`.

Answered by Juan before the work started: cars are solid and trade paint, lightning stays pointed
at the electric cars, and the pass covers the circuit only.

### Shape

- **Client-authoritative cars.** Each browser simulates its own car and publishes it 20 Hz; the
  server relays and owns the clock. Single player's feel is untouched — that was the point.
  It is cheatable by design, which is documented at the top of `src/net/protocol.ts`.
- **The server owns the start.** It waits for every client's `loaded`, picks one instant for GO
  and sends it in server time; each client's countdown is however long is left. Clients estimate
  the server clock from the lowest-latency ping/pong seen recently.
- **Rivals** are drawn 110 ms in the past between two real samples, extrapolated up to 250 ms
  when a packet is late, and dropped after 3 s of silence.
- **Contact** is resolved by each client on its own car only, 62% of the overlap each, so the two
  halves add up. The two screens do not agree exactly on a hard hit; that is written down.
- **Traffic** belongs to the host client, published 10 Hz, folded in elsewhere as a correction
  over ~150 ms. Keeps `server/` a relay with no game code in it.

### 2026-09-04 evening — QA pass: traffic, rival motion, colours (protocol 2)

Juan reported after the AWS deploy: traffic "goes a bit crazy and leaves the map", cars feel
clunky, and every player sees themselves as the violet car but rivals in slot colours. A new
two-browser probe (`npm run qa:mp`, `scripts/qa-mp.mjs`: private match server, two headless
Chromes, an optional latency relay, a `--chaos` mode that rams traffic and fires lightning)
reproduced all three with numbers, then confirmed the fixes.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Rival car stutters | Snapshot rows were stamped with the fan-out time, not the arrival time, so a sample sent twice looked like a stop-then-jump; rivals were also only re-placed per sim tick, so at 120–240 Hz they moved one frame in four | Server stamps each row `at` arrival; receiver drops repeats; rivals re-interpolated every rendered frame (`interpolateRivals`) |
| Non-host traffic trails the host and wobbles | Reports compared with the local copy *now*, so latency became a permanent pull backwards; patrol index never synced, so a corrected car steered for a stale waypoint | Half a second of local history; reports compared at their own timestamp; patrol index and knock velocity on the wire (`TRAFFIC_STRIDE` 7); non-hosts do not respawn locally |
| Electric cars leave the circuit | A punt at speed gave a car up to 95 m/s with nothing but the arena bounds to stop it | Shoved cars are pushed out of walls and buildings (`pushOutOfWorld`, shared with the player car) |
| Kills and shoves flicker on the non-host | The host's next report, sent before it knew, resurrected the car or slid it back | Local holds (`claimKill`, `claimBump`) until the host agrees; new `bump` message so the host repeats the shove, fast-forwarded by the transit time |
| Colours differ per screen | Own car always wore the livery | Own car painted in slot colour with the rival's marker strips; minimap arrow in slot colour |

Numbers from the probe, guest screen through an 80 ms + 20 ms jitter relay, 24 s, chaos on:

| Metric | Before (no chaos, 80 ms) | After (chaos, 80 ms) |
| --- | --- | --- |
| Traffic position error, host vs guest, mean / p95 | 0.51 m / 0.60 m (constant trail) | 0.07 m / 0.12 m |
| Patrol index out of step by 2+ | up to 3 cars | 0 |
| Rival frames with no movement (of ~4,000) | 2,703 | 35 |
| Per-frame speed jump of the rival, mean | 23.4 m/s | 10.2 m/s (includes one teleport by the chaos ram) |
| Destroyed/alive flicker | not measured | 0 on both screens |
| Cars off the circuit or in a building | 0 | 0 |
| Same colour on both screens | no | yes |

At zero latency the rival went from 2,601 stalled frames to 0. Suite: 265 tests in 18 files
(12 new). `npm run perf:check` still passes on the single-player circuit, whose car and traffic
are unchanged.

**Needs redeploying**: the protocol version is now 2, so the EB instance must be updated
(`npm run build` then `eb deploy rayo-bandido-prod`) or every page will be refused at `hello`.

### Verified

| What | How |
| --- | --- |
| Room, protocol, match lifecycle, snapshot fan-out (arrival stamps), traffic + hit + bump relay, classification, clock | `tests/matchServer.test.ts` — 19 tests against a real `node server/index.mjs` on a real port, driven by real WebSocket clients |
| Contact, interpolation (repeat samples, per-frame re-placement), traffic reconciliation (history alignment, patrol sync, kill/shove holds, host-side bump), shoved traffic vs walls, classification order, colours | `tests/multiplayer.test.ts` — 43 tests, no socket needed |
| Two browsers over a lossy-ish link | `npm run qa:mp:lag` — see the QA pass above |
| Client and server protocol copies agree | `tests/protocol.test.ts` |
| Two browsers, whole loop | Lobby → race → flag → results → race again, twice, in two windows. Standings agreed on both screens; traffic agreed within 0.8 m; a staged overlap at 0.4 m separated to 2.62 m |

Suite: 252 tests in 18 files. `npm run perf:check` still passes on the single-player circuit
(28 programs, no mid-play compiles, worst frame 12.6 ms, 48 draws).

### Budget with a field

Measured in the in-app browser on the circuit, two cars: **42 draw calls, 38,236 triangles**. A
rival is five draw calls (body, glass, tails, colour marker, wheels) against the player car's
nine — it drops the head lights, reverse lamps, exhaust flame and ground pool, none of which read
on a car you are looking at from behind. A full four-car grid therefore lands near **52 draws**,
inside the gate's 60. The gate itself still probes single player, so it does not cover this;
re-measure by hand if the rival car gains any parts.

### Known gaps

- Nobody has raced it against a real person over a real tunnel yet — only two windows on one
  machine, where latency is ~1 ms. The interpolation and clock code is written for real latency
  but has not met any.
- A player who quits mid-race is only classified when the socket closes; there is no "retire"
  message, so a tab that hangs without closing holds the results until the 60 s grace after the
  first finisher.
- The Test city stays single player, by decision.
- Audio does not react to rivals at all: no engine note, no tyre noise, no impact from another
  player's car.

### 2026-09-04 night — Rooms: create your own server (protocol 3)

Juan: "let me click VERSUS and create my own server, so only the people I want are in it."
Until now one process was one room, and whoever connected first hosted the only race there was.

`server/rooms.mjs` is now a registry of rooms, each one an unchanged `server/room.mjs`. A socket
names its room in `hello` and stays in it for life, so nothing below the handshake carries a room
id and the 20 Hz traffic is byte-for-byte what it was. A room has a four-character code from an
alphabet without I, O, 0 or 1, a label, and a public/private flag; it is reaped two minutes after
the last player leaves, so a reload does not lose the code. `GET /rooms` lists the public ones
over plain HTTP, because the browse screen has to read it before there is any socket.

`?mp=1` now opens **the room browser** (`src/ui/rooms.ts`): make a room, type a code, or click a
public one. `?mp=1&room=CODE` goes straight in and is what the lobby's COPY button hands out;
`?mp=1&create=1` opens one directly; `?mp=1&room=CODE&create=1` joins or re-opens that code,
which is how `scripts/qa-mp.mjs` gets two browsers into one room without reading either screen.
The address bar is rewritten with the real code once the server answers. The lobby header shows
`LABEL · CODE · PRIVATE|PUBLIC`, and ESC there now goes back to the rooms rather than the menu.

**Verified in two browsers** against a match server on a spare port: created a private room
(`JUAN CREW · YG56 · PRIVATE`), joined it by link and by typed code, both clients raced from the
same START; a public room showed up in a third browser's list while the private one did not,
with the private room's two players nowhere in the JSON; a code nobody hosts is refused with
"NO ROOM CALLED ZZZZ". Suite: 276 tests in 18 files (11 new — five for the registry over a real
socket, six for code and label handling).

Deployed to `rayo-bandido-prod` (sa-east-1) as `app-5bb9-260904_191542738994` and checked on the
live host: `/rooms` served, a room created through the real page over the deployed socket, and it
appeared in the public list from outside. The environment's Yellow health predates this and is an
IAM one — enhanced health cannot assume `aws-elasticbeanstalk-service-role`; the instance itself
reports ok with 100% 2xx.

**Follow-up the same night**: Juan asked for **LIST IT PUBLICLY to be ticked by default**, so a
new room is public unless the host unticks it (`&listed=0` is the URL form; the browse screen now
always writes the parameter rather than relying on the default, and `scripts/qa-mp.mjs` pins
`listed=0`). Reasoning is in `docs/DECISIONS.md` — an always-empty list makes multiplayer look
dead, and privacy stays one click away with the lobby header saying PRIVATE or PUBLIC.

### 2026-09-04 night — Interface skin: hazard yellow

Juan on the menus: "too naive, dull, kind of childish", with a brief for a trashier, darker
cyberpunk look — the night-highway palette, slashed lettering, hacked-terminal components. The
scene, the car and the circuit were explicitly out of scope and were not touched.

`src/styles.css` was rewritten as a skin rather than patched. Hazard yellow leads the chrome and
red is the alarm; the game's cyan, magenta, acid and violet keep their meanings so nothing in the
scene had to move. Type is two roles only — a condensed display stack for anything shouted, a
monospace stack for anything the machine says — both system fonts, since the game still has to
run offline. Every surface shares one notched corner, a 1px outline and a stroke along the cut.

Screens: the **main menu** (`src/ui/mainMenu.ts`) is now a numbered list beside a mode dossier
that carries the WANTED poster cropped to the driver and a spec table; the **room browser** and
the **lobby** wear the same wordmark, stamp, panel heads and status line through a new
`src/ui/chrome.ts`; the **HUD**, the **race readout**, the live **classification**, the finish
panel, the WRONG WAY tape and the **loading screen** follow the same skin. Every `data-role`
hook `scripts/qa-mp.mjs` drives is unchanged, and so is every class the HUD writes per frame.

**Verified in the browser** on the dev server at 1000x660 and at 375x812: main menu with each of
the three modes selected, room browser, a created room's lobby, the classification panel, the
in-game HUD in race mode, the finish panel, the wrong-way banner, the countdown, the live
standings and the loading screen. Suite: 276 tests in 18 files, all passing; `tsc --noEmit` clean.

### 2026-09-05 — Left-foot brake, and reverse that needs a real standstill

Juan on the brake: "too powerful — at full speed, pressing it lets me start going backwards
fairly easily, at least while drifting. It should behave like a left-foot brake: bring the
weight forward and close the apex, make the car go tighter instead of opening."

The cause was in `src/sim/vehicle.ts`: the brake only ever touched the *forward* component of
the body-frame velocity, and reverse engaged the first tick that component reached zero. Deep
in a slide most of the speed is sideways, so the forward component fell through zero in a few
frames while the car was still travelling at 60 km/h — and the car flipped into reverse.

Three changes, all constants in `src/config/tuning.ts`:

- **The brakes act along the velocity vector**, not the forward axis. Sideways speed is scrubbed
  at `brakeLateralShare` (0.6, so a drift survives the pedal) and the forward component can only
  reach zero, never cross it.
- **Reverse is its own gear.** It needs the whole car stopped — `reverseSpeedWindow` measures
  forward *and* sideways speed — with the brake held there for `reverseArmTime` (0.35 s). Once
  engaged it stays engaged until the brake is released. Nothing at speed can flick into reverse.
- **Left-foot braking.** Forward weight transfer (`brakeLoad`, ramped by speed) loads the front
  and unloads the rear: a bigger yaw budget (`brakeYawGain`) and lateral-grip cap
  (`brakeFrontBite`), a weaker self-aligning torque (`brakeAlignScale`) and a slide floor while
  already sliding (`brakeRearUnload`). Braking on a straight is unchanged — the rear only comes
  loose past `slideSlipStart`. Brake force is cut to `brakeThrottleFight` while the throttle is
  also held, because the engine is fighting the pedal.

`docs/DECISIONS.md` now records the car as **rear-wheel drive**. It is not simulated per wheel,
but the model has to express it, and the header of `src/sim/vehicle.ts` says where: drive only
ever loosens the rear, and the brake loads the front. Anything added later — launch behaviour, a
diff, wheelspin — keeps drive at the rear.

**Verified in the browser** (dev server, free-roam test city, `window.__rb.inject`, no console
errors): a half-second stab at 80 km/h scrubs to 31 km/h with no reverse; the brake pinned
through a 72 km/h handbrake slide turns the car 27° further and never crosses into reverse; the
same corner from the same spot runs a 45.8 m radius free and a 19.8 m radius on the brake
(22.9° vs 41.3° of heading in 0.75 s); and a held brake from 80 km/h stops the car in 0.77 s,
then engages reverse 0.42 s later at a genuine standstill. Suite: 313 tests in 21 files, all
passing (five new ones in `tests/vehicle.test.ts`); `tsc --noEmit` clean.

Pre-existing and untouched: `npm run qa` reports `driftActivates`, `chargeFromDrift` and
`nitroRecharges` as FAIL on `main` as well — the QA drive sequence, not the vehicle.

### 2026-09-05 — Drivetrain: a drift is now held with the throttle

Juan: drifting should be a deeper skill. Quick drifts stay easy — tap the handbrake, turn, get
what you expect — but *sustaining* one should be technical and closer to a real car: the box
locks a gear that keeps the engine high in its range, the throttle key becomes a modulator, and
what keeps traction lost is torque at the rear, spinning wheels. Donuts and figure eights in
first gear; the same figures in a taller gear need the road speed that gear's torque asks for.
And, after the first cut: regular driving must stay a plain automatic — the lock is for a drift
being held, nothing else.

Until now rpm and gear were presentation only — the audio derived both from road speed, and the
tacho drew that number. There is now a real drivetrain in the simulation, `src/sim/drivetrain.ts`,
with every constant in the new `DRIVETRAIN` block of `src/config/tuning.ts`:

- **Six-speed automatic, rpm linear through zero.** Road rpm is `speed / gearTop`. Upshifts land
  the note at 50-80%, not at idle, and downshifts have hysteresis. The tacho, the engine voice
  and the backfire trigger all read `VehicleState.rpm01` / `.gear` now; `engineTone` is gone.
- **Wheelspin is excess rpm, and it needs a reason.** Under throttle the engine revs above road
  rpm by up to the gear's torque (`spinAuthority`: first can spin at a standstill, third needs
  ~40 km/h before the band is reachable, sixth never). But only with a reason for the rear to
  let go: a drift being held, a slide already under way, or the wheel held at full lock below
  43 km/h for 0.8 s (`VEHICLE.spinIntent*` — a donut is asked for, a corner is not). On a
  straight the rear hooks up, so a launch revs and shifts like any automatic.
- **The throttle is a modulator.** The excess rises at `revRiseRate` and falls at `revFallRate`:
  a held key is a climbing needle, a tapped key a hovering one, a pad trigger parks it. Inside
  the torque band (`bandLow`..`bandHigh`, ~6000-8200 rpm on the dial) the excess is wheelspin.
- **Wheelspin holds the slide.** In `src/sim/vehicle.ts` the old `hold = max(throttle, steer)`
  is `max(wheelspin, steer * steerHold)`, with the momentum floor lowered. Spinning rears plus
  a turned wheel step the rear out at low speed (`spinSlide`, `powerYawKick`): the donut.
- **The limiter punishes a pinned key, after a grace.** Past `overRevGrace` (0.8 s) against the
  limiter with the rear loose, drive, self-alignment and rear grip fall away and the rear keeps
  coming round (`overRevYaw`): the car walks out past 80° and bogs to a crawl. Lift or
  counter-steer to catch it. A one-second flick with the key held is forgiven. A sliding rear
  spins in any gear up to fourth (`slideSpinBonus`), so this holds at speed too.
- **Gear lock, keyed to the drift rules.** `stepVehicle` now takes `DriftState.active`; while a
  drift is held the box keeps its gear and shifts only to keep road rpm *under* the band with
  torque to spare — down below `lockDownshiftRpm`, up once past `lockUpshiftRpm` for a moment,
  so a drift that gathers speed climbs a gear instead of hooking up or hitting the limiter. It
  hands back to the automatic 0.2 s after the drift ends. Ordinary cornering never locks it.
  The tacho shows the torque band while locked (`is-locked`) and lights it while the needle
  sits in it (`is-in-band`).
- **Donuts count as drifts** (`DRIFT.spinValid`), and lightning charge drops by
  `chargeLimiterLoss` while pinned — the one departure from "leave charge alone": the angle
  bonus would otherwise have paid a pinned throttle more than a clean drift.

**Verified in the browser** (dev server, test city with colliders cleared via `window.__rb`,
no console errors):

- Flat out on a straight: shifts at 32, 66, 105 and 148 km/h landing at 49-77% rpm, 163 km/h
  after 10 s, never locked, no wheelspin. A 40 km/h corner exit at full lock under power for
  0.6 s: no lock, no wheelspin, 101 km/h two seconds later.
- A 60 km/h handbrake flick held with the throttle tapped into the band: 4 s at 29-48° of slip,
  climbs from second to third, ends at 32 km/h with 70 charge. The same flick with the key
  pinned: walks out to 82°, ends at 9 km/h with 30 charge.
- A standstill donut with full lock and a tapped throttle: 533° in 8 s inside a 12 m box, a
  drift for 7.2 of those seconds, first gear then second as it gathers speed, 92 charge.
- Known: a full-throttle slalom at 70-90 km/h swinging full lock each way is a power-oversteer
  drift by the existing rules, so the box locks through it; it still climbs to fourth.

Suite: 334 tests in 22 files, all passing (`tests/drivetrain.test.ts` is new, plus donut, lock,
corner-exit and pinned-versus-tapped tests); `tsc --noEmit` clean.

Not done: manual gears (the lock is what "auto" gives the player instead), and the pad's
analog trigger is untested on hardware — the model parks the needle where the trigger says.

### 2026-09-05 — Manual box, self-steering counter-steer, and cars that spin

Juan, on the drivetrain: two boxes. The automatic keeps the simpler drift and is hard to hold a
drift on because the revs drop on every shift; the manual is where the drifting versatility
lives — donuts, figure eights — and that versatility is the reward for learning it. Then the
wheel: real counter-steer, where you lift your hand and the wheel slides through it; holding
the arrow too long in a first-gear donut makes the circle tighter, tapping it widens it; an
on-screen indicator of where the wheels are. And the car must be able to spin off if the
counter-steer is not done properly.

**Transmission** (`GameState.transmission`, T to toggle, remembered in `localStorage`; X/Z or
RB/LB to shift; the gear readout carries an A/M tag and the toggle prints a system message):

- The **automatic** reads engine revs, not just road speed: with the rear spinning it shifts up
  at `autoUpshiftRpm` (never from a standstill, never on road speed alone, and it then holds the
  taller gear for `autoShiftHold` so it does not hunt). Rev into the band with the rear loose
  and it shifts from under you — the needle lands out of the band in a gear with less torque.
  Regular driving is untouched: no excess revs, so the shift points are the road ones.
- The **manual** box moves only on the player's shifts. Flat out in a gear the limiter holds the
  car at the gear's top; a downshift the road is too fast for is dragged down to it; a tall gear
  at low revs lugs (`lugDrive`). The old gear lock is gone — manual is what it was for.
- Cruise mode shifts for itself whatever the box (`StepOptions.cruising`).

**Steering** (`src/sim/vehicle.ts`, step 2 and step 5):

- **Self-steer.** A released wheel in a slide aligns itself with the direction of travel at
  `selfSteerRate` — counter-steer — and returns to centre on grip. The arrow adds its lock on
  top, so holding it keeps full lock and tapping it holds a partial angle between taps.
- **The front turns the car by its angle to the line of travel**, not to the body
  (`maxEffectiveSteer`). A counter-steered wheel on that line rotates nothing; a wheel held
  into the slide keeps the rotation going. This replaced the old "counter-steer regrips faster"
  shortcut, which now only applies without wheelspin, and it is what makes a held arrow in a
  first-gear donut tighter than a tapped one.
- **Spins.** The anti-spin assist has its full strength only while the wheel is counter-steered
  and none at all steered into the slide (`spinGuardBare`). `VehicleState.counterSteer` reports
  where the wheel sits against the slide; the new wheel glyph in the cluster
  (`src/ui/wheelIndicator.ts`) turns its front wheels with the live angle, cyan when
  counter-steered, red when steered in.

**Verified in the browser** (dev server, test city with colliders cleared via `window.__rb`, no
console errors): T flips the box, prints MANUAL / X / Z TO SHIFT and persists it. Manual first
gear flat out holds 30 km/h at the limiter. A standstill donut with the throttle tapped and the
arrow lifted past 30°: manual turns 726° in 8 s inside an 8 m box in first; the same inputs on
the automatic run 1st→4th into a 67 m arc at 79 km/h. A manual second-gear 60 km/h flick: arrow
held into the slide walks out to 63° and crawls at 26 km/h (spun off); arrow lifted past 28°
holds 33° for the full 4 s at 41 km/h with the wheel swinging between +9° and −2°; arrow
released outright counter-steers within 0.25 s and the car straightens in 0.7 s. Suite: 343
tests in 22 files, all passing; `tsc --noEmit` clean.

Known and deliberate: on the automatic a full-throttle drift is not lost, it runs away — the
box climbs the gears and the slide widens into a fast power slide. Tight is manual's.

### 2026-09-05 — Walls: a hit and a scrape are different

Juan: hit a wall at an angle and the car kind of gets stuck. Two separate causes, both in
`src/sim/collision.ts`.

- The wall response was written for the moment of impact but ran on **every tick of contact**:
  it kept `collisionSlide` (85%) of the along-the-wall speed each time. Riding a barrier at
  60 Hz that is 15% of the car's speed gone sixty times a second — a 97%/s brake nothing can
  out-pull, so any car that touched a wall at an angle was pinned to it. Contact is now split
  from impact by `wallImpactSpeed` (2.5 m/s into the surface): a real hit still bounces
  (`restitution`) and scrubs once (`collisionSlide`), while a scrape only pays the steady
  `wallScrapeDecel` (4 m/s², about half the engine) and never bounces — a bounce off a wall the
  car is only leaning on buzzes it away from the barrier.
- Even freed of that, a car **stopped nose-first** in a wall could not leave: yaw comes from
  road speed (`src/sim/vehicle.ts`, step 5), so at a standstill full lock does nothing and full
  throttle only pushes harder into the wall. Reverse was the only way out, which is not what a
  player reaches for mid-chase. `unwedge()` gives the pinned car the pivot a turned wheel
  actually has against an obstacle: while it is pressed into a surface below `wedgeSpeed`
  (3 m/s) with the throttle down, it rotates at `wedgeYaw` (1.1 rad/s at full throttle) toward
  the wall's tangent — the side the wheel asks for, or the one the nose already leans toward —
  fading out as the car finds speed. Off the throttle, or dead square to the wall with the
  wheel straight, nothing happens: the car is not asking to go anywhere.

`pushOutOfWorld` now takes a `WallResponse` (restitution, slide, impact threshold, scrape
deceleration) and `dt` instead of two loose numbers, and optionally reports the contact normals
it pushed along. Shoved traffic uses its own response and is otherwise unchanged.

**Measured** (headless, `tests/collision.test.ts`): a 90 km/h approach at 10-45° to a wall now
leaves the car above 60 km/h four seconds later and still accelerating along the barrier, where
before it settled to a crawl; a wedged car on throttle and lock is away inside 4 s from nose
angles of 50-90°; a head-on hit still reports an impact above `wallImpactSpeed` and drops the
car below 30 km/h. **Verified in the browser** (dev server, test city, no console errors): a
30° hit on `blk-nw-a` at 90 km/h costs speed, aligns the car to the face and then pulls away
along it under throttle. Suite: 348 tests in 23 files, all passing; `tsc --noEmit` clean.

## Phones: app-like touch behaviour (2026-09-05)

The on-screen pad landed first and defended only itself, so the rest of the page still behaved
like a document: a fast double tap on the canvas zoomed (the canvas is the fire button), a
two-finger touch pinched, a drag rubber-banded on iOS or pulled to refresh on Android, and a
held button offered the text callout.

- **CSS** (`src/styles.css`, and the inlined loading-screen copy in `index.html`): `html, body`
  are `position: fixed` with `overscroll-behavior: none` and `touch-action: none`; the canvas
  is `touch-action: none` and unselectable; the callout and the tap highlight are off. The two
  screens that can outgrow a short window (`.rb-lobby`, `.rb-rooms`) and the room list keep
  `touch-action: pan-y` with `overscroll-behavior: contain`, and `#menu-root` gets
  `manipulation` — fast taps, no double-tap zoom.
- **`src/ui/mobileShell.ts`** (new, installed once from `src/main.ts`) closes what CSS cannot:
  Safari's `gesturestart/change/end` (pinch survives `user-scalable=no` on iOS), a second tap
  within 320 ms, `contextmenu`, and `touchmove` — the last two filtered by target, so anything
  over a scrollable ancestor still scrolls. It also takes a Wake Lock (re-taken whenever the
  tab comes back) and asks for fullscreen on the first tap of a touch session; both failures
  are ignored, which is what an iPhone does with them.
- **Firing moved to `pointerdown`** (`src/core/input/keyboard.ts`): the tap-to-fire binding used
  the compatibility `mousedown`, which arrives after `touchend` and dies with it — the
  double-tap guard would have swallowed every second shot. Taps on a control (`.rb-touch`,
  `#menu-root`, buttons, fields) are not shots.
- **Installable**: `public/manifest.webmanifest` (fullscreen, landscape, dark), the
  `apple-mobile-web-app-*` tags and an `apple-touch-icon` in `index.html`, and
  `scripts/make-icons.mjs`, which rasterises the favicon's bolt into 192/512/180 PNGs with
  nothing but `zlib` — re-run it if the mark changes. `.webmanifest` was added to the server's
  MIME table (`server/index.mjs`) and to the pre-compressor's text extensions.

**Verified in the browser** (dev server, 375×812 touch emulation, `?touch=1`): computed
`touch-action` is `none` on body and canvas and `pan-y` on the menu scrollers; a synthetic first
tap passes and a second within 320 ms is cancelled; `touchmove` over the canvas and
`gesturestart` are cancelled; `contextmenu` is refused. The rotated landscape layer and the pad
are unchanged. Suite: 348 tests in 23 files, all passing; `tsc --noEmit` clean.

### 2026-09-06 — The City: a free-roam proof of concept with drivable elevation

Juan's brief: a city at least four times the test arena, after Cyberpunk night-street
references — viaducts high in the air and running between buildings, roads that climb and
dip, curved avenues, alleys, a square of screens, radio masts, a huge drum of screens, water.
Layout, elevation, light and low-poly variety now; textures and detailed props are his own
later pass. Decisions in `docs/DECISIONS.md`; the scope exception in `AGENTS.md`.

**Elevation in the simulation** (the one architectural change). The world used to be planar.
Now:
- `src/world/track.ts`: a node may carry a height `y`; unmarked nodes interpolate between the
  nearest anchors with an eased grade (`easedRise`, `GRADE_EASE`), so a curved ramp climbs in
  one run. Every sample and projection carries `y`; `maxGrade`, `maxHeight`, `isElevated`.
- `src/world/surface.ts`: the surface field. At (x, z) it answers with the highest road a body
  can step onto from the height it already has (`STEP_UP`, 0.6 m). A car on the deck stays on
  the deck over the street, a car on the street stays under it, and a car at the foot of a
  ramp is carried up — each tick the ramp is a few centimetres higher than where it was.
- `src/sim/surface.ts` settles the car and every electric car onto that surface after they
  move, and writes the road grade along the heading as `VehicleState.pitch`. Step 4 of the
  vehicle feels `VEHICLE.gradeGravity` (0.45 g) along it; the body tilts by it (`sync.ts`,
  root rotation order YXZ); the chase camera aims up the slope (`CAMERA.pitchFollow`).
- Colliders carry optional height bounds (`ObstacleBox` / `ObstacleWall` `minY` / `maxY`):
  a viaduct's guardrail is a wall for the deck and nothing for the street below; a pillar is
  a wall for the street and nothing for the deck. `LEVEL_GAP` (3.5 m) keeps cars on different
  levels from touching, shaving or shooting each other. Events carry `y` so every effect
  (arc, explosion, sparks, pops, smoke, skid marks) lands on the road it happened on.

**The world** (`src/world/citySpec.ts` data, `src/world/cityWorld.ts` builder, shared block and
rail generation moved to `src/world/cityGen.ts` and reused by the circuit unchanged):
- 540 x 550 m: five avenues and streets each way, an S-shaped diagonal, five alleys, a
  waterfront boulevard, water behind a quay along the south edge.
- The viaduct: an 18 m closed highway 15 m up round the whole city and out over the bay, four
  ramps (two on, two off, 9-15 % grade, each merging parallel to the deck), 93 pillar pairs
  wherever the deck is over open ground or water, never over a street or a lower deck.
- The skyway: an open bridge road that climbs to 24 m up the west side, runs the north edge
  between the towers, crosses the viaduct twice, and comes down onto the centre boulevard.
- Blocks: cells split along straight roads (`axisSplit`) and the staircase the diagonal leaves
  is merged back into strips (`mergeUpTo`) — 89 blocks from 11 to 77 m instead of 240 huts.
- Traffic: the existing electric cars, untouched: nine on four rectangles of streets in the
  right-hand lane, four lapping the viaduct at 15 m. Cruise mode drives the central rectangle.

**The art** (all merged into the same 15 draw calls): viaduct slabs, skirts, undersides with
lit strips, pillars with beams (`elevatedBuilder.ts`); sloped guardrails that climb the ramps
and lamps hung off the deck fascia (`trackBuilder.ts`); five building silhouettes — podium
towers with a lit crown, stepped tiers, slabs with a neon spine, plain, and shabby boxes with
cages, awnings, tanks and shacks — rooftop screens, and a district where every facade is
stacked with holographic screens (`cityBuilder.ts`); the quay, its railing and lamps, neon
streaks on the water, four lattice radio masts, a power line of seven pylons across the bay,
the 26 m drum of screens on a 55 m mast, enclosed skybridges between towers
(`landmarksBuilder.ts`); the water plane and per-world fog (340 m here) in `environment.ts`;
viaducts in magenta and the bay on the minimap.

**Measured.** `tests/cityWorld.test.ts` (headless): every road clear of what is solid at its
level; every street a deck crosses has 5.5 m under it; decks that cross leave 5.5 m; grades
under 17 %; pillars off the streets; cruise mode drives the west ramp onto the deck with zero
rail contacts and arrives at 15.0 m; a car overhead cannot be locked. Art: 83k triangles, 15
draw calls; world build 0.4-1.0 s on this machine. **In the browser** (dev server, `?mode=city`,
no console errors): 58 FPS in the embedded preview, GPU 3.7 ms, sim 0.5 ms, render 1.7 ms;
the viaduct cars lap at 15 m; the race and test worlds unchanged.

**Known gaps, for the next passes.** No textures beyond the procedural ones (by design). The
ground under the viaduct corridor is bare. Ramps have no kerbs where they leave a street.
Shoulders are flat pavement, not raised kerbs. The far-shore skyline is silhouettes only.
The world build could be halved with a spatial index in `generateBlocks` if load time matters.

### 2026-09-06 (afternoon) — City, second pass: the bay palette, downtown, the viaduct's ground floor

Juan's feedback on the first look, all four points addressed (decisions in `docs/DECISIONS.md`):
- **Colours from his references.** Two palettes now live in `palette.ts`; the City draws in
  `bay` (deep navy night, saturated deep-blue sky, dense blue fog, teal / magenta / violet neon,
  amber lamps and stalls, near-black facades so the windows and screens carry the light). The
  arena and the circuit keep `arena`. Sky, reflection map, lights, window textures and lamp heads
  all follow the live palette.
- **The ground floor of the viaducts.** Columns every 12 m with barrier rings and lit edges,
  edge and centre beams plus pipes under the slab, a lit strip on every bay, hanging signs,
  fences between the columns (two bays in three; walls for the street, the open bay is the way
  in), stalls, posters and junk against them, a floor with pools of light.
- **Cosier, foggier.** Fog 10-300 m, amber pools, stalls on the urban ledges, palms in the old
  town and along the quay.
- **Downtown.** A skyscraper district in the north-west (70-140 m, setbacks, corner light
  strips, building-sized screens, lit crowns, antennas), every facade a wall of screens, the
  band behind it and the backdrop skyline grown to match, skybridges 22-52 m up.

**Measured.** 351 tests green (the city contract suite now also pins the columns off the streets
and off lower decks). Art: ~135k triangles, 15 environment draw calls (up from 83k; still under
the 200k rule). Browser (dev server 5178, `?mode=city`): 120 FPS in the preview, GPU 0.5-1.0 ms,
no console errors. Downtown: 5 skyscrapers and 13 pencil towers on 18 plots, 168 screens.

### 2026-09-06 (evening) — City, third pass: teal palette, greenery, three times the traffic

- The `bay` palette is now the teal night of Juan's third reference: teal-grey fog and sky,
  green-grey pavement, grey-teal concrete, cold white and pale-teal windows, amber lamps, yellow
  centre lines, red and coral for the hot notes, no violet anywhere. Water and foliage colours
  joined the palette.
- Hedges and palms on every block ledge facing a street in every zone (thickest on the quay,
  sparse downtown) and hedges along the viaduct fences (`landmarksBuilder.ts`, `elevatedBuilder.ts`).
- Traffic tripled to 39 cars: nine street rectangles spread evenly (`placeAlongLoop`), eight on
  the viaduct. Nothing about the cars changed.

**Measured.** 351 tests green. Art: ~141k triangles, 15 environment draw calls. Browser
(`?mode=city`): 39 targets, 8 of them on the deck, no console errors; sim about 1 ms and
render about 3 ms a frame with the full field.

### 2026-09-06 (night) — Buildings: a modular kit and one facade atlas for the whole city

The city read as one box stamped over and over: every block a grid of equal 17 m modules,
every wall in a zone the same 256 px window tile at the same lit fraction, six silhouettes
that were all setbacks on a box. Replaced by:

- **`env/facadeAtlas.ts`** — one 1024 px atlas of sixteen facade styles (grid, ribbon, vertical
  strips, lit clusters, service band, sparse groups, lit corners, inset panels, near-dark,
  curtain wall, louvres, mixed, lit stripe, stacked strips, balconies, big panels). Panes are
  drawn white; every wall quad carries `aFacadeCell` (which style, how bright the concrete)
  and a vertex colour (the glass tint, from the zone's palette of window lights). The
  material patches `map_fragment` / `emissivemap_fragment` to tile the wall's UV inside its
  cell with `texture2DGradEXT`, so there is no mip seam at the wrap. One texture, one
  material, one draw call for every facade in the city (was three); `windowActivity` sits
  on the same material unchanged (grid now 8 x 4 per 12 m tile).
- **`env/buildingKit.ts`** — eleven massing archetypes (tower, slab, podium + tower, stepped,
  offset stack with overhangs, cantilever, recessed centre, twin towers with a link, low,
  shabby, landmark: spire / crown / blade / twins / pagoda), chamfered corners on some
  towers, facade BANDS per volume (lit lobby or blank plinth, body pattern, dark service
  floor part-way up, a second pattern for the top storeys, a sparser pattern on the walls
  away from the street), one building in ten dark with navigation lights only, crowns (rim,
  frame, fins, spire, floating ring), mechanical blocks, antennas, rare beacons, corner light
  strips, lit setback edges. Three levels of detail: near (blocks), mid (perimeter band),
  far (backdrop skyline). All knobs in `KIT`.
- **`env/cityBuilder.ts`** — blocks are cut into plots of uneven size (`subdividePlot`), a
  smooth skyline field swings heights ±25 % so districts rise and fall, on a block of several
  plots the street edge drops and the plots behind rise, six landmark anchors (the biggest
  tower plots, 90 m apart) get the kit's silhouettes at 1.45x height, enclosed links between
  neighbouring towers on a block, downtown screens cut to a couple per face. All knobs in
  `BLOCKS`. Every plot seeds its own rng from its position: the city is the same on every
  machine and a block does not reshuffle when its neighbour changes.

**Measured** (`scripts/perf-probe.mjs --mode city`, dev server, same machine, same scene):
env draw calls 15 -> 13; env triangles 153.0k -> 156.5k (city), 14.3k -> 18.1k (arena),
42.7k -> 49.5k (circuit); steady GPU 2.0 ms -> 1.6 ms, drive 2.0 -> 1.4 ms; main thread
unchanged (~0.3 + 0.9 ms); 29 programs before and after, none compiled mid-play; no console
errors on a fresh load; 403 tests green (12 new in `tests/buildingKit.test.ts`: every
archetype draws, determinism, floor snapping, ≥ 6 archetypes and ≥ 10 styles across the
city, atlas cells, shader anchors). Texture memory: one 1024² atlas replaces three 256²
tiles (+~4.5 MB with mips).

**Known gaps.** Runtime LOD is still not possible with everything merged per material;
detail reduction is at build time (far ring simpler). The far ring beyond the 300 m fog is a
flat cutout as before. Chamfered roofs use two degenerate triangles per corner.

## City: the bus network (2026-09-06)

Bus stops on the boulevards and articulated buses running routes between them, from Juan's
two reference renders. Both are drawn in one livery — the amber of the shelters' fascia band
— so a bus and the stop it pulls into read as the same network across a junction.

**The stops.** `cityWorld.placeBusStops` walks the five wide boulevards and takes the first
station every ~130 m where the whole thing fits: axis-aligned street, ≥ 8 m of asphalt either
side of the centreline, enough pavement behind the kerb for the shelter, no crossing road, no
missing kerb (a junction mouth), nothing solid, no deck within 10 m, and clear of the spawn.
Every check is made at three stations over a bus's length, not just the middle. Sides
alternate down a street, but a candidate that fails on one kerb tries the other before it is
lost — and where both would do, the kerb a bus route drives along wins, which is why the
routes are laid out *before* the stops. Thirteen stops in the city today.

- `cityPlan.BusStopDef` + `BUS_STOP` — the one place a shelter's size is written down, read by
  the collider in `cityWorld.ts` and the geometry in `env/transitBuilder.ts`. Axis-aligned, so
  each shelter's box collider is the shape of the thing and not a fattened guess.
- `cityPlan.inBusStop` keeps lamp posts (`trackBuilder`) and palms (`landmarksBuilder`) out of
  a shelter: both used to stand exactly where one does.
- `env/transitBuilder.ts` draws them: back wall, gabled roof, a row of strip lights under the
  fascia, the amber "- BUS STOP -" band, the route map and name board behind a lit bench, and
  a side bay with a back-lit poster and the timetable.
- `textures.makeTransitAtlas` — a NON-uniform atlas (named pixel rects, not a grid: a 4:1 name
  board and a 1:1.5 timetable drawn in square cells both come out stretched) carrying the map,
  three name boards, the timetable, two posters, the hazard band, and what the bus wears: its
  destination roll, its roofline ad strip and its route plate.

**The buses.** `citySpec.BUS_ROUTE_LOOPS` — two rectangles of boulevard, both driven clockwise
in the kerb lane. The lane is taken per leg from that street's own width, so the bus hugs
whichever kerb it is on and stays outboard of the electric cars' lane (they run 3.5 m off the
centreline and steer round nothing). Two rectangles rather than more because only five streets
are wide enough, and two routes sharing a street would share one lane head-on.

- `sim/buses.ts` — the whole behaviour is one scalar, how far round the loop it has driven:
  ease down over 26 m into the next calling point, stand 6 s with the doors open, ease back up.
  A bus is **not** a target: it cannot be shot, shoved or destroyed, so its position is a pure
  function of how long the world has run, every screen agrees about it for free, and it needs
  no bytes on the wire.
- Solid via **four wall segments per bus**, reserved last in `ArenaLayout.walls` by the world
  builder and rewritten in place each tick before the collision pass. Segments, not a box: an
  axis-aligned box round a bus at 45° is a wall across half the street that nothing on screen
  accounts for. Nothing in the step allocates.
- `scene/busVisual.ts` — four merged meshes per bus (body, lit panels, transit-atlas panels,
  additive glow) plus a per-instance door light. Under a hemisphere key a dark vertical slab is
  a silhouette and nothing else, so what tells you this is a bus and how long it is are its
  lit window panes, the roofline ad screens on both sections, and the amber line under the
  skirt — not its shape.

**Measured.** City runtime 31 -> 48 draw calls and 165.0k -> 170.8k triangles with four buses
on screen (env builders unchanged at 14 draw calls / 163.3k, inside the 20-call budget); 72 FPS
in the debug overlay driving beside one. 423 tests green (13 new in `tests/cityWorld.test.ts`:
placement, shelter colliders, the lanes being on real asphalt and clear, calling only at
shelters on the driven kerb, a five-minute drive of every loop, the four walls tracking the
body, and the car bouncing off a bus instead of through it).

**Known gaps.** The electric cars still steer round nothing, so at a junction one can cross a
bus's lane and pass through it — the same thing they already do to each other. One route has
only two calling points, because the shelters near its legs mostly landed on the far kerb.

## The city reclaimed by nature (2026-09-07)

Juan's brief: the city looked *landscaped* — a hedge or a palm every seven metres along every
block ledge in the map, all the same size, all the same spacing. It should look like a city
that has been let go and grown over, gritty and cyberpunk, not post-apocalyptic. Two concept
renders came with it. After the first pass he added: **most** of the city should have plants,
not a handful of pockets, and the procedural graffiti doodles should be replaced with the six
real graffiti images he supplied.

**The one field.** `render/scene/env/reclaim.ts` answers "how far gone is this spot" for the
whole map, and every plant, tag, stain, vine and blank ground-floor wall is placed from it — so
a vine, the weeds under it and the paint beside it belong to the same place instead of being
three independent coin flips. It is a floor (`baseNeglect`, the city as a whole) plus radial
POCKETS on a 46 m grid (`pocketChance`, the places that have gone feral), biased per zone so
the corporate core is the best-kept part rather than a clean one. Pure arithmetic over a
position: no state, build time only, never in the render loop. It rides on `EnvBuilders`, so
every builder asks the same field the same question.

`RECLAIM.baseNeglect` is the single knob for how green the city is. At 0.45 the split is
8 % kept / 45 % lightly grown / 36 % overgrown / 12 % feral.

**What reads from it.**

- `plants.ts` — the kit: canopy tree, crooked street tree, palm, sapling, shrub, fern, weed
  tuft, vine, dead tree. Canopies are opaque faceted BLOBS (a six-lune closed lump, twelve
  triangles) rather than alpha leaf cards: cheaper, no sorting, and they silhouette against
  the neon. Leaf normals are tilted skyward (`MeshBuilder.normalUp`, new) because this city is
  lit by a hemisphere light and an unbiased vertical leaf facet comes out black.
- `reclaimBuilder.ts` — where it all goes. The pass that carries the look is **the verge**: the
  paved shoulder beside every ground-level street, which the kerb field already sizes and the
  street lamps already stand on. A block's own ledge is ten metres further back, so what grows
  there is scenery and what grows on the verge fills the frame. Also block ledges, the inside
  of blocks, alley walls and barriers, the perimeter retaining wall, viaduct columns and
  fences, the quay, and kerb-side retaining walls built into the strongest pockets.
- `buildingReclaim.ts` — per building: a ground-floor module where the place has given up,
  creeper down the facade, weeds in the joint, a drift of growth on a low roof.
- `groundFloor.ts` — nine interchangeable lower-floor modules (service wall, shutter, parking
  podium, maintenance bay, retaining wall, utility facade, underpass colonnade, ruined
  storefront, panelled wall). Each one hands back METADATA — paintable rectangles with
  keep-clear zones, vine lips, planting strips, prop anchors — and the reclamation passes read
  only that, so nothing is ever painted over glass.
- `graffiti.ts` — one atlas, one material, one draw call for every tag and every damp streak.
  Twelve cells are Juan's art out of `public/textures/graffiti/`, each used twice (once
  mirrored), loaded in the background behind a procedural fallback; four are procedural dirt
  (streaks, stain, cracks, soot) tinted with `PAL.grime`. Decals are alpha-blended without
  writing depth and polygon-offset off the surface, so nothing z-fights.

**Collision.** Nothing here has a collider and nothing needs one: every plant, tag and plinth
is inside a collider the simulation already has, hugging the face of one, or over four and a
half metres up where a bus passes under it. `tests/reclamation.test.ts` sweeps every vertex of
the greenery and decal builders against that rule; the plant kit clamps its own canopies,
fronds and trunk leans against it (`OVERHANG_CLEAR`), and the ground modules clamp every box
they draw to the pavement they stand on.

**Measured** (city, 1600x900, headless M3 Pro). Env builders 162.0k -> 213.4k triangles and
17 -> 18 draw calls (the one decal material). Runtime worst view 179.3k -> 231.8k triangles,
50 -> 58 draw calls, 21 -> 25 textures, 33 programs unchanged. GPU 1.4 ms -> 2.6 ms average on
a 16.7 ms frame; 60 FPS held in every view, no console errors. That is above the ~200k
guideline in AGENTS.md and deliberately so — the direction is a green city, the cost is about
a millisecond of GPU on a frame with twelve to spare, and `baseNeglect` trades the two off.
457 tests green, 20 of them new.

**Known gaps.** No runtime LOD: the environment is merged per material with `frustumCulled =
false`, so every triangle is submitted every frame and detail is tiered at build time
(archetype mix by intensity, one mark instead of a composition on far surfaces) rather than by
distance. Chunking the greenery into ~120 m meshes would cut submitted triangles several-fold
at the cost of a handful of draw calls, and is the obvious next move if the budget ever bites.
Graffiti is not placed on tower facades above the first three metres except in the worst
pockets, so the tall blank walls in the corporate core stay bare.

## The storm sky (2026-09-07)

Juan's reference: a night storm over the city — near-black navy overhead, deep desaturated
teal through the body of the sky, a brighter cyan-grey industrial haze along the skyline,
several large layered cloud banks with real depth in them, a magenta wash under some of them
from the city's own light, and lightning that briefly shows what is inside the cloud. What
was there instead was a 512 x 256 canvas gradient set as `scene.background`, which could not
move, could not be lit, and would have tiled visibly the moment anything was drawn into it.

**The sky is geometry now.** One inverted 500 m sphere centred on the camera, drawn first with
the depth test off, which is the background in the only sense that matters: everything else
paints over it. `scene.background` is null and `makeSkyTexture` is gone. `scene.environment`
stays exactly as it was — it is what the wet road and the car paint reflect.

**The clouds are a projection, not a texture** (`env/skyDome.ts`). Each layer is a plane at a
notional height and the view ray is projected onto it, `p = d.xz / d.y`. That divide is where
the depth comes from: straight up a formation reads at its true size, and towards the horizon
the same noise stretches without limit into the long banks a storm ceiling actually shows. Two
layers at different heights, scales and (very slow) drifts move against each other; the near
one's domain is bent by the far one's, so neither noise lattice can survive into the image.
The shape is fbm value noise from a hash — no texture, no period, nothing to repeat.

Three things carry the look beyond that. Detail is flattened towards the mean in step with how
fast the projection runs past a pixel (`hazeStart` / `hazeEnd`), which is both the
anti-aliasing and the aerial haze. A layer reads darker where its UNDERSIDE is in view
(`cloudUnderside`), so the ceiling overhead stays near-black while the banks along the skyline
keep the light they catch — without that term the whole sky filled with pale grey. And the
magenta is pushed into the thick parts of a layer (`pollutionFocus`) rather than spread evenly,
which is the difference between light coming up through a few banks and a pink band painted
across the horizon.

**Lightning is weather, not the weapon.** `env/storm.ts` is a clock with no Three.js and no DOM
in it, so it is unit-tested: irregular gaps skewed to the short end, and a strike is two to
four sub-flashes at uneven spacing with decaying peaks, because a single symmetric flash reads
as a light switch. `env/atmosphere.ts` spends one strike in five places at once — the sky (lit
through the RAW noise, so the flash reveals structure rather than a silhouette), the fog colour
(the one that does the most work: distant blocks are mostly fog by the time they reach the eye,
so lifting the air in front of them turns the skyline into silhouettes), both scene lights, the
environment map (the wet-road flare, for free, with no new material and no new pass), and the
rain.

**Rain** (`env/rain.ts`) is one `LineSegments` animated entirely in the vertex shader. The wrap
includes the camera's world position, so — `mod` being periodic — the field is anchored in the
world and drops stream past a moving car with no jump when the box moves, and the streaks are
raked back by the camera's own motion.

**Controls.** Everything is in `ATMOSPHERE` in `src/config/tuning.ts`: sky colours, horizon
glow, coverage, softness, contrast, the two scales and the two drifts, light-pollution colour /
intensity / focus, fog colour / tint / density scale, storm frequency / intensity / colour and
the five things a flash lifts, rain, and the quality level. Live from the console:
`__rb.atmosphere.config.coverage = 0.8; __rb.atmosphere.refresh()`, and
`__rb.atmosphere.strike()` fires a bolt on demand. `?atmos=low|medium|high` pins the preset for
a capture, the way `?scale=` pins the render scale; `auto` is high on a pointer device and
medium on a touch one. The three levels differ only in noise octaves, whether the second cloud
layer is drawn, dome tessellation and rain count — never in colour.

**Measured** (city, 1600x900, headless M3 Pro). Two extra draw calls and no extra render pass.
Best of four interleaved runs with the dome and rain toggled, camera parked so the sky fills
the frame: **0.30 ms of GPU**, of which the dome is 0.24 and the rain 0.06. The perf gate
passes in both runs — 33 programs start to finish (nothing compiles mid-play), worst frame
16.8 ms, draws within budget, no console errors. A hidden tab batches the whole atmosphere into
one coarse step every 0.5 s, which is what the capture scripts drive it through.

**Midnight, not dawn.** The first pass read as about 6 a.m. — Juan's note — so the whole
palette came down: zenith, middle and horizon darkened, `horizonGlow` 0.55 -> 0.34, both cloud
colours darkened, `cloudUnderside` up, `pollution` 0.5 -> 0.42, and `fogTint` 0.55 -> 0.7 so
each world's own haze is pulled further into the night. Checked as numbers rather than off a
thumbnail (a downscaled screenshot of this city is not readable): 64 x 64 patches read straight
out of the drawing buffer, camera above every roof so the sample is the dome and nothing else.
Sky luminance fell 52 % at 3 degrees of elevation, 52 % at 15, 69 % at 30 and 85 % at the
zenith. The road is unaffected — it is lit by the palette's own hemisphere light, not by the
sky — and a strike now has somewhere to go: the calm-to-flash contrast is far stronger against
a black ceiling than it was against a blue one.

**Known gaps.** The storm has no thunder — the audio layer is untouched. Rain falls through
roofs, viaducts and tunnels: there is no occupancy test, and adding one would cost the single
draw call the whole system is built around. The reflection env map is still the small canvas
equirect from before, so the wet road reflects a generic night sky rather than this one; the
flash reaches it through `environmentIntensity`, not through its pixels.

## The open world is a server (2026-09-07)

Free roam stopped being single player. There is no new mode and no new menu category: **OPEN
WORLD is inherently a server** now, so picking it joins the one city everybody shares. Same car,
one colour each, up to eight of them.

**One permanent room.** The match server already held many rooms (`server/rooms.mjs`); the city
is one more, on a reserved code (`WORLD_ROOM_CODE = 'WRLD'`), with two differences from a versus
room. It is opened when the process starts and never reaped, so `GET /rooms` can report an empty
city rather than no city — which is what lets the main menu say `ONLINE 2 / 8 DRIVING` before you
commit to anything. And its code is reserved: `freshCode` never mints it, and `join` routes it to
the city whatever the connection claimed it wanted, so a versus room can never collide with it.

**The same room with the phase machine taken out** (`server/room.mjs`, `mode: 'world'`). No match
to start, nothing to be ready for, nothing to load, no flag: the phase is `roaming` from the
moment the room opens, and cars are fanned out the whole time instead of only during a race.
`start`, `ready` and `finish` are ignored. Everything that is not about racing is shared code with
versus — the roster, the host, the clock, the snapshot fan-out, the host-owned electric-car
traffic (`createCityWorld()` is deterministic, so every client builds the same road).

**A slot is an identity, not a grid position.** A racer's slot is handed out per match; a roamer
takes the lowest free one at the door and keeps it until they disconnect, when it goes back in the
pool — so a room that has churned all evening still shows cyan, magenta and lime rather than four
cars in the last four colours. `SLOT_COLORS` grew from four to eight to match, and
`MAX_WORLD_PLAYERS` is capped at exactly that: the city cannot hold more cars than there are
colours to tell them apart with.

**A field that changes while you drive.** This was the real client-side work. A race builds its
rivals once and never touches the set again; the city cannot. `createRivalSet` gained `sync`,
which reconciles the tracks against a roster and reports whether anything actually changed —
keeping the samples of every car that stayed, so somebody joining does not make the car ahead of
you jump. `all` is the same array throughout, because the game, the minimap and the name tags all
hold the reference from the moment the world was built. `src/game.ts` mirrors that: rival visuals
are pooled by player id and re-aligned on each roster event (a car is built when someone drives
up, removed from the scene and disposed when they quit), and `src/render/nameTags.ts` does the
same with its DOM tags. `ownsTraffic` became a function rather than a captured boolean, because in
the city the host changes hands the moment they leave and the client that inherits it has to start
publishing.

**What the player sees.** A roster under the minimap (`src/ui/onlinePanel.ts`): `ONLINE n/8`, one
row per car in that player's colour, yours marked. It is the open world's whole multiplayer UI —
there is no lobby to sit in and no results screen to come back to — and it is directly under the
map because the two answer the same question a second apart: the map says where the coloured dots
are, the roster says who they are. Rows are rebuilt only on a roster change, never per frame. The
minimap needed nothing: it already drew rivals in slot colours for versus.

**Arrival.** The city has one spawn, so eight cars would land inside each other.
`src/world/arrivals.ts` fans them out from the slot — three abreast, then a row behind — in the
spawn's own frame, so it still points down the street whichever way the street runs, and slot 0 is
left exactly where the single-player city always put it.

**R is a rescue here too**, not a restart: resetting the world would reset money and traffic other
people can see, so R puts the car back where it came into the city.

**Falling back.** A city with no server is still a city. `?mode=city` waits up to 4 s for the
server to name the room (the slot decides the car's colour and where it appears, so the world
cannot be built before that), then drives alone and says so — and `?mode=city&solo=1` asks for
that outright, which is what the capture and QA scripts now use so nobody else's car turns up in a
screenshot. Reloading closes the socket on `pagehide` rather than waiting for the browser to get
round to it, so a player who reloads twice is not holding three of the eight colours.

**Protocol 3 -> 4**: `RoomInfo.mode`, the `roaming` phase, `MAX_WORLD_PLAYERS`, the reserved code
and label. `tests/protocol.test.ts` checks all of it against `server/protocol.mjs` as before.

**Tested.** 505 unit tests green, typecheck and production build green. Six new end-to-end tests
drive a real server through the city (a car straight in with a slot; slots handed back; cars
relayed with no match in between; `start` ignored; more cars than a race grid; listed even when
empty), plus the reconcile and arrival-fan tests. Verified in the browser against
`npm run host`: three cars in the city at once, each the right colour on every screen, name plates
and minimap dots correct, a car appearing and disappearing live as a player joins and quits, the
menu's live counter tracking it, and the versus room browser correctly not listing the city.

## The versus circuit: a race inside the open world (2026-09-07)

Juan asked for a circuit for VERSUS that takes place inside the city rather than beside it,
with the city itself untouched. The first attempt was wrong and he said so: it followed the
street grid, so every corner was a junction and every junction branched into two dead-end
run-off pockets — confusing, and nothing like a circuit. He also asked for the highway, for the
lap to go through the buildings, and for the barrier to be a subtle hologram rather than a
fence of vertical sticks. Rebuilt from that.

**Bandido Grid.** 1.54 km, sixteen corners, two laps. A lap: up st-west and east along
blvd-center; north up av-main between the skyscrapers; east along blvd-north, still in
downtown; south down av-east and east on st-n2; up the east on-ramp onto the VIADUCT, down its
east leg, round the 60 m south-east sweeper and west along the deck OVER THE BAY; down the
south off-ramp onto the waterfront and into turn one. A third of the lap is fifteen metres up,
and every lap climbs and drops 30 m.

**The ribbon, not the street plan.** The rebuild's one idea: the lap is a filleted racing line
and the barrier is simply its two edges, span by span — two continuous curves round the whole
lap. No branch, no stub, nothing standing across the road; a side street is closed because the
barrier sweeps past its mouth, and there is nothing to drive into by mistake. Once the barrier
is allowed to curve (which is what Juan's note unlocked), corners become radiused arcs taken
across the junctions instead of the L-shaped street corners the first version was stuck with.

The cost of inventing a racing line rather than borrowing the streets is that it can leave the
asphalt, so that is what the tooling checks: `scripts/circuit-preview.mjs` walks the ribbon edge
to edge, AT ITS OWN HEIGHT, against every road in `citySpec.ts` — streets, ramps and the viaduct
— and prints, per corner, the largest radius that still fits. Tuning the lap was ten minutes of
reading that table. `tests/circuitWorld.test.ts` runs the same check.

**Heights.** The lap borrows the ramp and viaduct nodes verbatim (listed in `CIRCUIT_BORROWED`
and pinned against `citySpec.ts` by a test) and anchors y at 0 on the street and 15 on the deck.
The barrier does NOT take its height from the ribbon, though: each span asks the city's own
surface field what the road is at that point, so it sits on the ramp however the two paths'
grades happen to differ, and its collider is bracketed to that level — a barrier on the viaduct
is not an invisible wall in the street fifteen metres underneath it.

**The barrier.** Low and mostly light: a knee-high kerb unit, a chevron on its face pointing the
way the lap goes, a hairline along the top and a thin additive curtain above it, about a metre
tall in total. The first version was a solid lit panel and deleted the city; the second was an
upright fence and Juan called it ugly, correctly — the reference he sent is a row of LED
delineators, and that is what it is now. Amber on the outside of a corner, cyan everywhere else.

**The city around it.** Street traffic and buses come out (fixed routes, no steering — they
would drive through the barrier). The viaduct keeps its traffic, thinned to the file that runs
the way the race does, because the lap shares that deck with it for a third of its length;
which way a patrol goes is read off twice the signed area of its own loop rather than off the
order the city built them in. Ten more cars go on the lap itself.

**Timing.** The estimator (the same speed profile `track-preview.mjs` uses, so the circuits
compare directly) says 63 s a lap, 126 s for the race.

**Wiring.** New `GameMode` `'circuit'`; `?mode=circuit` drives it alone, and `VERSUS_MODE` in
`src/main.ts` is the one constant pointing the versus lobby at it. RACE in the menu is still the
Bandido Loop, untouched. The server's `RB_LAPS` default is now 2 to match.

**Tested.** 524 unit tests green (17 new), typecheck and production build green. The new file
pins the copies of `citySpec.ts` this file has to keep, the ribbon-on-road check, the barrier
being unbroken and never in a building, its colliders being bracketed to their own level, the
gates, the grid, the traffic direction on the deck, and the triangle budget (the barrier adds
~40k in the same 19 draw calls). The last test drives the whole race on the autopilot through
the real physics — up the ramp, over the bay, back down — and takes the flag. In the browser at
`?mode=circuit`: 120 fps, 1.3-2.6 ms GPU, no shader compiled mid-play, 61-74 draw calls. And
`npm run qa:mp` raced two real browsers on it end to end, green: traffic agreeing to 0.10 m
(p95), nothing off the circuit, both players the right colour on both screens. That run earlier
found a bug in the harness rather than the game: `qa-mp.mjs` tested "inside a building" in two
dimensions, which calls every car on the viaduct a car in a wall, so it now respects `maxY` the
way `src/sim/collision.ts` does.

## Rayo Rush: a free-world activity (2026-09-07)

A ninety-second time attack you find in the city rather than pick off a menu. Drive into a marked
patch of `blvd-center`, take it up, and the next ninety seconds of ordinary free roam are scored:
every electric car you disable with the Rayo is worth points, chaining them multiplies those
points, and drifting into the shot is worth more again. When the clock runs out you get a card
and go back to driving.

**It is not a mode.** No load, no separate map, no second simulation, nothing torn down at the
end — the whole activity is one rules module (`src/sim/rush.ts`) that runs LAST in the tick and
only watches. It never moves a car, never touches the lightning, never changes what the player
may do. `stepGame` calls it after `stepLightning` and `applyRewards`, so it scores the
`targetDestroyed` events the tick already raised, and the ¥ economy is untouched: a kill during
a run still pays exactly the money it always did, and the run's score is a separate number.

**What counts.** Only a kill made by this player's own Rayo — the only thing that raises
`targetDestroyed` at all (a shove never destroys; another player's kill in the open world comes
in through `src/sim/traffic.ts` and is not an event here). And only once per car, which is what
`RushState.scored` is: one flag per electric car for the length of the run, so a car shot,
respawned twelve seconds later and shot again is worth nothing the second time. With 126 cars in
the city that is anti-farming, not a shortage.

**Scoring**, all of it in `RUSH` in `src/config/tuning.ts` and nowhere else: 100 a kill; a chain
window that multiplies x1, x1.5, x2 … to a x5 cap and drops to nothing if you take too long; a
flat bonus plus per-second and clean-drift bonuses for a shot fired out of a slide. All charge
comes from drifting, so "charged through drifting" had to mean something sharper than "had
charge": it means the shot came out of a drift — during one, or inside a grace after it ended,
because the slide is over by the time the nose is pointed at anything.

**The marker** (`src/render/scene/env/rushMarker.ts`) is paint and a light, not an object in the
road: a hazard ring stencilled on the asphalt, two chevrons pointing into it, and a glyph hung
well over roof height. No collider. It warms and quickens as you close on it and drops to a trace
while a run is on.

The glyph started as a textured plane and Juan asked for it bigger and, if possible, 3D — which
it should have been from the start, because a spinning plane is edge-on twice a turn and the
thing vanished at exactly the moment the rotation was meant to be reading. It is now an extruded
bolt (3.8 m tall, nearly a metre deep, so side-on it is a bar rather than a line) inside a broken
torus tilted off vertical, the two counter-rotating at different rates. Its solidity is carried
by VERTEX COLOUR, not by light: the city is hemisphere-dominated, so a lit material shades every
vertical face identically and the extrusion would have read as flat as the plane it replaced —
bright caps and deep sides put the contrast in the geometry, where a turn can show it. A
back-facing shell scaled 1.09 gives the neon bleed round the silhouette. The wordmark came off
the plate and became a `THREE.Sprite`, so it billboards itself and stays square to the driver
while everything under it turns; it hangs below the halo rather than above because the chase
camera looks slightly down and anything above ends up in the top of the frame where the controls
card is. Eight draw calls and 978 triangles for the whole marker.

Juan then asked for that wordmark three times the size, which stopped it being a nameplate that
tucks inside the ring: at 9.3 m wide it is 2.3 m tall, and there is no room for that under a
2.8 m halo hung at 6.9 m without dropping it into bus-roof height. So the glyph rides higher
(8.6 m) and the sprite hangs off the BOTTOM OF THE HALO by construction rather than at a typed-in
offset — resize the wordmark now and it moves out of the ring's way on its own instead of quietly
growing back into it. The canvas carries about a third of its height as transparent margin, so
the visible word sits around 3.9-4.9 m: clear of the 3.75 m buses that run this boulevard.

**Marked cars** wear the electric car's OWN acquisition ring in the system's amber, held steady
instead of pulsed — the cyan lock always wins when both apply. Only the nearest fourteen inside
62 m, chosen by `markRushTargets`, which is the same predicate that decides what actually
scores, so the ring and the rule cannot disagree. Measured in the browser: a live run costs 9
extra draw calls and ~1.5k triangles over free roam, against ~130 draws and a hundred rings if
every car were marked.

**The prompt is the paint.** It first went up inside a 26 m catchment around a 7.2 m painted
circle, so the sign hung around for half a block after you had left — Juan's note was that it
should show when you step on the icon and go the moment you are not on it. So the trigger IS the
circle now: `RUSH.marker.promptRadius` is 7.5 m, `rushMarker.ts` reads that same number to draw
the ring, and there is nothing to keep in sync because there is only one number. `exitRadius` is
8.4 — enough that a car parked on the line cannot flicker the prompt, not enough to read as a
lag. Rolling onto the paint also raises a `rushPrompt` edge, which is what the chime listens to.

**On the map.** The marker is drawn on the minimap in the chrome's hazard yellow — a ringed
bolt on a dark disc, which is the only yellow anything on that map uses, so the eye finds it
without being told to look. It rides in the base layer with the roads, because it never moves and
so costs nothing per frame, and it is drawn at a fixed PIXEL size rather than to world scale: a
7.5 m circle in a 540 m city is under three pixels on a 176 px map, and a mark the player is
meant to spot has to be sized for the eye rather than for the ground. `MinimapData.activities`
carries it, filled by `cityWorld.ts` from the same `RUSH_SITE` the rules and the art get, so the
map cannot send anyone somewhere the marker is not. This is the opposite call to the one made
about the electric cars, and deliberately: a car is quarry and hunting it is the game, whereas an
activity is a destination, and a destination nobody can find does not exist.

**The chime.** `oneShots.pickup()`, in the arcade pickup idiom Juan asked for (Vice City's money
grab): three notes rising root-fourth-octave on triangle oscillators through a high lowpass, a
quiet sine an octave over each for the glassy top, and a bright noise tick on the leading edge
for the first note to land on. Over in a fifth of a second — it is a "you are standing on it",
not a fanfare. Synthesized like everything else here; no asset. Only on the way in: rolling off a
marker is not worth a sound.

**Interface.** `src/ui/rushOverlay.ts` is a HUD sub-component, composed into `createHud` the way
the tacho and the gauges are and under the same contract (built once, diffed writes, WAAPI
flashes). The count-in is not its own element: `3 — 2 — 1 — RAYO RUSH` reuses the race
countdown's. Prompt low and centred, clock/score/streak in the top gutter under the controls
card, kill feed up the left edge, and only the results card takes the middle of the screen —
`EV DISABLED +100`, `CHAIN x3`, `CLEAN DRIFT CHARGE BONUS +143`. One button does the whole
activity (F, pad R3, or a click/tap on the prompt itself), and the marker stays quiet after a
run until you have driven away and come back, so dismissing the card never drops you into a
prompt for the run you just finished.

**The board.** Three plain HTTP routes on the same server (`server/leaderboard.mjs`,
`src/net/leaderboard.ts`) — not the socket, because a scoreboard is a request and a response and
it has to work for someone driving the city alone. A small JSON document, debounced to disk
under `RB_DATA_DIR` (or `.data/`, gitignored); point that at something that survives a deploy or
the board resets with each release. One row per player, their best. Three ranked attempts per
UTC day, enforced server-side and mirrored in localStorage so the prompt can say a number before
the network answers. Identity is a random id the browser mints and keeps: no accounts, and
clearing site data buys a fresh allowance — a known hole, and the same trust model
`src/net/protocol.ts` already states. **The activity never waits on it.** Server down, no
socket, opened off a file: you still get the marker, the countdown, the two minutes, the score
and a personal best. You just lose the global board.

**The sign's size.** It went up twice — 30% first, then "bigger, don't be shy" — which is what
finally made it worth building properly. It is now one number, `--rb-prompt`, with the type
inside in `em` against it and the box in `calc()`: one value moves the panel, every line, the
padding and the key badge together. That number follows the WINDOW rather than sitting at a fixed
px, because a sign sized for one monitor is the wrong size on every other one —
`clamp(11.2px, 1.2vw, 17.6px)`, so it is the same share of the screen at 1280 as at 3440, with
`max-width: 94vw` as the backstop where the longest line wraps (balanced) instead of running off
a phone. It overshot at first and came back 20%; scaling the three numbers in that clamp by one
factor is the whole retune, at every window width at once. Body text settled at 14.4px against
the 9px it started at, a little over 1.5x.

That change also turned up a real bug: the rule carried the usual `font: inherit` button reset
AFTER the size, and the `font` shorthand resets `font-size` with everything else — so the sign
was silently rendering at the browser's own 16px rather than at its own value. It is
`font-family` and friends now, spelled out.

**Duration.** It ran at two minutes first; Juan cut it to ninety seconds. A one-line change,
because the length lives only in `RUSH.durationSeconds` — the prompt reads it to say what it is
promising and the clock reads it to know where to start, so there was no second copy to go stale.

**Tested.** 578 unit tests green (35 new: 25 rules, 10 board), typecheck green. `tests/rush.test.ts` pins the two
things most worth pinning — a kill on the very last tick is paid and nothing after it is, and one
car can never pay twice — plus the chain curve and its cap, the streak lapsing, the drift bonuses,
the count-in, the re-arm, the prompt appearing and vanishing with the edge of the paint, and the
marker standing on a road, clear of anything solid, with traffic around it. `tests/leaderboard.test.ts` starts a real server on a throwaway data dir and drives the
three routes: the allowance, one row per player, refusing a spent day and refusing an implausible
score without spending an attempt. In the browser at `?mode=city`: prompt, count-in, chains to x3,
drift bonuses, the card with a new personal best, dismiss, and the same run again against a real
server on 8088 — filed, ranked, and the prompt down to `NO RANKED ATTEMPTS LEFT TODAY · PRACTICE
RUN` once the day was spent.

## One RACE tab: the city circuit, alone or against a grid (2026-09-08)

Juan: "without discarding the current circuit under Race, lets have that Race tab render the new
city circuit we have in Versus. Also, lets just merge both tabs. Lets call it Race and one can
choose to either race offline or Versus, by joining or creating a room."

**What was wrong.** The main menu had three cards, and two of them were races on two different
tracks: RACE was the Bandido Loop (`raceSpec.ts`, the standalone circuit) and VERSUS was the
Bandido Grid (`circuitSpec.ts`, the lap cut through the open-world city). So the first question
the menu asked was "which track", and the answer silently decided whether anyone else could be on
it — you could not run the Grid alone without knowing that `?mode=circuit` existed, and you could
not race the Loop against anyone at all. Company and track were tangled into one choice.

**What it is now.** Two cards on the main menu — OPEN WORLD and RACE — and RACE opens a second
screen (`?race=1`, `src/ui/raceMenu.ts`) with the only question that was ever really being asked:

| | | |
| --- | --- | --- |
| OFFLINE | `?mode=circuit` | the Bandido Grid on your own, against the clock |
| VERSUS | `?mp=1` | the room browser, then a lobby, then a grid of up to four |

Both run the same circuit, so switching between them is not switching track. `VERSUS_MODE` in
`src/main.ts` was already `'circuit'`; the offline half now points at the same constant's world
rather than at a different one.

**Nothing was discarded.** The Bandido Loop is still built, still tested (`tests/raceWorld.test.ts`,
`tests/track.test.ts`) and still what the perf gate measures — `npm run perf -- --mode race`
drives it, and `?mode=race` opens it. It is off the menu, not out of the build.

**The shell the two menus share.** The main menu's list-plus-dossier markup moved into
`src/ui/menuScreen.ts` and both screens are built from it, so arriving at the race menu is the
same terminal one screen deeper rather than a second screen that happens to look similar. It also
carries the one thing that differs between them: `setSpec` rewrites a single dossier row after
the screen is drawn, which is how the main menu shows how busy the city is (`ONLINE 2 / 8
DRIVING`) and how the race menu shows how many rooms are open (`ROOMS 02 OPEN`) — both polled over
`GET /rooms`, both saying `NO SERVER` rather than `0` when there is nothing to ask.

**ESC goes back where you came from**, which is now one level rather than always the top: out of a
circuit or a match to the race menu, off the race menu to the main menu, off the room browser to
the race menu (the lobby still goes back to the rooms, as before). The OFFLINE card keeps RACE's
magenta and VERSUS keeps its cyan, so the colour follows the mode across the two screens.

**Verified in the browser** at 800x450 on the dev server: both main-menu cards and their dossiers;
RACE > OFFLINE building the Grid in the city with its barriers, LAP 1/2 and the countdown; ESC
back to `?race=1`; RACE > VERSUS reaching the room browser and its ESC back to `?race=1`; the race
menu's ESC back to the main menu; and `?mode=race` still opening the Bandido Loop, which the
minimap tells apart from the Grid at a glance. 588 unit tests and typecheck green; no console
errors beyond the expected `GET /rooms` refusals with no match server running.

**Back and forward had to be fixed with it.** Every route here is an address entered by loading
it, which makes the browser back button a real way to move between the screens — and it was
landing on a blank page. The back/forward cache was handing back the screen exactly as it was
left: a menu caught mid-exit, still wearing `is-leaving` (`opacity: 0`, a 200 ms fade against a
180 ms navigation, so the frozen frame is already invisible) and still holding the `done` flag
that stops it answering a second choice. Not just blank — dead to a click. A restored page now
reloads (`pageshow` with `persisted`), which costs the build again, is what would have happened
had the browser not cached the page at all, and makes every arrival identical: the address
decides what is on screen, always. It fixes the worlds too, where a restore would otherwise give
back a paused frame loop and a socket the server gave up on long ago.

**A mode name is a wordmark, so it stays on one line.** `OPEN WORLD` was wrapping in the list.
The list is wider (390px), and the name and the kicker beside it are both `nowrap` and both
scale with the viewport (`clamp(16px, 5.4vw, 30px)`, and the kicker’s letter-spacing with it), so
below the width where the panel stops growing they come down together rather than one of them
folding. Full 30px at desktop, one line at 375 and at 320 with the row’s own padding intact.

## Rayo Rush becomes three missions (2026-09-08)

The activity now has a shape to get through rather than just a score to beat. Three missions, in
order, each asking for more than the last — 1,200, then 3,000, then 6,000 — and each driven
somewhere else in the city. Clear one and the marker packs up: the paint, the chevrons and the
hologram re-appear at the next site, the map's yellow mark moves with them, and the sign there
is asking for the bigger number.

**The whole progression is one integer.** `RushState.cleared` — how many missions are finished —
and everything else is derived from it: which mission is on offer (`rushLevelIndex`, clamped at
the last), what it asks for (`rushTargetScore`), which street the marker stands in
(`rushSiteFor`). There is no second copy to fall out of step, which is why the marker cannot end
up at one corner while the target belongs to another. The rules move it forward by exactly one,
at the flag, and only from the level it currently points at — so beating mission 1's number while
standing on mission 2 clears nothing.

**Where is the world's business, how much is the rules'.** A target score is a tuning value
(`RUSH.levels`); a street corner is a fact about Bandido Bay (`ArenaLayout.rushSites`, one per
mission, each carrying its own name). `rushSiteFor` is the only place the two lists meet,
including the clamp that lets a world ship fewer sites than there are missions. The three:
CENTRE BOULEVARD where the marker always was, DOWNTOWN CANYON on `av-main` between the towers
with traffic on both sides of a 20 m street and `alley-e` to chain into, and THE WATERFRONT on
`blvd-water` by the quay — the hardest to hold a streak in, because the bay takes half the
escape routes away.

**Progress is the browser's, not the board's.** `src/core/progress.ts` is localStorage and
nothing else: no fetch, no promises, nothing to wait for. That is deliberate and it is the seam
to cut when there is a database — every reader goes through `readRushProgress` / `writeRushProgress`
and progress never travels any other way. It is kept apart from `src/net/leaderboard.ts` because
that module's localStorage is a *mirror* of something the server owns, and mixing the two would
mean a mission un-clearing itself because a fetch failed. So a run made offline, or with the
day's three ranked attempts already spent, still advances the chain: clearing a mission is a fact
about the driving. Everything read back is treated as untrusted — a count from a build with four
missions in it clamps to three, a short `best` array grows, junk reads as a fresh player.

**On screen.** The prompt gained a strip under the wordmark — `MISSION 2 / 3 · DOWNTOWN CANYON` —
and its third line is now the bar to clear rather than a note about the board. The live readout
carries `TARGET 3,000` under the score, which flashes and turns to `TARGET CLEARED` the instant
the run crosses it, so "am I going to make it" is a glance and not a sum. The results card names
the verdict above the personal best: a filled yellow chip and where you are going next when a
mission falls, a red outline and how many points short when it does not. Once the chain is done
the marker stays at the waterfront and the sign says `ALL MISSIONS CLEAR` with no target at all —
the run goes on being worth driving for the global board, it has just stopped gating anything.

**Verified in the browser** at 800x450 on the dev server, driving all three end to end: mission 1
cleared on the boulevard, the card reading `MISSION 1 COMPLETE / NEXT · DOWNTOWN CANYON`, the
marker group found at (-70, -124) and exactly one yellow mark on the minimap, now downtown;
mission 2 and 3 the same; the all-clear prompt and its missing target line; and a reload picking
the chain back up at the waterfront with the marker already standing there rather than at the
first site. 605 unit tests and typecheck green.

## Why the open world felt less smooth (2026-09-08)

Juan reported the open world driving heavy on a very powerful PC while a Mac felt smoother, and
asked whether the server was to blame. It is not: with `?mode=city&solo=1` (no socket at all) the
city costs the same as with one open, and the sim side of a networked city is about 0.2 ms a
frame. Three real causes, in order of size.

**The browser is not using the fast GPU, and that is the whole story on this machine.** Chrome
reports `ANGLE (Intel, Intel(R) Graphics (0x00007D67))` while an RTX 5060 sits idle beside it.
The panel is 2560x1600 at 240 Hz with Windows on 150% scaling, so `devicePixelRatio` is 1.5 and
the canvas is 3.36 Mpx — 2.3x what the headless perf probe measures at 1600x900. The GPU timer
reads 5-13 ms a frame in every mode, city and circuit and race alike, which is the shape of a
fill-rate limit rather than a scene-content one. `powerPreference: 'high-performance'` is already
asked for in `createRenderer`; the override has to come from Windows Graphics Settings or the
NVIDIA control panel, per browser executable. Nothing in the repo can fix it, and until it is
fixed no code change here will make the difference Juan is asking about.

**The resolution governor could not react on a 240 Hz display, and now can.** Its down rule
compared the AVERAGE frame interval against `resolutionDownMs` (18.5 ms, the 60 Hz miss line).
Vsync only ever presents whole refreshes, so a game mostly running at 120 FPS and regularly
slipping to 40 averages about 16 ms and reads as healthy while every slip is a visible lurch —
judder is a property of the spread, not the mean. `resolutionDownShare` (0.25) now steps the
scale down when more than a quarter of the window's frames individually missed `downMs`, whatever
the average said. The `cpuBound` and `gpuIdle` guards still apply, so a frame the main thread
caused is still not answered with fewer pixels. Three tests cover it, including the exact
alternating 8 ms / 29 ms mix whose mean sits under the threshold.

**The city was running 1,666 Web Audio nodes to render silence.** Every electric car was given
its own hover hum — four oscillators, a looping noise source, a bandpass and six gains, thirteen
nodes, started at build and never stopped — and the open world holds 126 of them. `AUDIO.humFar`
puts an exact zero on anything past 55 m, so all but a handful were audible to nobody, and each
still took two `setTargetAtTime` writes from the main thread every frame. The voices are pooled
now (`AUDIO.humVoices`, twelve) and handed to the nearest cars in range, re-tuned to each car's
own pitch as they change hands; a car can only pick up a voice at the edge of `humFar` where its
gain is zero, so a hand-off is silent by construction. Measured by counting node construction:
open world **1,666 -> 184** nodes (506 oscillators -> 50), circuit 577 -> 187, race 184 -> 184,
which is the point — a race never had the problem and its audio graph is untouched.

**The traffic draw calls are over budget and were NOT fixed — deliberately.** `scripts/perf-drawcalls.mjs`
(new) attributes every draw call to its object, and it is the traffic: the environment is properly
merged at about twenty-five calls for the whole city, while 126 electric cars clone their own
materials and cost three or four calls each, reaching **248 calls looking down a long boulevard**
against a budget of 60. Hiding the distant ones looked free and is not: the city's haze is
`FogExp2` at `HAZE.cityDensity`, chosen precisely so the far side of the bay keeps contrast
instead of clamping flat, so a car at 165 m is only about a fifth hazed. A same-frame A/B (render
the identical frame with and without the far cars, diff the pixels) put the error at up to 100/255
against a harness noise floor of ~34 — a visible pop. By the distance the fog genuinely hides a
car, there is nothing left within it worth culling. A draw-distance cull was written, measured,
and reverted for that reason. The real fix is to instance the fleet, which would take those 248
calls to single figures; it is a shader-patch job for per-instance emissive and beacon opacity,
and it wants its own pass with the warm-up and the no-mid-play-compile gate in mind.

**Also.** `src/render/probe.ts` no longer lets an invisible object answer the F4 crosshair —
Three's raycaster does not test `visible`, so a switched-off mesh could name a surface that is
not on screen.

## Passengers: a free-world side ride (2026-09-08)

Alongside RAYO RUSH, an organic pickup: a violet pin stands at a stop, the car parks inside its
ring, `F` boards whoever is waiting, they say where they are going and how they like to be
driven, and a tip on top of a fixed fare says how the ride went. Three characters ship as static
data (`src/content/passengers.ts`: Mika wants speed and drifts, Vera wants calm and no sliding,
Nico wants clean Rayo hits and a steady car); adding a fourth is adding an entry, and
`tests/passenger.test.ts` validates every entry against the six preference kinds, the reactions
each obliges, and the city's stops.

- Rules: `src/sim/passenger.ts`, stepped after `stepRush`. Mood 0..100 moves per second for the
  speed rules (with a grace) and in rate-limited, capped steps for drifts, Rayo kills (once per
  car) and crashes (for everybody). A stopped car earns and loses nothing. `RushState.locked` /
  `PassengerState.locked` are written by `stepGame` so the two activities never overlap.
- Content is chosen before the ride (`planTrip`): character, both stops, fare, opening variant.
  The dialogue queue plays one prewritten line at a time with priorities, a stale drop for
  reactions, and no back-to-back repeats. No AI, no audio.
- Stops: `PASSENGER_STOPS` in `src/world/citySpec.ts`, tagged so the catalogue never names a
  coordinate; the test checks each is on a road, clear of junctions and of the RUSH sites.
- Presentation: `src/ui/passengerOverlay.ts` (prompt, ride panel with an SVG portrait from
  `src/ui/portraits.ts`, subtitle strip, fare card), `src/render/scene/env/passengerMarker.ts`
  (ring + beam, pickup and destination roles), violet marks on the minimap.
- Money is paid once, by `applyPassengerFare` in `src/sim/economy.ts`, on `passengerComplete`.
  A cancelled ride (second `F` within 2.5 s, `R`, a multiplayer rescue) pays nothing. Rides
  completed and the best tip persist under `rb.passenger.rides`.
- Tuning: `PASSENGER` in `src/config/tuning.ts`. Automation: `__rb.passenger.offerNow()`.

## El Búho and the Moogul: a free-world encounter (2026-09-08)

A man stands in an open bay under the viaduct's east leg — `BUHO_SITE` in `src/world/citySpec.ts`,
reached by turning off `blvd-center` under the deck at (245, 60) and driving 30 m north — selling
one thing. Roll onto his amber ring, `F` shows MOOGUL and the price, `F` again inside four seconds
charges the yen counter once (`spendMoney`, `src/sim/economy.ts`), he says one line, and an
eight-minute clock starts. What the clock drives is the city slowly coming alive and settling
down again; nothing else — no car, traffic, weapon or other player — is touched.

- Rules: `src/sim/buho.ts`, stepped last in `stepGame`. One press arms, the second buys; no money
  or a Moogul already in the player buys nothing and says so. `locked` is written from the other
  two activities, and a RAYO RUSH run or a passenger boarding ends the trip on the same tick.
  The clock is simulation time (`moogulElapsed`), so it stops with the tab and never bursts.
- Content: `src/content/buho.ts` — greetings, purchase remarks, a refusal and a "one is plenty",
  in his own Spanish; `validateBuho` is in `tests/buho.test.ts`. Portrait `buho` in
  `src/ui/portraits.ts`; `src/ui/buhoOverlay.ts` reuses the passenger prompt, portrait box and
  subtitle strip re-coloured amber.
- The envelope: `moogulIntensity` eases `MOOGUL.timeline.keys` (fractions of one `duration`), so
  the first minute is a normal city, the picture is barely there by 2:30, climbs, peaks between
  4:30 and 6:00 and is gone at 8:00. Each layer reads it through its own `[start, full]` window
  (`MOOGUL.layers`), which is what keeps them from all arriving at once.
- The picture: `src/render/scene/moogulTrip.ts` owns everything and lets go of everything. Sky,
  fog and the two lights are pulled towards two cycling moods FROM WHAT THE ATMOSPHERE WROTE THIS
  FRAME (a strike still flashes through it); facades and paint read two uniforms patched in at
  build (`env/moogulSurface.ts`: the window grid drifts across the concrete, tints and paint turn
  and pulse — no geometry moves, nothing recompiles); up to four faces stand on real panes of real
  walls near the car (`WallIndex.collect`, the volume's floors and chamfer, the atlas's pane
  layout), depth-tested and lifted 7 cm off the glass; a restrained colour separation and a slow
  swim ride the nitro blur pass (`FinishAmounts`, `render/post/speedBlur.ts`), middle of the frame
  exact. Reduced motion drops the swim and halves the rest.
- Cleanup: expiry, interruption, `R`, a multiplayer rescue, `dispose`. The shown amount eases
  down over `stopFadeSeconds`, then the sky re-reads `ATMOSPHERE`, the lights get their colours
  back, the uniforms go to zero and the faces go dark. Verified in the browser: every sky, fog
  and light colour identical before and after.
- Tuning: `MOOGUL` in `src/config/tuning.ts`. Development: `__rb.buho.scrub(300)`,
  `__rb.buho.timeScale(20)`, `__rb.buho.grant()`, `__rb.buho.status()`.
- Not done: no minimap mark for the bay (he is found, not handed over); faces only stand on
  buildings the kit registered (viaduct skirts and ground-floor modules have no panes anyway).
