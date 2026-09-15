/**
 * Recorded sound effects (served from public/). Everything else in the kit is synthesized; these
 * are the few voices that come from a file.
 */

/** Fetches and decodes one file. Rejects on a missing file or one the browser cannot decode. */
export async function fetchSample(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/**
 * Scales `buffer` in place to an RMS of `targetRms` (never past a 0.99 peak), so a voice's volume
 * knob means the same thing whatever file is dropped in behind it.
 */
export function normalizeRms(buffer: AudioBuffer, targetRms: number): AudioBuffer {
  let sum = 0;
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  const rms = Math.sqrt(sum / (buffer.length * buffer.numberOfChannels));
  if (rms <= 0) return buffer;
  const norm = Math.min(targetRms / rms, 0.99 / peak);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= norm;
  }
  return buffer;
}
