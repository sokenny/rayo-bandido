# Locked decisions and temporary defaults

## Locked by Juan

| Area | Decision |
| --- | --- |
| Title | Rayo Bandido |
| Platform | Modern desktop browser |
| Technology | Three.js-based web game |
| Protagonist | First-generation Toyota GT86 / visually recognizable GT86-like coupe |
| Theme | 50% JDM, 50% cyberpunk |
| World | Dark, nocturnal and dystopian; electric cars dominate the city |
| Core fantasy | The combustion-powered outlaw destroys/disables electric cars through drift-charged lightning |
| Drift | Easier and more forgiving than Need for Speed Underground 2 for the MVP |
| Lightning charge | Charged only through valid drifting |
| Lightning targeting | Auto-target nearest eligible electric vehicle inside a forward cone |
| Reward | Destroyed/disabled electric vehicles award money |
| Money in MVP | Visible counter only; modifications come later |
| Nitro | Separate resource that recharges gradually |
| Camera | Low, close, centered third-person chase camera |
| Graphics | Approved low-poly retro-remaster reference; performance over fidelity |
| Performance | Aim for stable 60 FPS; accept simpler graphics to achieve it |
| Multiplayer | Required later, excluded from day-one MVP |

## Temporary MVP defaults

These values may be tuned without asking Juan. Keep them centralized.

| Parameter | Starting default |
| --- | --- |
| Controls | WASD/arrow keys drive; Space handbrake; Shift nitro; E or click lightning; R restart |
| Camera FOV | 60 base, easing toward 70 during nitro |
| Drift activation | Speed above 25 km/h-equivalent and slip angle above roughly 12° for 200 ms |
| Drift cancellation | Low speed, collision, reversal or slip below threshold for roughly 350 ms |
| Lightning capacity | 100 units |
| Lightning cost | 50 units per shot |
| Nitro capacity | 100 units |
| Nitro recharge | Recharge while moving and not boosting; no recharge while stationary |
| Auto-aim cone | Approximately 35° either side of forward direction |
| Auto-aim range | Approximately 45 world meters |
| Render scale | Starts at `min(devicePixelRatio, 1.5)`; the resolution governor may step it down to 0.7 (x0.85 per notch) while frames are dropped on the GPU, and back up with headroom. `?scale=` pins it |
| Start-up | Loading screen until every shader is compiled and every texture uploaded (`warmUp` in `src/game.ts`); the WANTED portrait is waited for up to 2.5 s so the board is drawn once |
| Target reward | 100 currency units |
| Arena | Compact loop or several connected city blocks |
| Targets | At least 3 simultaneously available electric vehicles |

## Decisions intentionally deferred

- Exact multiplayer mode and player count.
- Final economy and modification prices.
- Final licensed branding and vehicle naming.
- Story, characters and corporations.
- Mobile controls.
- Garage and customization UI.
- Final audio and soundtrack.


## Implementation decisions taken during the day-one session (lead agent, 2026-09-02)

| Area | Decision | Why |
| --- | --- | --- |
| Stack | Vite 6, TypeScript 5 strict, Three.js 0.170, Vitest 2, vanilla DOM HUD | Matches the technical baseline; no framework has MVP value |
| Physics | Custom planar arcade controller + circle-vs-AABB collision; no Rapier | Realistic wheel simulation is out of scope; AABB colliders derived from the layout keep art and collision in sync |
| Simulation | Fixed 60 Hz step, max 5 steps per frame, render interpolation of car and targets | Stable, deterministic rules; future multiplayer can replay `PlayerCommand`s |
| Coordinates | Compass heading (0 = -Z, clockwise positive), car nose at local -Z, only `src/render/sync.ts` maps heading to Three rotation | One documented convention with unit tests avoids sign bugs across agents |
| Player car asset | Built low-poly GT86-like proxy with four wheel nodes | No local optimization workflow (gltfpack / gltf-transform) was installed; the 3.06M-triangle GLB is never loaded |
| Targets | Six patrolling electric cars; destroyed targets respawn after 12 s at their spawn, reward paid once per destruction | Keeps the loop alive in a compact arena without unbounded object creation |
| Currency display | HUD shows a yen sign (matches the approved concept image); economy stores plain integers | Branding/naming remain deferred |
| Tooling | Node LTS installed via winget (was absent); `puppeteer-core` drives the installed Chrome/Edge for the QA screenshot loop | No browser download; screenshots land in `artifacts/` |
