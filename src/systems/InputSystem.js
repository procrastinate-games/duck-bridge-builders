// Keyboard + mouse. Gameplay code reads state; "pressed" flags last one fixed step.

export class InputSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, consumed by consume()
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, left: false, right: false };
    this.clicked = false;
    this.wheel = 0;
    this.orbitDX = 0;
    this.orbitDY = 0;
    this.enabled = true;
    this.lastMoveTime = 0;
    this.dragDist = 0;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = this.norm(e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(this.norm(e)));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      this.updateMouse(e);
      if (e.button === 0) {
        this.mouse.left = true;
        this.dragDist = 0;
      }
      if (e.button === 2 || e.button === 1) {
        this.mouse.right = true;
        canvas.setPointerCapture?.(e.pointerId);
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.mouse.left) {
        this.mouse.left = false;
        if (this.dragDist < 8) this.clicked = true;
      }
      if (e.button === 2 || e.button === 1) this.mouse.right = false;
    });
    window.addEventListener('pointermove', (e) => {
      this.updateMouse(e);
      if (this.mouse.right) {
        this.orbitDX += e.movementX;
        this.orbitDY += e.movementY;
      }
      if (this.mouse.left) this.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  }

  norm(e) {
    return e.code;
  }

  updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
    this.mouse.ndcY = -(this.mouse.y / r.height) * 2 + 1;
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  /** Movement vector in input space (x: right, y: forward). */
  moveAxis() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  takeOrbit() {
    const d = { x: this.orbitDX, y: this.orbitDY };
    this.orbitDX = 0;
    this.orbitDY = 0;
    return d;
  }

  takeClick() {
    const c = this.clicked;
    this.clicked = false;
    return this.enabled && c;
  }

  consume() {
    this.pressed.clear();
  }

  /** Simulated key tap (used by tests / autopilot). */
  tap(code) {
    this.pressed.add(code);
  }
}
