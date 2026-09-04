import './styles.css';
import { createGame } from './game';
import { createLoadingScreen } from './ui/loadingScreen';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root');
const debugRoot = document.getElementById('debug-root');
if (!canvas || !hudRoot || !debugRoot) {
  throw new Error('Rayo Bandido: missing root elements in index.html');
}

/**
 * Boot sequence. The loading screen is already on screen (static markup in `index.html`);
 * this drives its captions and takes it down once the GPU has been warmed up, so the first
 * frame the player sees is already a smooth one.
 */
async function boot(): Promise<void> {
  const loading = createLoadingScreen(document.getElementById('loading-root'));
  loading.set('BUILDING THE CITY', 0.12);
  // Let the caption paint before the synchronous scene build blocks the thread.
  await loading.paint();

  const game = createGame(canvas!, hudRoot!, debugRoot!);
  try {
    await game.warmUp(loading);
  } catch (err) {
    // A failed warm-up only costs the first-use hitches it was meant to remove.
    console.warn('Rayo Bandido: warm-up failed, starting cold', err);
  }
  game.start();
  canvas!.focus();
  void loading.hide();
}

void boot();
