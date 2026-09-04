# Rayo Bandido

Browser arcade drift game. Drive an outlaw combustion GT86-like coupe through a dark JDM x cyberpunk
city, drift to charge lightning, fire it at the electric cars that replaced everything else, get paid.

Day-one vertical slice: single player, desktop browser, keyboard.

## Run

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. Append `?debug=1` to start with the performance overlay open, and
`?scale=1` (any 0.7-1.5) to pin the render scale instead of letting the resolution governor pick it.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build on 127.0.0.1:4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests for the gameplay rules |
| `npm run qa` | Automated browser drive: drives, drifts, fires, saves screenshots + metrics to `artifacts/` (needs the dev server running and Chrome or Edge installed) |
| `npm run perf` | Performance probe: startup breakdown, worst frame while each effect appears for the first time, shaders compiled per phase, CPU/GPU ms per frame. Writes `artifacts/perf.json`. `npm run perf:headed` for vsync-limited numbers. Pass `--url http://127.0.0.1:4173/?debug=1` to probe the production build |

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
- **Budgets**: ~30-50 draw calls, ~17k triangles, no per-frame allocation in sim, FX or HUD.

## Controls

| Key | Action |
| --- | --- |
| W / S or Up / Down | Throttle / brake (brake at standstill reverses) |
| A / D or Left / Right | Steer |
| Space | Handbrake (kick the rear out to start a drift) |
| Shift | Nitro (recharges gradually while driving) |
| E or left click | Fire lightning at the nearest electric car in the forward cone |
| R | Instant restart |
| C | Cruise mode: the car drives itself around the city at a relaxed pace. Any driving input hands control back |
| F3 or ` | Toggle the debug overlay (FPS, draw calls, triangles) |

## Loop

Nitro gives speed. Drifting charges the lightning. Lightning destroys electric cars. Destroyed cars pay money.

## Project layout

See `docs/PROGRESS.md` (architecture table, current state, measurements) and `AGENTS.md` (rules).
Product and scope documents live in `docs/`. Reference images and the unoptimized source model live in
`assets/` (the source GLB is never loaded at runtime).
