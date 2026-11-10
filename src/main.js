import './style.css';
import { Game } from './core/Game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
game.init().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  ui.innerHTML = `<div class="screen show"><div class="panel"><h2>Oops — the river is blocked</h2><p>${String(err.message || err)}</p><p>Try a recent Chrome, Safari or Firefox with WebGL enabled.</p></div></div>`;
});
