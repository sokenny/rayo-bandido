# Agent rules — Rayo Bandido

## Product priorities

1. Driving must feel responsive and fun.
2. Drift, lightning and nitro must form one understandable gameplay loop.
3. Stable performance is more important than graphical fidelity.
4. Visual identity is exactly JDM × cyberpunk, approximately 50/50.
5. The first deliverable is single-player; future multiplayer compatibility is architectural only.

## Scope control

- Build only the day-one vertical slice described in `docs/MVP_SPEC.md`.
- Do not add accounts, backend, multiplayer, open world, garage UI, story, police AI or multiple playable cars.
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

