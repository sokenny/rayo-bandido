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


Status notes (2026-09-03): RB-005 and RB-006 stay `in_progress` until a keyboard hand-feel pass and the
camera occlusion fix land (see `docs/PROGRESS.md`, "PENDING ITEMS"). RB-016 is the open QA pass.
