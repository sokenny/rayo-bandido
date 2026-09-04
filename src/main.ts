import './styles.css';
import type { GameMode } from './core/types';
import { createGame } from './game';
import { createLoadingScreen } from './ui/loadingScreen';
import { showMainMenu } from './ui/mainMenu';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root');
const debugRoot = document.getElementById('debug-root');
const menuRoot = document.getElementById('menu-root');
if (!canvas || !hudRoot || !debugRoot || !menuRoot) {
  throw new Error('Rayo Bandido: missing root elements in index.html');
}

/**
 * Which world to load comes from the URL: `?mode=test` (the free-roam city) or `?mode=race`
 * (the circuit). Without one, the main menu is shown and the choice is written into the URL,
 * so a world is always one reload away and a race link can be shared later for multiplayer.
 */
function modeFromUrl(): GameMode | null {
  const mode = new URLSearchParams(location.search).get('mode');
  return mode === 'test' || mode === 'race' ? mode : null;
}

function urlWithMode(mode: GameMode | null): string {
  const params = new URLSearchParams(location.search);
  if (mode) params.set('mode', mode);
  else params.delete('mode');
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}

/**
 * Boot sequence. The loading screen is already on screen (static markup in `index.html`);
 * this drives its captions and takes it down once the GPU has been warmed up, so the first
 * frame the player sees is already a smooth one.
 */
async function boot(mode: GameMode): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  loading.set(mode === 'race' ? 'BUILDING THE CIRCUIT' : 'BUILDING THE CITY', 0.12);
  // Let the caption paint before the synchronous scene build blocks the thread.
  await loading.paint();

  const game = createGame(canvas!, hudRoot!, debugRoot!, mode);
  // `?nowarm=1` skips the warm-up to reproduce the first-use hitches on purpose (A/B, and the
  // negative test for the perf gate: `node scripts/perf-probe.mjs --check --url ...?nowarm=1`).
  if (new URLSearchParams(location.search).has('nowarm')) {
    loading.set('SKIPPING WARM-UP', 1);
  } else {
    try {
      await game.warmUp(loading);
    } catch (err) {
      // A failed warm-up only costs the first-use hitches it was meant to remove.
      console.warn('Rayo Bandido: warm-up failed, starting cold', err);
    }
  }
  game.start();
  canvas!.focus();
  void loading.hide();

  // ESC leaves the world and returns to the menu.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') location.assign(urlWithMode(null));
  });
}

function menu(): void {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  void loading.hide();
  showMainMenu(menuRoot!, (mode) => {
    // A short beat for the card to light up, then reload into the chosen world.
    setTimeout(() => location.assign(urlWithMode(mode)), 180);
  });
}

const mode = modeFromUrl();
if (mode) void boot(mode);
else menu();
