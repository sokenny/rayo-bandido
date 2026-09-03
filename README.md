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

Open http://127.0.0.1:5173. Append `?debug=1` to start with the performance overlay open.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build on 127.0.0.1:4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests for the gameplay rules |
| `npm run qa` | Automated browser drive: drives, drifts, fires, saves screenshots + metrics to `artifacts/` (needs the dev server running and Chrome or Edge installed) |

## Controls

| Key | Action |
| --- | --- |
| W / S or Up / Down | Throttle / brake (brake at standstill reverses) |
| A / D or Left / Right | Steer |
| Space | Handbrake (kick the rear out to start a drift) |
| Shift | Nitro (recharges gradually while driving) |
| E or left click | Fire lightning at the nearest electric car in the forward cone |
| R | Instant restart |
| F3 or ` | Toggle the debug overlay (FPS, draw calls, triangles) |

## Loop

Nitro gives speed. Drifting charges the lightning. Lightning destroys electric cars. Destroyed cars pay money.

## Project layout

See `docs/PROGRESS.md` (architecture table, current state, measurements) and `AGENTS.md` (rules).
Product and scope documents live in `docs/`. Reference images and the unoptimized source model live in
`assets/` (the source GLB is never loaded at runtime).
