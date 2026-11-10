// Centralized mutable state. Systems read it; events/orchestrator mutate it.

class GameState {
  constructor() {
    this.settings = {
      music: 0.5,
      sfx: 0.8,
      sensitivity: 1,
      shadows: true,
      stressView: 'always', // 'always' | 'test'
    };
    this.reset();
  }

  reset() {
    this.phase = 'menu'; // menu | build | countdown | ducks | hippo | results | paused
    this.prevPhase = 'menu';
    this.levelIndex = 0;
    this.mode = 'relaxed'; // relaxed | timed
    this.inventory = {};
    this.carried = null;
    this.attempts = 0;
    this.buildTime = 0;
    this.timer = 0;
    this.timerLimit = 0;
    this.ducksRescued = 0;
    this.hippoResult = null; // null | 'crossed' | 'fell'
    this.testMaxStress = 0;
    this.lastResult = null;
    this.failure = null;
    this.tutorialStep = 0;
    this.bestStarsThisLevel = 0;
    this.elapsed = 0;
  }
}

export const gameState = new GameState();
