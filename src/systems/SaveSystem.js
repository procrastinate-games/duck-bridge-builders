// Local progress: unlocked levels, stars, personal bests, settings.

import { GAME } from '../core/Constants.js';
import { LEVELS } from '../level/levels.js';

function blank() {
  return {
    version: 1,
    unlocked: 1,
    levels: {}, // `${id}-${mode}` → { stars, bestScore, bestTime, bestCost, completions }
    settings: null,
    tutorialDone: false,
  };
}

export class SaveSystem {
  constructor() {
    this.data = blank();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(GAME.SAVE_KEY);
      if (raw) this.data = { ...blank(), ...JSON.parse(raw) };
    } catch {
      this.data = blank();
    }
  }

  save() {
    try {
      localStorage.setItem(GAME.SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* private mode etc. — progress just won't persist */
    }
  }

  record(levelId, mode) {
    return this.data.levels[`${levelId}-${mode}`] || { stars: 0, bestScore: 0, bestTime: null, bestCost: null, completions: 0 };
  }

  isUnlocked(levelId) {
    return levelId <= this.data.unlocked;
  }

  /** Store a result; returns which personal bests were beaten. */
  submit(levelId, mode, { stars, score, time, cost }) {
    const key = `${levelId}-${mode}`;
    const rec = this.record(levelId, mode);
    const beat = { score: false, time: false, cost: false };
    if (stars > rec.stars) rec.stars = stars;
    if (score > rec.bestScore) {
      rec.bestScore = score;
      beat.score = true;
    }
    if (stars >= 3) {
      rec.completions++;
      if (mode === 'timed' && (rec.bestTime === null || time < rec.bestTime)) {
        rec.bestTime = time;
        beat.time = true;
      }
      if (rec.bestCost === null || cost < rec.bestCost) {
        rec.bestCost = cost;
        beat.cost = true;
      }
    }
    this.data.levels[key] = rec;
    if (stars >= 2 && levelId >= this.data.unlocked && levelId < LEVELS.length) this.data.unlocked = levelId + 1;
    this.save();
    return beat;
  }

  totalStars() {
    let s = 0;
    for (const r of Object.values(this.data.levels)) s += r.stars;
    return s;
  }

  saveSettings(settings) {
    this.data.settings = { ...settings };
    this.save();
  }

  reset() {
    const settings = this.data.settings;
    this.data = blank();
    this.data.settings = settings;
    this.save();
  }
}
