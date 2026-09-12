# City v2 — "The Stack" (working name)

You are the lead engineer on Rayo Bandido. This session builds a NEW free-roam city beside the
existing one. It does not modify the existing city ("Bandido Bay", `src/world/citySpec.ts`),
and it does not move any mission, race, passenger stop or police logic yet. That is a follow-up.

The goal is a city that looks and feels like the two reference images at
`assets/references/city-v2-highway.webp` and `assets/references/city-v2-street.webp`. Read both
images with the Read tool before anything else, and again before every phase report.

## Status (the agent updates this block at every gate; Juan flips "approved")

| Phase | State | Gate evidence |
|---|---|---|
| 0 — Plan | approved | `docs/CITY_V2_PLAN.md` + `docs/city-v2-plan-ribbons.png` (from `scripts/stack-preview.mjs`); PROGRESS.md 2026-09-12 |
| 1 — Roads and levels | approved | `src/world/stackSpec.ts` + `createCityWorld(spec)`; `tests/stackWorld.test.ts` (24); `scripts/city-drive.mjs --mode stack` 13 stages, 0 collisions; `artifacts/stack-phase1/phase1-*.png` (14 shots, metrics in `phase1.json`); PROGRESS.md 2026-09-12 |
| 2 — Massing and enclosure | approved | `src/world/stackMassing.ts` (12 carved sites, 32 passages) + `env/passageBuilder.ts`; `tests/stackWorld.test.ts` (30); `artifacts/stack-phase2/frame-test.html` / `.png` (six vantages beside the references, 1:1 crops, sky % and overhead per view), `phase2-*.png` (14), `phase2.json`; `city-drive.mjs --mode stack` 13 stages, 0 collisions; PROGRESS.md 2026-09-12 |
| 3 — Surfaces and light | not started | six vantage shots, before/after |
| 4 — Missions move in | not started | separate brief |

States: `not started` → `in progress` → `at gate` (agent stops here) → `approved` (Juan). A run
picks up the first phase that is not `approved`. If it is `at gate`, the run applies Juan's
feedback on that phase; it never starts the next one without an `approved` above it.

## Why a new city and not an edit

Bandido Bay is a flat grid of free-standing boxes with 3.4 m pavements, one deck at 15 m and one
bridge at 24 m. Its problems are not materials. They are massing, enclosure and layering:

- The road is in the open. In the references the road is a corridor cut through structure:
  building walls at the kerb, decks and portal frames overhead, piers beside the lane.
- The sky owns a third of the frame. In the references the sky is under 15% of the frame and
  fog closes the far end of every street.
- Everything sits at ground level plus one deck. The references stack three or four road
  levels, and the levels cross each other repeatedly, inside the buildings.
- Buildings are glass boxes with neon. The references are concrete: brutalist massing with
  cut-outs, warm window grids, one red or amber accent per view, neon rare.

Editing the old spec cannot get there without breaking every coordinate the missions, the
circuit, the street race and 6 test files pin. So: new spec, same pipeline.

## What you must reuse (do not build a second version of any of these)

- `src/world/track.ts` — ribbons with per-node height, fillets, grades. All roads are ribbons.
- `src/world/cityGen.ts` — block grid cut around ribbons, rails, elevated corridors.
- `src/world/cityPlan.ts` — the plan types (`RibbonDef`, `PillarDef`, `SkybridgeDef`,
  `MegastructureDef`, `CityVolume` …). Extend types if needed; never fork them.
- `src/world/cityWorld.ts` — the world assembler. Factor the parts that are Bay-specific out of
  it so a second spec can drive the same assembler. Prefer `createCityWorld(spec)` over a copy.
- `src/world/cityMegastructures.ts` — buildings a road passes THROUGH. This is the closest
  thing we have to the references; the new city uses it everywhere, not in one corner.
- `src/render/scene/env/buildingKit.ts`, `facadeAtlas.ts`, `wallDetail.ts` (triplanar
  concrete), `elevatedBuilder.ts` (deck skirts, soffits, ribs, piers, maintenance lamps),
  `propsBuilder.ts`, `plants.ts`, `reclaimBuilder.ts`, `graffiti.ts`, `transitBuilder.ts`.
- `src/render/scene/env/palette.ts` — the `bay` palette. Shift the window mix warmer to
  match the references (amber/sodium dominant, cold white second, teal third), keep red as the
  single hot accent, no violet, no pink.
- Traffic (`src/sim/traffic.ts`, `TRAFFIC_LOOPS`, `VIADUCT_CARS`), surface field, R recovery
  (`cityRecovery.ts`), road graph (`roadGraph.ts`).
- Tests in `tests/cityWorld.test.ts` and `tests/megacity.test.ts` are the contract for
  clearance, grades, pillars, pavement and draw calls. Write the same tests against the new spec.
- QA tooling: `scripts/city-shots.mjs` (named vantage points + metrics), `scripts/city-drive.mjs`,
  `scripts/megacity-check.mjs`, `scripts/perf-drawcalls.mjs`, `?debug=1` overlay.

Read, in this order, before writing code: `AGENTS.md`, the City sections of `docs/PROGRESS.md`
(2026-09-06 onward), `src/world/citySpec.ts`, `cityWorld.ts`, `cityGen.ts`, `cityPlan.ts`,
`cityMegastructures.ts`, `track.ts`, `src/render/scene/env/cityBuilder.ts`, `buildingKit.ts`,
`elevatedBuilder.ts`, `megastructureBuilder.ts`, `wallDetail.ts`, `tests/cityWorld.test.ts`,
`scripts/city-shots.mjs`.

## Hard-won facts from the first city (treat as rules)

1. The night light is a HemisphereLight (~1.9) over a weak directional key (~0.45), no shadows.
   Hemisphere shading depends on `normal.y` only. Any trick that only bends normals
   sideways is invisible on walls. Depth on vertical surfaces needs REAL geometry (ribs, piers,
   recesses, cantilevers) or baked light pools (vertex colour), like the viaduct underside does.
2. Downscaled dark screenshots lie. Before changing a material because "it looks flat", crop
   1:1 or read pixel values. Report measured numbers, not impressions.
3. Juan judges against the reference images, not against the written visual rules for the
   arena. When in doubt, re-read the two images.
4. The whole static city must stay in a handful of whole-city batches. The district-per-chunk
   experiment cost 45 draw calls for 41k triangles and was reverted. Ceiling: 20 static
   environment draw calls, about 200k static triangles, 60 FPS at 1440x900 DPR 1 on a
   mid-range laptop. Frustum culling per chunk is not worth it at this map size.
5. `MeshBuilder.tube` / `panel` output must be DoubleSide.
6. Real chamfers on props cost +66% triangles for nothing visible. Spend triangles on the
   structure the driver is inside, not on rooftop clutter.

## The design brief

Size: about 600 x 600 m. Perimeter treatment as Bandido Bay (wall band, fog). It may end in
water on one side, or in a wall of towers; it must never end in visible empty ground.

### Road system: four levels, one flow

- L0 street (y 0), L1 deck (y ~12), L2 highway (y ~24), L3 skyway (y ~36). Deck thickness and
  drive-under clearance as in `elevatedBuilder.ts` / `DRIVE_UNDER`.
- The spine is a closed elevated highway loop (L2) that does not run round the edge of the map
  like the old viaduct. It cuts THROUGH the middle of the city, through buildings, with the
  towers on both sides of it and above it. At least 40% of its length is enclosed on at least
  two sides (walls, soffit above, or both). See `city-v2-highway.webp`: that is the L2 driving
  experience, and it is the single most important shot in this brief.
- Two interchanges where L0, L1 and L2 connect with tangential ramps (merges, not T-junctions).
  Every level is reachable from every other within 400 m of road. No dead ends anywhere; every
  ramp ends inside another road, the way `RAMP_SPECS` do now.
- Streets (L0) are NOT a uniform grid. Use two or three wide avenues, curved connectors,
  one long sweeper, and narrow one-way cuts between buildings. Grid spacing varies 60–140 m.
- Stacked crossings: at least six places where three levels are visible at once from L0
  (a deck above, a highway above that). See `city-v2-street.webp`.
- Traffic on all four levels, density as Bandido Bay's viaduct (64 cars on the loop) scaled by
  length. A driver on L2 must see cars on L1 and L0 through the gaps.

### Massing: the city is one structure

- Buildings stand at the kerb. Default setback 0–1 m on the avenues, 0 in the cuts. Pavement
  only where a bus stop or a stall needs it.
- At least 30% of L1/L2 road length passes INSIDE a building volume (megastructure passages)
  or under a building bridging the road. Passages have real ceilings with lamps, ribs and
  ducts (extend `elevatedBuilder` / `megastructureBuilder`; this is the "portal frame" module).
- Skybridges (`SkybridgeDef`) between towers over every avenue, at two or three heights, some
  with lit windows (occupied), some bare concrete.
- Towers 80–160 m in the core, stepped and cantilevered, concrete-dominant bands (`wallDetail`
  concrete on the lower 3 storeys of every facade, `facadeAtlas` 'panels'/'louvre'/'stack'
  styles favoured over glass). Landmarks: two or three hand-drawn silhouettes on the horizon.
- Ground floors (`groundFloor.ts`) on every wall that meets a street: shutters, grilles,
  stalls, doors, the odd lit shopfront. No blank wall longer than 20 m at street level.
- Old-town pocket: one low district of shabby 3–6 storey blocks with alleys, for contrast and
  for the reclamation/graffiti systems to have somewhere to live.

### Light and colour

- Palette `bay`, windows shifted warm. Per view: many small warm lights, a few cold ones, ONE
  red or amber accent object (a billboard, a strip on a pier, a tail-light river).
- Fog: the far end of every street and every deck disappears into teal-grey haze. Tune
  density so that at 250 m a tower is 70–80% fog. Road readability rule from `AGENTS.md` holds.
- Light pools on the asphalt under every deck lamp and passage lamp (bake into vertex colour or
  the existing glow builder). Wet asphalt reflections as today.

### Frame test (acceptance for the look)

From the chase camera, at six named vantage points you choose and record in `city-shots.mjs`
(two on L2 inside an enclosed stretch, two on L0 under stacked decks, one on a ramp mid-climb,
one at an avenue with skybridges), measure the screenshot at 1440x900:

- sky pixels (the sky dome, not fog) under 15% of the frame at the two L2 and two L0 points;
- something structural (deck, soffit, skybridge, passage ceiling) within 40 m overhead at four
  of the six points;
- the far end of the road fogged out, no visible map edge, in all six;
- static environment draw calls ≤ 20, static triangles ≤ 220k, and the `?debug=1` overlay
  reading ≥ 55 FPS at 1440x900 DPR 1 in Chrome on this machine at all six points.

Put these numbers in the phase reports. A phase is not done until they are met.

## Phases and gates

Work one phase per run. At each gate, stop and hand Juan the screenshots and the metrics.
Do not start the next phase in the same run unless told to.

**Phase 0 — Plan (no code).** Write `docs/CITY_V2_PLAN.md`: an ASCII or SVG plan view of the
four levels, the interchange positions, the enclosed stretches, the districts, and the list of
builder extensions you need (expected: covered-passage module, zero-setback street walls,
multi-level interchange rails, warm window mix). Estimate triangles per system against the
budget. Render the road ribbons only with `scripts/track-preview.mjs` (or extend it) and
include the picture. Gate: Juan approves the plan.

**Phase 1 — Roads and levels.** New spec module (`src/world/stackSpec.ts`, name open) and a
new mode `'stack'` wired into `game.ts` and the main menu next to OPEN WORLD (label
"THE STACK", or whatever Juan picks). All four levels, ramps, interchanges, rails, pillars,
surface field, R recovery, traffic on every level. Plain massing from `cityGen` blocks is
fine here. Tests: the `cityWorld.test.ts` suite against the new spec (clearance, grades,
pillars, drives up every ramp under its own power). Gate: `city-drive.mjs` completes L0 → L1
→ L2 → L3 → L0 without collision; screenshots from every level.

**Phase 2 — Massing and enclosure.** Megastructure passages along the L2 spine, skybridges,
zero-setback walls, portal frames, stacked crossings, the old-town pocket, the horizon
landmarks. This is where the frame test must pass. Gate: the six vantage shots + metrics,
side by side with the two reference images.

**Phase 3 — Surfaces and light.** Concrete coverage, facade style mix, warm windows, light
pools, ground floors, props, reclamation, graffiti, rain. Gate: same six shots, before/after.

Phase 4 (later, separate brief): move missions, passenger stops, bus routes, police, the
circuit gate and the street rings into the new city.

## Non-negotiables

- `citySpec.ts`, `cityWorld.ts` behaviour for mode `'city'`, `circuitSpec.ts`,
  `streetSpec.ts` and every existing test keep passing unchanged. The old world stays
  selectable until Phase 4 retires it.
- No new textures pipeline, no image assets: procedural canvas textures and the existing
  concrete detail map only. Textures are Juan's later pass.
- No per-chunk meshes, no dynamic lights beyond what exists, no shadows.
- Simulation stays planar-plus-surface-field. Nothing in the sim learns about buildings.
- Every phase report: files changed, commands run, test output, the six screenshots with the
  measured numbers, and what you could not verify. Never claim it looks right without the
  1:1 crops.
- If a builder extension would cost more than 25k triangles or a new draw call, stop and say
  so before building it.

## How every run starts

1. Read this file top to bottom, then the Status table. Pick the first phase not `approved`.
2. Read the two reference images, `AGENTS.md`, the City sections of `docs/PROGRESS.md`, and
   `docs/CITY_V2_PLAN.md` once it exists.
3. Do that one phase. At its gate: set its State to `at gate`, add the evidence to
   `docs/PROGRESS.md` under a dated heading, and stop. Do not start the next phase.
4. If Juan's message carries feedback on a phase that is `at gate`, apply it, re-run the gate
   evidence, and stop again.
