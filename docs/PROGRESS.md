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
