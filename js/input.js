// Styrning: tangentbord (WASD/piltangenter) och pekskärm (virtuell styrspak).

export class Input {
  constructor(root, opts = {}) {
    this.root = root;
    this.invertY = !!opts.invertY;
    this.sensitivity = opts.sensitivity || 1;   // styrkänslighet från inställningarna
    this.keys = new Set();
    this.kx = 0; this.ky = 0;          // utjämnade tangentbordsvärden
    this.stick = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.touchBoost = false; this.touchBrake = false;
    this.look = { yaw: 0, pitch: 0 };        // titta runt i cockpiten
    this.lookTouch = { active: false, id: null, sx: 0, sy: 0, yaw: 0, pitch: 0 };
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
    // Titta runt: dra på högra delen av skärmen (pekskärm) eller håll Q/E/R (tangentbord)
    const lookZone = root.querySelector('.look-zone');
    if (lookZone) {
      on(lookZone, 'pointerdown', (e) => {
        if (this.lookTouch.active) return;
        e.preventDefault();
        lookZone.setPointerCapture && lookZone.setPointerCapture(e.pointerId);
        this.lookTouch = { active: true, id: e.pointerId, sx: e.clientX, sy: e.clientY, yaw: 0, pitch: 0 };
      });
      on(lookZone, 'pointermove', (e) => {
        const L = this.lookTouch;
        if (!L.active || e.pointerId !== L.id) return;
        L.yaw = Math.max(-1.5, Math.min(1.5, -(e.clientX - L.sx) / 120));
        L.pitch = Math.max(-0.6, Math.min(0.6, -(e.clientY - L.sy) / 160));
      });
      const endLook = (e) => { if (e.pointerId === this.lookTouch.id) this.lookTouch.active = false; };
      on(lookZone, 'pointerup', endLook);
      on(lookZone, 'pointercancel', endLook);
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
    const R = 70;
    let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stick.x = dx / R;
    this.stick.y = -dy / R;
    // knappen stannar inom ringen (ringen är mindre på mobil); styrningen är densamma
    const k = Math.min(1, (this.base.offsetWidth / 2) / R);
    this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  }

  read(dt) {
    const k = this.keys;
    const tx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ty = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const rate = Math.min(1, dt * 10);    // tangenterna når fullt utslag på ungefär en tiondels sekund
    this.kx += (tx - this.kx) * rate;
    this.ky += (ty - this.ky) * rate;
    let x = this.kx, y = this.ky;
    if (this.stick.active) {
      // liten dödzon och mjukare kurva för finkänslig styrning
      const curve = (v) => (Math.abs(v) < 0.08 ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - 0.08) / 0.92, 1.3));
      x = curve(this.stick.x); y = curve(this.stick.y);
    }
    if (this.invertY) y = -y;
    x *= this.sensitivity; y *= this.sensitivity;

    // blickriktning (fjädrar tillbaka framåt när man släpper)
    let ly = 0, lp = 0;
    if (k.has('KeyQ')) ly += 1.3;
    if (k.has('KeyE')) ly -= 1.3;
    if (k.has('KeyR')) lp += 0.5;
    if (this.lookTouch.active) { ly = this.lookTouch.yaw; lp = this.lookTouch.pitch; }
    const lr = Math.min(1, dt * 6);
    this.look.yaw += (ly - this.look.yaw) * lr;
    this.look.pitch += (lp - this.look.pitch) * lr;
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
