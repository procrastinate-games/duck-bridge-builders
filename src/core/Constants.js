// Every balance number, timing and colour lives here.

export const GAME = {
  FIXED_DT: 1 / 60,
  MAX_STEPS_PER_FRAME: 4,
  MAX_DPR: 2,
  FOV: 50,
  NEAR: 0.1,
  FAR: 400,
  GRAVITY: 9.81,
  WATER_Y: 0,
  SAVE_KEY: 'duck-bridge-builders-save-v1',
};

// Structural materials. Forces in newtons, moments in N·m, lengths in metres.
export const MATERIALS = {
  shortPlank: {
    id: 'shortPlank', name: 'Short Plank', kind: 'deck', length: 2.0, minLength: 0.6,
    mass: 12, axialStrength: 26000, EA: 2.0e7, EI: 20000, bendStrength: 6200,
    thick: 0.14, width: 2.2, cost: 1, color: 0xd9a066, key: '1',
    blurb: 'Walkable deck. Strong over short spans.',
  },
  longPlank: {
    id: 'longPlank', name: 'Long Plank', kind: 'deck', length: 4.0, minLength: 0.6,
    mass: 22, axialStrength: 26000, EA: 2.0e7, EI: 20000, bendStrength: 6200,
    thick: 0.14, width: 2.2, cost: 2, color: 0xc98d55, key: '2',
    blurb: 'Walkable deck. Covers distance, bends under heavy loads.',
  },
  beam: {
    id: 'beam', name: 'Support Beam', kind: 'beam', length: 3.2, minLength: 0.6,
    mass: 18, axialStrength: 40000, EA: 4.0e7, EI: 36000,
    thick: 0.2, width: 0.18, cost: 2, color: 0xa86b3c, key: '3',
    blurb: 'Diagonal bracing. Build triangles!',
  },
  post: {
    id: 'post', name: 'Support Post', kind: 'post', length: 3.0, minLength: 0.6,
    mass: 26, axialStrength: 60000, EA: 6.0e7, EI: 90000,
    thick: 0.28, width: 0.28, cost: 2, color: 0x8a5a33, key: '4',
    blurb: 'Stout pillar. Stand it on the ground under the deck.',
  },
};

export const CONNECTOR = {
  id: 'connector', name: 'Connector', cost: 1, mass: 1, key: '5',
  blurb: 'Metal bracket. Press F on a joint to reinforce it.',
};

export const MATERIAL_ORDER = ['shortPlank', 'longPlank', 'beam', 'post'];

// Joint capacities: nailed (default) vs reinforced with a connector.
export const JOINTS = {
  nail: { pullOut: 15000, momentCap: 2100, stiffness: 1.0e5 },
  connector: { pullOut: 42000, momentCap: 9000, stiffness: 6.0e5 },
  anchorBonus: 1.15, // ground/bank anchors grip a little better
};

export const SOLVER = {
  SUBSTEPS: 16,
  LINEAR_DAMPING: 1.6, // 1/s
  ANGULAR_DAMPING: 3.0,
  NODE_RADIUS: 0.06,
  GROUND_FRICTION: 0.6,
  BUOYANCY: 1.7, // wood floats
  WATER_DRAG: 3.5,
  SMOOTHING: 0.45, // EMA factor for break checks
  OVERLOAD_FRAMES: 2, // must exceed capacity this many frames in a row
  DAMAGE_THRESHOLD: 0.8,
  DAMAGE_RATE: 0.6,
  DAMAGE_MAX: 0.6,
  DAMAGE_STRENGTH_LOSS: 0.35,
  MIN_INERTIA: 0.4,
  MAX_BREAKS_PER_FRAME: 2,
};

export const BUILD = {
  REACH: 4.6, // how far the beaver can place from its chest
  SNAP_NODE_RADIUS: 0.85,
  SNAP_GROUND_RADIUS: 0.9,
  END_SNAP_RADIUS: 0.75,
  END_SNAP_ANGLE: 0.24, // radians: auto-aim cone toward existing joints
  ROTATE_STEP: Math.PI / 12, // 15°
  TRIM_STEP: 0.25,
  GRID: 0.25,
  MAX_ANCHOR_SLOPE: 1.2, // dy/dx; steeper ground can't take an anchor
  NODE_MERGE: 0.45,
  PICKUP_RADIUS: 2.2,
  PILE_RADIUS: 2.4,
  PLACE_TIME: 0.55,
  HAMMER_TIME: 0.6,
};

export const BEAVER = {
  MASS: 30,
  WALK_SPEED: 3.4,
  RUN_SPEED: 5.8,
  SWIM_SPEED: 2.5,
  CARRY_FACTOR: { shortPlank: 0.9, longPlank: 0.78, beam: 0.8, post: 0.72, broken: 0.9 },
  JUMP_SPEED: 6.2,
  GRAVITY: 22,
  RADIUS: 0.36,
  HALF_HEIGHT: 0.28,
  TURN_RATE: 12,
  ACCEL: 14,
  SWIM_FLOAT_Y: -0.32,
  CLIMB_TIME: 0.55,
  STEP_UP: 0.42,
  LEAP_HEIGHT: 2.6, // how high above his feet the beaver can leap out of the water
  LEAP_REACH: 2.2,
};

export const DUCKS = {
  COUNT: 10,
  MASS: 8,
  SPEED: 1.25,
  SPACING: 1.35,
  STEP_UP: 0.32,
  MAX_DROP: 0.55,
  MAX_SLOPE: 0.7, // tan(35°)
  HESITATE_TIME: 1.3,
  QUEUE_GAP: 0.95,
};

export const HIPPO = {
  MASS: 950,
  SPEED: 0.85,
  LEG_SPREAD: 0.75, // front/back leg pairs at ±this along x
  STEP_PERIOD: 0.95,
  STEP_IMPACT: 0.28, // extra fraction of weight on the stepping legs
  STEP_UP: 0.5,
  MAX_DROP: 0.7,
  MAX_SLOPE: 0.6,
  INSPECT_TIME: 1.8,
  HESITATE_STRESS: 0.78,
  MAX_HESITATIONS: 3,
};

export const INSPECTION = {
  COUNTDOWN: 3,
  FAIL_LINGER: 3.2,
  SUCCESS_LINGER: 4.5,
  DUCKS_DONE_PAUSE: 1.6,
};

export const SCORING = {
  DUCK: 100,
  ALL_DUCKS: 500,
  HIPPO: 1500,
  FIRST_TRY: 500,
  MATERIAL_UNDER_PAR: 60, // per cost point under par
  ROCK_SOLID: 300,
  ROCK_SOLID_STRESS: 0.65,
  TIME_BONUS_PER_SEC: 6,
  ATTEMPT_PENALTY: 100,
};

export const CAMERA = {
  DISTANCE: 13,
  MIN_DISTANCE: 5,
  MAX_DISTANCE: 30,
  PITCH: 0.42,
  MIN_PITCH: 0.08,
  MAX_PITCH: 1.25,
  YAW: 0.22,
  SENSITIVITY: 0.005,
  FOLLOW_LERP: 6,
  CARRY_EXTRA_DISTANCE: 3,
};

export const WORLD = {
  Z_HALF: 32,
  X_MARGIN: 32,
  PLAY_Z_HALF: 17,
  PLAY_X_MARGIN: 16,
  DAM_Z: -15,
  CURRENT: 1.2, // m/s along -z
};

// Collision groups (bit indices)
export const GROUPS = {
  TERRAIN: 0,
  DECK: 1,
  RAIL: 2,
  BEAVER: 3,
  DEBRIS: 4,
  CRITTER: 5,
};

export const COLORS = {
  SKY_TOP: 0x6ec6ff,
  SKY_BOTTOM: 0xfff1d6,
  FOG: 0xcfe9f5,
  GRASS: 0x7cc35a,
  GRASS_DARK: 0x5aa34a,
  DIRT: 0xb98a5c,
  ROCK: 0x9a9aa6,
  SAND: 0xe8d39a,
  WATER_SHALLOW: 0x5fd6d6,
  WATER_DEEP: 0x2a8fc4,
  BEAVER_FUR: 0x8b5a2b,
  BEAVER_BELLY: 0xd2a06d,
  BEAVER_TAIL: 0x5b3a22,
  VEST: 0xff7a1a,
  VEST_STRIPE: 0xfff36b,
  HELMET: 0xffcc22,
  DUCK: 0xffe14a,
  DUCK_BEAK: 0xff9d2a,
  HIPPO: 0xb9a3d6,
  HIPPO_BELLY: 0xe6c7e8,
  METAL: 0x9aa4ad,
  STRESS_OK: 0x6fd36f,
  STRESS_MID: 0xffd23f,
  STRESS_HIGH: 0xff4d3d,
  PREVIEW_OK: 0x7dffb0,
  PREVIEW_BAD: 0xff5c5c,
  NODE: 0xfff3b0,
  ANCHOR: 0x6b4a2b,
};
