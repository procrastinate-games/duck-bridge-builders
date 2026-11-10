// Orchestrator: renderer, scene, systems, level session lifecycle, the
// fixed-step simulation loop, and the build → test → repair flow.

import * as THREE from 'three';
import { GAME, COLORS, MATERIALS, DUCKS, BEAVER, CAMERA } from './Constants.js';
import { eventBus, Events } from './EventBus.js';
import { gameState } from './GameState.js';
import { LEVELS, profileFn, startAnchors, terrainHeight, windForceFor } from '../level/levels.js';
import { LevelBuilder } from '../level/LevelBuilder.js';
import { PhysicsWorld, initRapier, G } from '../systems/PhysicsWorld.js';
import { StructureSolver } from '../systems/StructureSolver.js';
import { InputSystem } from '../systems/InputSystem.js';
import { CameraRig } from '../systems/CameraRig.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { AudioManager } from '../systems/AudioManager.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { Bridge } from '../gameplay/Bridge.js';
import { Beaver } from '../gameplay/Beaver.js';
import { DebrisSystem } from '../gameplay/Debris.js';
import { BuildController } from '../gameplay/BuildController.js';
import { Inspection } from '../gameplay/Inspection.js';
import { findSurface } from '../gameplay/WalkSurface.js';
import { bridgeCost, computeScore, explainFailure } from '../gameplay/Scoring.js';
import { UI, TUTORIAL } from '../ui/UI.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -0.2, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.05, 0.6, h), 0.7));
    float sun = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 64.0);
    col += uSun * sun * 0.8;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Timer();
    this.acc = 0;
    this.time = 0;
    this.manualClock = !!window.__MANUAL_CLOCK__;
    // automated tests on GPU-less machines: simulate everything, draw nothing
    this.noDraw = !!window.__TEST_NO_DRAW__;
    this.flags = {};
    this.feedbackT = 0;
    this.inventoryDirty = true;
    this.ready = false;
  }

  async init() {
    this.save = new SaveSystem();
    if (this.save.data.settings) Object.assign(gameState.settings, this.save.data.settings);
    this.ui = new UI(this.save);
    this.ui.setLoading(0.15, 'Gathering planks…');

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME.MAX_DPR));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = gameState.settings.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.FOG, 70, 230);
    this.camera = new THREE.PerspectiveCamera(GAME.FOV, window.innerWidth / window.innerHeight, GAME.NEAR, GAME.FAR);
    this.setupLights();

    this.ui.setLoading(0.35, 'Waking up the physics…');
    await initRapier();
    this.physics = new PhysicsWorld();

    this.input = new InputSystem(this.canvas);
    this.cameraRig = new CameraRig(this.camera);
    this.cameraRig.physics = this.physics;
    this.particles = new ParticleSystem(this.scene);
    this.audio = new AudioManager();
    this.levelBuilder = new LevelBuilder(this.scene, this.physics);

    this.wireEvents();
    window.addEventListener('resize', () => this.onResize());

    this.ui.setLoading(0.7, 'Filling the river…');
    this.loadLevel(0, 'relaxed', { attract: true });
    this.ui.setLoading(1, 'Ready!');
    this.ui.showMenu();
    this.audio.playMusic('menu');
    this.ready = true;
    this.renderer.setAnimationLoop(() => this.frame());
    this.exposeTestHooks();
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xcfefff, 0x8a7a5a, 1.25);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-14, 26, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.skyUniforms = {
      uTop: { value: new THREE.Color(COLORS.SKY_TOP) },
      uHorizon: { value: new THREE.Color(COLORS.SKY_BOTTOM) },
      uSun: { value: new THREE.Color(0xfff2c4) },
      uSunDir: { value: sun.position.clone().normalize() },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -1;
    this.scene.add(sky);
  }

  applyTheme(level) {
    const t = level.theme;
    if (t.sunset) {
      this.skyUniforms.uTop.value.setHex(0x7fa8ff);
      this.skyUniforms.uHorizon.value.setHex(0xffc79a);
      this.sun.color.setHex(0xffd2a0);
      this.scene.fog.color.setHex(0xf5d7c0);
    } else if (t.windy) {
      this.skyUniforms.uTop.value.setHex(0x86b9ef);
      this.skyUniforms.uHorizon.value.setHex(0xe9f2f7);
      this.sun.color.setHex(0xf6f4ee);
      this.scene.fog.color.setHex(0xdde8ee);
    } else {
      this.skyUniforms.uTop.value.setHex(COLORS.SKY_TOP);
      this.skyUniforms.uHorizon.value.setHex(COLORS.SKY_BOTTOM);
      this.sun.color.setHex(0xfff1d6);
      this.scene.fog.color.setHex(COLORS.FOG);
    }
    const ext = level.gap / 2 + 16;
    const cam = this.sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 90;
    cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- events

  wireEvents() {
    eventBus.on(Events.UI_START_LEVEL, ({ index, mode }) => this.startLevel(index, mode));
    eventBus.on(Events.UI_TEST, () => this.requestTest());
    eventBus.on(Events.UI_REPAIR, () => this.repair());
    eventBus.on(Events.UI_RESTART, () => this.restart());
    eventBus.on(Events.UI_NEXT, () => this.nextLevel());
    eventBus.on(Events.UI_MENU, () => this.toMenu());
    eventBus.on(Events.UI_PAUSE, () => this.pause());
    eventBus.on(Events.UI_RESUME, () => this.resume());
    eventBus.on(Events.UI_SETTINGS_CHANGED, () => {
      this.renderer.shadowMap.enabled = gameState.settings.shadows;
      this.scene.traverse((o) => {
        if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true;
      });
      if (this.bridge) this.bridge.stressMode = gameState.settings.stressView;
    });
    eventBus.on(Events.INVENTORY_CHANGED, () => (this.inventoryDirty = true));
    eventBus.on(Events.ITEM_PICKED, () => {
      this.inventoryDirty = true;
      this.flags.carry = true;
    });
    eventBus.on(Events.ITEM_PLACED, ({ member }) => {
      this.inventoryDirty = true;
      this.flags.placed = true;
      if (member.mat.kind !== 'deck') this.flags.support = true;
    });
    eventBus.on(Events.ITEM_DROPPED, () => (this.inventoryDirty = true));
    eventBus.on(Events.ITEM_RECYCLED, ({ refunded }) => {
      this.inventoryDirty = true;
      this.ui.toast(refunded ? '♻️ Back on the pile' : 'Scrap cleared (already recycled)');
    });
    eventBus.on(Events.NODE_REINFORCED, () => (this.flags.reinforce = true));
    eventBus.on(Events.PLACE_DENIED, (msg) => msg && this.ui.toast(msg));
    eventBus.on(Events.TEST_COUNTDOWN, (n) => this.ui.countdown(n));
    eventBus.on(Events.TEST_PHASE, (p) => this.onTestPhase(p));
    eventBus.on(Events.TEST_FINISHED, (r) => this.onTestFinished(r));
    eventBus.on(Events.WALKER_FELL, ({ who }) => {
      this.ui.banner(who === 'hippo' ? 'KER-SPLOOSH!' : 'SPLASH!', 'fail', 2200);
      this.beaver.setMood('dismay');
      this.audio.play('fail');
    });
    eventBus.on(Events.CELEBRATE, () => {
      this.ui.banner('HIPPO APPROVED!', 'win', 4200);
      this.audio.play('victory');
      this.audio.play('hippoYay');
      this.beaver.setMood('celebrate');
      const g = this.level.gap / 2;
      const deckY = Math.max(this.level.bankL, this.level.bankR);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.particles.confetti({ x: g + 2 + Math.random() * 3, y: deckY + 3, z: (Math.random() - 0.5) * 4 }, 90), i * 450);
      }
      this.particles.confetti({ x: this.beaver.pos.x, y: this.beaver.feetY + 2, z: this.beaver.pos.z }, 60);
    });
    eventBus.on(Events.HIPPO_STEP, () => {
      if (this.inspection?.hippo?.state === 'enter' || this.inspection?.hippo?.state === 'cross') this.cameraRig.shake(0.18);
    });
    eventBus.on(Events.HIPPO_ARRIVE, () => this.audio.play('hippoHmm'));
    eventBus.on(Events.DUCK_RESCUED, (n) => {
      const nest = this.levelBuilder.nestPos;
      if (nest) this.particles.hearts({ x: nest.x, y: nest.y + 0.6, z: nest.z });
      if (n === DUCKS.COUNT) this.ui.banner('All 10 ducklings safe! 🐥', '', 2000);
    });
    eventBus.on(Events.SPLASH, ({ pos, big }) => this.particles.splash(pos, big));
  }

  // ---------------------------------------------------------------- level lifecycle

  disposeSession() {
    if (this.inspection) this.inspection.clear();
    if (this.build) this.build.dispose();
    if (this.bridge) this.bridge.dispose();
    if (this.debris) this.debris.dispose();
    if (this.beaver) this.beaver.dispose();
    this.particles.clear();
    this.inspection = this.build = this.bridge = this.debris = this.beaver = null;
  }

  loadLevel(index, mode, { attract = false } = {}) {
    this.disposeSession();
    const level = LEVELS[index];
    this.level = level;
    this.physics.create();
    this.levelBuilder.build(level);
    this.applyTheme(level);

    const solver = new StructureSolver(profileFn(level));
    for (const a of startAnchors(level)) solver.addNode(a.x, a.y, { fixed: true, kind: a.kind });
    solver.windForce = windForceFor(level);
    this.solver = solver;
    this.bridge = new Bridge(this.scene, this.physics, solver);
    this.bridge.stressMode = gameState.settings.stressView;
    this.bridge.syncTopology();
    this.debris = new DebrisSystem(this.scene, this.physics);
    this.beaver = new Beaver(this.scene, this.physics, this.particles);
    const g = level.gap / 2;
    this.beaver.spawn(level, -g - 4.5, 1.2);
    this.beaver.deckAt = (x, z, feetY) => {
      if (Math.abs(z) > MATERIALS.shortPlank.width / 2) return null;
      const s = findSurface(solver, level, x, feetY + 0.05, BEAVER.STEP_UP, 99);
      return s.member ? { y: s.y, memberId: s.member.id } : null;
    };
    this.beaver.deckAbove = (x, z) => {
      if (Math.abs(z) > MATERIALS.shortPlank.width / 2) return null;
      const s = findSurface(solver, level, x, GAME.WATER_Y + 6, 0, 99);
      return s.member ? { y: s.y } : null;
    };
    this.build = new BuildController({
      scene: this.scene, camera: this.camera, solver, bridge: this.bridge, beaver: this.beaver,
      debris: this.debris, levelBuilder: this.levelBuilder, level, particles: this.particles, cameraRig: this.cameraRig,
    });
    this.inspection = new Inspection({
      scene: this.scene, physics: this.physics, solver, level, particles: this.particles,
      cameraRig: this.cameraRig, nest: this.levelBuilder.nestPos, bridge: this.bridge, deckFilter: G.qDeck,
    });

    gameState.levelIndex = index;
    gameState.mode = mode;
    gameState.inventory = { ...level.budget };
    gameState.carried = null;
    gameState.attempts = 0;
    gameState.buildTime = 0;
    gameState.timer = level.timeLimit;
    gameState.timerLimit = level.timeLimit;
    gameState.ducksRescued = 0;
    gameState.hippoResult = null;
    gameState.lastResult = null;
    gameState.bestStarsThisLevel = 0;
    this.flags = {};
    this.startPos = this.beaver.pos.clone();
    this.inventoryDirty = true;
    this.lastTimerSecond = null;

    const deckY = Math.max(level.bankL, level.bankR);
    if (attract) {
      gameState.phase = 'menu';
      this.cameraRig.reset(new THREE.Vector3(0, deckY, 0), { yaw: 0.5, pitch: 0.35, distance: level.gap + 18 });
      this.cameraRig.setCinematic({ target: new THREE.Vector3(0, deckY - 0.5, 0), distance: level.gap + 16, pitch: 0.32, lerp: 0.5 });
      this.attract = true;
    } else {
      this.attract = false;
      gameState.phase = 'build';
      const tutorial = level.tutorial && !this.save.data.tutorialDone;
      gameState.tutorialStep = tutorial ? 0 : TUTORIAL.length;
      this.ui.setTutorial(level.tutorial);
      this.ui.showHud(level, mode);
      // intro sweep: overview, then settle behind the beaver
      this.cameraRig.reset(new THREE.Vector3(0, deckY, 0), { yaw: 0.6, pitch: 0.45, distance: level.gap + 20 });
      this.cameraRig.setCinematic({ target: new THREE.Vector3(0, deckY - 0.5, 0), distance: level.gap + 12, yaw: 0.3, pitch: 0.38, lerp: 1.2 });
      this.introT = 1.6;
      this.audio.playMusic('build');
      this.audio.play('whoosh');
      this.ui.banner(`${level.id}. ${level.name}`, '', 2000);
    }
  }

  startLevel(index, mode) {
    this.loadLevel(index, mode);
  }

  restart() {
    this.loadLevel(gameState.levelIndex, gameState.mode);
  }

  nextLevel() {
    const next = gameState.levelIndex + 1;
    if (next >= LEVELS.length) {
      this.ui.toast('🏆 You built every bridge! Thanks for playing.', 4000);
      this.toMenu();
      return;
    }
    this.loadLevel(next, gameState.mode);
  }

  toMenu() {
    this.loadLevel(gameState.levelIndex || 0, gameState.mode, { attract: true });
    this.ui.setTesting(false);
    this.ui.showMenu();
    this.audio.playMusic('menu');
  }

  pause() {
    if (!['build', 'countdown', 'ducks', 'hippo'].includes(gameState.phase)) return;
    gameState.prevPhase = gameState.phase;
    gameState.phase = 'paused';
    this.ui.showPause();
  }

  resume() {
    if (gameState.phase !== 'paused') return;
    gameState.phase = gameState.prevPhase;
    this.ui.hidePause();
  }

  // ---------------------------------------------------------------- testing

  get testing() {
    return ['countdown', 'ducks', 'hippo'].includes(gameState.phase);
  }

  requestTest() {
    if (gameState.phase !== 'build') return;
    if (this.beaver.carried) {
      // put the carried piece back on its pile — nothing is auto-built
      const item = this.beaver.carried;
      if (!item.broken) gameState.inventory[item.type]++;
      const pile = this.levelBuilder.piles.find((p) => p.type === item.type);
      if (pile && !item.broken) this.levelBuilder.updatePileVisual(pile, gameState.inventory[item.type], MATERIALS[item.type].name);
      this.beaver.setCarried(null);
      gameState.carried = null;
      this.build.clearPreview();
    }
    gameState.attempts++;
    gameState.phase = 'countdown';
    this.flags.tested = true;
    this.ui.tutorialCheck(this.flags);
    this.bridge.clearGhosts();
    for (const n of this.solver.nodes.values()) n.failedMark = 0;
    for (const m of this.solver.members.values()) m.peakStress = 0;
    this.connectorsUsed = this.level.budget.connector - gameState.inventory.connector;
    this.testCost = bridgeCost(this.solver, this.connectorsUsed);
    const g = this.level.gap / 2;
    this.beaver.teleport(-g - 3.4, 3.4, Math.PI / 2);
    this.beaver.setMood(null);
    this.bridge.highlightMember = null;
    this.bridge.highlightNode = null;
    this.bridge.showJointHints = false;
    this.build.reachRing.visible = false;
    this.inspection.start();
    this.ui.setTesting(true);
    this.audio.playMusic('test');
  }

  onTestPhase(p) {
    if (p === 'ducks' || p === 'hippo') gameState.phase = p;
    this.ui.updateTestHud(p, gameState.ducksRescued, this.solver.maxStress());
    if (p === 'hippo') {
      this.ui.banner('Here comes the inspector! 🦛', '', 2200);
    }
  }

  onTestFinished(r) {
    gameState.phase = 'results';
    const level = this.level;
    const score = computeScore({
      result: r, level, attempts: gameState.attempts, cost: this.testCost,
      buildTime: gameState.buildTime, mode: gameState.mode,
    });
    const exp = explainFailure(r);
    const beat = this.save.submit(level.id, gameState.mode, { stars: score.stars, score: score.score, time: gameState.buildTime, cost: this.testCost });
    gameState.bestStarsThisLevel = Math.max(gameState.bestStarsThisLevel, score.stars);
    const canNext = this.save.isUnlocked(level.id + 1) || (level.id === LEVELS.length && score.stars >= 2);
    gameState.lastResult = { ...r, ...score };
    // mark failures for repair mode
    this.audio.playMusic(r.hippo ? 'victory' : 'build');
    for (let i = 0; i < score.stars; i++) setTimeout(() => this.audio.play('star', { n: i }), 300 + i * 300);
    this.ui.setTesting(false);
    this.ui.showResults({
      ...r, ...score, title: r.rescued >= DUCKS.COUNT && !r.hippo ? `${exp.title}` : exp.title, tip: exp.tip,
      cost: this.testCost, par: level.parCost, time: gameState.buildTime, attempts: gameState.attempts,
      beat, canNext, isLast: level.id === LEVELS.length,
    });
    if (beat.score && gameState.attempts > 0 && score.score > 0) this.ui.toast('🏅 New personal best!');
  }

  repair() {
    if (gameState.phase !== 'results') return;
    this.inspection.clear();
    gameState.phase = 'build';
    this.beaver.setMood(null);
    this.cameraRig.setCinematic(null);
    this.cameraRig.reset(this.beaver.pos.clone().add(new THREE.Vector3(0, 1, 0)), { distance: CAMERA.DISTANCE + 2 });
    if (gameState.mode === 'timed') {
      gameState.timer = this.level.repairTime;
      gameState.timerLimit = this.level.repairTime;
    }
    this.ui.showHud(this.level, gameState.mode);
    this.audio.playMusic('build');
    if (this.bridge.ghosts.length || [...this.solver.nodes.values()].some((n) => n.failedMark)) {
      this.ui.toast('🔴 Red markers show what failed · F re-nails loose joints', 3600);
    }
    if (this.level.tutorial && gameState.tutorialStep >= TUTORIAL.length) {
      this.ui.banner('Repair time! 🔨', '', 1600);
    }
  }

  // ---------------------------------------------------------------- structure events

  handleStructureEvents() {
    const events = this.solver.drainEvents();
    if (!events.length) return;
    for (const ev of events) {
      this.inspection.noteStructural(ev);
      if (ev.type === 'loosen') {
        eventBus.emit(Events.JOINT_LOOSENED, ev);
        this.particles.dust({ x: ev.x, y: ev.y, z: 1.1 }, 5);
        this.particles.dust({ x: ev.x, y: ev.y, z: -1.1 }, 5);
        this.cameraRig.shake(0.1);
      } else if (ev.type === 'detach') {
        eventBus.emit(Events.JOINT_DETACHED, ev);
        this.particles.chips({ x: ev.x, y: ev.y, z: 1.1 }, 10);
        this.particles.chips({ x: ev.x, y: ev.y, z: -1.1 }, 10);
        this.cameraRig.shake(0.3);
      } else if (ev.type === 'snap') {
        eventBus.emit(Events.MEMBER_SNAPPED, ev);
        const m = ev.member;
        this.bridge.addGhost(m.type, ev.ax, ev.ay, ev.bx, ev.by);
        for (const p of ev.pieces) {
          this.debris.spawnFromSegment(m.type, p.x1, p.y1, p.x2, p.y2, p.vx, p.vy, { broken: true, damage: m.damage, parentId: m.id });
        }
        this.particles.chips({ x: ev.x, y: ev.y, z: 0 }, 26);
        this.cameraRig.shake(0.45);
      } else if (ev.type === 'cluster') {
        for (const p of ev.pieces) {
          this.bridge.addGhost(p.member.type, p.x1, p.y1, p.x2, p.y2);
          this.debris.spawnFromSegment(p.member.type, p.x1, p.y1, p.x2, p.y2, p.vx, p.vy, { broken: false, damage: p.member.damage });
        }
        eventBus.emit(Events.CLUSTER_FELL, ev);
        if (ev.pieces.length > 1) this.cameraRig.shake(0.5);
      }
    }
    this.bridge.syncTopology();
  }

  // ---------------------------------------------------------------- loop

  frame() {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.manualClock) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= GAME.FIXED_DT && steps < GAME.MAX_STEPS_PER_FRAME) {
        this.fixedUpdate(GAME.FIXED_DT);
        this.acc -= GAME.FIXED_DT;
        steps++;
      }
      if (steps === GAME.MAX_STEPS_PER_FRAME) this.acc = 0;
    }
    // how far we are between the last physics step and the next one
    this.alpha = this.manualClock ? 1 : Math.min(1, this.acc / GAME.FIXED_DT);
    this.renderFrame(this.manualClock ? 0 : dt);
  }

  /** Deterministic stepping for tests. */
  step(frames = 1) {
    this.alpha = 1;
    for (let i = 0; i < frames; i++) {
      this.fixedUpdate(GAME.FIXED_DT);
      this.renderFrame(GAME.FIXED_DT, i === frames - 1);
    }
  }

  fixedUpdate(dt) {
    if (!this.solver || !this.physics.world) return;
    const phase = gameState.phase;
    if (phase === 'paused') {
      this.input.consume();
      return;
    }
    const input = this.input;
    this.solver.clearLoads();

    const camFwd = this.cameraRig.forward();
    if (phase === 'build') {
      const axis = input.moveAxis();
      this.beaver.fixedUpdate(dt, axis, {
        run: input.down('ShiftLeft') || input.down('ShiftRight'),
        jump: input.hit('Space'),
        enabled: this.introT <= 0 || true,
      }, camFwd);
      this.build.update(input, dt);
      if (input.hit('KeyT')) this.requestTest();
      if (input.hit('Escape') || input.hit('KeyP')) this.pause();
      // build clock
      gameState.buildTime += dt;
      if (gameState.mode === 'timed') {
        gameState.timer -= dt;
        const sec = Math.ceil(gameState.timer);
        if (sec <= 10 && sec !== this.lastTimerSecond && sec > 0) eventBus.emit(Events.TIMER_WARNING);
        this.lastTimerSecond = sec;
        if (gameState.timer <= 0) {
          this.ui.toast('⏰ Time! The inspectors are here.');
          this.requestTest();
        }
      }
      // tutorial progress
      if (!this.flags.moved && this.beaver.pos.distanceTo(this.startPos) > 3) this.flags.moved = true;
    } else {
      this.beaver.fixedUpdate(dt, { x: 0, y: 0 }, { enabled: false }, camFwd);
      if (input.hit('Escape') || input.hit('KeyP')) this.pause();
    }
    // beaver weight on the bridge
    this.beaver.detectGround(this.bridge);
    if (this.beaver.groundMemberId != null && this.solver.members.has(this.beaver.groundMemberId)) {
      const m = this.solver.members.get(this.beaver.groundMemberId);
      const a = this.solver.nodes.get(m.a);
      const b = this.solver.nodes.get(m.b);
      const dx = b.x - a.x;
      const t = Math.abs(dx) > 0.05 ? (this.beaver.pos.x - a.x) / dx : 0.5;
      this.solver.addPointLoad(m.id, t, BEAVER.MASS, 0, 'beaver');
    }

    if (this.inspection.active) this.inspection.fixedUpdate(dt);

    // During construction the bridge flexes but nothing loosens or breaks (the
    // HUD and red tint warn about overloaded parts). The inspection is the real
    // test and always runs with full breaking. Disconnected pieces still fall.
    this.solver.breakingEnabled = phase !== 'build' && phase !== 'menu';
    this.solver.step(dt);
    this.handleStructureEvents();
    if (this.solver.topologyDirty) this.bridge.syncTopology();
    this.bridge.syncPhysics();
    this.debris.fixedUpdate(dt);
    this.physics.step();

    // creaks scale with stress
    const stress = this.solver.maxStress();
    if (this.testing && stress > 0.45) eventBus.emit(Events.STRUCTURE_CREAK, { vol: Math.min(1.5, stress) });
    else if (phase === 'build' && stress > 0.75) eventBus.emit(Events.STRUCTURE_CREAK, { vol: 0.6 });

    input.consume();
  }

  renderFrame(dt, draw = true) {
    this.time += dt;
    const phase = gameState.phase;
    const input = this.input;

    // camera input
    const orbit = input.takeOrbit();
    if (phase !== 'menu' && phase !== 'paused') this.cameraRig.orbit(orbit.x, orbit.y);
    if (phase !== 'build' || !this.beaver?.carried) {
      const w = input.takeWheel();
      if (w && phase !== 'menu' && phase !== 'paused') this.cameraRig.zoom(w);
    }
    if (this.beaver) {
      const rp = this.beaver.interpolate(this.alpha ?? 1);
      if (phase === 'build') {
        if (this.introT > 0) {
          this.introT -= dt;
          if (this.introT <= 0) {
            this.cameraRig.setCinematic(null);
            this.cameraRig.yaw = CAMERA.YAW;
            this.cameraRig.pitch = CAMERA.PITCH;
          }
        }
        this.cameraRig.target.set(rp.x, rp.y - this.beaver.pos.y + this.beaver.feetY + 1.1, rp.z * 0.6);
        this.cameraRig.extraDistance = this.beaver.carried ? CAMERA.CARRY_EXTRA_DISTANCE : 0;
      } else if (phase === 'menu' && this.attract) {
        this.cameraRig.yaw += dt * 0.06;
        if (this.cameraRig.cinematic) this.cameraRig.cinematic.yaw = this.cameraRig.yaw;
      } else if (phase === 'results') {
        this.cameraRig.extraDistance = 0;
      }
      this.beaver.animate(dt, this.time);
      this.inspection.animate(dt, this.time, this.alpha ?? 1);
      this.bridge.update(dt, { testing: this.testing || phase === 'results', carrying: !!this.beaver.carried });
      this.bridge.windSway = this.level.wind ? 1 : 0;
      this.debris.update();
    }
    this.cameraRig.update(dt);
    this.particles.update(dt);
    this.levelBuilder.update(dt);
    if (this.level?.wind && Math.random() < dt * 6) {
      const g = this.level.gap / 2;
      this.particles.emit({
        pos: { x: -g - 10 + Math.random() * 6, y: 2 + Math.random() * 5, z: (Math.random() - 0.5) * 20 },
        count: 1, colors: [0x8fcf6b, 0xd8c35a, 0xf2a65a], speed: 0, up: 0.3, size: 0.07, life: 4, gravity: 0.2, drag: 0, spin: 5, shrink: false,
      });
      const last = this.particles.parts[this.particles.parts.length - 1];
      if (last) last.vx = 4 + Math.random() * 3;
    }

    // sun shadow follows the action
    if (this.beaver && this.sun.castShadow) {
      const focus = phase === 'build' ? this.beaver.pos : this.cameraRig.smoothTarget;
      this.sun.target.position.set(focus.x * 0.5, 0, 0);
      this.sun.position.set(focus.x * 0.5 - 14, 26, 18);
    }

    this.updateHud(dt);
    if (draw && !this.noDraw) this.renderer.render(this.scene, this.camera);
  }

  updateHud(dt) {
    const phase = gameState.phase;
    if (phase === 'build' && this.build) {
      this.ui.setHint(this.build.hint);
      if (this.inventoryDirty) {
        this.ui.renderMaterials();
        this.inventoryDirty = false;
      }
      if (gameState.mode === 'timed') this.ui.setTimer(gameState.timer, gameState.attempts > 0 ? 'Repair ' : '');
      this.feedbackT -= dt;
      if (this.feedbackT <= 0) {
        this.feedbackT = 0.25;
        const gap = this.pathGap();
        if (gap === null) this.flags.path = true;
        this.ui.setFeedback({
          pathGap: gap,
          stress: this.solver.maxStress(),
          pieces: this.solver.members.size,
          cost: bridgeCost(this.solver, this.level.budget.connector - gameState.inventory.connector),
        });
        this.ui.tutorialCheck(this.flags);
      }
    } else if (this.testing || phase === 'results') {
      this.ui.updateTestHud(null, gameState.ducksRescued, this.solver.maxStress());
    }
  }

  /** Walk the deck like a duckling would; return x of the first gap, or null. */
  pathGap() {
    const level = this.level;
    const g = level.gap / 2;
    let y = level.bankL;
    for (let x = -g - 0.4; x <= g + 0.6; x += 0.1) {
      const s = findSurface(this.solver, level, x, y + 0.05, DUCKS.STEP_UP, DUCKS.MAX_DROP);
      if (!s.supported || (s.member && Math.abs(s.slope) > DUCKS.MAX_SLOPE)) return x + g;
      y = s.y;
    }
    return null;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------------------------------------------------------------- test hooks

  exposeTestHooks() {
    window.__GAME__ = this;
    window.__GAME_STATE__ = gameState;
    window.render_game_to_text = () => JSON.stringify(this.snapshot());
    window.advanceTime = (ms) => {
      const frames = Math.max(1, Math.round(ms / (GAME.FIXED_DT * 1000)));
      this.step(frames);
      return frames;
    };
    this.debug = {
      start: (i = 0, mode = 'relaxed') => this.startLevel(i, mode),
      place: (type, ax, ay, angleDeg, freeLen = null) => {
        if (!(gameState.inventory[type] > 0)) return { ok: false, reason: `out of ${type}` };
        const r = this.build.debugPlace(type, ax, ay, angleDeg, freeLen);
        if (r.ok) {
          gameState.inventory[type]--;
          const pile = this.levelBuilder.piles.find((p) => p.type === type);
          this.levelBuilder.updatePileVisual(pile, gameState.inventory[type], MATERIALS[type].name);
          this.inventoryDirty = true;
        }
        this.bridge.syncTopology();
        return r;
      },
      ground: (x) => terrainHeight(this.level, x, 0),
      reinforceAt: (x, y) => {
        const n = this.solver.findNodeNear(x, y, 0.6);
        if (!n || gameState.inventory.connector <= 0) return false;
        if (this.solver.reinforceNode(n.id)) gameState.inventory.connector--;
        this.inventoryDirty = true;
        return true;
      },
      reinforceAll: () => {
        for (const n of this.solver.nodes.values()) {
          if (gameState.inventory.connector > 0 && !n.reinforced && n.members.size) {
            this.solver.reinforceNode(n.id);
            gameState.inventory.connector--;
          }
        }
      },
      test: () => this.requestTest(),
      repair: () => this.repair(),
      restart: () => this.restart(),
      next: () => this.nextLevel(),
      teleport: (x, z) => this.beaver.teleport(x, z),
      skipIntro: () => {
        this.introT = 0.001;
      },
    };
  }

  snapshot() {
    const s = this.solver;
    const b = this.beaver;
    return {
      coords: 'x: along the bridge (left bank → right bank), y: up, z: toward camera; bridge plane is z=0',
      phase: gameState.phase,
      level: this.level ? { id: this.level.id, name: this.level.name, gap: this.level.gap } : null,
      mode: gameState.mode,
      timer: gameState.mode === 'timed' ? +gameState.timer.toFixed(1) : null,
      attempts: gameState.attempts,
      inventory: gameState.inventory,
      beaver: b ? {
        x: +b.pos.x.toFixed(2), y: +b.feetY.toFixed(2), z: +b.pos.z.toFixed(2),
        carrying: b.carried ? { type: b.carried.type, len: +b.carried.length.toFixed(2), broken: b.carried.broken } : null,
        swimming: b.swimming, grounded: b.grounded, onMember: b.groundMemberId ?? null,
      } : null,
      bridge: s ? {
        members: [...s.members.values()].map((m) => {
          const a = s.nodes.get(m.a);
          const c = s.nodes.get(m.b);
          return {
            id: m.id, type: m.type, a: [+a.x.toFixed(2), +a.y.toFixed(2)], b: [+c.x.toFixed(2), +c.y.toFixed(2)],
            stress: +m.stress.toFixed(2), damage: +m.damage.toFixed(2), rigid: m.ends.map((e) => e.rigid),
          };
        }),
        nodes: s.nodes.size,
        reinforced: [...s.nodes.values()].filter((n) => n.reinforced).length,
        maxStress: +s.maxStress().toFixed(2),
        pathGap: this.level ? this.pathGap() : null,
        ghosts: this.bridge?.ghosts.length ?? 0,
      } : null,
      debris: this.debris ? this.debris.items.length : 0,
      inspection: this.inspection ? this.inspection.snapshot() : null,
      ducksRescued: gameState.ducksRescued,
      hippo: gameState.hippoResult,
      lastResult: gameState.lastResult ? { stars: gameState.lastResult.stars, score: gameState.lastResult.score, rescued: gameState.lastResult.rescued, hippo: gameState.lastResult.hippo } : null,
      hint: this.build ? this.build.hint.replace(/<[^>]+>/g, '') : '',
      unlocked: this.save.data.unlocked,
    };
  }
}

export { terrainHeight };
