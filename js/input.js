// Styrning: tangentbord (WASD/piltangenter) och pekskärm (virtuell styrspak).

export class Input {
  constructor(root, opts = {}) {
    this.root = root;
    this.invertY = !!opts.invertY;
    this.keys = new Set();
    this.kx = 0; this.ky = 0;          // utjämnade tangentbordsvärden
    this.stick = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.touchBoost = false; this.touchBrake = false;
    this._listeners = [];

    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); this._listeners.push([el, ev, fn, o]); };
    on(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      this.keys.add(k);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());

    const stickZone = root.querySelector('.stick-zone');
    const knob = root.querySelector('.stick-knob');
    const base = root.querySelector('.stick-base');
    this.knob = knob; this.base = base;
    if (stickZone) {
      on(stickZone, 'pointerdown', (e) => {
        if (this.stick.active) return;
        e.preventDefault();
        stickZone.setPointerCapture && stickZone.setPointerCapture(e.pointerId);
        const r = stickZone.getBoundingClientRect();
        this.stick = { active: true, id: e.pointerId, x: 0, y: 0, cx: e.clientX, cy: e.clientY };
        base.style.left = (e.clientX - r.left) + 'px';
        base.style.top = (e.clientY - r.top) + 'px';
        base.classList.add('active');
        this._moveStick(e);
      });
      on(stickZone, 'pointermove', (e) => { if (this.stick.active && e.pointerId === this.stick.id) this._moveStick(e); });
      const end = (e) => {
        if (e.pointerId !== this.stick.id) return;
        this.stick.active = false; this.stick.x = 0; this.stick.y = 0;
        base.classList.remove('active');
        knob.style.transform = 'translate(-50%, -50%)';
      };
      on(stickZone, 'pointerup', end);
      on(stickZone, 'pointercancel', end);
    }
    const hold = (sel, prop) => {
      const el = root.querySelector(sel);
      if (!el) return;
      on(el, 'pointerdown', (e) => { e.preventDefault(); this[prop] = true; el.classList.add('down'); });
      const up = () => { this[prop] = false; el.classList.remove('down'); };
      on(el, 'pointerup', up); on(el, 'pointercancel', up); on(el, 'pointerleave', up);
    };
    hold('.btn-boost', 'touchBoost');
    hold('.btn-brake', 'touchBrake');
  }

  _moveStick(e) {
    const R = 55;
    let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stick.x = dx / R;
    this.stick.y = -dy / R;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  read(dt) {
    const k = this.keys;
    const tx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ty = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const rate = Math.min(1, dt * 7);
    this.kx += (tx - this.kx) * rate;
    this.ky += (ty - this.ky) * rate;
    let x = this.kx, y = this.ky;
    if (this.stick.active) {
      // liten dödzon och mjukare kurva för finkänslig styrning
      const curve = (v) => (Math.abs(v) < 0.08 ? 0 : Math.sign(v) * Math.pow(Math.abs(v), 1.4));
      x = curve(this.stick.x); y = curve(this.stick.y);
    }
    if (this.invertY) y = -y;
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      boost: k.has('Space') || this.touchBoost,
      brake: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBrake,
    };
  }

  destroy() {
    this._listeners.forEach(([el, ev, fn, o]) => el.removeEventListener(ev, fn, o));
    this._listeners = [];
  }
}
