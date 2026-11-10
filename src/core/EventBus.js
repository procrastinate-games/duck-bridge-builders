// Singleton pub/sub. All cross-module communication goes through here.
export const Events = {
  // Game flow
  GAME_MENU: 'game:menu',
  LEVEL_START: 'level:start',
  LEVEL_RESTART: 'level:restart',
  PHASE_CHANGED: 'game:phase',
  PAUSE: 'game:pause',
  RESUME: 'game:resume',

  // Building
  ITEM_PICKED: 'build:picked',
  ITEM_PLACED: 'build:placed',
  ITEM_DROPPED: 'build:dropped',
  ITEM_RECYCLED: 'build:recycled',
  MEMBER_REMOVED: 'build:removed',
  NODE_HAMMERED: 'build:hammered',
  NODE_REINFORCED: 'build:reinforced',
  PLACE_DENIED: 'build:denied',
  PIECE_TRIMMED: 'build:trimmed',
  INVENTORY_CHANGED: 'build:inventory',

  // Structure
  JOINT_LOOSENED: 'structure:loosened',
  JOINT_DETACHED: 'structure:detached',
  MEMBER_SNAPPED: 'structure:snapped',
  STRUCTURE_CREAK: 'structure:creak',
  CLUSTER_FELL: 'structure:cluster',

  // Inspection
  TEST_REQUESTED: 'test:request',
  TEST_COUNTDOWN: 'test:countdown',
  TEST_PHASE: 'test:phase',
  DUCK_RESCUED: 'test:duckRescued',
  WALKER_FELL: 'test:walkerFell',
  WALKER_HESITATE: 'test:hesitate',
  HIPPO_STEP: 'test:hippoStep',
  HIPPO_ARRIVE: 'test:hippoArrive',
  TEST_FINISHED: 'test:finished',
  REPAIR_START: 'test:repair',

  // UI requests
  UI_START_LEVEL: 'ui:startLevel',
  UI_REPAIR: 'ui:repair',
  UI_RESTART: 'ui:restart',
  UI_NEXT: 'ui:next',
  UI_MENU: 'ui:menu',
  UI_TEST: 'ui:test',
  UI_PAUSE: 'ui:pause',
  UI_RESUME: 'ui:resume',
  UI_SETTINGS_CHANGED: 'ui:settings',
  TOAST: 'ui:toast',

  // FX / audio
  SPLASH: 'fx:splash',
  FOOTSTEP: 'fx:footstep',
  QUACK: 'fx:quack',
  JUMP: 'fx:jump',
  UI_CLICK: 'ui:click',
  CELEBRATE: 'fx:celebrate',
  TIMER_WARNING: 'fx:timerWarning',
  AUDIO_SETTINGS: 'audio:settings',
};

class EventBus {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    (this.listeners[event] ||= []).push(callback);
    return () => this.off(event, callback);
  }

  once(event, callback) {
    const off = this.on(event, (data) => {
      off();
      callback(data);
    });
    return off;
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
  }

  emit(event, data) {
    const list = this.listeners[event];
    if (!list) return;
    for (const cb of [...list]) {
      try {
        cb(data);
      } catch (err) {
        console.error(`EventBus error in ${event}:`, err);
      }
    }
  }

  clear() {
    this.listeners = {};
  }
}

export const eventBus = new EventBus();
