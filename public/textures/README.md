# Textures

Hand-made art the game loads at runtime. Everything under `public/` is served as-is at the
matching URL, so `public/textures/road/asphalt.webp` is fetched as `/textures/road/asphalt.webp`.

Almost every surface in the city is still drawn procedurally into a canvas at start-up
(`src/render/scene/env/textures.ts`). This folder is the escape hatch for the surfaces where a
real image does the job better.

## Swapping a texture

Drop the new file in on top of the old one, keeping the name. Nothing else changes — no code,
no import, no rebuild step of its own. `npm run dev` picks it up on reload; the shipped server
serves this folder with `cache-control: no-cache`, so a deployed swap needs no cache busting.

To try a new file **beside** the old one, add its name to that slot's `files` list in
`src/render/textures/manifest.ts`. The list is tried in order and the first file that loads
wins, so putting the new name first is enough to switch, and removing it is enough to switch
back.

## Adding a new texture

1. Put the file in the folder its surface belongs to (create the folder if it is new).
2. Add a slot to `TEXTURES` in `src/render/textures/manifest.ts` — the candidate file names
   plus how it should be sampled (`tiling`, `anisotropy`) and graded (`tint`, `gain`).
3. Read the slot from the material that wants it:
   `attachTexture(material, 'road/asphalt', proceduralFallback)`.

Every slot keeps a procedural fallback. A file that is missing, slow or corrupt costs that
surface its art and nothing else — the game never blocks on one.

## Layout

```
public/textures/
  road/        street surfaces: asphalt, and later kerbs, paint, patches
  nature/      greenery: foliage (hedges + palm fronds), bark (palm trunks)
  buildings/   facades, roofs, shutters
  props/       barriers, containers, signage
  sky/         backdrops and environment maps
```

Only the folders in use exist. The two poster images (`/badkala.webp`, `/rayo-wanted.webp`) are
one-off screens rather than surfaces, load through their own modules, and stay at the root of
`public/`.

## Conventions

- **Format.** `.webp` at quality 80–90. `.png` for anything needing hard edges or alpha, `.jpg`
  accepted. All three extensions are tried per slot, best format first.
- **Size.** Powers of two, 1024×1024 for a tiling surface. Go to 2048 only when the tile is
  visibly soft under the car — it is four times the memory and the bay is dark.
- **Seamless.** Anything with `tiling: true` has to wrap on all four edges. Resizing a seamless
  tile keeps it seamless; cropping does not.
- **Colour.** Keep the file the untouched original. Night grading belongs in the manifest
  (`tint` pulls the art towards a colour, `gain` lifts or drops it), where it can be tuned
  against the running game instead of re-exported.
- **Scale.** Each surface declares how many metres one tile covers, and the art should be shot
  for about that much of the real thing: `ROAD_TILE` 8 m (`scene/env/cityBuilder.ts`),
  `FOLIAGE_TILE` 1.3 m and `BARK_TILE` 1.6 m (`scene/env/builders.ts`).

```bash
cwebp -resize 1024 1024 -q 85 -m 6 source.png -o public/textures/road/asphalt.webp
```
