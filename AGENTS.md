# Agent rules — Rayo Bandido

## Product priorities

1. Driving must feel responsive and fun.
2. Drift, lightning and nitro must form one understandable gameplay loop.
3. Stable performance is more important than graphical fidelity.
4. Visual identity is exactly JDM × cyberpunk, approximately 50/50.
5. Multiplayer must never cost single player anything: no input latency, no prediction, and
   nothing on the wire that the local car waits for.

## Scope control

- Build only the day-one vertical slice described in `docs/MVP_SPEC.md`, plus the race circuit
  and the multiplayer racing on it (both delivered after the day-one session — see
  `docs/PROGRESS.md`), plus the City: the free-roam proof of concept Juan asked for on
  2026-09-06 (`src/world/citySpec.ts`), which is built in layers — layout, elevation and
  lighting first; textures and detailed props are a later pass of his own.
- Do not add accounts, garage UI, story, police AI or multiple playable cars. The City is the
  one open-world exception, and it stays a proof of concept until Juan says otherwise.
- Multiplayer is rooms of up to four cars on the circuit — a player opens a room and hands out
  its code — and the server is a relay: no game rules, no physics and no knowledge of the track
  live in `server/`. Keep it that way. A room is chosen once, at `hello`, and never changes for
  the life of a socket; nothing below the handshake carries a room id.
- Money is a visible counter. A modification shop is later work.
- Use placeholders when an asset would block the complete gameplay loop.

## Engineering rules

- TypeScript strict mode.
- Keep modules small and responsibilities explicit.
- Separate input, simulation, rendering, game rules and UI.
- Prefer data-driven tuning constants collected in one obvious module.
- Use a fixed simulation timestep or another stable update strategy.
- Avoid allocations inside frame-critical loops.
- Pool short-lived effects and repeated targets.
- Dispose Three.js geometries, materials and textures when replaced.
- Do not introduce a framework or abstraction without immediate MVP value.
- Keep the main branch runnable after integration checkpoints.
- Networking lives behind `src/net/session.ts`. Nothing outside `src/net/` may import a socket,
  and `createGame` with no session must behave exactly as it did before multiplayer existed.
- `src/net/protocol.ts` is the wire contract; `server/protocol.mjs` repeats it because the
  server is plain JavaScript. Change one and change the other — `tests/protocol.test.ts` fails
  if they drift.

## Performance rules

- Target 60 FPS on a mid-range laptop in a modern Chromium browser.
- Treat 30 FPS as the minimum floor for modest hardware.
- Keep the default runtime scene under approximately 200k visible triangles when practical.
- Prefer one or very few shadow-casting lights.
- Prefer baked/emissive lighting over dynamic lights.
- Cap pixel ratio on high-DPI screens.
- Use instancing for repeated buildings, barriers and targets.
- Keep postprocessing optional and cheap.
- Expose FPS, draw calls and triangle count in a debug overlay or documented toggle.

## Visual rules

- The approved target is `assets/references/approved-visual-target.png`.
- Camera framing follows `assets/references/camera-reference.png`.
- Preserve road readability. Darkness, fog and bloom must not hide gameplay.
- Lightning is cyan/blue-white. Nitro is magenta/violet with a warm exhaust core.
- Use low-poly silhouettes, modular architecture, emissive windows and selective neon.

## Agent coordination

- State owned files before editing.
- Do not edit files owned by another active agent.
- Report changed files and commands/tests run.
- Do not claim success without runtime evidence.
- Update `docs/PROGRESS.md` after an integrated milestone.

