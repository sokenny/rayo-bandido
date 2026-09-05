import type { PlayerCommand } from '../types';
import { createPlayerCommand, type InputSource } from './keyboard';

/**
 * One command out of several devices, so keyboard and gamepad are always both live and the
 * player can swap mid-race without a settings screen. Analog axes take whichever device is
 * pushing hardest; held and edge-triggered flags are OR-ed, which keeps each source's own
 * edge semantics intact because every source is polled exactly once per tick.
 */
export function combineInputs(...sources: InputSource[]): InputSource {
  if (sources.length === 1) return sources[0];
  // One scratch command per extra source, allocated here so polling never allocates.
  const scratch = sources.slice(1).map(() => createPlayerCommand());

  return {
    poll(out: PlayerCommand) {
      sources[0].poll(out);
      for (let i = 1; i < sources.length; i++) {
        const s = scratch[i - 1];
        sources[i].poll(s);
        out.throttle = Math.max(out.throttle, s.throttle);
        out.brake = Math.max(out.brake, s.brake);
        if (Math.abs(s.steer) > Math.abs(out.steer)) out.steer = s.steer;
        out.handbrake = out.handbrake || s.handbrake;
        out.nitro = out.nitro || s.nitro;
        out.fire = out.fire || s.fire;
        out.restart = out.restart || s.restart;
        out.cruise = out.cruise || s.cruise;
        out.pov = out.pov || s.pov;
      }
    },
    dispose() {
      for (const s of sources) s.dispose();
    },
  };
}
