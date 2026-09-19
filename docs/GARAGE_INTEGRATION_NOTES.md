# Integrator notes collected from Wave 1 reports

## A · body (merged 66a1b20)
- ExhaustOutlet has no direction; flame always +Z. `exhaustTips.side` is an angled rear pipe. True side exit = add `dir` to ExhaustOutlet + lights.ts support.
- hull.ts exports HULL_SECTIONS. Spoilers stand on deckTopAt(z, trunk) → trunk change rebuilds body (already).
- trunk.louver sits on the rear window.
- QA: spoiler.double-gt in rear 3/4 shows a brown block above the roof — check endplate placement.
- Stock parts violate new clearance rules at lowest ride height (splitter y 0.09, skirts, diffuser) — only new parts enforced.

## B · wheels/stance (merged a9c1c24)
- Hull has no wheel wells: only outer ~5 cm of the wheel shows; inward track steps tiny (4 mm). Real fix: wheel-well cutouts / dark liner in hull/fenders.
- Camera shots wheelFrontHead / wheelRearTail can't see camber (bumper hides wheels) → D needs higher pitch/offset yaw.
- Camber tilts around wheel centre; inner tyre edge dips ≤2 cm under road (hidden under car).
- New STANCE_STEP keys trackIn, rimRatio. stanceParams half-tracks include width offset.
- Placeholder prices 1200–5200 in wheels.ts → F's PRICING.
- Full vitest suite not run by B — integrator must run full suite.

## F · rules/saving (merged 0890074)
- Wire: GameState.workshop = createWorkshopState(readGarage()); writeGarage(workshopSave(ws)) on workshopPurchase; locked in lockOtherActivities; stepWorkshop per tick; stepGarage(..., {workshop:true}); garageWantsWorkshop → canEnterWorkshop → openWorkshop; garageWorkshopLine(s, events, from).
- applyWorkshopCommand(ws, cmd, shop, economy, events) — map E's WorkshopIntent → F's WorkshopCommand.
- workshopFade / workshopShowroomVisible drive the 0.7 s fade; scene swap at midpoint.
- Widen GarageLineKind: 'welcome'|'install'|'broke'|'door'|'goodbye'.
- Snapshot rating = carStars 0–10; update types.ts comment. Proposed snapshot fields: dirty, installedValue, vinyls/decals of preview, line/lineId. Maybe WorkshopState.layerIndex.
- Bake new Loco lines (D6 approved) + add to RUNTIME_DIALOGUE / prepareDialogue.
- Money ≈ 12k/hour; mid part ≈ 2k.

## G · lights/audio (merged d785115)
- audio/index.ts facade: AudioSystem += setExhaust(id), revDemo(); SILENT no-ops; createAudio forwards to engine.
- Call setExhaust(loadout.exhaustSound) at game load and on exhaust pick + revDemo(); audio.update must keep running in the workshop.
- Pop-up headlights sit on hood front edge (z≈-2.0, y 0.66–0.78) → check clash with A's hoods (scoop/bulge/twin-vent).
- QA: headlights.slim angled bars look odd; popup looks like floating white slabs — review.
- Presets can't raise pop frequency (backfire trigger untouched). Juan tunes EXHAUST_PRESETS by ear.

## E · UI (merged 9a3cc29)
- createWorkshopOverlay({ onIntent, keyTarget?, gamepad? }) → { root, update(WorkshopUiSnapshot), say(text, s?), dispose }.
- WorkshopIntent (E) ≠ WorkshopCommand (F): write the mapper in controller. E sends install even when !canInstall (F answers funds denial). selectGroup/selectCategory/open/optionIndex/layer actions select/add/remove/color/zone/orbit/level.
- Snapshot extras needed: layers {items, selected}, line/lineId, playerName, level. F's snapshot uses carStars 0–10 (harness mock showed 16 — fine once real).
- Overlay captures all keys on window in capture phase; minimap's M listener still fires in workshop → suppress.
- Lazy-load src/ui/workshop with the showroom. Voice Loco via speakDialogue next to say().
- Group carousel shows all GROUPS; filter by shopGroups for future shops.

## D · showroom/camera (merged 6019b8f)
- createShowroom(renderer, opts) → scene, camera, rig, dim, attach/detach, setCategory, setShot, setShop, setIdleSpin, setReflections, introShot, outroShot, resize, warmUp (async), update(dt, input), render(), dispose. NO_INPUT export.
- While attached showroom owns car.root and calls car.update; don't syncCar/car.update. Use showroom.render() instead of renderer.render.
- Entry: attach → setCategory → await warmUp() under black fade → introShot(). Exit: outroShot() during fade → detach → dispose.
- rig.setFraming(x,y) to clear UI; setReflections(false)/reflectionScale 0.35 for slow machines.
- Category→shot remaps in carParts.ts: headlights+headlightColor→headlightsClose (headlightColor dimShowroom:true); exhaustTips+exhaustSound→exhaustClose; neon→neonLow.
- B's concern: wheelFrontHead/wheelRearTail pitch 0.04 may hide camber behind bumper — verify in QA.
- Per-frame zero-alloc of showroom.update not tested.
- ~48–55 draw calls both passes, 36k tris; 0.5 ms/frame.

## C · paint (merged 18f24c0)
- createCarPaint(loadout) / apply(loadout, material): material.color stays WHITE (paint lives in texture). Check carVisual crash-grime still reads sensibly (it multiplies clean color).
- formatPlateText spaces only real Mercosur pattern (AB123CD → AB 123 CD).
- windshield decal zone = strip on front edge of roof.
- Graffiti decals load async then repaint once.
- Chrome finish looks weak (paintEnv.ts is dark purple) — possible fix: showroom/paintEnv brighter band for chrome; not blocking.
- Rear bumpers must stay clear of PLATE_MOUNT + ~4.5 cm (small tris there treated as plate trim) — verify A's rear bumpers.
- Full suite after all merges on main: 87 files, 1354 tests green.
