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
| `npm test` | Vitest, 53 tests in 7 files (math, rules, vehicle, drift, fx, vehicleVisual, arena) |
| `npm run build` | Typecheck + production build to `dist/` (606 kB JS, 165 kB gzip) |
| `npm run preview` | Serve `dist/` on 127.0.0.1:4173 |
| `npm run qa` | Headless Chrome drive of the whole loop; writes `artifacts/*.png` and `artifacts/qa-metrics.json` (needs the dev server running) |
| `npm run qa:headed` | Same, in a visible Chrome window (use this for a real, vsync-limited FPS number) |

Controls: WASD / arrows drive, Space handbrake, Shift nitro, E or left click fires lightning,
R restarts, M mutes audio, F3 or backquote toggles the debug overlay. Browser automation hook: `window.__rb`
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

Multiplayer readiness: `PlayerCommand` is a serializable intent, `GameState` is plain data, rules live
in `src/sim`, rendering and UI only read state. No networking exists or is stubbed.

## Known risks

- Drift feel is verified only by headless tests and one scripted run; needs a human on a keyboard.
- Chase camera has no obstacle avoidance (pending item 2).
- The source GLB is never loaded; the proxy car is built from lofted primitives. No local decimation
  tool (gltfpack / gltf-transform) was installed.
- Headless FPS numbers are not vsync-limited; treat them as headroom, not the shipped frame rate.
- Multiplayer is a future requirement with no selected mode or networking model.

## Updates

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
