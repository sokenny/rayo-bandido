import { track, setUserProperties, type AnalyticsParams } from './analytics';
import type { GameEvent, GameMode, GameState } from './core/types';

/**
 * GAMEPLAY ANALYTICS: the game's own event stream (`GameEvent`, seen in `handleEvent` in
 * `src/game.ts`) turned into what GA should hear.
 *
 * TWO KINDS OF THING GO UP:
 *
 *   MILESTONES — a run started or ended, a ride, a pursuit, an intro stage. One GA event each,
 *                because each is a step in a funnel somebody will want to read.
 *   STYLE      — drifts, near misses, bolts, crashes, props. These arrive many times a second,
 *                so they are only counted here and go up once, as `play_summary`, when the
 *                player leaves the world (or hides the tab — a phone rarely says goodbye).
 *
 * A run still under way when the player leaves is reported as `*_abandoned`: that is the
 * drop-off inside an activity, which no end event can show.
 *
 * Nothing here touches the simulation. `frame` is called once per rendered frame and costs a
 * few additions.
 */
export interface PlayAnalytics {
  onEvent(ev: GameEvent): void;
  /** Once per rendered frame, `dt` in seconds. */
  frame(dt: number): void;
  /** The intro overlay's "skip this line" was used. */
  introLineSkipped(): void;
  /** Report the summary (and anything abandoned) now, and stop listening. */
  dispose(): void;
}

export interface PlayAnalyticsOptions {
  mode: GameMode;
  online: boolean;
  /**
   * Where this world was entered from: `'world'` when driven into from the city, `'menu'` otherwise.
   * Reported as `entry_source`, never `source`: GA4 reads `source` as the session's traffic source.
   */
  source: 'world' | 'menu';
  /** The STREET RACE event this world is for (`?event=`), or -1. */
  streetEvent: number;
  gl: WebGLRenderingContext | WebGL2RenderingContext | null;
}

/** Below this much driving, a summary says nothing worth a hit (a page opened and left). */
const MIN_SUMMARY_SECONDS = 5;
/** When the one `perf_sample` of a visit is taken, in seconds of play. */
const PERF_SAMPLE_AT = 60;
/** A frame this long or longer counts as a hitch in `slow_frame_pct`. */
const SLOW_FRAME_S = 1 / 30;
/** El Búho and the garage are rolled onto repeatedly while parking; one visit per this many seconds. */
const VISIT_COOLDOWN_S = 45;
/** Landing speed (m/s) from which a flight counts as a jump in the summary (roughly a 1 m drop). */
const JUMP_IMPACT = 4;

type InputDevice = 'keyboard' | 'gamepad' | 'wheel' | 'touch' | 'mouse';

function gpuInfo(gl: PlayAnalyticsOptions['gl']): { gpu: string; gpu_vendor: string } {
  let gpu = 'unknown';
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? 'unknown');
    }
  } catch {
    /* some browsers refuse the extension */
  }
  const g = gpu.toLowerCase();
  const gpu_vendor = /nvidia|geforce|rtx|gtx/.test(g)
    ? 'nvidia'
    : /amd|radeon/.test(g)
      ? 'amd'
      : /intel/.test(g)
        ? 'intel'
        : /apple/.test(g)
          ? 'apple'
          : /adreno|mali|powervr/.test(g)
            ? 'mobile'
            : /swiftshader|llvmpipe|software/.test(g)
              ? 'software'
              : 'other';
  return { gpu, gpu_vendor };
}

export function createPlayAnalytics(state: GameState, opts: PlayAnalyticsOptions): PlayAnalytics {
  const { mode, online, source } = opts;
  const base: AnalyticsParams = { mode, online };
  /** A world with the city's economy, police and NPCs in it, rather than a race course. */
  const openCity = mode === 'city' || mode === 'bay' || mode === 'stack' || mode === 'rush' || mode === 'test';

  // ---- style counters (reported in play_summary)
  const c = {
    seconds: 0,
    distanceKm: 0,
    topSpeedKmh: 0,
    drifts: 0,
    driftSeconds: 0,
    longestDrift: 0,
    maxDriftChain: 0,
    nitro: 0,
    bolts: 0,
    boltsMissed: 0,
    boltsDenied: 0,
    kills: 0,
    nearMisses: 0,
    crashesLight: 0,
    crashesMedium: 0,
    crashesHeavy: 0,
    props: 0,
    jumps: 0,
    restarts: 0,
    earned: 0,
    spent: 0,
    maxStars: 0,
    pursuits: 0,
    busted: 0,
    escaped: 0,
    passengerOffers: 0,
    washerOffers: 0,
    introSkippedLines: 0,
  };
  const activities = new Set<string>();

  // ---- perf
  let frames = 0;
  let slowFrames = 0;
  let perfSent = false;
  let perfFrames = 0;
  let perfSeconds = 0;
  let perfSlow = 0;

  // ---- input devices seen during this visit
  const inputSeconds: Record<InputDevice, number> = { keyboard: 0, gamepad: 0, wheel: 0, touch: 0, mouse: 0 };
  let lastInput: InputDevice | null = null;
  let reportedInput: InputDevice | null = null;
  let padSignature = '';
  let padPollIn = 0;
  const onKey = (): void => void (lastInput = 'keyboard');
  const onTouch = (): void => void (lastInput = 'touch');
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') lastInput = 'mouse';
  };
  window.addEventListener('keydown', onKey, { passive: true });
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });

  function pollPads(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    let sig = '';
    let wheel = false;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      if (/wheel|g29|g920|g923|driving force|thrustmaster|fanatec|moza/i.test(pad.id)) wheel = true;
      for (const b of pad.buttons) sig += b.pressed ? '1' : '0';
      for (const a of pad.axes) sig += Math.round(a * 4);
    }
    // A change, not a press: a resting shifter or a stuck axis is not somebody playing.
    if (sig && padSignature && sig !== padSignature) lastInput = wheel ? 'wheel' : 'gamepad';
    padSignature = sig;
  }

  // ---- milestones in flight, timed on a clock that a summary never resets
  let clock = 0;
  let introStart = -1;
  let introStage = '';
  let rushRunning = false;
  let rushStartedAt = 0;
  let raceRunning = false;
  let raceStartedAt = 0;
  let pursuitOn = false;
  let passengerRiding = false;
  let lastBuhoVisit = -Infinity;
  let lastGarageVisit = -Infinity;
  let disposed = false;

  const levelOf = (cleared: number | undefined): number => (cleared ?? 0) + 1;

  function onEvent(ev: GameEvent): void {
    if (disposed) return;
    switch (ev.type) {
      /* ------------------------------------------------ style */
      case 'driftStart':
        c.drifts++;
        break;
      case 'driftEnd':
        c.driftSeconds += ev.duration;
        c.longestDrift = Math.max(c.longestDrift, ev.duration);
        c.maxDriftChain = Math.max(c.maxDriftChain, ev.chain);
        break;
      case 'nitroStart':
        c.nitro++;
        break;
      case 'lightningFired':
        c.bolts++;
        if (ev.targetId < 0) c.boltsMissed++;
        break;
      case 'lightningDenied':
        c.boltsDenied++;
        break;
      case 'targetDestroyed':
        c.kills++;
        c.earned += ev.reward;
        break;
      case 'nearMiss':
        c.nearMisses++;
        break;
      case 'crashDamage':
        if (ev.severity === 'light') c.crashesLight++;
        else if (ev.severity === 'medium') c.crashesMedium++;
        else c.crashesHeavy++;
        c.spent += ev.charged;
        break;
      case 'crashStall':
        if (ev.severity === 'medium') c.crashesMedium++;
        else if (ev.severity === 'heavy') c.crashesHeavy++;
        break;
      case 'propHit':
        c.props++;
        break;
      case 'landing':
        // A kerb or a crest also leaves the ground for a tick; a jump is a landing that hurt.
        if (ev.impact >= JUMP_IMPACT) c.jumps++;
        break;
      case 'restart':
        c.restarts++;
        break;
      case 'transmission':
        track('transmission_change', { ...base, transmission: ev.mode });
        setUserProperties({ transmission: ev.mode });
        break;

      /* ------------------------------------------------ races (circuit, street, mp) */
      case 'raceStart':
        raceRunning = true;
        raceStartedAt = clock;
        if (mode === 'circuit') {
          activities.add('time_attack');
          track('time_attack_start', { ...base, entry_source: source, level: levelOf(state.timeAttack?.cleared) });
        } else if (mode === 'street') {
          activities.add('street_race');
          track('street_race_start', { ...base, entry_source: source, event: opts.streetEvent + 1 });
        } else {
          activities.add('race');
          track('race_start', base);
        }
        break;
      case 'raceFinish':
        raceRunning = false;
        if (mode !== 'circuit' && mode !== 'street') track('race_finish', { ...base, time: ev.total, best_lap: ev.bestLap });
        break;
      case 'timeAttackEnd': {
        const r = ev.results;
        track('time_attack_end', {
          ...base,
          level: r.level + 1,
          cleared: r.cleared,
          advanced: r.advanced,
          time: r.time,
          target_time: r.targetTime,
          within_time: r.withinTime,
          crashes: r.crashes,
          within_crashes: r.withinCrashes,
        });
        break;
      }
      case 'timeAttackCrash':
        if (ev.fatal) track('time_attack_failed', { ...base, level: levelOf(state.timeAttack?.cleared), crashes: ev.crashes });
        break;
      case 'timeAttackLevelUp':
        track('level_up', { ...base, activity: 'time_attack', level: ev.level + 1, all_clear: ev.allClear });
        setUserProperties({ time_attack_cleared: ev.cleared });
        break;
      case 'streetRaceEnd': {
        const r = ev.results;
        raceRunning = false;
        track('street_race_end', {
          ...base,
          event: r.event + 1,
          placement: r.placement,
          field: r.field,
          won: r.won,
          advanced: r.advanced,
          time: r.time,
        });
        if (r.advanced) track('level_up', { ...base, activity: 'street_race', level: r.event + 1 });
        break;
      }
      case 'streetRaceShortcut':
        if (ev.shortcut >= 0) track('street_race_shortcut', { ...base, event: opts.streetEvent + 1, shortcut: ev.shortcut });
        break;

      /* ------------------------------------------------ doors out of the city */
      case 'circuitEnter':
        track('circuit_enter', base);
        break;
      case 'streetRaceEnter':
        track('street_race_enter', { ...base, event: ev.event + 1 });
        break;

      /* ------------------------------------------------ rayo rush */
      case 'rushStart':
        rushRunning = true;
        rushStartedAt = clock;
        activities.add('rush');
        track('rush_start', { ...base, entry_source: mode === 'rush' ? 'menu' : 'world', level: levelOf(state.rush?.cleared) });
        break;
      case 'rushEnd': {
        const r = ev.results;
        rushRunning = false;
        track('rush_end', {
          ...base,
          level: r.level + 1,
          score: r.score,
          target: r.targetScore,
          cleared: r.cleared,
          advanced: r.advanced,
          disabled: r.disabled,
          best_chain: r.bestChain,
          crashes: r.crashes,
          near_misses: r.nearMisses,
          style_bonus: r.styleBonus,
        });
        break;
      }
      case 'rushLevelUp':
        track('level_up', { ...base, activity: 'rush', level: ev.level + 1, all_clear: ev.allClear });
        setUserProperties({ rush_cleared: ev.cleared });
        break;

      /* ------------------------------------------------ passengers */
      case 'passengerOffer':
        c.passengerOffers++;
        break;
      case 'passengerBoard':
        passengerRiding = true;
        activities.add('passenger');
        track('passenger_board', { ...base, passenger_id: ev.passengerId, destination: ev.destinationId });
        break;
      case 'passengerComplete': {
        const r = ev.results;
        passengerRiding = false;
        c.earned += r.fare + r.tip;
        track('passenger_complete', { ...base, passenger_id: r.passengerId, mood: r.mood, tier: r.tier, fare: r.fare, tip: r.tip });
        break;
      }
      case 'passengerCancel':
        passengerRiding = false;
        track('passenger_cancel', { ...base, passenger_id: ev.passengerId, reason: ev.reason });
        break;

      /* ------------------------------------------------ el búho, the garage, the washers */
      case 'buhoPrompt':
        if (ev.on && clock - lastBuhoVisit > VISIT_COOLDOWN_S) {
          lastBuhoVisit = clock;
          track('buho_visit', { ...base, money: state.economy.money });
        }
        break;
      case 'buhoPurchase':
        activities.add('moogul');
        c.spent += ev.price;
        track('buho_purchase', { ...base, price: ev.price });
        break;
      case 'buhoDenied':
        track('buho_denied', { ...base, reason: ev.reason, money: state.economy.money });
        break;
      case 'garagePrompt':
        if (ev.on && clock - lastGarageVisit > VISIT_COOLDOWN_S) {
          lastGarageVisit = clock;
          track('garage_visit', { ...base, money: state.economy.money });
        }
        break;
      case 'washerOffer':
        if (ev.on) c.washerOffers++;
        break;
      case 'washerPaid':
        c.spent += ev.charged;
        track('washer_paid', { ...base, charged: ev.charged });
        break;
      case 'washerRefused':
        track('washer_refused', base);
        break;

      /* ------------------------------------------------ police */
      case 'wantedStars':
        c.maxStars = Math.max(c.maxStars, ev.stars);
        break;
      case 'pursuitStart':
        pursuitOn = true;
        c.pursuits++;
        track('pursuit_start', { ...base, stars: ev.stars });
        break;
      case 'pursuitEnd':
        pursuitOn = false;
        if (ev.reason === 'escaped') c.escaped++;
        track('pursuit_end', { ...base, reason: ev.reason, duration: ev.duration, max_stars: c.maxStars });
        break;
      case 'policeBusted':
        c.busted++;
        c.spent += ev.charged;
        track('police_busted', { ...base, stars: ev.stars, fine: ev.fine, charged: ev.charged });
        break;

      /* ------------------------------------------------ the intro */
      case 'introStage':
        if (introStart < 0) introStart = clock;
        track('intro_stage', { stage: ev.stage, seconds: clock - introStart, from: introStage || 'start' });
        // A skip jumps straight to `complete`; `intro_done` should still say where it was left.
        if (ev.stage !== 'complete') introStage = ev.stage;
        break;
      case 'introDone':
        track('intro_done', {
          reason: ev.reason,
          stage: introStage,
          seconds: introStart < 0 ? 0 : clock - introStart,
          skipped_lines: c.introSkippedLines,
        });
        introStage = '';
        setUserProperties({ intro_done: ev.reason });
        break;
      default:
        break;
    }
  }

  function frame(dt: number): void {
    if (disposed || !(dt > 0) || dt > 1) return;
    if (document.visibilityState !== 'visible') return;
    clock += dt;
    c.seconds += dt;
    const speed = Math.abs(state.vehicle.speed);
    c.distanceKm += (speed * dt) / 1000;
    c.topSpeedKmh = Math.max(c.topSpeedKmh, speed * 3.6);

    frames++;
    if (dt >= SLOW_FRAME_S) slowFrames++;
    if (!perfSent) {
      perfFrames++;
      perfSeconds += dt;
      if (dt >= SLOW_FRAME_S) perfSlow++;
      if (perfSeconds >= PERF_SAMPLE_AT) {
        perfSent = true;
        track('perf_sample', {
          ...base,
          ...gpuInfo(opts.gl),
          avg_fps: perfFrames / perfSeconds,
          slow_frame_pct: (100 * perfSlow) / perfFrames,
          dpr: window.devicePixelRatio || 1,
          screen_w: screen.width,
          screen_h: screen.height,
        });
      }
    }

    padPollIn -= dt;
    if (padPollIn <= 0) {
      padPollIn = 0.25;
      pollPads();
    }
    if (lastInput) {
      inputSeconds[lastInput] += dt;
      if (reportedInput !== lastInput && inputSeconds[lastInput] > 20) {
        reportedInput = lastInput;
        setUserProperties({ input_device: lastInput });
      }
    }
  }

  function primaryInput(): string {
    let best = 'none';
    let most = 0;
    for (const key of Object.keys(inputSeconds) as InputDevice[]) {
      if (inputSeconds[key] > most) {
        most = inputSeconds[key];
        best = key;
      }
    }
    return best;
  }

  function reportExit(): void {
    if (rushRunning) {
      track('rush_abandoned', { ...base, level: levelOf(state.rush?.cleared), score: state.rush?.score ?? 0, seconds: clock - rushStartedAt });
      rushRunning = false;
    }
    if (raceRunning) {
      const params = { ...base, seconds: clock - raceStartedAt, lap: state.race?.lap ?? 0 };
      if (mode === 'circuit') track('time_attack_abandoned', { ...params, level: levelOf(state.timeAttack?.cleared) });
      else if (mode === 'street') track('street_race_abandoned', { ...params, event: opts.streetEvent + 1 });
      else track('race_abandoned', params);
      raceRunning = false;
    }
    if (passengerRiding) {
      track('passenger_abandoned', base);
      passengerRiding = false;
    }
    if (introStage) track('intro_abandoned', { stage: introStage, seconds: introStart < 0 ? 0 : clock - introStart });
    if (pursuitOn) track('pursuit_abandoned', { ...base, max_stars: c.maxStars });
  }

  /** Report what has accumulated and start counting afresh (a tab hidden may well come back). */
  function flushSummary(reason: string): void {
    if (c.seconds < MIN_SUMMARY_SECONDS) return;
    const minutes = c.seconds / 60;
    const head = { ...base, reason, minutes };
    // GA4 keeps at most 25 parameters per event, so the summary is two: how they drive, and
    // what they did with the city around them.
    track('play_summary', {
      ...head,
      distance_km: c.distanceKm,
      top_speed_kmh: c.topSpeedKmh,
      drifts: c.drifts,
      drift_pct: (100 * c.driftSeconds) / c.seconds,
      longest_drift_s: c.longestDrift,
      max_drift_chain: c.maxDriftChain,
      nitro_uses: c.nitro,
      bolts_fired: c.bolts,
      bolts_missed: c.boltsMissed,
      cars_disabled: c.kills,
      near_misses: c.nearMisses,
      crashes_light: c.crashesLight,
      crashes_medium: c.crashesMedium,
      crashes_heavy: c.crashesHeavy,
      crashes_per_min: (c.crashesLight + c.crashesMedium + c.crashesHeavy) / minutes,
      props_hit: c.props,
      jumps: c.jumps,
      restarts: c.restarts,
      activities: [...activities].sort().join(',') || 'free_roam',
      input: primaryInput(),
    });
    if (openCity) {
      track('play_summary_world', {
        ...head,
        money_earned: c.earned,
        money_spent: c.spent,
        money_now: state.economy.money,
        max_wanted_stars: c.maxStars,
        pursuits: c.pursuits,
        escaped: c.escaped,
        busted: c.busted,
        passenger_offers: c.passengerOffers,
        washer_offers: c.washerOffers,
        bolts_denied: c.boltsDenied,
        activity_count: activities.size,
        avg_fps: frames / c.seconds,
        slow_frame_pct: frames ? (100 * slowFrames) / frames : 0,
      });
    } else {
      track('play_summary_perf', { ...head, avg_fps: frames / c.seconds, slow_frame_pct: frames ? (100 * slowFrames) / frames : 0 });
    }
    for (const key of Object.keys(c) as Array<keyof typeof c>) c[key] = 0;
    for (const key of Object.keys(inputSeconds) as InputDevice[]) inputSeconds[key] = 0;
    frames = 0;
    slowFrames = 0;
    activities.clear();
    // Whatever is still under way carries on into the next stretch of the count.
    if (rushRunning) activities.add('rush');
    if (passengerRiding) activities.add('passenger');
    if (raceRunning) activities.add(mode === 'circuit' ? 'time_attack' : mode === 'street' ? 'street_race' : 'race');
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flushSummary('hidden');
  };
  const onPageHide = (): void => {
    reportExit();
    flushSummary('exit');
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  track('world_enter', { ...base, entry_source: source });

  return {
    onEvent,
    frame,
    introLineSkipped() {
      c.introSkippedLines++;
    },
    dispose() {
      if (disposed) return;
      reportExit();
      flushSummary('exit');
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('pointerdown', onPointer);
    },
  };
}
