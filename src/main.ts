import './styles.css';
import { createGame } from './game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud-root');
const debugRoot = document.getElementById('debug-root');
if (!canvas || !hudRoot || !debugRoot) {
  throw new Error('Rayo Bandido: missing root elements in index.html');
}

const game = createGame(canvas, hudRoot, debugRoot);
game.start();
canvas.focus();
