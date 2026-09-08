import type { ActivitySite, DriftState, GameEvent, PlayerCommand, RushResults, RushState, TargetState, VehicleState } from '../core/types';
import { RUSH } from '../config/tuning';

/**
 * RAYO RUSH: the free-world time attack.
 *
 * WHAT IT IS NOT. It is not a mode, a map or a second simulation. The city keeps running
 * exactly as it was — same traffic on the same patrols, same drift charging the same weapon,
 * same collisions — and this module only watches. It owns a clock, a score and one rule about
 * what a kill is worth; it never moves a car, never touches the lightning and never changes
 * what the player is allowed to do. That is what lets a run start and end without a load, a
 * fade or a hitch: nothing is torn down because nothing was built.
 *
 * WHERE IT SITS IN A TICK. Last, after `stepLightning` — so the `targetDestroyed` events it
 * scores are already in `events` — and after `applyRewards`, so the money a kill pays and the
 * points it scores are decided independently of each other. The run's score is NOT money:
 * `src/sim/economy.ts` is untouched and keeps paying the same ¥ it always did.
 *
 * WHAT COUNTS. Only a `targetDestroyed` raised by this tick's own lightning, which in this
 * game is the only thing that raises one at all (`src/sim/collision.ts` shoves electric cars,
 * it never destroys them; a kill made by ANOTHER player in the open world arrives through
 * `src/sim/traffic.ts` and never becomes an event here). And only once per car: `scored` keeps
 * one flag per electric car for the length of the run, so a car that is shot, respawns twelve
 * seconds later and is shot again is worth nothing the second time.
 *
 * THE STREAK. Kills inside `chainWindow` of each other build a multiplier; letting the window
 * lapse drops it back to nothing. The window is not a grace on the clock — when the run ends
 * mid-streak the streak simply ends with it.
 *
 * STYLE. All lightning charge comes from drifting (`src/sim/drift.ts`), so "charged through
 * drifting" cannot mean "had charge". It means the shot was fired out of a drift: during one,
 * or within `driftChargeGrace` of one ending — which is what actually happens, because the
 * slide is over by the time the nose is pointed at anything. The drift's own length and
 * whether it survived without a collision are what the extra points are scaled by.
 *
 * THE MISSION CHAIN. Three runs in order (`RUSH.levels`), each asking for a bigger score than
 * the last and each driven at its own site. `RushState.cleared` is the whole of it: which
 * mission is on offer, which site the marker stands on and what score it wants are all derived
 * from that one number, so there is nothing to keep in step. The rules move it forward by
 * exactly one, at the end of a run that met the target, and never in any other circumstance —
 * they do not know how to write it down, how to read it back or what a browser is. Persisting
 * it is the caller's job (`src/core/progress.ts`), which is why a run made offline, or with the
 * day's ranked attempts already spent, still advances the chain: clearing a mission is a fact
 * about the driving, not about the network.
 *
 * Pure data in, pure data out. No Three.js, no DOM, no clock of its own, and nothing here
 * allocates per tick.
 */

/** How many missions there are. One place asks `RUSH.levels` its length; everything else asks here. */
export function rushLevelCount(): number {
  return RUSH.levels.length;
}

/**
 * Which mission `cleared` missions in is on offer. Clamped at the last one, so a player who has
 * finished the chain keeps the final site and its target rather than falling off the end of the
 * list — `rushAllClear` is what tells them apart.
 */
export function rushLevelIndex(cleared: number): number {
  const last = RUSH.levels.length - 1;
  if (!Number.isFinite(cleared) || cleared <= 0) return 0;
  return Math.min(last, Math.floor(cleared));
}

/** The score the mission on offer is asking for. */
export function rushTargetScore(cleared: number): number {
  return RUSH.levels[rushLevelIndex(cleared)].target;
}

/** True once every mission has been cleared. The marker stops moving; runs stop gating. */
export function rushAllClear(cleared: number): boolean {
  return cleared >= RUSH.levels.length;
}

/**
 * Where the mission on offer is driven. The ONLY place the world's list of sites and the
 * tuning's list of levels are put together, which is what makes the mismatch harmless: a world
 * that ships fewer sites than there are missions simply runs the last few at its last site.
 * Returns null when the world carries no sites at all, which is how every map but the city
 * says it does not have the activity.
 */
export function rushSiteFor(sites: readonly ActivitySite[] | null | undefined, cleared: number): ActivitySite | null {
  if (!sites || sites.length === 0) return null;
  return sites[Math.min(rushLevelIndex(cleared), sites.length - 1)];
}

/**
 * `cleared` is how many missions this player has already finished, which the caller has read
 * back from wherever it keeps such things. It defaults to 0 — a fresh browser starts at the
 * first mission — and is clamped, because a stored number is an untrusted number.
 */
export function createRushState(targetCount: number, cleared = 0): RushState {
  return {
    phase: 'idle',
    cleared: clampCleared(cleared),
    countdown: 0,
    timeLeft: 0,
    score: 0,
    disabled: 0,
    chain: 0,
    multiplier: 1,
    chainWindow: 0,
    bestChain: 0,
    styleBonus: 0,
    atMarker: false,
    locked: false,
    ranked: false,
    rearmed: true,
    scored: new Uint8Array(targetCount),
    driftSeconds: 0,
    driftClean: false,
    driftCredit: 0,
    driftHeldClean: true,
    results: null,
  };
}

/** A stored progress count, made safe: a whole number between 0 and the length of the chain. */
function clampCleared(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(RUSH.levels.length, Math.floor(value));
}

/**
 * Move the chain to a given point. The caller's way of restoring progress it had written down
 * (`src/core/progress.ts`) onto a state that was built before that was known, and the only
 * thing besides finishing a run that may move it.
 */
export function setRushProgress(r: RushState, cleared: number): void {
  r.cleared = clampCleared(cleared);
}

/**
 * Back to plain free roam. Used by a restart, and by dismissing the results card.
 *
 * `cleared` is deliberately NOT touched: restarting the game puts the car back at the spawn,
 * it does not un-finish missions the player has finished. Progress leaves this state only by
 * being overwritten with `setRushProgress`.
 */
export function resetRushState(r: RushState): void {
  r.phase = 'idle';
  r.countdown = 0;
  r.timeLeft = 0;
  r.score = 0;
  r.disabled = 0;
  r.chain = 0;
  r.multiplier = 1;
  r.chainWindow = 0;
  r.bestChain = 0;
  r.styleBonus = 0;
  r.atMarker = false;
  r.ranked = false;
  r.rearmed = true;
  r.scored.fill(0);
  r.driftSeconds = 0;
  r.driftClean = false;
  r.driftCredit = 0;
  r.driftHeldClean = true;
  r.results = null;
}

/** The multiplier a streak of `chain` eliminations pays, capped by `chainMax`. */
export function chainMultiplier(chain: number): number {
  if (chain <= 1) return 1;
  const { chainStep, chainMax } = RUSH.scoring;
  return Math.min(chainMax, 1 + (chain - 1) * chainStep);
}

/**
 * Style points for one shot, given the drift that charged it. `seconds` is the length of that
 * drift and `clean` whether it ran from start to finish without a collision. 0 when the shot
 * was not drift-charged at all, which is the only case that pays nothing.
 */
export function styleBonusFor(seconds: number, clean: boolean): number {
  const s = RUSH.scoring;
  const held = Math.min(seconds, s.driftBonusMaxSeconds);
  return Math.round(s.driftChargeBonus + held * s.driftBonusPerSecond + (clean ? s.cleanDriftBonus : 0));
}

/**
 * Whether an electric car is a legal Rayo Rush target right now: alive, and not already paid
 * for during this run. Presentation asks the same question when it decides what to mark, so
 * what is drawn as a target and what actually scores can never disagree.
 */
export function isRushTarget(rush: RushState, target: TargetState): boolean {
  if (rush.phase !== 'running') return false;
  if (target.status !== 'active') return false;
  return rush.scored[target.id] !== 1;
}

/**
 * Which electric cars wear the target treatment this frame, written into `out` as one flag
 * per car (`out[id] = 1`).
 *
 * Everything alive and unscored is a legal kill; only the nearest `RUSH.targets.maxMarked`
 * inside `markRadius` are MARKED, because a ring on all ~126 cars in the city is unreadable
 * and would cost a hundred draw calls to say nothing. The radius is comfortably past
 * `LIGHTNING.range`, so a target is seen before it can be shot.
 *
 * Presentation calls this, but it lives here so that what is drawn as a target and what
 * `isRushTarget` will actually pay for are decided by the same code.
 *
 * Allocation free: the top-N is kept in two scratch buffers sized once at module load, and
 * `out` is the caller's own array.
 */
const markIds = new Int32Array(64);
const markDist = new Float64Array(64);

export function markRushTargets(
  rush: RushState,
  targets: readonly TargetState[],
  x: number,
  z: number,
  out: Uint8Array,
): void {
  out.fill(0);
  if (rush.phase !== 'running') return;
  const limit = Math.min(RUSH.targets.maxMarked, markIds.length);
  if (limit <= 0) return;
  const radius2 = RUSH.targets.markRadius * RUSH.targets.markRadius;
  let held = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!isRushTarget(rush, t)) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius2) continue;
    // Insertion into a sorted top-N. `limit` is 14 by default, so the shuffle is nothing.
    if (held === limit && d2 >= markDist[held - 1]) continue;
    let at = held < limit ? held : limit - 1;
    while (at > 0 && markDist[at - 1] > d2) {
      markDist[at] = markDist[at - 1];
      markIds[at] = markIds[at - 1];
      at--;
    }
    markDist[at] = d2;
    markIds[at] = t.id;
    if (held < limit) held++;
  }

  for (let i = 0; i < held; i++) {
    const id = markIds[i];
    if (id >= 0 && id < out.length) out[id] = 1;
  }
}

/**
 * Whether the marker is offering a run right now. The prompt asks this rather than merely
 * "is the player near the marker", so what is on screen and what the key will actually do can
 * never disagree — standing in a marker that has not re-armed since the last run shows nothing.
 */
export function canStartRush(rush: RushState): boolean {
  return rush.phase === 'idle' && rush.atMarker && rush.rearmed && !rush.locked;
}

/**
 * Start a run. Returns false when there is nothing to start — not at the marker, or one is
 * already under way — so the caller can leave the key press alone.
 *
 * `ranked` is the caller's to decide: the rules have no idea what day it is or how many
 * attempts a player has left (`src/net/leaderboard.ts` does), and a run that is out of ranked
 * attempts is still a run. It plays and scores identically; it just is not submitted.
 */
export function startRush(rush: RushState, ranked: boolean, events: GameEvent[]): boolean {
  if (!canStartRush(rush)) return false;
  rush.phase = 'countdown';
  rush.countdown = RUSH.countdownSeconds;
  rush.timeLeft = RUSH.durationSeconds;
  rush.score = 0;
  rush.disabled = 0;
  rush.chain = 0;
  rush.multiplier = 1;
  rush.chainWindow = 0;
  rush.bestChain = 0;
  rush.styleBonus = 0;
  rush.ranked = ranked;
  rush.rearmed = false;
  rush.results = null;
  rush.scored.fill(0);
  events.push({ type: 'rushStart', ranked });
  // The first number of the count-in shows on the tick the run is taken up, not a tick later.
  events.push({ type: 'rushCountdown', seconds: Math.ceil(RUSH.countdownSeconds) });
  return true;
}

/**
 * Put the results card away and hand the world back. Returns false when there was no card up.
 * The marker will not offer another run until the player has driven `rearmRadius` away from it.
 */
export function dismissRush(rush: RushState, events: GameEvent[]): boolean {
  if (rush.phase !== 'results') return false;
  rush.phase = 'idle';
  rush.results = null;
  rush.chain = 0;
  rush.multiplier = 1;
  rush.chainWindow = 0;
  rush.scored.fill(0);
  events.push({ type: 'rushDismissed' });
  return true;
}

/**
 * The flag. Freezes the run into a `RushResults`, and — this is the whole of the progression —
 * moves the chain on by one when the score met what the mission asked for AND that mission was
 * the one still outstanding. The second half of that condition is what stops a replay of an
 * already-cleared level from skipping the next one: `rush.cleared` is both "how many are done"
 * and "which one is on offer", so it may only ever be incremented from the level it points at.
 *
 * The promotion is raised BEFORE the run itself, so a listener that moves the marker and one
 * that shows the card see them in the order they happened.
 */
function endRun(rush: RushState, site: ActivitySite, events: GameEvent[]): void {
  const level = rushLevelIndex(rush.cleared);
  const targetScore = RUSH.levels[level].target;
  const cleared = rush.score >= targetScore;
  const advanced = cleared && rush.cleared === level;
  if (advanced) {
    rush.cleared = level + 1;
    events.push({ type: 'rushLevelUp', level, cleared: rush.cleared, allClear: rushAllClear(rush.cleared) });
  }

  const results: RushResults = {
    score: rush.score,
    disabled: rush.disabled,
    bestChain: rush.bestChain,
    styleBonus: rush.styleBonus,
    ranked: rush.ranked,
    level,
    targetScore,
    levelLabel: site.label ?? '',
    cleared,
    advanced,
  };
  rush.phase = 'results';
  rush.timeLeft = 0;
  rush.chainWindow = 0;
  rush.results = results;
  events.push({ type: 'rushEnd', results });
}

/**
 * One tick of the activity.
 *
 * `events` is this tick's event list, already carrying whatever `stepLightning` raised. It is
 * read for `targetDestroyed` and appended to — the loop is bounded by the length taken before
 * the appends start, so the events pushed here are never re-read.
 */
export function stepRush(
  rush: RushState,
  site: ActivitySite,
  v: VehicleState,
  drift: DriftState,
  cmd: PlayerCommand,
  targets: TargetState[],
  /**
   * Whether a run started on this tick would count towards the global board. The rules have
   * no idea what day it is or how many attempts a player has left — `src/net/leaderboard.ts`
   * does — so the caller supplies the fact and the rules record it.
   */
  ranked: boolean,
  dt: number,
  events: GameEvent[],
): void {
  // What the marker was offering as the tick opened. Compared with the same question at the
  // end, this is what turns a boolean into the edge the chime and any other feedback need.
  const wasOffering = canStartRush(rush);

  /* ------------------------------------------------------------ where the player is */

  const dx = v.x - site.x;
  const dz = v.z - site.z;
  const dist2 = dx * dx + dz * dz;
  const m = RUSH.marker;
  const limit = rush.atMarker ? m.exitRadius : m.promptRadius;
  rush.atMarker = dist2 <= limit * limit;
  // Driving away is what makes the marker offer a run again, so dismissing the card cannot
  // drop the player straight back into a prompt for the run they have just finished.
  if (!rush.rearmed && rush.phase === 'idle' && dist2 > m.rearmRadius * m.rearmRadius) rush.rearmed = true;

  /* ------------------------------------------------------------ one button */

  // Take it up, and afterwards put it away: the same key, because from where the player sits
  // it is the same gesture. Handled before the clock so it works in every phase, and before
  // the count-in below so a run taken up now counts in from this tick rather than the next.
  if (cmd.activate) {
    if (rush.phase === 'results') dismissRush(rush, events);
    else if (rush.phase === 'idle') startRush(rush, ranked, events);
  }

  /* ------------------------------------------------------------ drift credit */

  if (drift.active) {
    if (v.collided) rush.driftHeldClean = false;
    rush.driftSeconds = drift.duration;
    rush.driftClean = rush.driftHeldClean;
    // Held, not counting down: a shot fired mid-slide is always drift-charged.
    rush.driftCredit = RUSH.scoring.driftChargeGrace;
  } else {
    if (rush.driftCredit > 0) rush.driftCredit = Math.max(0, rush.driftCredit - dt);
    // Armed for the next slide. Done here rather than on `driftStart` because by the time
    // that event is seen the drift is already active and may already have been hit.
    rush.driftHeldClean = true;
  }

  /* ------------------------------------------------------------ the clock */

  if (rush.phase === 'countdown') {
    const before = Math.ceil(rush.countdown);
    rush.countdown -= dt;
    const after = Math.ceil(rush.countdown);
    if (rush.countdown <= 0) {
      rush.countdown = 0;
      rush.phase = 'running';
      rush.timeLeft = RUSH.durationSeconds;
      // `seconds: 0` is the GO beat. The overlay draws it as RAYO RUSH.
      events.push({ type: 'rushCountdown', seconds: 0 });
    } else if (after !== before) {
      events.push({ type: 'rushCountdown', seconds: after });
    }
  } else if (rush.phase === 'running') {
    stepRunningRush(rush, site, targets, dt, events);
  }

  /* ------------------------------------------------------------ the offer */

  // Last, so it accounts for everything the tick did: rolling onto the paint raises it, and
  // rolling off it — or taking the run up, which is the marker's offer being accepted — drops it.
  const nowOffering = canStartRush(rush);
  if (nowOffering !== wasOffering) events.push({ type: 'rushPrompt', on: nowOffering });
}

/**
 * The body of a live run: the streak window, the scoring pass over this tick's kills, and the
 * clock. Split out of `stepRush` only so the phases read as alternatives rather than as a
 * sequence of early returns — nothing here is called from anywhere else.
 */
function stepRunningRush(rush: RushState, site: ActivitySite, targets: TargetState[], dt: number, events: GameEvent[]): void {
  if (rush.chainWindow > 0) {
    rush.chainWindow = Math.max(0, rush.chainWindow - dt);
    // Too long between eliminations: the streak is gone.
    if (rush.chainWindow === 0) {
      rush.chain = 0;
      rush.multiplier = 1;
    }
  }

  /* ------------------------------------------------------------ scoring */

  // The length is taken before anything is appended, so a `rushScore` pushed inside the loop
  // is never scored a second time.
  const incoming = events.length;
  for (let i = 0; i < incoming; i++) {
    const ev = events[i];
    if (ev.type !== 'targetDestroyed') continue;
    const id = ev.targetId;
    if (id < 0 || id >= rush.scored.length) continue;
    if (rush.scored[id] === 1) continue;
    const target = targets[id];
    // A destroyed car whose id does not line up with its slot would score the wrong flag.
    if (target && target.id !== id) continue;
    rush.scored[id] = 1;

    rush.chain += 1;
    rush.multiplier = chainMultiplier(rush.chain);
    rush.chainWindow = RUSH.scoring.chainWindow;
    if (rush.chain > rush.bestChain) rush.bestChain = rush.chain;

    const driftCharged = rush.driftCredit > 0;
    const driftSeconds = driftCharged ? rush.driftSeconds : 0;
    const cleanDrift = driftCharged && rush.driftClean;
    const driftBonus = driftCharged ? styleBonusFor(driftSeconds, cleanDrift) : 0;
    // The multiplier rewards the chain, the bonus rewards the driving; multiplying the bonus
    // too would make a late-run streak worth more than everything before it put together.
    const points = Math.round(RUSH.scoring.disable * rush.multiplier) + driftBonus;

    rush.score += points;
    rush.disabled += 1;
    rush.styleBonus += driftBonus;

    events.push({
      type: 'rushScore',
      targetId: id,
      x: ev.x,
      y: ev.y,
      z: ev.z,
      points,
      chain: rush.chain,
      multiplier: rush.multiplier,
      driftBonus,
      driftSeconds,
      cleanDrift,
    });
  }

  /* ------------------------------------------------------------ time */

  rush.timeLeft -= dt;
  if (rush.timeLeft <= 0) {
    // Time expires at the END of the tick, so a kill that landed on this very tick is paid —
    // and nothing after it can be. The clock stops here; `phase` leaves the scoring loop above
    // unreachable from the next tick on.
    endRun(rush, site, events);
  }
}
