/**
 * Rayo Bandido match server.
 *
 * One process serves two things on ONE port:
 *   - the built game (`dist/`) over HTTP, plus `GET /rooms` (the public room list),
 *   - every match room (`server/rooms.mjs`) over a WebSocket at `/ws`.
 *
 * That is the whole point of the arrangement: `ngrok http 8080` then produces a single URL
 * that is both the game and the socket, so a friend only ever needs one link and the client
 * never has to be told where the server is — it connects back to the origin it was served
 * from (`src/net/connection.ts`).
 *
 * Usage:
 *   npm run build && npm run serve        # play the production build, port 8080
 *   npm run serve -- --port 9000          # somewhere else
 *   PORT=9000 npm run serve               # same thing
 *
 * In development the game is served by Vite on 5173 instead and this process runs alongside
 * it (`npm run dev:mp`); a dev build of the client aims its socket at `DEV_MATCH_PORT`
 * (`src/net/protocol.ts`) rather than at its own origin. Development is the only arrangement
 * with two ports in it — which is why it is the only one the client has to know about.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRooms } from './rooms.mjs';
import { SNAPSHOT_HZ } from './protocol.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

const args = process.argv.slice(2);
const argPort = args.indexOf('--port');
const port = Number(argPort >= 0 ? args[argPort + 1] : process.env.PORT || 8080);
const laps = Number(process.env.RB_LAPS || 2);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Served with its own type or Android quietly ignores the install prompt.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

const rooms = createRooms({ laps, log });

/* ------------------------------------------------------------------- static */

function notFound(res, message) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
}

/** Resolve a URL path inside `dist/`, refusing anything that climbs out of it. */
function resolveInDist(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = resolve(dist, `.${normalize(decoded)}`);
  if (candidate !== dist && !candidate.startsWith(dist + sep)) return null;
  return candidate;
}

/**
 * Pick the pre-compressed twin of `file` that this visitor can decode.
 *
 * `scripts/precompress.mjs` writes `<file>.br` and `<file>.gz` beside every text asset at
 * build time, and omits either one that did not actually shrink — so the existence check is
 * the whole negotiation. Brotli first: it wins on every asset here, and any browser new enough
 * for the `es2022` bundle understands it. Anything the build did not compress (images, audio,
 * the tiny files) simply has no twin and goes out as-is.
 */
function negotiateEncoding(file, accept) {
  const offers = /\bbr\b/.test(accept) ? ['br', 'gzip'] : /\bgzip\b/.test(accept) ? ['gzip'] : [];
  for (const encoding of offers) {
    const twin = `${file}${encoding === 'br' ? '.br' : '.gz'}`;
    if (existsSync(twin)) return { encoding, body: twin };
  }
  return { encoding: null, body: file };
}

function serveFile(res, file, accept = '') {
  // The type comes from the *logical* file: `index.js.br` is still JavaScript, and a browser
  // told otherwise refuses to run it as a module.
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  // Vite fingerprints everything under /assets, so those are safe to cache hard; index.html
  // must not be, or a rebuilt game keeps loading the old bundle for whoever raced before.
  const immutable = file.includes(`${sep}assets${sep}`);
  const { encoding, body } = negotiateEncoding(file, accept);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    // Two visitors can get different bytes for one URL, so any cache in between has to key on
    // what they asked for.
    vary: 'accept-encoding',
    // The bundle is served from a fingerprinted path with a declared type; refusing MIME
    // sniffing keeps a proxy or browser from guessing a different one.
    'x-content-type-options': 'nosniff',
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  createReadStream(body).pipe(res);
}

const server = createServer((req, res) => {
  // `/rooms` and `/health` are read cross-origin in development, where the game comes from
  // Vite on 5173 and this process only holds the sockets. Nothing here is private: it is the
  // list of rooms that asked to be public, which is the whole point of asking.
  const json = (body) => {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };

  if (req.url === '/health') {
    json({ ok: true, rooms: rooms.size });
    return;
  }

  if (req.url === '/rooms' || req.url?.startsWith('/rooms?')) {
    json({ rooms: rooms.listed() });
    return;
  }

  if (!existsSync(dist)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No build found. Run `npm run build` first, or use `npm run dev` and play on 5173.');
    return;
  }

  const accept = req.headers['accept-encoding'] || '';
  const file = resolveInDist(req.url || '/');
  if (!file) return notFound(res, 'Not found');
  if (existsSync(file) && statSync(file).isFile()) return serveFile(res, file, accept);

  // Anything else falls back to the entry document, so `/?mp=1` works as a shared link.
  const index = join(dist, 'index.html');
  if (existsSync(index)) return serveFile(res, index, accept);
  return notFound(res, 'Not found');
});

/* ---------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  let playerId = null;
  let room = null;
  const sendRaw = (encoded) => socket.send(encoded);

  socket.on('message', (data) => {
    const raw = typeof data === 'string' ? data : data.toString();
    if (room) {
      room.message(playerId, raw);
      return;
    }
    // The first message has to be `hello`; it names the room, and the registry decides
    // whether that room exists, may be created, and has space.
    let hello;
    try {
      hello = JSON.parse(raw);
    } catch {
      socket.close();
      return;
    }
    if (!hello || hello.t !== 'hello') return;
    const seat = rooms.join(sendRaw, hello);
    if (!seat) {
      // `join` has already explained itself; give the frame a moment to flush.
      setTimeout(() => socket.close(), 50);
      return;
    }
    room = seat.room;
    playerId = seat.player.id;
  });

  const gone = () => {
    if (!room) return;
    rooms.leave(room, playerId);
    room = null;
  };
  socket.on('close', gone);
  socket.on('error', gone);
});

const timer = setInterval(() => rooms.tick(), Math.round(1000 / SNAPSHOT_HZ));
timer.unref?.();

server.listen(port, () => {
  // The bound port, not the requested one: `--port 0` lets the OS pick, which is how the
  // integration test starts a server without fighting for a fixed number.
  const address = server.address();
  const bound = address && typeof address === 'object' ? address.port : port;
  log(`Rayo Bandido match server on http://127.0.0.1:${bound}`);
  log(existsSync(dist) ? `serving ${dist}` : 'no dist/ yet — run `npm run build`');
  log(`share it with:  ngrok http ${bound}`);
  log('then open the URL with ?mp=1, make a room, and send friends the link it gives you');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('shutting down');
    clearInterval(timer);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
