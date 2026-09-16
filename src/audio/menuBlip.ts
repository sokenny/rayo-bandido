import { MENU_AUDIO } from '../config/tuning';
import { isMenuAudioMuted } from './menuAmbience';

/**
 * The chirp when the cursor lands on a menu option: a short analog-style pluck, synthesized
 * rather than recorded so the menu fetches nothing for it. The AudioContext is only made on the
 * first chirp. Before the player's first key or click the browser keeps the context suspended,
 * so a hover that early is simply silent.
 */
let ctx: AudioContext | null = null;

export function playMenuBlip(): void {
  if (isMenuAudioMuted()) return;
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (ctx.state !== 'running') return;

  const { volume, fromHz, toHz, detuneCents, filterFromHz, filterToHz, q, seconds } = MENU_AUDIO.hover;
  const now = ctx.currentTime;
  const end = now + seconds;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterFromHz, now);
  filter.frequency.exponentialRampToValueAtTime(filterToHz, end);
  filter.connect(gain);

  for (const detune of [-detuneCents / 2, detuneCents / 2]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(toHz, end);
    osc.connect(filter);
    osc.start(now);
    osc.stop(end + 0.02);
  }
}
