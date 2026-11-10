// HTML overlay UI: menus, HUD, inspection HUD, results, pause, settings,
// controls guide, tutorial and toasts. Requests go out over the EventBus.

import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { LEVELS } from '../level/levels.js';
import { MATERIALS, MATERIAL_ORDER, DUCKS } from '../core/Constants.js';

const $ = (sel, root = document) => root.querySelector(sel);

const ICONS = {
  shortPlank: '<svg viewBox="0 0 40 24"><rect x="6" y="8" width="28" height="8" rx="2" fill="#d9a066" stroke="#7a4a22" stroke-width="2"/></svg>',
  longPlank: '<svg viewBox="0 0 40 24"><rect x="1" y="8" width="38" height="8" rx="2" fill="#c98d55" stroke="#7a4a22" stroke-width="2"/></svg>',
  beam: '<svg viewBox="0 0 40 24"><rect x="4" y="9" width="32" height="6" rx="2" fill="#a86b3c" stroke="#5a3418" stroke-width="2" transform="rotate(-30 20 12)"/></svg>',
  post: '<svg viewBox="0 0 40 24"><rect x="15" y="1" width="10" height="22" rx="2" fill="#8a5a33" stroke="#4a2c14" stroke-width="2"/></svg>',
  connector: '<svg viewBox="0 0 40 24"><rect x="11" y="3" width="18" height="18" rx="3" fill="#b8c2cb" stroke="#4d565e" stroke-width="2"/><circle cx="16" cy="8" r="2" fill="#4d565e"/><circle cx="24" cy="8" r="2" fill="#4d565e"/><circle cx="16" cy="16" r="2" fill="#4d565e"/><circle cx="24" cy="16" r="2" fill="#4d565e"/></svg>',
};

const TUTORIAL = [
  { text: 'Move the beaver with <b>WASD</b> (hold <b>Shift</b> to run). <b>Right-drag</b> to look around, <b>wheel</b> to zoom.', check: 'moved' },
  { text: 'Walk to the <b>Short Plank</b> pile (the one nearest the river) and press <b>E</b> to pick one up.', check: 'carry' },
  { text: 'Point the mouse at the glowing <b>stake</b> on the river edge. The ghost plank snaps to it. <b>Click</b> to place it.', check: 'placed' },
  { text: 'Keep going! Walk out on your plank and build a deck all the way to the stake on the other bank.', check: 'path' },
  { text: 'Planks alone sag under heavy loads. Carry a <b>Support Post</b>, rotate it upright (<b>Q/R</b>) and stand it on the riverbed under a joint.', check: 'support' },
  { text: 'Point at a joint and press <b>F</b> to bolt on a metal <b>connector</b>. Reinforced joints are much stronger.', check: 'reinforce' },
  { text: 'Ready? Press <b>TEST BRIDGE</b> (or <b>T</b>) and watch the parade!', check: 'tested' },
];

export class UI {
  constructor(save) {
    this.save = save;
    this.root = document.getElementById('ui');
    this.selectedMode = 'relaxed';
    this.build();
    this.bind();
    this.toastTimer = null;
  }

  build() {
    this.root.innerHTML = `
      <div id="loading" class="screen show"><div class="logo-small">🦫</div><div class="loading-text">Gathering planks…</div><div class="bar"><div></div></div></div>

      <div id="menu" class="screen">
        <div class="menu-card">
          <div class="title-wrap">
            <div class="title-emoji">🦫🪵🐥</div>
            <h1>Duck Bridge<br/><span>Builders</span></h1>
            <p class="subtitle">Build it. Test it. Watch it wobble. Fix it.</p>
          </div>
          <div class="mode-toggle" role="tablist">
            <button data-mode="relaxed" class="pill active">🌿 Relaxed</button>
            <button data-mode="timed" class="pill">⏱️ Time Challenge</button>
          </div>
          <p class="mode-desc" id="mode-desc"></p>
          <button class="btn big primary" id="btn-play">Play</button>
          <div class="row">
            <button class="btn" id="btn-levels">Levels</button>
            <button class="btn" id="btn-controls">Controls</button>
            <button class="btn" id="btn-settings">Settings</button>
          </div>
          <div class="stars-total" id="stars-total"></div>
        </div>
      </div>

      <div id="levels" class="screen">
        <div class="panel wide">
          <h2>Choose a crossing</h2>
          <div class="mode-toggle small">
            <button data-mode="relaxed" class="pill active">🌿 Relaxed</button>
            <button data-mode="timed" class="pill">⏱️ Time Challenge</button>
          </div>
          <div class="level-grid" id="level-grid"></div>
          <div class="row"><button class="btn" data-back>Back</button></div>
        </div>
      </div>

      <div id="settings" class="screen modal">
        <div class="panel">
          <h2>Settings</h2>
          <label class="slider">Music <input type="range" min="0" max="1" step="0.05" id="set-music"/></label>
          <label class="slider">Sound effects <input type="range" min="0" max="1" step="0.05" id="set-sfx"/></label>
          <label class="slider">Camera sensitivity <input type="range" min="0.3" max="2" step="0.1" id="set-sens"/></label>
          <label class="check"><input type="checkbox" id="set-shadows"/> Soft shadows</label>
          <label class="check"><input type="checkbox" id="set-stress"/> Show stress colours while building</label>
          <div class="row">
            <button class="btn danger" id="btn-reset-progress">Reset progress</button>
            <button class="btn primary" data-back>Done</button>
          </div>
        </div>
      </div>

      <div id="controls" class="screen modal">
        <div class="panel">
          <h2>Controls</h2>
          <div class="controls-grid">
            <kbd>W A S D</kbd><span>Walk (camera-relative)</span>
            <kbd>Shift</kbd><span>Run</span>
            <kbd>Space</kbd><span>Jump · leap out of the water onto the bridge</span>
            <kbd>Right-drag</kbd><span>Rotate camera</span>
            <kbd>Wheel</kbd><span>Zoom · rotate piece while carrying</span>
            <kbd>E</kbd><span>Pick up · place · detach a piece · return to pile</span>
            <kbd>Left click</kbd><span>Place the carried piece</span>
            <kbd>Q / R</kbd><span>Rotate carried piece 15°</span>
            <kbd>Z / X</kbd><span>Trim / lengthen a free-ended piece (or Shift + wheel)</span>
            <kbd>F</kbd><span>Hammer a loose joint · add a connector</span>
            <kbd>G</kbd><span>Drop what you carry</span>
            <kbd>T</kbd><span>Test the bridge</span>
            <kbd>Esc</kbd><span>Pause</span>
          </div>
          <div class="tips">
            <p>🪵 Pieces must start at a <b>glowing joint</b> or on <b>solid ground</b>. The far end snaps to nearby joints — the beaver trims it to fit.</p>
            <p>🦫 You can walk on your deck and <b>swim</b> in the river. Press <b>Space</b> in the water to leap onto the bridge, or swim into a bank to climb out.</p>
            <p>📐 Triangles and posts carry the hippo. Long unsupported planks bend and snap.</p>
            <p>🧰 After a failed test, red markers show what broke. Repair and test again!</p>
          </div>
          <div class="row"><button class="btn primary" data-back>Got it</button></div>
        </div>
      </div>

      <div id="hud" class="hidden">
        <div class="hud-top-left">
          <div class="level-chip"><span id="hud-level"></span><small id="hud-mode"></small></div>
        </div>
        <div class="hud-top-center">
          <div id="hud-timer" class="timer hidden"></div>
          <div id="test-banner" class="test-banner hidden">
            <div id="test-phase"></div>
            <div class="duck-counter"><span id="duck-icons"></span><b id="duck-count">Ducklings Rescued: 0 / 10</b></div>
            <div class="condition"><span>Bridge condition</span><div class="cond-bar"><div id="cond-fill"></div></div></div>
          </div>
        </div>
        <div class="hud-left" id="materials"></div>
        <div class="hud-right">
          <button id="btn-test" class="btn test">TEST BRIDGE<small>T</small></button>
          <div class="feedback" id="feedback"></div>
          <div class="row tight">
            <button class="btn small" id="btn-hud-pause">❚❚ Pause</button>
            <button class="btn small" id="btn-hud-help">? Keys</button>
          </div>
        </div>
        <div class="hud-bottom"><div id="hint" class="hint"></div></div>
        <div id="tutorial" class="tutorial hidden">
          <div class="tut-head">🦫 Foreman Tips <span id="tut-step"></span><button id="tut-skip" class="link">skip</button></div>
          <div id="tut-text"></div>
        </div>
      </div>

      <div id="countdown" class="countdown hidden"></div>
      <div id="banner" class="banner hidden"></div>
      <div id="toast" class="toast hidden"></div>

      <div id="pause" class="screen modal">
        <div class="panel">
          <h2>Paused</h2>
          <button class="btn big primary" id="btn-resume">Resume</button>
          <div class="row">
            <button class="btn" id="btn-pause-restart">Restart level</button>
            <button class="btn" id="btn-pause-controls">Controls</button>
            <button class="btn" id="btn-pause-settings">Settings</button>
          </div>
          <button class="btn" id="btn-pause-menu">Quit to menu</button>
        </div>
      </div>

      <div id="results" class="screen modal">
        <div class="panel results">
          <div class="result-emoji" id="res-emoji"></div>
          <h2 id="res-title"></h2>
          <div class="stars" id="res-stars"></div>
          <p class="res-tip" id="res-tip"></p>
          <div class="res-stats" id="res-stats"></div>
          <div class="res-breakdown" id="res-breakdown"></div>
          <div class="awards" id="res-awards"></div>
          <div class="row">
            <button class="btn primary" id="btn-repair">🔨 Repair Bridge</button>
            <button class="btn" id="btn-restart">↺ Restart Level</button>
            <button class="btn next" id="btn-next">Next Level ➜</button>
          </div>
          <button class="btn link" id="btn-res-menu">Main menu</button>
        </div>
      </div>
    `;
  }

  bind() {
    const click = (id, fn) => $(id, this.root).addEventListener('click', (e) => {
      eventBus.emit(Events.UI_CLICK);
      fn(e);
    });
    this.root.querySelectorAll('.mode-toggle .pill').forEach((b) => b.addEventListener('click', () => {
      eventBus.emit(Events.UI_CLICK);
      this.setMode(b.dataset.mode);
    }));
    click('#btn-play', () => {
      const idx = Math.min(this.save.data.unlocked, LEVELS.length) - 1;
      this.startLevel(idx);
    });
    click('#btn-levels', () => this.showLevels());
    click('#btn-controls', () => this.openModal('controls'));
    click('#btn-settings', () => this.openModal('settings'));
    click('#btn-resume', () => eventBus.emit(Events.UI_RESUME));
    click('#btn-pause-restart', () => eventBus.emit(Events.UI_RESTART));
    click('#btn-pause-menu', () => eventBus.emit(Events.UI_MENU));
    click('#btn-pause-controls', () => this.openModal('controls'));
    click('#btn-pause-settings', () => this.openModal('settings'));
    click('#btn-hud-pause', () => eventBus.emit(Events.UI_PAUSE));
    click('#btn-hud-help', () => {
      eventBus.emit(Events.UI_PAUSE);
      this.openModal('controls');
    });
    click('#btn-test', () => eventBus.emit(Events.UI_TEST));
    click('#btn-repair', () => eventBus.emit(Events.UI_REPAIR));
    click('#btn-restart', () => eventBus.emit(Events.UI_RESTART));
    click('#btn-next', () => eventBus.emit(Events.UI_NEXT));
    click('#btn-res-menu', () => eventBus.emit(Events.UI_MENU));
    click('#tut-skip', () => {
      gameState.tutorialStep = TUTORIAL.length;
      this.save.data.tutorialDone = true;
      this.save.save();
      this.updateTutorial();
    });
    click('#btn-reset-progress', () => {
      if (confirm('Reset all stars, records and unlocked levels?')) {
        this.save.reset();
        this.refreshMenu();
        this.toast('Progress reset');
      }
    });
    this.root.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
      eventBus.emit(Events.UI_CLICK);
      this.back();
    }));
    // settings
    const s = gameState.settings;
    const music = $('#set-music', this.root);
    const sfx = $('#set-sfx', this.root);
    const sens = $('#set-sens', this.root);
    const sh = $('#set-shadows', this.root);
    const st = $('#set-stress', this.root);
    music.value = s.music;
    sfx.value = s.sfx;
    sens.value = s.sensitivity;
    sh.checked = s.shadows;
    st.checked = s.stressView === 'always';
    const changed = () => {
      s.music = +music.value;
      s.sfx = +sfx.value;
      s.sensitivity = +sens.value;
      s.shadows = sh.checked;
      s.stressView = st.checked ? 'always' : 'test';
      this.save.saveSettings(s);
      eventBus.emit(Events.AUDIO_SETTINGS);
      eventBus.emit(Events.UI_SETTINGS_CHANGED);
    };
    for (const el of [music, sfx, sens, sh, st]) el.addEventListener('input', changed);
    eventBus.on(Events.TOAST, (msg) => this.toast(msg));
    this.setMode('relaxed');
  }

  // ---------------------------------------------------------------- screens

  showScreen(id) {
    this.root.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
    this.current = id;
  }

  openModal(id) {
    this.modalReturn = this.current;
    this.showScreen(id);
  }

  back() {
    if (this.current === 'settings' || this.current === 'controls') {
      const ret = this.modalReturn;
      if (ret === 'pause' || ret === 'results') return this.showScreen(ret);
    }
    this.showMenu();
  }

  hideScreens() {
    this.root.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    this.current = null;
  }

  setLoading(p, text) {
    const bar = $('#loading .bar div', this.root);
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    if (text) $('#loading .loading-text', this.root).textContent = text;
  }

  setMode(mode) {
    this.selectedMode = mode;
    this.root.querySelectorAll('.mode-toggle .pill').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#mode-desc', this.root).innerHTML = mode === 'relaxed'
      ? 'No clock. Build, break and tinker as long as you like.'
      : 'Beat the build clock — the inspection starts when time runs out. Faster bridges earn bonus points.';
    if (this.current === 'levels') this.renderLevels();
  }

  showMenu() {
    this.refreshMenu();
    this.showScreen('menu');
    $('#hud', this.root).classList.add('hidden');
  }

  refreshMenu() {
    const total = this.save.totalStars();
    $('#stars-total', this.root).innerHTML = `⭐ ${total} / ${LEVELS.length * 3 * 2} stars collected`;
  }

  showLevels() {
    this.renderLevels();
    this.showScreen('levels');
  }

  renderLevels() {
    const grid = $('#level-grid', this.root);
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const unlocked = this.save.isUnlocked(L.id);
      const rec = this.save.record(L.id, this.selectedMode);
      const card = document.createElement('button');
      card.className = `level-card ${unlocked ? '' : 'locked'}`;
      card.disabled = !unlocked;
      const stars = [0, 1, 2].map((k) => `<span class="${k < rec.stars ? 'on' : ''}">★</span>`).join('');
      const best = [];
      if (rec.bestScore) best.push(`Best ${rec.bestScore}`);
      if (rec.bestTime != null) best.push(`${Math.round(rec.bestTime)} s`);
      if (rec.bestCost != null) best.push(`${rec.bestCost} mat.`);
      card.innerHTML = `
        <div class="lc-num">${L.id}</div>
        <div class="lc-name">${L.name}</div>
        <div class="lc-tag">${unlocked ? L.tagline : '🔒 Earn ⭐⭐ on the previous crossing'}</div>
        <div class="lc-meta">${L.gap} m gap · ${L.wind ? '💨 windy · ' : ''}${L.hippoMass} kg hippo${this.selectedMode === 'timed' ? ` · ⏱️ ${Math.round(L.timeLimit / 60)} min` : ''}</div>
        <div class="lc-stars">${stars}</div>
        <div class="lc-best">${best.join(' · ')}</div>`;
      card.addEventListener('click', () => {
        eventBus.emit(Events.UI_CLICK);
        this.startLevel(i);
      });
      grid.appendChild(card);
    });
  }

  startLevel(index) {
    eventBus.emit(Events.UI_START_LEVEL, { index, mode: this.selectedMode });
  }

  // ---------------------------------------------------------------- HUD

  showHud(level, mode) {
    this.hideScreens();
    $('#hud', this.root).classList.remove('hidden');
    $('#hud-level', this.root).textContent = `${level.id}. ${level.name}`;
    $('#hud-mode', this.root).textContent = mode === 'timed' ? 'Time Challenge' : 'Relaxed';
    $('#hud-timer', this.root).classList.toggle('hidden', mode !== 'timed');
    this.setTesting(false);
    this.renderMaterials();
    this.updateTutorial();
  }

  renderMaterials() {
    const el = $('#materials', this.root);
    const inv = gameState.inventory;
    const carried = gameState.carried;
    const rows = [...MATERIAL_ORDER, 'connector'].map((type) => {
      const name = type === 'connector' ? 'Connectors' : MATERIALS[type].name;
      const blurb = type === 'connector' ? 'Press F on a joint' : MATERIALS[type].blurb;
      const n = inv[type] ?? 0;
      const isCarried = carried && carried.type === type && !carried.broken;
      return `<div class="mat ${n === 0 ? 'empty' : ''} ${isCarried ? 'carried' : ''}" title="${blurb}">
        <div class="mat-icon">${ICONS[type]}</div>
        <div class="mat-name">${name}<small>${blurb}</small></div>
        <div class="mat-count">×${n}</div>
      </div>`;
    });
    let carriedHtml = '';
    if (carried) {
      carriedHtml = `<div class="carrying">Carrying: <b>${carried.broken ? 'broken ' : ''}${MATERIALS[carried.type].name}</b> ${carried.length < MATERIALS[carried.type].length - 0.05 ? `(${carried.length.toFixed(1)} m)` : ''}</div>`;
    }
    el.innerHTML = `<div class="panel-title">Materials</div>${rows.join('')}${carriedHtml}`;
  }

  setHint(html) {
    const el = $('#hint', this.root);
    if (this.lastHint !== html) {
      el.innerHTML = html || '';
      el.classList.toggle('hidden', !html);
      this.lastHint = html;
    }
  }

  setTimer(seconds, label = '') {
    const el = $('#hud-timer', this.root);
    const s = Math.max(0, Math.ceil(seconds));
    const txt = `${label}⏱️ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('warn', seconds < 30);
  }

  setFeedback(info) {
    const el = $('#feedback', this.root);
    const path = info.pathGap == null
      ? '<span class="ok">✓ Deck reaches the far bank</span>'
      : `<span class="bad">✗ Deck gap at ${info.pathGap.toFixed(1)} m</span>`;
    const stress = Math.round(info.stress * 100);
    const cls = stress >= 100 ? 'bad' : stress > 70 ? 'mid' : 'ok';
    const load = stress >= 100
      ? `<span class="bad">⚠ Red parts can't hold their own weight (${stress}%) — add supports before testing</span>`
      : `<span class="${cls}">Self-weight stress ${stress}%</span>`;
    const html = `${path}${load}<span>Pieces: ${info.pieces} · Cost ${info.cost}</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  setTesting(on) {
    $('#btn-test', this.root).classList.toggle('hidden', on);
    $('#feedback', this.root).classList.toggle('hidden', on);
    $('#materials', this.root).classList.toggle('hidden', on);
    $('#test-banner', this.root).classList.toggle('hidden', !on);
    $('.hud-bottom', this.root).classList.toggle('hidden', on);
    $('#tutorial', this.root).classList.toggle('hidden', on || gameState.tutorialStep >= TUTORIAL.length || !this.tutorialOn);
    if (on) this.updateTestHud('countdown', 0, 0);
  }

  updateTestHud(phase, rescued, condition) {
    const names = {
      countdown: 'Inspection starting…',
      ducks: '🐥 Phase 1 — The Duckling Parade',
      ducksDone: '🐥 All ducklings safe!',
      hippo: '🦛 Phase 2 — The Hippo Challenge',
      hippoInspect: '🦛 The inspector is examining your work…',
      hippoCross: '🦛 Phase 2 — The Hippo Challenge',
      failing: '💦 Splash!',
      celebrating: '🎉 HIPPO APPROVED!',
    };
    if (phase) $('#test-phase', this.root).textContent = names[phase] || '';
    const icons = Array.from({ length: DUCKS.COUNT }, (_, i) => `<span class="${i < rescued ? 'on' : ''}">🐥</span>`).join('');
    const ic = $('#duck-icons', this.root);
    if (ic.dataset.n !== String(rescued)) {
      ic.innerHTML = icons;
      ic.dataset.n = String(rescued);
      $('#duck-count', this.root).textContent = `Ducklings Rescued: ${rescued} / ${DUCKS.COUNT}`;
    }
    const health = Math.max(0, 1 - condition);
    const fill = $('#cond-fill', this.root);
    fill.style.width = `${Math.round(health * 100)}%`;
    fill.style.background = health > 0.5 ? '#6fd36f' : health > 0.2 ? '#ffd23f' : '#ff4d3d';
  }

  countdown(n) {
    const el = $('#countdown', this.root);
    el.classList.remove('hidden');
    el.textContent = n > 0 ? String(n) : 'GO!';
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    if (n <= 0) setTimeout(() => el.classList.add('hidden'), 700);
  }

  banner(text, cls = '', ms = 2600) {
    const el = $('#banner', this.root);
    el.className = `banner ${cls}`;
    el.innerHTML = text;
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  toast(msg, ms = 2200) {
    const el = $('#toast', this.root);
    el.innerHTML = msg;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------------------------------------------------------------- tutorial

  setTutorial(on) {
    this.tutorialOn = on;
    this.updateTutorial();
  }

  updateTutorial() {
    const el = $('#tutorial', this.root);
    const step = gameState.tutorialStep;
    if (!this.tutorialOn || step >= TUTORIAL.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    $('#tut-step', this.root).textContent = `${step + 1}/${TUTORIAL.length}`;
    $('#tut-text', this.root).innerHTML = TUTORIAL[step].text;
  }

  tutorialCheck(flags) {
    if (!this.tutorialOn) return;
    let step = gameState.tutorialStep;
    let advanced = false;
    while (step < TUTORIAL.length && flags[TUTORIAL[step].check]) {
      step++;
      advanced = true;
    }
    if (advanced) {
      gameState.tutorialStep = step;
      this.updateTutorial();
      if (step >= TUTORIAL.length) {
        this.save.data.tutorialDone = true;
        this.save.save();
      }
    }
  }

  // ---------------------------------------------------------------- pause/results

  showPause() {
    this.showScreen('pause');
  }

  hidePause() {
    this.hideScreens();
  }

  showResults(r) {
    // r: { success, rescued, hippo, stars, score, breakdown, awards, title, tip, cost, time, attempts, beat, canNext, mode, isLast }
    this.showScreen('results');
    $('#res-emoji', this.root).textContent = r.hippo ? '🦛🎉🐥' : r.rescued >= DUCKS.COUNT ? '🐥✨' : '💦🦆';
    $('#res-title', this.root).textContent = r.hippo ? 'HIPPO APPROVED!' : r.title;
    $('#res-stars', this.root).innerHTML = [0, 1, 2].map((k) => `<span class="star ${k < r.stars ? 'on' : ''}" style="animation-delay:${0.25 + k * 0.3}s">★</span>`).join('');
    $('#res-tip', this.root).innerHTML = r.hippo
      ? 'The inspector stamps your bridge with a happy hoof. The ducklings are dancing!'
      : `<b>${r.rescued >= DUCKS.COUNT ? 'The ducklings made it — ' : ''}</b>${r.tip}`;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    $('#res-stats', this.root).innerHTML = `
      <div><b>${r.rescued}/${DUCKS.COUNT}</b><span>Ducklings rescued</span></div>
      <div><b>${r.hippo ? '✓ Crossed' : r.hippoTried ? '✗ Splashed' : '—'}</b><span>Hippo</span></div>
      <div><b>${r.cost}</b><span>Materials used (par ${r.par})</span></div>
      <div><b>${fmt(r.time)}</b><span>Build time</span></div>
      <div><b>${r.attempts}</b><span>Test attempts</span></div>
      <div><b>${r.score}</b><span>Score${r.beat?.score ? ' · NEW BEST!' : ''}</span></div>`;
    $('#res-breakdown', this.root).innerHTML = r.breakdown.map((b) => `<div><span>${b.label}</span><b>${b.pts > 0 ? '+' : ''}${Math.round(b.pts)}</b></div>`).join('');
    $('#res-awards', this.root).innerHTML = r.awards.map((a) => `<div class="award"><b>🏅 ${a.name}</b><small>${a.desc}</small></div>`).join('');
    $('#btn-repair', this.root).classList.toggle('hidden', r.hippo);
    const next = $('#btn-next', this.root);
    next.classList.toggle('hidden', !r.canNext);
    next.textContent = r.isLast ? '🏆 Finish' : 'Next Level ➜';
    $('#btn-restart', this.root).textContent = r.hippo ? '↺ Build again' : '↺ Restart Level';
  }
}

export { TUTORIAL };
