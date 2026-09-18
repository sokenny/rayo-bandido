import type { GameEvent, IntroObjectiveId, IntroStage } from '../core/types';
import type { IntroConfig } from '../content/intro';
import { prepareDialogue, speakDialogue, stopDialogue } from '../audio/dialogueVoice';
import { CONTROLS } from './hud';
import { createSystemMessage, type SystemMessage } from './systemMessage';
import { isTouchDevice } from './viewport';

/**
 * The introduction's screen furniture (`src/sim/intro.ts` decides; this shows):
 *
 *   - the OPENING: a short fade over the in-engine view of the start with two title lines.
 *     Skippable at once, and it ends exactly once whichever way it ends;
 *   - the CLIP at the meet: an MP4 when `INTRO.cinematic.src` names one and the browser will
 *     play it, otherwise the same kind of placeholder over the meet itself;
 *   - the INCOMING CALL card (her face, the name, the channel), then the call panel she
 *     talks from — the same face, larger, beside the name and the channel light;
 *   - the SUBTITLE strip, one line at a time, quiet between lines;
 *   - the INSTRUCTION CARD in the middle of the screen: the one step the player is on, with the
 *     real key for the device in their hands, and SALTAR INTRODUCCIÓN quietly in a corner.
 *
 * Built the way the other overlays are: the DOM once, writes only on change, timing owned by
 * the simulation (a line is up for as long as the rules say), flashes on the Web Animations
 * API. It hangs off `#hud-root` beside the HUD rather than inside it, because it outlives the
 * cruise-clean fade and has to sit over everything during the opening.
 *
 * THE VIDEO is never trusted to autoplay. `play()` is tried with sound, then muted, and a
 * second refusal — or a load error, or nothing playing within the timeout — is the placeholder.
 * While the clip is actually covering the screen `opaque` is true and the game skips drawing
 * the world behind it. Nothing here pauses the simulation: a networked city keeps running.
 */
export interface IntroOverlayOptions {
  cfg: IntroConfig;
  /** Where the HUD lives, for the charge-gauge highlight. */
  hudRoot: HTMLElement;
  onOpeningDone(): void;
  onCinematicDone(): void;
  onSkipLine(): void;
  onSkipIntro(): void;
  /** Music under a voice clip: a fraction of the theme's volume, 1 to restore. */
  duckMusic(level: number): void;
}

export interface IntroOverlaySnapshot {
  stage: IntroStage;
  objective: IntroObjectiveId | null;
  /** A line is on screen. */
  talking: boolean;
  /** Simulation seconds: what the card's timed flashes count against. */
  time: number;
  /** The meter can pay for a shot right now. */
  canShoot: boolean;
  /** The player has driven far enough that the driving keys no longer need showing. */
  moving: boolean;
}

export interface IntroOverlay {
  root: HTMLElement;
  /** True while an opaque video covers the screen. */
  readonly opaque: boolean;
  /** Start the opening. Calls `onOpeningDone` exactly once, however it ends. */
  startOpening(): void;
  /** Start the clip at the meet. Calls `onCinematicDone` exactly once, however it ends. */
  startCinematic(): void;
  update(s: IntroOverlaySnapshot): void;
  onEvent(ev: GameEvent): void;
  dispose(): void;
}

/**
 * Keys on a computer, the thumb pad on a phone. Deliberately never the pad: a wheel, a shifter
 * or a forgotten controller left plugged in must not turn the first lesson into button names.
 */
type Device = 'keys' | 'touch';

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function pick<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Rayo Bandido intro overlay: missing element "${selector}"`);
  return el as T;
}

/** The key the HUD's own card names for an action: never a guess. */
function binding(action: string): string {
  for (const [key, name] of CONTROLS) if (name === action) return key;
  return '?';
}

/** A key from the binding table as the card names it: the first of its alternatives, in Spanish. */
function keyLabel(action: string): string {
  return binding(action).split(' o ')[0];
}

/** Card text with `{hand}` / `{aim}` filled in as key caps. The config is ours: no user text. */
function withKeys(text: string): string {
  return text
    .replace('{hand}', `<b class="rb-key">${keyLabel('freno de mano')}</b>`)
    .replace('{aim}', `<b class="rb-key">${keyLabel('mantener: apuntar')}</b>`);
}

export function createIntroOverlay(options: IntroOverlayOptions): IntroOverlay {
  const { cfg } = options;
  const root = document.createElement('div');
  root.className = 'rb-intro';
  root.innerHTML =
    // The opening: a video slot, a placeholder title, and the one skip that is always visible.
    `<div class="rb-intro__cine">` +
    `<div class="rb-intro__cine-title"><b></b><span></span></div>` +
    `<button type="button" class="rb-intro__cine-skip"><span class="rb-key">ENTER</span> SALTAR</button>` +
    `</div>` +
    // The incoming call.
    `<div class="rb-intro__call">` +
    `<div class="rb-intro__portrait rb-intro__portrait--call"><span class="rb-intro__initials">${cfg.call.portrait.initials}</span></div>` +
    `<div class="rb-intro__call-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.6 3.2c.5-.4 1.3-.3 1.7.3l1.9 2.8c.3.5.3 1.2-.2 1.6l-1.3 1.2c1.1 2.4 3 4.3 5.4 5.4l1.2-1.3c.4-.5 1.1-.5 1.6-.2l2.8 1.9c.6.4.7 1.2.3 1.7l-1.4 1.7c-.6.8-1.7 1.1-2.7.8C10.2 17.7 6.3 13.8 4.9 8c-.3-1 0-2.1.8-2.7z"/></svg></div>` +
    `<div class="rb-intro__call-state">${cfg.call.state}</div>` +
    `<div class="rb-intro__call-name">${cfg.call.name}</div>` +
    `<div class="rb-intro__call-sub">${cfg.call.subtitle}</div>` +
    `</div>` +
    // The call panel.
    `<div class="rb-intro__panel">` +
    `<div class="rb-intro__portrait"><span class="rb-intro__initials">${cfg.call.portrait.initials}</span></div>` +
    `<div class="rb-intro__who"><b class="rb-intro__name">${cfg.call.name}</b><span class="rb-intro__channel"><i></i>${cfg.call.subtitle}</span></div>` +
    `</div>` +
    // The subtitle strip.
    `<div class="rb-intro__subtitle"><span class="rb-intro__speaker"></span><span class="rb-intro__text"></span>` +
    `<button type="button" class="rb-intro__line-skip" title="Saltar línea"><span class="rb-key">ENTER</span></button></div>` +
    // The instruction card, centre screen, and the quiet skip in the corner.
    `<div class="rb-intro__card"><b class="rb-intro__card-title"></b><span class="rb-intro__card-text"></span></div>` +
    `<button type="button" class="rb-intro__skip">SALTAR INTRODUCCIÓN</button>`;

  const cineEl = pick<HTMLElement>(root, '.rb-intro__cine');
  const cineTitleEl = pick<HTMLElement>(root, '.rb-intro__cine-title b');
  const cineSubEl = pick<HTMLElement>(root, '.rb-intro__cine-title span');
  const cineSkipEl = pick<HTMLButtonElement>(root, '.rb-intro__cine-skip');
  const callEl = pick<HTMLElement>(root, '.rb-intro__call');
  const panelEl = pick<HTMLElement>(root, '.rb-intro__panel');
  const callPortraitEl = pick<HTMLElement>(root, '.rb-intro__portrait--call');
  const portraitEl = pick<HTMLElement>(root, '.rb-intro__panel .rb-intro__portrait');
  const subtitleEl = pick<HTMLElement>(root, '.rb-intro__subtitle');
  const speakerEl = pick<HTMLElement>(root, '.rb-intro__speaker');
  const textEl = pick<HTMLElement>(root, '.rb-intro__text');
  const lineSkipEl = pick<HTMLButtonElement>(root, '.rb-intro__line-skip');
  const cardEl = pick<HTMLElement>(root, '.rb-intro__card');
  const cardTitleEl = pick<HTMLElement>(root, '.rb-intro__card-title');
  const cardTextEl = pick<HTMLElement>(root, '.rb-intro__card-text');
  const skipEl = pick<HTMLButtonElement>(root, '.rb-intro__skip');
  // The HUD's full controls card is too much to read on a first drive: the intro card says
  // which key matters now, so the list stays away until the intro is over.
  options.hudRoot.classList.add('rb-intro-running');
  const message: SystemMessage = createSystemMessage(root);

  /* ----------------------------------------------------------- the portrait */

  // The existing poster, cropped to the face by CSS; the initials stay underneath until it
  // has actually loaded, and stay for good if it never does. Both frames — the card the phone
  // rings in and the panel she talks from — show the same face.
  function attachPortrait(frame: HTMLElement): void {
    const src = cfg.call.portrait.src;
    if (!src) return;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.className = 'rb-intro__portrait-img';
    img.addEventListener('load', () => frame.classList.add('has-art'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = src;
    frame.appendChild(img);
  }
  attachPortrait(callPortraitEl);
  attachPortrait(portraitEl);

  /* ----------------------------------------------------------- the device */

  const device: Device = isTouchDevice() ? 'touch' : 'keys';

  /* ----------------------------------------------------------- state */

  let shownStage: IntroStage | null = null;
  let shownTalking: boolean | null = null;
  /** Sim time the current stage was first seen at, for the card's timed flashes. */
  let stageSeenAt = 0;
  let shownObjective: IntroObjectiveId | null = null;
  /** Sim time the current objective was first seen at. */
  let objectiveSeenAt = 0;
  /** What the card shows, as a key: the DOM is written only when it changes. */
  let shownCard = '';
  let opaque = false;
  let video: HTMLVideoElement | null = null;
  let openingTimer = 0;
  let voice: HTMLAudioElement | null = null;
  let disposed = false;
  let over = false;

  /* ----------------------------------------------------------- the card */

  type CardTone = 'step' | 'warn' | 'done' | 'hint';

  /** Put `key`'s content on the card, or take it down with ''. Writes only on change. */
  function showCard(key: string, tone: CardTone = 'step', title = '', html = ''): void {
    if (key === shownCard) return;
    shownCard = key;
    // The charge ring is pointed at while filling it is the thing to do.
    highlightCharge(key === 'drift' || key === 'empty');
    if (!key) {
      cardEl.classList.remove('is-on');
      return;
    }
    cardTitleEl.textContent = title;
    cardTitleEl.hidden = !title;
    cardTextEl.innerHTML = html;
    cardTextEl.hidden = !html;
    cardEl.className = `rb-intro__card is-on is-${tone}`;
    if (canAnimate) {
      cardEl.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.94)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], {
        duration: 240,
        easing: 'ease-out',
      });
    }
  }

  /**
   * One step at a time, and only the step the player is on: the driving keys until the car is
   * moving, the drift until there has been one, the shot until a car is down — or, while the
   * meter cannot pay for it, that it has to be charged first — then where to go.
   */
  function renderCard(s: IntroOverlaySnapshot): void {
    const c = cfg.card;
    const touch = device === 'touch';
    // A step just done flashes first, over whatever she says about it.
    if (s.time - stageSeenAt < c.doneSeconds) {
      if (s.stage === 'disableEV') return showCard('drift-done', 'done', c.driftDone);
      if (s.stage === 'arrival') return showCard('ev-done', 'done', c.evDone);
    }
    // Then the step she has asked for — the objective is set by the line that asks — and
    // nothing at all while she is still getting to it.
    switch (s.objective) {
      case 'approach':
        if (!s.moving) return showCard('approach', 'hint', '', touch ? c.approach.touch : c.approach.keys);
        return showCard('');
      case 'drift':
        return showCard('drift', 'step', c.drift.title, withKeys(touch ? c.drift.touch : c.drift.keys));
      case 'disable':
        if (s.canShoot) return showCard('shoot', 'step', c.shoot.title, withKeys(touch ? c.shoot.touch : c.shoot.keys));
        return showCard('empty', 'warn', c.empty.title, withKeys(touch ? c.empty.touch : c.empty.keys));
      case 'arrival':
        if (s.time - objectiveSeenAt < c.arrivalSeconds) return showCard('arrival', 'step', c.arrival.title, c.arrival.text);
        return showCard('');
      default:
        return showCard('');
    }
  }

  function flash(el: HTMLElement): void {
    if (!canAnimate) return;
    el.animate([{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], {
      duration: 220,
      easing: 'ease-out',
    });
  }

  /* ----------------------------------------------------------- the presentations */

  /**
   * Two of them on the one layer, never at once: the OPENING (a placeholder only) and the CLIP
   * at the meet (the MP4, or its placeholder). Each starts once, ends once, and reports once.
   */
  type Presentation = 'opening' | 'cinematic';
  let running: Presentation | null = null;
  const finished = { opening: false, cinematic: false };

  function finishPresentation(): void {
    if (!running) return;
    const which = running;
    running = null;
    finished[which] = true;
    opaque = false;
    window.clearTimeout(openingTimer);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      video = null;
    }
    cineEl.classList.remove('is-on', 'is-video', 'is-placeholder', 'is-opening');
    cineEl.classList.add('is-gone');
    if (which === 'opening') options.onOpeningDone();
    else options.onCinematicDone();
  }

  function placeholder(which: Presentation, seconds: number, title: string, sub: string): void {
    if (running !== which) return;
    opaque = false;
    cineTitleEl.textContent = title;
    cineSubEl.textContent = sub;
    cineEl.classList.remove('is-video', 'is-gone');
    cineEl.classList.add('is-on', 'is-placeholder');
    // The opening is a beat, not a hold: its fade and title are timed to fit inside it.
    cineEl.classList.toggle('is-opening', which === 'opening');
    window.clearTimeout(openingTimer);
    openingTimer = window.setTimeout(finishPresentation, seconds * 1000);
  }

  function playVideo(src: string): void {
    const v = document.createElement('video');
    video = v;
    v.className = 'rb-intro__video';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.controls = false;
    let settled = false;
    const c = cfg.cinematic;
    const fallBack = (): void => {
      if (settled || running !== 'cinematic') return;
      settled = true;
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
      video = null;
      placeholder('cinematic', c.placeholder.seconds, c.placeholder.title, c.placeholder.sub);
    };
    const started = (): void => {
      if (settled || running !== 'cinematic') return;
      settled = true;
      window.clearTimeout(openingTimer);
      opaque = true;
      cineEl.classList.add('is-video');
    };
    v.addEventListener('playing', started);
    v.addEventListener('ended', finishPresentation);
    v.addEventListener('error', fallBack);
    v.addEventListener('stalled', () => {
      if (!settled) fallBack();
    });
    cineEl.insertBefore(v, cineEl.firstChild);
    cineEl.classList.remove('is-gone');
    cineEl.classList.add('is-on');
    v.src = src;
    // With sound first — the page was entered through a click on the menu, and the player has
    // been driving since — then muted, then not at all. Nothing here waits on a promise that
    // could hang: the timeout is the ceiling.
    openingTimer = window.setTimeout(fallBack, c.loadTimeoutSeconds * 1000);
    const attempt = v.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        if (settled || running !== 'cinematic') return;
        v.muted = true;
        const again = v.play();
        if (again && typeof again.catch === 'function') again.catch(fallBack);
      });
    }
  }

  function startOpening(): void {
    if (running || finished.opening) return;
    running = 'opening';
    const o = cfg.opening;
    placeholder('opening', o.seconds, o.title, o.sub);
  }

  function startCinematic(): void {
    if (running || finished.cinematic) return;
    running = 'cinematic';
    const c = cfg.cinematic;
    if (c.src) playVideo(c.src);
    else placeholder('cinematic', c.placeholder.seconds, c.placeholder.title, c.placeholder.sub);
  }

  /* ----------------------------------------------------------- voice */

  function stopVoice(): void {
    if (!voice) return;
    voice.pause();
    voice.removeAttribute('src');
    voice.load();
    voice = null;
    options.duckMusic(1);
  }

  function playVoice(src: string): void {
    stopVoice();
    const a = new Audio();
    voice = a;
    a.preload = 'auto';
    const done = (): void => {
      if (voice === a) stopVoice();
    };
    a.addEventListener('ended', done);
    a.addEventListener('error', done);
    a.src = src;
    // Ducked from the attempt, restored by `done` — which a refused `play()` also reaches.
    options.duckMusic(cfg.call.duck);
    const attempt = a.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(done);
  }

  /* ----------------------------------------------------------- input */

  function onKey(e: KeyboardEvent): void {
    if (over || disposed) return;
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (e.repeat) return;
    if (running) {
      finishPresentation();
    } else if (shownTalking) {
      options.onSkipLine();
    } else {
      return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  cineSkipEl.addEventListener('click', () => finishPresentation());
  lineSkipEl.addEventListener('click', () => options.onSkipLine());
  skipEl.addEventListener('click', () => options.onSkipIntro());

  /* ----------------------------------------------------------- the gauge */

  function highlightCharge(on: boolean): void {
    const gauge = options.hudRoot.querySelector('.rb-gauge--charge');
    if (gauge) gauge.classList.toggle('is-intro-hilite', on);
  }

  /* ----------------------------------------------------------- the end */

  function end(reason: 'completed' | 'skipped'): void {
    over = true;
    stopVoice();
    stopDialogue('badkala');
    highlightCharge(false);
    finishPresentation();
    options.hudRoot.classList.remove('rb-intro-running');
    callEl.classList.remove('is-on');
    panelEl.classList.remove('is-on');
    subtitleEl.classList.remove('is-on');
    skipEl.classList.remove('is-on');
    showCard('');
    if (reason === 'completed') message.show(cfg.notes.completed, { tone: 'calm', duration: 2600 });
    else message.show(cfg.notes.skipped, { tone: 'calm', duration: 1400 });
  }

  return {
    root,
    get opaque() {
      return opaque;
    },
    startOpening,
    startCinematic,

    update(s) {
      if (over) return;
      if (s.stage !== shownStage) {
        shownStage = s.stage;
        stageSeenAt = s.time;
      }
      if (s.objective !== shownObjective) {
        shownObjective = s.objective;
        objectiveSeenAt = s.time;
      }
      renderCard(s);
      if (s.talking !== shownTalking) {
        shownTalking = s.talking;
        panelEl.classList.toggle('is-quiet', !s.talking);
        portraitEl.classList.toggle('is-talking', s.talking);
      }
    },

    onEvent(ev) {
      if (over) return;
      switch (ev.type) {
        case 'introCall':
          if (ev.phase === 'ringing') {
            callEl.classList.add('is-on');
            skipEl.classList.add('is-on');
            // While it rings: have every voiced line generated (or found cached) before she talks.
            void prepareDialogue(
              'badkala',
              cfg.lines.filter((l) => l.tts && !l.voice).map((l) => l.text),
            );
            try {
              navigator.vibrate?.(cfg.call.vibrateMs);
            } catch {
              /* not a phone, or not allowed */
            }
          } else if (ev.phase === 'connected') {
            callEl.classList.remove('is-on');
            panelEl.classList.add('is-on', 'is-quiet');
            skipEl.classList.add('is-on');
          } else {
            panelEl.classList.remove('is-on');
            subtitleEl.classList.remove('is-on');
          }
          break;
        case 'introLine':
          speakerEl.textContent = ev.speaker;
          textEl.textContent = ev.text;
          subtitleEl.classList.add('is-on');
          flash(subtitleEl);
          if (ev.voice) playVoice(ev.voice);
          // Not awaited: the subtitle is already up, and the voice joins it whenever it is ready.
          else if (ev.tts) void speakDialogue({ characterId: 'badkala', text: ev.text, interrupt: true, gain: cfg.call.voiceGain });
          break;
        case 'introLineEnd':
          subtitleEl.classList.remove('is-on');
          stopVoice();
          stopDialogue('badkala');
          break;
        case 'introStage':
          // Pulling into the meet: the clip, over the car standing among the others.
          if (ev.stage === 'meetup') startCinematic();
          break;
        case 'introNote':
          message.show(ev.text, { tone: 'calm', duration: 1400 });
          break;
        case 'introDone':
          end(ev.reason);
          break;
        case 'restart':
          // R during the intro puts the rules back at the incoming call: the phone will ring
          // again, so everything the call put up comes down until it does.
          stopVoice();
          callEl.classList.remove('is-on');
          panelEl.classList.remove('is-on');
          subtitleEl.classList.remove('is-on');
          skipEl.classList.remove('is-on');
          shownStage = null;
          showCard('');
          break;
        default:
          break;
      }
    },

    dispose() {
      disposed = true;
      over = true;
      stopVoice();
      highlightCharge(false);
      options.hudRoot.classList.remove('rb-intro-running');
      window.clearTimeout(openingTimer);
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video = null;
      }
      window.removeEventListener('keydown', onKey);
      message.dispose();
      root.remove();
    },
  };
}
