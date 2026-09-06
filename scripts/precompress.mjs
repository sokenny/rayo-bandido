/**
 * Pre-compress the built client, once, at build time.
 *
 * `server/index.mjs` serves whichever of `<file>.br` / `<file>.gz` the visitor's
 * `accept-encoding` allows and falls back to the plain file. Doing it here rather than in the
 * request path buys the expensive settings — Brotli quality 11 is far too slow to run per
 * request, and it is the setting that turns the ~750 KB bundle into ~150 KB on the wire.
 *
 * Only text formats are touched. `.mp3` and `.webp` are already compressed; running them
 * through Brotli costs build time to produce a file nobody should send.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  createBrotliCompress,
  createGzip,
  constants as zlibConstants,
} from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

const COMPRESSIBLE = new Set([
  '.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.svg', '.map', '.txt',
]);
// Below roughly one packet there is nothing to win, and Brotli's own framing can make a tiny
// file bigger than the original.
const MIN_BYTES = 1024;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function compress(file, ext, makeStream) {
  const out = `${file}${ext}`;
  await pipeline(createReadStream(file), makeStream(), createWriteStream(out));
  const { size } = await stat(out);
  return { out, size };
}

const brotli = (size) =>
  createBrotliCompress({
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
    },
  });

const gzip = () => createGzip({ level: zlibConstants.Z_BEST_COMPRESSION });

let done = 0;
for await (const file of walk(dist)) {
  const ext = extname(file).toLowerCase();
  if (ext === '.br' || ext === '.gz') continue; // a previous run's output
  if (!COMPRESSIBLE.has(ext)) continue;

  const { size } = await stat(file);
  if (size < MIN_BYTES) continue;

  const br = await compress(file, '.br', () => brotli(size));
  const gz = await compress(file, '.gz', gzip);

  // A variant that did not actually shrink would only cost a round trip to discover.
  for (const variant of [br, gz]) {
    if (variant.size >= size) await unlink(variant.out);
  }

  const pct = (n) => `${Math.round((1 - n / size) * 100)}%`;
  console.log(
    `  ${relative(dist, file).padEnd(34)} ${String(size).padStart(8)} B  ` +
      `br ${pct(br.size).padStart(4)}  gz ${pct(gz.size).padStart(4)}`,
  );
  done += 1;
}

console.log(`precompressed ${done} file${done === 1 ? '' : 's'} in dist/`);
