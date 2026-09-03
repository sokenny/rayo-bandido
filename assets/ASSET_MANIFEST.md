# Asset manifest

## Approved references

| File | Purpose | Instruction |
| --- | --- | --- |
| `references/approved-visual-target.png` | Primary MVP visual benchmark | Match its graphics tier, density, palette and readability; do not treat it as a texture source |
| `references/camera-reference.png` | Chase-camera framing | Reproduce framing and road visibility, not UI or proprietary content |
| `references/moodboard-highway.png` | Corporate highway and city scale | Borrow mood, scale and cyan/red guidance; simplify holograms into billboards |
| `references/moodboard-wet-road.png` | Wet road, portals and minimal UI | Borrow contrast and route markers; use cheap reflection approximations |
| `references/moodboard-jdm-alley.png` | Underground JDM/cyberpunk culture | Borrow palette, clutter language and garage mood; concentrate detail in small zones |

## Source model

### `source/gt86-source-unoptimized.glb`

Observed properties:

- Binary glTF 2.0.
- Approximately 11 MB compressed on disk.
- Approximately 1,584,798 vertices.
- Approximately 3,064,110 triangles at runtime.
- One node, one mesh and one primitive.
- One material with three embedded JPEG textures.
- No animation and no skin.
- Wheels are not separate objects.

Permitted use:

- Silhouette and styling reference.
- Offline decimation/retopology source if reliable tools are already available.
- Non-destructive experiments on a copied file.

Forbidden default behavior:

- Loading it directly in the shipped MVP.
- Using its complex geometry as a physics collider.
- Blocking the vertical slice while attempting perfect retopology.

Runtime target for the player car:

- Approximately 50k–150k triangles maximum, preferably toward the low end.
- Separate body and four wheel nodes with correct pivots.
- Simple box/compound collision proxy.
- One or few materials.
- 1K–2K textures, compressed where practical.
- Target asset transfer size below roughly 10–20 MB, ideally lower.

