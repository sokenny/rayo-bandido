# Taller del Loco Mustang — plan de modificaciones (estilo NFSU2)

Pedido de Juan, 2026-09-19. Abrir el garage del Loco Mustang (hoy solo saluda y lava el auto) como
taller de modificaciones **cosméticas**, con la experiencia de Need for Speed Underground 2: carrusel
de categorías arriba, lista de opciones a la izquierda, el auto en una plataforma y **la cámara que
viaja a la parte que estás eligiendo**. A futuro puede haber varios talleres (mecánica / estética);
por ahora todo vive en el del Loco Mustang, pero la arquitectura no debe asumir un solo taller.

Este documento es el contrato para los subagentes (Opus 5). Identificadores en inglés, como el código.

---

## 1. Qué hay hoy (investigado)

| Tema | Estado | Archivos |
|---|---|---|
| Garage en el mundo | Lote en esquina frente al meet, con anillo en la vereda. Solo Metro (`METRO_GARAGE`). | `src/world/garage.ts`, `src/world/metroSpec.ts:586`, `render/scene/env/garageBuilder.ts` |
| Reglas | Entrás al anillo → saluda; `F` → otra línea "todavía no abrió". Lava el daño de choque gratis. Nunca "tiene" el auto. | `src/sim/garage.ts`, `src/sim/crashDamage.ts:199` |
| UI | Cartel + retrato + subtítulo. Nada para comprar. | `src/ui/garageOverlay.ts`, `src/content/garage.ts` |
| El auto | **Procedural, sin GLB.** `buildBodyGeometry()` fusiona casco, paragolpes, polleras, difusor, alerón GT, espejos, escapes y patente en **una sola geometría** con colores por vértice. 14 draw calls. | `src/render/scene/carVisual.ts` (710 líneas) |
| Pintura | Un canvas 512² procedural (`livery.ts`) como `map`, UVs "lengthwise" (proyección por eje dominante: los dos flancos comparten textura). Material `MeshPhysicalMaterial` con clearcoat y env map propio. | `vehicles/livery.ts`, `vehicles/paintEnv.ts`, `geometryKit.ts:273` |
| Ruedas | Un solo diseño (5 rayos), `InstancedMesh` ×4, colores por vértice. Posiciones fijas desde `VEHICLE.trackWidth`. | `vehicles/wheel.ts`, `carVisual.ts` |
| Luces / neón | Faros, traseras, reversa, neón inferior y charco de luz: colores **horneados en vértices**. El neón cian hoy es el **indicador de carga del rayo** (`setCharge`). | `carVisual.ts`, `vehicles/interior.ts` |
| Sonido de escape | Motor sintetizado: buffers de ciclo horneados al crear la voz; backfire y flutter aparte. No hay presets intercambiables. | `src/audio/engine.ts`, `backfire.ts` |
| Plata | `state.economy.money`, `spendMoney()` es el único lugar donde se cobra. Persiste en `rb.wallet`. | `src/sim/economy.ts`, `src/core/progress.ts` |
| Guardado | localStorage por clave + `ProgressSnapshot` sincronizado con el servidor (Postgres). Todo lo leído se re-valida campo por campo. | `src/core/progress.ts`, `src/net/account.ts`, `server/accounts.mjs`, `server/db/migrations/` |
| Actividades | `src/sim/activities.ts` decide quién "tiene" el auto y bloquea al resto. El garage hoy no es una actividad. | `src/sim/activities.ts` |
| Cámara | `chaseCamera.ts`: chase + monturas rígidas. No hay cámara orbital de exhibición. El fondo del menú (`menuBackdrop.ts`) ya es un precedente de **escena aparte con cámara propia**. | `render/camera/chaseCamera.ts`, `render/menuBackdrop.ts` |
| Multijugador | El auto rival es el mismo casco en color de slot, sin livery (5 draw calls). El protocolo no lleva apariencia. En versus **tu** auto también pierde el livery por el color de slot (DECISIONS). | `render/scene/rivalCarVisual.ts`, `src/net/protocol.ts`, `server/protocol.mjs` |
| Menú con gamepad | Existe navegación discreta para menús DOM. | `src/core/input/gamepadMenu.ts` |
| Reglas del repo | `AGENTS.md` todavía dice "no garage UI / mod shop es trabajo futuro" → **hay que actualizarlo** en la Ola 0. | `AGENTS.md`, `docs/DECISIONS.md:58` |

### Las cuatro cosas que condicionan todo

1. **El auto es una sola malla fusionada.** Para cambiar piezas hay que partir `buildBodyGeometry` en
   *slots*. Se sigue fusionando a una geometría (el presupuesto de 14 draw calls no se toca): cambiar
   una pieza = reconstruir la geometría, que solo pasa dentro del taller.
2. **Los UVs actuales no sirven para vinilos.** La proyección "lengthwise" es perfecta para las
   esquirlas del livery actual pero no tiene regiones: un vinilo de costado aparecería también en el
   techo. Hace falta un atlas con regiones (costado izq., costado der., capot/techo/baúl, frente/cola,
   patente).
3. **Casi todos los colores están horneados en vértices.** Neón, faros, centro de llanta magenta, etc.
   Para que sean configurables: vértices en blanco × color del material, o reconstruir la geometría.
4. **`game.ts` (3429 líneas), `hud.ts`, `types.ts`, `tuning.ts` y `styles.css` son puntos calientes.**
   Solo el integrador los toca; todo lo demás vive en archivos nuevos.

---

## 2. Arquitectura

```
src/core/loadout.ts                 CarLoadout, STOCK_LOADOUT, sanitizeLoadout(), encode/decode compacto
src/content/carParts.ts             CATÁLOGO (datos): categorías, piezas, precios, rating, plano de cámara
src/content/shops.ts                ShopDef: qué categorías vende cada taller (hoy: 'loco-mustang' = todas)
src/content/garage.ts               + líneas nuevas del Loco ("abierto", compra, sin plata)
src/sim/workshop.ts                 máquina de estados pura de la sesión de taller (sin Three, sin DOM)
src/core/progress.ts                + clave rb.garage { loadout, owned[] } dentro de ProgressSnapshot
server/accounts.mjs + 004_garage.sql  columna jsonb, sanitize en servidor
src/render/scene/vehicles/parts/*   constructores de geometría por slot
src/render/scene/vehicles/{lights,underglow,wheelRig,plate}.ts   extraídos de carVisual
src/render/scene/vehicles/paintShop.ts   compositor de pintura: base+acabado → vinilos → calcos → patente
src/render/workshop/showroom.ts     escena interior del taller (chunk lazy)
src/render/workshop/workshopCamera.ts   rig orbital con planos por categoría
src/ui/workshop/*  (+ workshop.css) overlay NFSU2: carrusel, lista, pie, paleta, billetera
src/workshop/controller.ts          pega todo; game.ts solo lo instancia (~40 líneas)
```

### 2.1 `CarLoadout` — el contrato central

```ts
interface CarLoadout {
  v: 1;
  body: { frontBumper: PartId; rearBumper: PartId; skirts: PartId; hood: PartId; trunk: PartId;
          spoiler: PartId; exhaustTips: PartId };
  wheels: { rim: PartId; rimColor: ColorId; size: -1|0|1|2; width: 0|1|2 };
  stance: { rideHeight: number; camberFront: number; camberRear: number; trackFront: number; trackRear: number }; // pasos enteros acotados
  paint: { base: ColorId; finish: 'gloss'|'metallic'|'pearl'|'matte'|'chrome'; roof?: ColorId };
  vinyls: Array<{ id: PartId; color: ColorId }>;          // máx. 4 capas
  decals: Array<{ id: PartId; zone: DecalZone }>;          // calcos y grafitis, zonas fijas
  lights: { head: PartId; headColor: ColorId; tail: PartId; neon: ColorId|'off'; interior: ColorId };
  exhaustSound: PartId;
  plate: { text: string; style: PartId };
}
```

- **Todo son ids y enteros acotados**, nunca floats libres ni colores arbitrarios: se valida contra el
  catálogo, entra en el save del servidor y viaja barato por el wire más adelante.
- `sanitizeLoadout(unknown)`: id desconocido → pieza de fábrica. Mismo contrato que `progress.ts`
  ("todo lo leído es no confiable").
- **El look actual del auto ES el loadout por defecto** (alerón GT, splitter, wide-body, livery de
  esquirlas como vinilo "RAYO"). Test de regresión: `buildBodyGeometry(STOCK)` da la misma cantidad
  de vértices/triángulos que hoy. El catálogo agrega opciones más sobrias *y* más agresivas.
- Mecánica futura: irá en `loadout.performance` + una capa de modificadores sobre `VEHICLE`. **No se
  hace ahora** y lo cosmético **nunca** toca `VEHICLE` (el radio físico de rueda queda fijo: el
  "tamaño de llanta" cambia la relación llanta/goma, no el radio exterior).

### 2.2 Varios talleres a futuro

`ShopDef { id, npc, categories: CategoryId[], priceFactor }`. El catálogo no sabe de talleres; el
taller filtra categorías. `sim/workshop.ts`, la UI y el showroom reciben un `ShopDef`. El mundo hoy
tiene `plan.garage` singular: se deja así, y pasar a `plan.garages[]` es un cambio local cuando
exista el segundo.

### 2.3 Sesión de taller (`sim/workshop.ts`)

`closed → entering → browsing(category) → previewing(part) → leaving`. Mantiene `installed` (lo
guardado) y `preview` (lo que se ve). Probarse es gratis; **INSTALAR** cobra con `spendMoney` y pasa
la pieza a `owned` (reinstalar algo propio es gratis). Salir descarta el preview. Eventos:
`workshopEnter/Exit/Preview/Purchase/Denied`. Es una actividad nueva en `activities.ts`
(`'workshop'`) que bloquea todo lo demás; **no se entra con la policía encima** ni en carrera/versus.

### 2.4 Showroom: escena aparte, no dentro del mundo

La boca del garage mide 5,6 × 11 m con la camioneta adentro: una cámara orbitando a 5–6 m atraviesa
paredes. Recomendación: **escena `THREE.Scene` propia** (como `menuBackdrop`), cargada con `import()`
dinámico al apretar F: interior del taller del Loco (plataforma giratoria, piso pulido con reflejo,
pilas de cubiertas, cajas de herramientas rojas, lámparas colgantes cálidas, su Daewoo al fondo,
carteles). La ciudad no se dibuja mientras tanto, así que el showroom tiene presupuesto de sobra. El
`CarVisual` del jugador se re-parenta al showroom (no se duplica). Transición: fundido a negro
(~350 ms) a la entrada y a la salida; el auto reaparece en el anillo mirando a la calle.

### 2.5 Cámara (`workshopCamera.ts`)

Rig orbital en esféricas alrededor de un `target` sobre el auto. Cada categoría nombra un plano
(datos, en el catálogo/tuning): `{ yaw, pitch, distance, targetY, targetZ, fov }`.

| Categoría | Plano |
|---|---|
| Paragolpes delantero / faros | 3/4 frontal bajo, cerca |
| Paragolpes trasero / escape / patente | 3/4 trasero bajo; patente = trasero centrado y muy cerca |
| Polleras / neón | lateral bajo (el neón además baja las luces del taller) |
| Capot | frontal alto picado |
| Baúl / alerón | 3/4 trasero alto |
| Llantas / camber / offset / altura | lateral a la altura del eje, cerca de la rueda delantera |
| Pintura / vinilos | 3/4 general con órbita lenta continua |
| Luces interiores | a través del parabrisas |

Interpolación amortiguada (yaw por el arco más corto, *ease* ~0,6 s), arrastre libre con mouse/stick
derecho/touch que vuelve al plano tras unos segundos quieto, y un leve vaivén para que nunca esté
estática. Sin asignaciones por frame.

### 2.6 UI (`src/ui/workshop/`)

Fiel a las referencias: barra superior con título de sección + **carrusel horizontal de íconos**
(SVG propios, centro resaltado) + nombre de categoría debajo; **riel vertical a la izquierda** con
las opciones; nombre de la pieza abajo al centro; abajo a la derecha `ATRÁS` / `INSTALAR · $precio` /
`SALIR`; billetera visible; **rating visual** con estrella (suma de ratings de piezas; por ahora
solo un número, después puede alimentar reputación). Paleta de colores en grilla para pintura/neón.
Dos niveles de menú como NFSU2 (Carrocería → Paragolpes delanteros → opciones). Entrada: teclado,
gamepad (`gamepadMenu.ts`, LB/RB para categoría) y touch. CSS en archivo propio
(`workshop.css`, importado por el overlay) para no pisar `styles.css`. Identidad JDM × cyberpunk del
juego, no el verde lima de NFSU2.

### 2.7 Piezas por área — cómo se resuelve cada una

| Pedido | Solución técnica |
|---|---|
| Paragolpes del./tras., polleras, capot, baúl, alerones | Slots de geometría con `loft/box/wheelArch` de `geometryKit`. 4–5 opciones por slot + fábrica. Capot: tomas/bulge/carbono. Baúl: liso/ducktail/carbono. Alerón: ninguno/lip/ducktail/GT actual/GT alto doble plano. |
| Llantas, tamaño, offset | `wheel.ts` → catálogo de 6–8 diseños (5 rayos, multi-rayo, malla, dish profundo, 6 rayos dobles, turbofan). Tamaño = relación llanta/goma; ancho; offset = posición X del carrier. Color de llanta vía vértices blancos × material. |
| Altura, camber, ancho de vía | `wheelRig.ts`: carrier `steer → camber → spin` (espejado por lado); altura = offset base de `chassis.position.y` (hoy lo escribe `attitude.heave`, se suma). Solo visual. |
| Faros, neón, luces interiores | `lights.ts`/`underglow.ts`/`interior.ts`: formas de faro/trasera como slot, colores por material. **Neón vs. carga del rayo: ver decisión D2.** |
| Escape visible y sonido | Slot de puntas (simple, doble actual, cañón, cuádruple, lateral) + `engine.setExhaust(preset)` que re-hornea los buffers (tono de cuerpo, filtro, drive, propensión a backfire). 4 presets como *punto de partida*: **Juan los afina de oído** (memoria: el backfire se afina de oído, no por espectro). Al elegir un escape en el taller, el motor pega un acelerón de prueba. |
| Pintura | Color base (paleta ~32) × acabado → parámetros del `MeshPhysicalMaterial` (metalness, roughness, clearcoat, `iridescence` para perlado). |
| Vinilos, calcos, grafitis | `paintShop.ts`: compositor en canvas 1024² con atlas por regiones; vinilos = funciones procedurales de canvas (el livery actual pasa a ser el vinilo "RAYO"; rayos, tribal, llamas, franjas, kanji); grafitis reutilizan `env/graffiti.ts`. Se recompone solo al cambiar. Nuevos UVs: `applyBodyAtlasUVs`. |
| Patentes | Celda propia del atlas de pintura (0 draw calls extra). Formato Mercosur argentino (`AB 123 CD`), 7 caracteres `[A-Z0-9 ]`, 3–4 estilos de chapa. |

Presupuesto: carrocería ≤ +1.500 triángulos sobre la actual; draw calls del auto = 14, sin cambios.

---

## 3. Decisiones (Juan aprobó las recomendaciones el 2026-09-19)

Tomadas tal como están abajo. D4: los precios los calibra el agente F contra lo que paga hoy la
economía (`src/sim/economy.ts`, `RUSH`/`PASSENGER`/`STREET_RACE` en tuning): una pieza media ≈ 10–15
minutos de juego, las top ≈ 1 hora. D6: el integrador puede hornear las voces nuevas.

- **D1 · Showroom** — escena aparte (recomendado) vs. dentro del mundo.
- **D2 · Neón vs. carga del rayo** — hoy el neón cian *es* el medidor de carga. Recomiendo: en reposo
  muestra el color elegido; al cargar, vira a cian/blanco y parpadea como hoy. La llama de nitro
  sigue magenta siempre (regla visual de `AGENTS.md`).
- **D3 · Versus** — la pintura sigue siendo el color de slot (decisión vigente); piezas y llantas sí
  se ven. Que los **rivales vean tus mods** requiere cambiar el protocolo → Ola 4.
- **D4 · Economía** — comprás una vez, es tuya (`owned`), reinstalar es gratis. Precios en el
  catálogo; necesito un orden de magnitud tuyo (¿cuánto gana un jugador por hora hoy?).
- **D5 · Rating visual** — mostrarlo ya como número; engancharlo a reputación/AURA después.
- **D6 · Voces** — las líneas nuevas del Loco hay que hornearlas (`npm run dialogue:voices`), que
  tiene costo de TTS. Lo dispara el integrador solo con tu OK.
- **D7 · Mundo mientras estás adentro** — la sim sigue corriendo (una ciudad en red nunca se pausa),
  el auto queda retenido por la actividad `'workshop'`, la ciudad no se renderiza.

---

## 4. Plan de ejecución con subagentes (Opus 5)

**Antes de empezar:** hay cambios sin commitear en `tuning.ts`, `game.ts`, `styles.css`, `minimap.ts`.
Los worktrees salen de `HEAD`: commitear primero.

### Ola 0 — Contratos y refactor habilitante (1 agente, secuencial, sin worktree)
Es lo que desbloquea el paralelismo; nada visible cambia.
1. `core/loadout.ts`, esqueleto de `content/carParts.ts` y `content/shops.ts`, tipos/eventos en `types.ts`.
2. Partir `carVisual.ts` en ensamblador + `parts/` (con las piezas actuales como fábrica),
   `lights.ts`, `underglow.ts`, `wheelRig.ts`. `CarVisual.applyLoadout(loadout)`.
3. Test de regresión: geometría de fábrica idéntica a la actual; `npm run perf:check` sin cambios.
4. Actualizar `AGENTS.md` (alcance: taller permitido) y `docs/DECISIONS.md`.

### Ola 1 — En paralelo, `isolation: worktree`, archivos disjuntos
Los archivos exactos de cada agente y los puntos de extensión están en **§6 Contratos de la Ola 0**;
donde difiera de esta tabla, manda §6.

| Agente | Alcance | Archivos propios |
|---|---|---|
| **A · Carrocería** | Paragolpes, polleras, capot, baúl, alerones, puntas de escape | `vehicles/parts/*`, tests |
| **B · Ruedas y stance** | Diseños de llanta, tamaño/ancho/offset, camber, altura | `vehicles/wheel.ts`, `vehicles/wheelRig.ts`, tests |
| **C · Pintura** | Atlas UV, compositor, acabados, vinilos, calcos/grafitis, patente | `vehicles/paintShop.ts`, `vehicles/livery.ts`, `vehicles/plate.ts`, `geometryKit.ts` (solo UVs) |
| **D · Showroom y cámara** | Escena interior, plataforma, luces, rig de cámara con planos | `render/workshop/*` |
| **E · UI** | Overlay NFSU2 completo contra un `WorkshopState` simulado, íconos, gamepad/touch | `ui/workshop/*` |
| **F · Reglas y guardado** | `sim/workshop.ts`, catálogo con precios, `progress.ts`, servidor + migración 004 | `sim/workshop.ts`, `content/carParts.ts`, `core/progress.ts`, `server/accounts.mjs`, `server/db/migrations/004_garage.sql`, tests |
| **G · Luces y audio** | Estilos/colores de faros, neón (D2), luces interiores, presets de escape | `vehicles/lights.ts`, `vehicles/underglow.ts`, `vehicles/interior.ts`, `audio/engine.ts` |

Cada brief incluye: este documento, la sección que le toca, sus archivos propios, la regla de no
tocar los puntos calientes, y "reportá archivos cambiados + tests corridos" (`AGENTS.md`).

### Ola 2 — Integración (1 agente)
`workshop/controller.ts`; cableado en `game.ts`, `hud.ts`, `activities.ts`, `minimap.ts`,
`analyticsPlay.ts` (`workshop_enter`, `part_purchased`); transición de entrada/salida; cartel del
garage pasa a "OPEN"; líneas nuevas del Loco; el lavado de daño gratis se conserva.

### Ola 3 — QA y revisión (2 agentes)
- `scripts/garage-shots.mjs` (puppeteer, como `city-shots.mjs`): una captura por plano de cámara y
  por pieza. Revisar **recortes 1:1 / píxeles**, no miniaturas (memoria: los screenshots reducidos
  de escenas oscuras engañan).
- `npm test`, `npm run typecheck`, `npm run perf:check`, draw calls del auto = 14, prueba con
  gamepad y touch, save corrupto → auto de fábrica, ida y vuelta con el servidor.
- Revisor de arquitectura de solo lectura sobre el diff completo.

### Ola 4 — Después (fuera de este alcance)
Loadout por el wire (`hello` + bump de versión en **ambos** `protocol`), rivales y autos del meet con
loadouts, rating → reputación, segundo taller, mods mecánicos.

---

## 5. Riesgos

- **Conflictos de merge** en los puntos calientes → mitigado con la Ola 0 y un único integrador.
- **Atlas UV**: cambiarlo altera cómo se ve el livery actual; el vinilo "RAYO" debe re-pintarse para
  el atlas nuevo y compararse contra capturas de hoy.
- **Legibilidad de juego**: neón (D2) y color de slot en versus (D3) no pueden romperse por estética.
- **Sonido**: los presets de escape son subjetivos; planificar una pasada de Juan de oído.
- **Tamaño del bundle**: showroom y UI del taller van en chunk lazy; el menú no debe pagar por ellos.

---

## 6. Contratos de la Ola 0

Hecha el 2026-09-19. Cero cambio visible: `tests/carVisualStock.test.ts` fija la geometría, los
materiales, el orden de las mallas y la pose de las ruedas del auto de fábrica con números
capturados **antes** del refactor. Si ese test falla, cambiaste el auto de fábrica: no se
re-snapshotea (única excepción: el `uv` de la carrocería, que el agente C re-baselinea a
propósito al pasar al atlas).

### 6.1 Archivos creados y nombres exportados

| Archivo | Exporta | Dueño desde la Ola 1 |
|---|---|---|
| `src/core/loadout.ts` | `CarLoadout`, `PartId`, `ColorId`, `PaintFinish`/`PAINT_FINISHES`, `DecalZone`/`DECAL_ZONES`, `VinylLayer`, `DecalLayer`, `WheelSizeStep`, `WheelWidthStep`, `STEP_RANGES`/`StepCategoryId`, `MAX_VINYLS`, `PLATE_MAX_CHARS`, `STOCK_LOADOUT` (congelado), `stockLoadout()`, `cloneLoadout()`, `sanitizeLoadout()`, `sanitizePlateText()`, `loadoutsEqual()`, `ScalarCategoryId`, `getChoice()`, `isValidChoice()`, `setChoice()`, `setVinyls()`, `setDecals()`, `setPlateText()`, `loadoutPartIds()`, `loadoutRating()`, `encodeLoadout()`, `decodeLoadout()`, `stockPartsMissing()` | **congelado** (solo el integrador) |
| `src/content/carParts.ts` | `CategoryId`, `WorkshopGroupId`, `CategoryKind` (`part`/`color`/`step`/`finish`/`layers`), `CategoryDef` (`id, group, kind, label, icon, cameraShot, price, dimShowroom?`), `GROUPS`, `CATEGORIES`, `CATEGORY_IDS`, `categoryDef()`, `categoriesOf()`, `isCategoryId()`, `PartDef` (`id, category, name, price, rating, blurb?, defaultColor?`), `PARTS`, `findPart()`, `isPartOf()`, `partsOf()`, `stockPartId()`, `PaletteColor` (`id, name, hex, accent?`), `PALETTE` (32), `findColor()`, `isColorId()`, `validateCatalogue()`; re-exporta `CAMERA_SHOTS`/`CameraShot`/`CameraShotKey` | F (precios: tabla `PRICING` y `CategoryDef.price`) |
| `src/content/workshopShots.ts` | `CameraShot { yaw, pitch, distance, targetY, targetZ, fov, orbitSpeed? }`, `CameraShotKey`, `CAMERA_SHOTS` (convención de ejes en el encabezado) | D |
| `src/content/parts/body.ts` | `BODY_PARTS` (paragolpes, polleras, capot, baúl, alerón, puntas de escape) | A |
| `src/content/parts/wheels.ts` | `WHEEL_PARTS` (diseños de llanta) | B |
| `src/content/parts/paint.ts` | `PAINT_PARTS` (vinilos y calcos; el de fábrica es `vinyls.rayo`) | C |
| `src/content/parts/plate.ts` | `PLATE_PARTS` (estilos de patente) | C |
| `src/content/parts/lights.ts` | `LIGHT_PARTS` (formas de faro y trasera) | G |
| `src/content/parts/exhaustSound.ts` | `EXHAUST_SOUND_PARTS` (presets de sonido) | G |
| `src/content/shops.ts` | `ShopDef { id, npc, name, categories, priceFactor }`, `LOCO_MUSTANG_SHOP`, `SHOPS`, `findShop()`, `shopPrice()`, `shopSells()`, `validateShop()` | F |
| `src/core/types.ts` | `WorkshopPhase`, `WorkshopDenyReason`, `WorkshopState`, `WorkshopOptionView`, `WorkshopHudSnapshot`; `GameEvent` += `workshopEnter`, `workshopExit`, `workshopPreview`, `workshopPurchase`, `workshopDenied` | integrador |
| `src/sim/activities.ts` | `ActivityKind` += `'workshop'`, `workshopEngaged()`; `engagedActivity()` acepta `workshop?` (todavía nadie lo pasa: `GameState` no tiene `workshop`) | integrador |
| `src/render/scene/vehicles/parts/common.ts` | `BodySlot`, `BODY_SLOTS` (orden de fusión), `CustomBodySlot`, `isCustomSlot()`, `slotPartId()`, `BodyPartContext { openCabin, loadout }`, `SlotModule { slot, variants, build(partId, ctx) }`, `BODY_COLORS`, `CAR_DIMS` | A |
| `src/render/scene/vehicles/parts/{hull,greenhouse,fenders,frontBumper,skirts,rearBumper,spoiler,mirrors,hood,trunk,exhaustTips}.ts` | un `<slot>Slot: SlotModule` cada uno; `exhaustTips.ts` además `exhaustOutlets(partId)` / `ExhaustOutlet` | A |
| `src/render/scene/vehicles/parts/index.ts` | `SLOT_MODULES`, `buildSlotParts()`, re-exporta `common` y `exhaustOutlets` | A |
| `src/render/scene/vehicles/bodyAssembler.ts` | `buildBodyGeometry(openCabin = false, loadout = STOCK_LOADOUT)` (re-exportado por `carVisual.ts` con la misma firma de siempre) | **congelado** |
| `src/render/scene/vehicles/bodyUVs.ts` | `applyBodyUVs(geometry)` (hoy = `applyLengthwiseUVs`) | C |
| `src/render/scene/vehicles/plate.ts` | `PLATE_MOUNT`, `buildPlateGeometry(plate)`, `formatPlateText()`, `CanvasCell`, `drawPlate(ctx2d, cell, plate)` (stub) | C |
| `src/render/scene/vehicles/paintShop.ts` | `CarPaint { texture, apply(loadout, material), dispose }`, `createCarPaint(loadout)` (stub: el livery de hoy) | C |
| `src/render/scene/vehicles/lights.ts` | `CarLights`, `createCarLights(chassis, loadout)`, `buildHeadGeometry(partId)`, `buildTailGeometry(partId)` (re-exportado por `carVisual.ts`), `buildExhaustGlowGeometry(outlets)` | G |
| `src/render/scene/vehicles/underglow.ts` | `Underglow { pool, strips, setCharge, update, applyLoadout, dispose }`, `createUnderglow(root, chassis, loadout)` | G |
| `src/render/scene/vehicles/wheelRig.ts` | `WheelRig { mesh, wheels, rideHeight, sync, applyLoadout, dispose }`, `createWheelRig(root, loadout)`, `WHEEL_WIDTH`, `STANCE_STEP`, `StanceParams`, `stanceParams()`, `buildLoadoutWheelGeometry()` | B |
| `src/render/scene/vehicles/interior.ts` | `CabinInterior.applyLoadout()` (no-op) | G |
| `src/render/scene/carVisual.ts` | `CarVisual.applyLoadout(loadout)`, `CarVisual.loadout`, `CarVisualOptions.loadout`; el resto igual | **congelado** (integrador) |
| `tests/loadout.test.ts`, `tests/carVisualStock.test.ts` (+ `tests/__snapshots__/carVisualStock.test.ts.snap`) | contratos y regresión del auto de fábrica | todos lo corren; nadie cambia los números de fábrica |

### 6.2 Reglas comunes

- **Ids**: `<categoría>.<nombre>`, nombre en `[a-z0-9-]`. Cada categoría `part` tiene exactamente un
  `<categoría>.stock` = el auto de hoy. Colores: ids de `PALETTE`, nunca RGB. Pasos: enteros dentro
  de `STEP_RANGES`, 0 = hoy. Qué vale un paso en metros/radianes vive en el render (`STANCE_STEP`).
- **Una pieza = dos lugares**: la entrada del catálogo (`src/content/parts/<dominio>.ts`) y su
  variante en el constructor (mismo id). `validateCatalogue()` y los tests de cada agente lo
  verifican. Precio y rating en el archivo de dominio son provisorios; F manda vía `PRICING`.
- **Nunca** tocar `VEHICLE`, `src/sim/vehicle.ts`, ni nada que la simulación lea.
- `applyLoadout` de cada módulo es de tiempo de taller: puede asignar memoria, **debe** disponer lo
  que reemplaza, **no** puede crear ni quitar mallas ni materiales (14 draw calls, mismos materiales).
- Todo `update`/`sync`/`set*` por frame: cero asignaciones.
- El orden de creación de mallas y materiales en `createCarVisual` es el orden en que three.js
  desempata el dibujo: no reordenar.
- Puntos calientes (`game.ts`, `hud.ts`, `types.ts`, `tuning.ts`, `styles.css`, `activities.ts`,
  `loadout.ts`, `carVisual.ts`, `bodyAssembler.ts`): **ningún agente de la Ola 1 los edita**. Si
  un agente necesita un cambio de contrato, lo reporta; lo hace el integrador.
- Correr antes de terminar: `npm run typecheck`, `npx vitest run tests/loadout.test.ts
  tests/carVisualStock.test.ts tests/vehicleVisual.test.ts` + los tests propios.

### 6.3 Puntos de extensión por agente

**A · Carrocería** — archivos: `src/render/scene/vehicles/parts/*.ts` (salvo que `common.ts` es
compartido de solo lectura para los demás), `src/content/parts/body.ts`, tests nuevos
`tests/bodyParts*.test.ts`.
- Pieza nueva: un `case '<slot>.<nombre>':` en el `build` del `SlotModule` del slot + el id en su
  `variants` + la entrada en `BODY_PARTS`. Devolver geometrías pasadas por `part()`/`partRGBA()`.
- Slots vendibles: `frontBumper` (splitter + parrilla + toma), `rearBumper` (difusor + valance),
  `skirts`, `hood` (lo que va SOBRE el capot del casco), `trunk` (ídem; fábrica = vacío),
  `spoiler`, `exhaustTips`. Fijos (no tocar la variante `stock`): `hull`, `greenhouse`, `fenders`,
  `mirrors`.
- Puntas de escape nuevas: además listar sus bocas en `exhaustOutlets(partId)`; `lights.ts` pone
  ahí las llamas.
- Respetar: `PLATE_MOUNT` (`plate.ts`), faros en z ≈ -2.13 x ≈ ±0.44, traseras/reversa en
  z ≈ 2.11–2.16, tiras de neón en x = ±0.995 y = 0.11. `ctx.loadout` disponible para reaccionar a
  otras elecciones (p. ej. `stance.trackFront` en los guardabarros). Presupuesto: ≤ +1.500 tris.

**B · Ruedas y stance** — archivos: `src/render/scene/vehicles/wheel.ts`,
`src/render/scene/vehicles/wheelRig.ts`, `src/content/parts/wheels.ts`, tests `tests/wheelRig*.test.ts`.
- Diseños: `buildLoadoutWheelGeometry(l)` en `wheelRig.ts` (o funciones nuevas en `wheel.ts`) por
  `l.wheels.rim`; color de llanta `l.wheels.rimColor` horneado en los vértices de los rayos (hex de
  `findColor`); `l.wheels.size` cambia la relación llanta/goma **con el radio exterior fijo en
  `VEHICLE.wheelRadius`**. `wheelKey()` decide cuándo se reconstruye la geometría.
- Stance: ya implementado con valores iniciales en `STANCE_STEP` (altura, camber, trocha, ancho);
  afinar a ojo. Contrato: `wheels[i].spin.parent === wheels[i].steer`, `steer.position.y ===
  VEHICLE.wheelRadius`, camber como matriz entre `steer` y `spin` (no un nodo), `rideHeight` en
  metros lo suma `CarVisual.update` al `chassis`.
- Los rivales (`rivalCarVisual.ts`) no usan el rig: no tocarlos.

**C · Pintura, vinilos, calcos, patente** — archivos: `src/render/scene/vehicles/paintShop.ts`,
`livery.ts`, `bodyUVs.ts`, `plate.ts`, `geometryKit.ts` (solo funciones de UV nuevas),
`src/content/parts/paint.ts`, `src/content/parts/plate.ts`, tests `tests/paintShop*.test.ts`.
- `createCarPaint(loadout)` crea UNA `CanvasTexture` que es `map` y `emissiveMap` del cuerpo para
  toda la vida del auto; `apply(loadout, material)` la repinta en el lugar (`needsUpdate`) y pone
  color/metalness/roughness/clearcoat/iridescence según `paint.base` × `paint.finish`. Debe dejar
  `material.color` en la pintura LIMPIA (el auto la lee para el grime de daño). Fábrica
  (`midnight` + `metallic` + `vinyls.rayo`) = el livery de hoy (material color blanco × mapa).
- Atlas: `applyBodyUVs()` en `bodyUVs.ts` es el único lugar donde se asignan UVs del cuerpo;
  al cambiarlo, re-baselinear SOLO los campos `uv` de `tests/carVisualStock.test.ts`.
- Patente: `buildPlateGeometry(plate)` por `plate.style` (sigue fusionada al cuerpo),
  `drawPlate(ctx2d, cell, plate)` para la celda del atlas, `formatPlateText()` para `AB 123 CD`.
- En partida (slot) no hay `CarPaint`: el color de slot manda (D3).

**D · Showroom y cámara** — archivos: `src/render/workshop/*` (nuevo), `src/content/workshopShots.ts`,
tests `tests/workshopCamera*.test.ts`.
- La cámara lee `CAMERA_SHOTS[categoryDef(cat).cameraShot]` (ejes en el encabezado de
  `workshopShots.ts`) y `CategoryDef.dimShowroom`. Se pueden agregar claves a `CameraShotKey`
  (y a `CAMERA_SHOTS`); para asignarlas a una categoría, pedírselo a F (`CATEGORIES` es suyo).
- El showroom recibe el `CarVisual` del jugador (re-parentar `car.root`), un `ShopDef` y nada de
  `game.ts`. API sugerida para el integrador: `createShowroom(renderer)` →
  `{ scene, camera, attach(car), detach(), setCategory(cat), update(dt, input), dispose }`.

**E · UI** — archivos: `src/ui/workshop/*` (+ `workshop.css` importado desde ahí), tests
`tests/workshopUi*.test.ts`.
- Renderiza un `WorkshopHudSnapshot` (en `types.ts`) y emite intenciones; no conoce `GameState`.
  Datos estáticos (grupos, etiquetas, íconos por `CategoryDef.icon`, paleta con `accent`) de
  `carParts.ts`. Probar contra snapshots simulados. Entrada: teclado, `gamepadMenu.ts`, touch.

**F · Reglas y guardado** — archivos: `src/sim/workshop.ts` (nuevo), `src/content/carParts.ts`
(`PRICING`, `CategoryDef.price`, `CATEGORIES`), `src/content/shops.ts`, `src/core/progress.ts`,
`server/accounts.mjs`, `server/db/migrations/004_garage.sql`, tests `tests/workshop*.test.ts`.
- Máquina de estados sobre `WorkshopState` con los eventos `workshop*`; `setChoice`/`setVinyls`/
  `setDecals`/`setPlateText` para cambiar el preview; `loadoutPartIds` + `owned` para saber qué se
  paga; `shopPrice(shop, …)` para cobrar vía `spendMoney()`; categorías no-`part` cobran
  `CategoryDef.price` por cambio (F decide si se "poseen").
- Guardado `rb.garage { loadout, owned[] }` pasando SIEMPRE por `sanitizeLoadout` (o
  `decodeLoadout` si se guarda el código compacto); el servidor debe sanear igual (mismo contrato
  de ids: `[a-zA-Z]+\.[a-z0-9-]+`, `[A-Z0-9 ]{0,7}`).

**G · Luces y audio** — archivos: `src/render/scene/vehicles/lights.ts`, `underglow.ts`,
`interior.ts`, `src/content/parts/lights.ts`, `src/content/parts/exhaustSound.ts`,
`src/audio/engine.ts`, tests `tests/carLights*.test.ts`.
- `lights.ts`: formas en `buildHeadGeometry`/`buildTailGeometry` por id; `applyLoadout` ya
  reconstruye geometría al cambiar pieza; agregar `lights.headColor` → `headMat.emissive`. Las
  traseras siguen rojas al frenar y magenta con nitro.
- `underglow.ts`: `applyLoadout` recolorea desde `lights.neon` (`'off'` apaga el reposo, NO la
  lectura de carga); D2: al cargar vira a cian/blanco y parpadea como hoy. `'rayo'` (cian + acento
  magenta) = exactamente lo de hoy.
- `interior.ts`: `applyLoadout` por `lights.interior` (`'rayo'` = cian izq. / magenta der.).
- Audio: `engine.setExhaust(presetId)` por `exhaustSound`; Juan afina de oído.

**Integrador (Ola 2)** — `GameState.workshop: WorkshopState | null` y `workshop.locked` en
`lockOtherActivities`; `src/workshop/controller.ts`; `game.ts`/`hud.ts`/`minimap.ts`; construir el
`WorkshopHudSnapshot`; `car.applyLoadout(state.workshop.preview)` en cada `workshopPreview` y el
`installed` al salir y al cargar la partida (`createCarVisual({ loadout })`).


---

## 7. Estado de la Ola 2 (integrada el 2026-09-19)

Integrada en `main` (commits `5b84acd`, `81f6905`, `879e0d8`). Detalle y mediciones en
`docs/PROGRESS.md` ("Loco Mustang's workshop opens").

- **Hecho**: `src/workshop/controller.ts` (carga lazy, corte a negro, showroom, overlay, mapeo
  intención → comando, preview en el auto, escape + acelerón, guardado, voz del Loco adentro, editor
  de capas); `GameState.workshop` + puerta en el anillo + actividad que retiene el auto y apaga la
  policía; `GarageLineKind` ampliado; `audio.setExhaust/revDemo`; `workshop_enter` y
  `part_purchased`; planos de cámara pedidos por D (faros, escape, neón) y camber/trocha re-afinados;
  el auto sale del save en todos los modos (en partida, pintura de slot — D3); `__rb.workshop` para
  automatizar; `scripts/workshop-drive.mjs` recorre una visita entera en el juego real.
- **Voces (D6)**: no se hornearon — no hay `ELEVENLABS_API_KEY` en esta máquina. Las 20 líneas nuevas
  están en `PENDING_VOICE_DIALOGUE` (`src/content/dialogueLines.ts`); `npm run dialogue:voices` con la
  clave las hornea, y después se pasan a `RUNTIME_DIALOGUE`. Mientras tanto se ven como subtítulo.
- **Arreglos rápidos de la lista de la Ola 1 que NO se hicieron** (ninguno era barato y seguro):
  - Forro oscuro en los pasos de rueda: cambiaría la geometría de fábrica (`carVisualStock`).
  - Alerón `double-gt` (placas y flap que se leen como bloques marrones en 3/4 trasero),
    `headlights.slim` (barras en ángulo), `headlights.popup` (placas blancas flotando sobre el capot,
    y su choque con capots con toma/joroba/ventilados): son decisiones de geometría de A y G.

### Para la Ola 3 (QA)

1. Voces: hornear con la clave y mover `PENDING_VOICE_DIALOGUE` a `RUNTIME_DIALOGUE`.
2. Gamepad (LB/RB, stick derecho para orbitar) y touch (teléfono rotado) dentro del taller: no se
   probaron en la Ola 2. Revisar también que los botones táctiles de manejo ocultos no queden
   "apretados" al salir.
3. Neón en `neonLow` con el taller atenuado: el color elegido se lee poco en la captura; revisar la
   intensidad en reposo (D2) y el plano.
4. El medidor de GPU del overlay de debug (`gpuTimer`) solo envuelve el render de la ciudad: dentro
   del showroom muestra un valor viejo.
5. Programas de shader: después de la primera visita quedan ~16 más en caché (las variantes de los
   materiales del auto con las luces del showroom); no crecen por visita.
6. Las piezas señaladas arriba (double-gt, slim, popup, popup vs capots, forro de pasos de rueda).
7. Capturas por plano y por pieza (`scripts/garage-shots.mjs`) a tamaño completo; el cromado débil
   (C) y el grime de choque sobre pintura (material blanco × textura) a revisar a ojo.
8. En una sala de la ciudad en red el taller funciona (la sim sigue, el auto publica quieto en el
   anillo); no se probó con otro jugador conectado.
