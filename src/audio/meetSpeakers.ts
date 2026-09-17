import { AUDIO, MEET_MUSIC } from '../config/tuning';
import type { AudioCore } from './core';
import { distanceGain, stereoPan } from './dsp';
import type { Listener } from './electricHum';

/**
 * The song coming out of the speakers at a car meet (`MEET_MUSIC`): a recording, looped, heard
 * from where the speakers stand — full at the stack, darker and quieter across the lot, gone a
 * block away. Diegetic, so the radio's M does not touch it; it gives way to a spoken line instead.
 *
 * One media element streams the file (a 2½-minute song decoded to a buffer is tens of MB), and
 * its clock is also the beat the people by the speakers nod to (`beats`).
 */
export interface MeetSpeakers {
  update(dt: number, listener: Listener, voiceSpeaking: boolean): void;
  /**
   * Beats into the song right now (MEET_MUSIC.bpm on MEET_MUSIC.firstBeat), or NaN while it is not
   * playing — before the first gesture, or when the file will not load.
   */
  beats(): number;
  /** 0..1: how much the listener is hearing it, for the radio to step aside. */
  presence(): number;
  dispose(): void;
}

export function createMeetSpeakers(core: AudioCore, points: ReadonlyArray<{ x: number; z: number }>): MeetSpeakers | null {
  if (points.length === 0) return null;
  const { ctx, master } = core;
  const cfg = MEET_MUSIC;

  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.loop = true;
  el.src = cfg.song.src;
  let broken = false;
  el.onerror = () => {
    broken = true;
  };

  const source = ctx.createMediaElementSource(el);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  filter.frequency.value = cfg.brightHz;
  const level = ctx.createGain();
  level.gain.value = 0;
  const pan = ctx.createStereoPanner();
  source.connect(filter).connect(level).connect(pan).connect(master);

  let presence = 0;
  let asking = false;

  return {
    update(_dt, listener, voiceSpeaking) {
      if (broken) return;
      // The element needs the page's gesture as much as the context does; ask again until it plays.
      if (el.paused && !asking && ctx.state === 'running') {
        asking = true;
        el.play()
          .catch(() => {})
          .finally(() => (asking = false));
      }

      // The nearest stack is the one heard; a meet has one, but nothing here depends on that.
      let best = Infinity;
      let dx = 0;
      let dz = 0;
      for (const p of points) {
        const px = p.x - listener.x;
        const pz = p.z - listener.z;
        const d = px * px + pz * pz;
        if (d < best) {
          best = d;
          dx = px;
          dz = pz;
        }
      }
      const dist = Math.sqrt(best);
      presence = distanceGain(dist, cfg.near, cfg.far);
      const t = Math.min(1, Math.max(0, (dist - cfg.near) / (cfg.far - cfg.near)));
      const when = ctx.currentTime;
      const tc = 0.08;
      level.gain.setTargetAtTime(cfg.volume * presence * (voiceSpeaking ? cfg.underVoice : 1), when, voiceSpeaking ? 0.12 : 0.4);
      filter.frequency.setTargetAtTime(cfg.brightHz * Math.pow(cfg.darkHz / cfg.brightHz, t), when, tc);
      pan.pan.setTargetAtTime(stereoPan(dx, dz, listener.heading, AUDIO.maxPan) * cfg.panDepth, when, tc);
    },

    beats() {
      if (broken || el.paused) return NaN;
      return ((el.currentTime - cfg.firstBeat) * cfg.bpm) / 60;
    },

    presence: () => (broken || el.paused ? 0 : presence),

    dispose() {
      el.pause();
      el.removeAttribute('src');
      el.load();
      try {
        source.disconnect();
        filter.disconnect();
        level.disconnect();
        pan.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}
