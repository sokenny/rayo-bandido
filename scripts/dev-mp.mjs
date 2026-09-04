/**
 * Multiplayer development: the Vite dev server and the match server together.
 *
 * Vite serves the game on 5173 with hot reload; the match server runs alongside it on 8080,
 * and a dev build of the client aims its socket there (`DEV_MATCH_PORT` in
 * `src/net/protocol.ts`). In production the two are one process on one port — which is the
 * arrangement a tunnel needs — so only development has two of them to start.
 *
 * Open http://127.0.0.1:5173/?mp=1 in one window, make a room, and open the link it gives
 * you in a second window to race yourself.
 *
 * Usage:  npm run dev:mp  [--port 8080]
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || '8080';

const children = [];

function run(label, colour, command, commandArgs) {
  const child = spawn(command, commandArgs, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colour}m${label.padEnd(6)}\x1b[0m`;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${tag} ${line}`));
  }
  child.on('exit', (code) => {
    console.log(`${tag} exited with ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 200).unref();
}

run('server', '35', process.execPath, ['server/index.mjs', '--port', port]);
run('vite', '36', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173']);

console.log('\x1b[36mvite  \x1b[0m open http://127.0.0.1:5173/?mp=1 (make a room in one window, follow its link in the other)');

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
