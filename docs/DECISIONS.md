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
| Multiplayer | Required later, excluded from day-one MVP. Delivered 2026-09-04: one room, up to 4 cars, the Bandido Loop |

## Temporary MVP defaults

These values may be tuned without asking Juan. Keep them centralized.

| Parameter | Starting default |
| --- | --- |
| Controls | WASD/arrow keys drive; Space handbrake; Shift nitro; E or click lightning; R restart |
| Gamepad | Xbox-style standard mapping, always live beside the keyboard: RT/LT drive, left stick steers, LB handbrake, RB nitro, X lightning, Y cruise, Start restart, View camera; A/Start confirm in menus |
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

## Multiplayer decisions (2026-09-04)

Asked and answered by Juan before the work started: player cars are solid and trade paint;
lightning stays pointed at the electric cars and cannot be fired at rivals; the pass covers the
race circuit only, and the Test city stays single player.

| Area | Decision | Why |
| --- | --- | --- |
| Shape | One Node process serves the built game over HTTP **and** the match socket at `/ws` on the same port | `ngrok http 8080` then yields one URL that is both the game and the server, so a friend needs one link and the client needs no configuration |
| Authority | Client-authoritative cars: every browser simulates its own car and publishes the result 20 times a second; the server relays and owns the clock | Keeps the driving feel identical to single player — no input latency, no prediction, no rollback. The cost is that it is cheatable, which is the right trade for a lobby of friends and is written down in `src/net/protocol.ts` |
| Rival motion | Snapshot interpolation, rivals drawn 110 ms in the past, extrapolated up to 250 ms when a packet is late | Two real samples to blend between; a fixed small amount of apparent lag instead of an unpredictable amount of jitter |
| Contact | Each client resolves only its own car out of a collision, by 62% of the overlap | A rival cannot be moved from here — the next snapshot would undo it. Both clients doing their own half adds up to a clean separation. The two screens will not agree exactly on a hard hit; that is the accepted cost |
| Traffic | The host client owns the twelve electric cars and publishes them 10 times a second; the others run the same deterministic patrol and fold the reports in as corrections over ~150 ms | Everybody dodges the same cars. Keeping it on a client means the server never has to know what the circuit looks like, so it stays a relay with no game code in it |
| Traffic reports are compared in the past | A receiver keeps half a second of its own traffic history and measures a report against its copy at the report's timestamp, not against its copy now (`src/sim/traffic.ts`) | Comparing with "now" found every car behind by one latency's worth of travel and dragged it back ten times a second — a sawtooth that grew with latency. Measured in the past, two agreeing simulations report zero error whatever the link |
| Traffic reports carry patrol index and knock velocity | Seven numbers per car on the wire instead of four | A copy dragged to the host's position but steering for its own stale waypoint fought the corrections for the car's heading. Sending the waypoint (and the shove) keeps the two simulations on the same patrol; destroyed cars come back only on the host's say-so for the same reason |
| Local kills and shoves are held | A non-host that kills or shoves an electric car ignores the host's reports for that car for a round trip (1.5 s for a kill; RTT + 0.25 s, clamped 0.35–0.9 s, for a shove), then follows the host | Otherwise the host's next report, sent before the host knew, resurrected the car or slid it back onto the bonnet. The shove is also reported to the host (`bump`), which fast-forwards it by the transit time so the copies meet |
| Shoved traffic collides with the world | A knocked electric car is pushed out of walls and buildings with the car's own circle routine | A punt at speed used to send a car straight through the guardrail and off the circuit |
| Rival samples are stamped on arrival | Each snapshot row carries the server time that car's state arrived, and a receiver drops a sample it has already seen | The fan-out timer is not in step with any client's publish timer, so the same sample could be sent twice under two different stamps; rivals then waited and jumped. Rivals are also re-placed for every rendered frame, not only per simulation tick, so they move every frame on a 120 Hz display |
| Own car painted in slot colour | In a match the player's own car drops the livery for its slot colour and wears the same marker strips as a rival; the minimap arrow matches | Each player saw themselves as the violet livery and everyone else in slot colours, so "the yellow car" meant a different driver on every screen |
| The start | The server picks one instant for GO and tells every client in server time; each client's countdown is however long is left until then | The grid launches together whatever each machine took to build the circuit, and whatever the latency is |
| Room | ~~A single room, capacity 4, host is the longest-connected player~~ **Superseded 2026-09-04 by "Rooms" below.** Capacity 4 and host-by-join-order still stand, per room | Juan asked for one server and up to four cars per match; room codes looked like UI for a problem nobody had, until the problem turned out to be "whoever clicks VERSUS first owns the only race there is" |
| Restart | R is a rescue in a match — back on the road at the last gate, clock still running — not a restart | A restart would reset one client's race while everyone else kept going |
| Protocol | Duplicated between `src/net/protocol.ts` (source of truth) and `server/protocol.mjs`, with `tests/protocol.test.ts` failing if they drift | The server is plain JavaScript outside the TypeScript project and cannot import the client module; a test is cheaper than a build step for the server |
| Dev transport | A dev build aims its socket at `DEV_MATCH_PORT` (8080); production uses its own origin | A Vite `server.proxy` websocket entry was tried first and dropped: it hung up the upgrade before it reached the match server. Two ports in development is simpler than a proxy that has to work |

## Rooms (2026-09-04, evening)

Juan asked to be able to create his own server rather than have the first player to click VERSUS
become the host of the only room there is, so that only the people he invites are on his grid.
Asked and answered before the work: joining is by code **plus** a browsable list of rooms that
can be public; the host gets no moderation controls (no kick, no lock) — who has the code is the
whole access model.

| Area | Decision | Why |
| --- | --- | --- |
| Many rooms per process | `server/rooms.mjs` holds a registry of `server/room.mjs` instances keyed by code; the room is chosen once at `hello` and never changes for the life of a socket | The room stays the whole world as far as a player is concerned, and nothing below the handshake has to carry a room id — the 20 Hz messages are untouched, so this cost no bandwidth |
| Four-character codes, `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` | No I, O, 0 or 1 | A code is read off one screen and typed into another, or read aloud down a call. Those four are the characters people get wrong. 32^4 is a million codes for a server that holds 64 rooms |
| ~~Unlisted by default~~ **Listed by default** (changed by Juan the same evening, before anyone else had played it) | Creating a room offers a **LIST IT PUBLICLY** tick, ticked to start with; untick it and the room appears in no list, so only the link or the code gets a car in | First written private-first, on the reasoning that the request was privacy. Juan asked for the opposite default: with nobody listed, the browser screen's list is always empty and multiplayer reads as dead, while a host who wants a closed room only has to untick one box. Privacy is still one click away and the lobby says PRIVATE or PUBLIC in its header, so nobody is listed without seeing it |
| The list is HTTP, not the socket | `GET /rooms` returns the listed rooms; the browser screen polls it every 4 s | It has to be readable before a player has picked a room to open a socket to. Keeping it off the wire protocol also keeps `hello` the only handshake |
| Rooms outlive their players by two minutes | An empty room is reaped `EMPTY_ROOM_TTL_MS` after the last player leaves, not immediately | A host who reloads, or a grid that all quits to the menu between races, comes back to the same code and the same link |
| A link can re-open its own room | `?mp=1&room=K7QP&create=1` joins K7QP or opens it under that code if it has expired; a plain `?mp=1&room=K7QP` is join-only and says "no room called K7QP" | The plain link is what the lobby hands out, so a mistyped code fails loudly instead of quietly stranding a friend in an empty room of their own. The create-or-join form is for a permanent link and for `scripts/qa-mp.mjs`, which needs two browsers to meet without reading each other's screens |
| The room is in the URL | `?mp=1` is the browser screen; the address bar is rewritten to `?mp=1&room=CODE` once the server answers, with `create`/`listed`/`label` dropped. `&listed=0` on a `create` is the URL form of unticking the box, and the browser screen always writes the parameter rather than leaving it to the default | Reloading returns to the same room instead of the browser, the bar can be copied as an invite, and a reload cannot open a second room |
| ESC in the lobby goes back to the rooms | Not out to the main menu, as before | Leaving a room is nearly always followed by joining a different one |
| Protocol 3 | `hello` gained `room` and `create`; `welcome` returns the room; `refused` gained `missing` and `busy` | A version bump is what tells an old page to reload instead of failing strangely; a stale tab would otherwise hello into nowhere |

## Interface skin: hazard yellow (2026-09-04, night)

Juan on the menus as they were: "too naive, dull, kind of childish", and asked for a trashier,
darker, cyberpunk look — the palette of a night-highway reference, slashed display lettering,
and components that read as a hacked terminal rather than as a settings screen. Scope was the
menus and the UI only: the scene, the car, the circuit and the effects were not to be touched.

| Area | Decision | Why |
| --- | --- | --- |
| A fourth colour, not a new palette | Cyan, magenta, acid and violet still mean what they meant; hazard yellow (`#fcee0a`) and a hot red (`#ff2b3d`) were added and belong to the *chrome* — yellow is the system talking, red is danger | The scene is keyed to the old four (`src/core/playerColors.ts`, every effect); repainting them would have been a scene change, which was out of scope. Yellow had no gameplay meaning to collide with, so it could carry the whole interface |
| Two type roles | Condensed display (`Bahnschrift`/`DIN`/`Impact` stack) for anything shouted, monospace for anything the machine says. Nothing is set in the UI sans-serif any more | The old screens were one system font at several sizes, which is what read as naive. No web fonts: the game must run with the network unplugged, so both are system stacks |
| Every surface is notched | One shared `--rb-notch` clip-path cuts the top-right corner, with a 1px stroke drawn along the cut | One rule dresses panels, buttons, list rows and HUD cards as one machined system, and it costs no markup |
| The wordmark is misregistered, not animated | Red and cyan copies sit permanently a few pixels off the yellow, and tear only twice in a four-second loop | A constant shake is unreadable and looks like a broken page; a rare tear reads as bad hardware |
| The main menu is a list plus a dossier | Three numbered rows, and a record panel that describes whichever one the cursor is on — with the WANTED poster cropped to the driver | Three equal cards said nothing about the modes. The dossier gives the copy somewhere to live, and reuses `public/rayo-wanted.webp`, which was already in the build for the in-world billboard |
| Decoration cannot be clicked | The corner brackets, the frame readouts and the scanlines are `aria-hidden` and `pointer-events: none`, and the scanline layer sits below the content | A skin that swallows a click on START RACE is a bug, not a style |
| The loading screen repeats the skin by hand | `index.html` keeps its own inlined copy of the type, the stamp and the hazard bar rather than importing the stylesheet | It has to paint before the bundle is requested, which is the whole reason it is inline |
