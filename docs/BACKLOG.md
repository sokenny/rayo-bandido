# Day-one backlog

Status values: `todo`, `in_progress`, `blocked`, `done`.

| ID | Priority | Status | Task | Acceptance signal |
| --- | --- | --- | --- | --- |
| RB-001 | P0 | done | Scaffold Vite + TypeScript + Three.js project | Dev server and production build succeed |
| RB-002 | P0 | done | Create compact modular night arena | Player sees a readable drivable route |
| RB-003 | P0 | done | Create optimized GT86-like proxy with separate wheels | Car renders and wheel nodes animate independently |
| RB-004 | P0 | done | Implement acceleration, braking, steering and reverse | Keyboard driving is responsive |
| RB-005 | P0 | in_progress | Implement easy arcade drift and handbrake | Player can intentionally sustain a drift |
| RB-006 | P0 | in_progress | Implement chase camera | Camera remains readable during grip, drift and reverse |
| RB-007 | P0 | done | Detect valid drift and accumulate charge | Charge rises only during valid drift |
| RB-008 | P0 | done | Add nitro resource and boost | Nitro increases acceleration/FOV and recharges while moving |
| RB-009 | P0 | done | Add electric-car targets | At least three targets exist and can be acquired |
| RB-010 | P0 | done | Add forward-cone auto-targeting and lightning | Shot selects nearest eligible target and displays a clear arc |
| RB-011 | P0 | done | Add impact/destruction and money | Target responds visibly and money increases once |
| RB-012 | P0 | done | Add restart flow | R restores a playable initial state immediately |
| RB-013 | P1 | done | Add lightweight HUD | Charge, nitro, money and controls are legible |
| RB-014 | P1 | done | Add tire smoke, skid marks and restrained neon effects | Drift is visually readable without major FPS loss |
| RB-015 | P1 | done | Add debug performance overlay | FPS, draw calls and triangles can be inspected |
| RB-016 | P1 | in_progress | Browser QA and tuning pass | Full loop passes acceptance checklist |
| RB-017 | P2 | todo | Add placeholder engine, tire, nitro and lightning audio | Actions receive basic audio feedback |
| RB-018 | P2 | todo | Produce preview deployment if credentials exist | Shareable preview URL or documented blocker |

Do not begin P2 work while any P0 item is broken.

## Multiplayer (added 2026-09-04)

| ID | Priority | Status | Task | Acceptance signal |
| --- | --- | --- | --- | --- |
| RB-020 | P0 | done | Match server: one Node process serving `dist/` and the `/ws` room on one port | `npm run host` + a tunnel gives friends one working link |
| RB-021 | P0 | done | Wire protocol, room, lobby, grid slots and a server-timed start | `tests/matchServer.test.ts` drives a real server end to end |
| RB-022 | P0 | done | Rival cars: snapshot interpolation, five-draw-call visual, name plates, minimap dots | Two windows see each other move smoothly |
| RB-023 | P0 | done | Solid contact between player cars | Overlapping cars separate; closing speed is lost; the rival is never moved locally |
| RB-024 | P0 | done | Host-authoritative electric traffic | Two clients agree on the twelve cars within ~1 m |
| RB-025 | P1 | done | Live standings, results screen, race again | Classification agrees on both screens and ranks finishers by time |
| RB-026 | P1 | todo | Race it against a real person over a real tunnel | Two machines, real latency; check the start is fair and rivals stay smooth |
| RB-027 | P2 | todo | A `retire` message so a quitting player is classified at once | Leaving mid-race does not hold the results for the grace period |
| RB-028 | P2 | todo | Audio for rival cars: engine note, tyres, contact | A car alongside can be heard, not only seen |
| RB-029 | P2 | todo | Extend the perf gate to a full four-car grid | The 60-draw-call budget is checked with a field, not just alone |
| RB-030 | P1 | done | Many rooms per server: create one, invite by code or link, browse the public ones | Two private rooms on one server never see each other; a room's link puts a car in that room and no other |


Status notes (2026-09-03): RB-005 and RB-006 stay `in_progress` until a keyboard hand-feel pass and the
camera occlusion fix land (see `docs/PROGRESS.md`, "PENDING ITEMS"). RB-016 is the open QA pass.
