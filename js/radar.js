// Navigatörens radar: ovanifrån-karta över kommande hinder och portar,
// höjdmätare och möjlighet att rita ut en egen rutt.

const ZOOMS = [45, 80, 140, 240];
const COLORS = {
  bg: '#0b1712',
  grid: 'rgba(120,200,160,0.07)',
  ring: 'rgba(120,220,170,0.22)',
  tree: '#2f8f46',
  treeTall: '#3fae5a',
  rock: '#9aa0a6',
  canyon: '#b08968',
  wall: '#e06c5a',
  tunnel: '#8fa3b0',
  roof: 'rgba(143,163,176,0.22)',
  next: '#ffd23f',
  upcoming: '#ff8c42',
  passed: 'rgba(61,220,132,0.45)',
  finish: '#ffffff',
  route: '#4dd0ff',
  plane: '#ffffff',
  trail: 'rgba(255,255,255,',
  text: '#e8f5ee',
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class RadarView {
  constructor(canvas, level, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = level;
    this.opts = opts;
    this.mode = opts.mode || 'heading';  // heading | north | overview
    this.zoomIdx = opts.zoomIdx != null ? opts.zoomIdx : 1;
    this.route = [];
    this.trail = [];
    this.insets = null;
    this.trailT = 0;
    this.state = null;      // senaste mottagna
    this.view = null;       // utjämnat visningstillstånd
    this.running = false;
    this.time = 0;
    this.onRouteChange = opts.onRouteChange || (() => {});
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();

    if (opts.interactive) {
      this._down = (e) => {
        this._downPos = [e.clientX, e.clientY];
      };
      this._up = (e) => {
        if (!this._downPos) return;
        const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
        this._downPos = null;
        if (moved > 12) return;
        const r = canvas.getBoundingClientRect();
        const w = this.fromScreen(e.clientX - r.left, e.clientY - r.top);
        if (!w) return;
        this.route.push(w);
        this.onRouteChange(this.route);
      };
      canvas.addEventListener('pointerdown', this._down);
      canvas.addEventListener('pointerup', this._up);
    }
  }

  setState(s) {
    this.state = s;
    if (!this.view) this.view = { x: s.x, y: s.y, z: s.z, yaw: s.yw };
  }

  setMode(m) { this.mode = m; }
  zoom(d) { this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIdx + d)); }
  undoRoute() { this.route.pop(); this.onRouteChange(this.route); }
  clearRoute() { this.route = []; this.onRouteChange(this.route); }
  resetTrail() { this.trail = []; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 300;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.draw();
    };
    this._raf = requestAnimationFrame(loop);
  }

  update(dt) {
    this.time += dt;
    const s = this.state;
    if (!s) return;
    const v = this.view;
    const jump = Math.hypot(s.x - v.x, s.z - v.z) > 30;
    const k = jump ? 1 : Math.min(1, dt * 12);
    v.x += (s.x - v.x) * k; v.y += (s.y - v.y) * k; v.z += (s.z - v.z) * k;
    v.yaw += wrap(s.yw - v.yaw) * k;
    if (jump) this.trail = [];
    this.trailT += dt;
    if (this.trailT > 0.2 && s.ph === 'fly') {
      this.trailT = 0;
      this.trail.push([v.x, v.z]);
      if (this.trail.length > 70) this.trail.shift();
    }
  }

  // ---- koordinater -----------------------------------------------------
  _frame() {
    const B = this.level.bounds;
    const v = this.view || { x: this.level.start.x, z: this.level.start.z, yaw: this.level.start.yaw };
    if (this.mode === 'overview') {
      const pad = 30;
      const ww = B.maxX - B.minX + pad * 2, hh = B.maxZ - B.minZ + pad * 2;
      const ins = this.insets || { top: 0, bottom: 0, left: 0, right: 0 };
      const aw = Math.max(50, this.w - ins.left - ins.right), ah = Math.max(50, this.h - ins.top - ins.bottom);
      const k = Math.min(aw / ww, ah / hh);
      return { k, px: (B.minX + B.maxX) / 2, pz: (B.minZ + B.maxZ) / 2, rot: 0, cx: ins.left + aw / 2, cy: ins.top + ah / 2 };
    }
    const R = ZOOMS[this.zoomIdx];
    const k = (Math.min(this.w, this.h) / 2) / R;
    // planet lite nedanför mitten så man ser mer framåt
    const cy = this.mode === 'heading' ? this.h * 0.62 : this.h / 2;
    return { k, px: v.x, pz: v.z, rot: this.mode === 'heading' ? v.yaw : 0, cx: this.w / 2, cy };
  }

  toScreen(x, z, f = this._f) {
    const dx = (x - f.px) * f.k, dz = (z - f.pz) * f.k;
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    return [f.cx + dx * c - dz * s, f.cy + dx * s + dz * c];
  }

  fromScreen(sx, sy) {
    const f = this._f || this._frame();
    const dx = sx - f.cx, dy = sy - f.cy;
    const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
    const x = (dx * c - dy * s) / f.k + f.px;
    const z = (dx * s + dy * c) / f.k + f.pz;
    return [x, z];
  }

  // ---- vägledning --------------------------------------------------------
  guidance() {
    const s = this.state;
    if (!s) return null;
    const g = this.level.gates[Math.min(s.ng, this.level.gates.length - 1)];
    const dx = g.x - s.x, dz = g.z - s.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(-dx, -dz);
    const turn = -wrap(want - s.yw) * 180 / Math.PI; // + = höger
    return { gate: g, dist, turn, dy: g.y - s.y, alt: s.y };
  }

  // ---- rita --------------------------------------------------------------
  draw() {
    const ctx = this.ctx, L = this.level;
    if (this.beforeDraw && this.mode === 'overview') this.beforeDraw();
    const f = this._frame();
    this._f = f;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.rotate(f.rot);
    ctx.scale(f.k, f.k);
    ctx.translate(-f.px, -f.pz);
    const px = 1 / f.k; // en skärmpixel i världsenheter

    // rutnät
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = px;
    const B = L.bounds;
    ctx.beginPath();
    for (let x = Math.floor((B.minX - 100) / 20) * 20; x <= B.maxX + 100; x += 20) { ctx.moveTo(x, B.minZ - 100); ctx.lineTo(x, B.maxZ + 100); }
    for (let z = Math.floor((B.minZ - 100) / 20) * 20; z <= B.maxZ + 100; z += 20) { ctx.moveTo(B.minX - 100, z); ctx.lineTo(B.maxX + 100, z); }
    ctx.stroke();

    // tunneltak först (genomskinligt), sedan väggar
    for (const b of L.boxes) {
      ctx.save();
      ctx.translate(b.x, b.z);
      ctx.rotate(-b.yaw);
      ctx.fillStyle = COLORS[b.kind] || COLORS.wall;
      if (b.kind === 'roof') ctx.fillRect(-b.hx, -b.hz, b.hx * 2, b.hz * 2);
      ctx.restore();
    }
    for (const b of L.boxes) {
      if (b.kind === 'roof') continue;
      ctx.save();
      ctx.translate(b.x, b.z);
      ctx.rotate(-b.yaw);
      ctx.fillStyle = COLORS[b.kind] || COLORS.wall;
      ctx.fillRect(-b.hx, -b.hz, b.hx * 2, b.hz * 2);
      ctx.restore();
    }

    // träd och klippor
    for (const t of L.trees) {
      ctx.fillStyle = t.h > 15 ? COLORS.treeTall : COLORS.tree;
      ctx.beginPath(); ctx.arc(t.x, t.z, t.baseR * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = COLORS.rock;
    for (const o of L.rocks) { ctx.beginPath(); ctx.arc(o.x, o.z, o.r, 0, Math.PI * 2); ctx.fill(); }

    // spår efter planet
    this.trail.forEach((p, i) => {
      ctx.fillStyle = COLORS.trail + (0.08 + 0.5 * i / this.trail.length) + ')';
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * px * 1.2, 0, Math.PI * 2); ctx.fill();
    });

    // portar
    const ng = this.state ? this.state.ng : 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    L.gates.forEach((g, i) => {
      const nx = -Math.sin(g.yaw), nz = -Math.cos(g.yaw); // passeringsriktning
      const sx = -nz, sz = nx;                             // längs porten
      let c = i < ng ? COLORS.passed : i === ng ? COLORS.next : COLORS.upcoming;
      if (g.finish && i >= ng) c = COLORS.finish;
      if (i === ng) {
        ctx.strokeStyle = `rgba(255,210,63,${0.25 + 0.4 * pulse})`;
        ctx.lineWidth = 3 * px;
        ctx.beginPath(); ctx.arc(g.x, g.z, g.r + 4 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(1.2, 1.4 * f.k) * px * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(g.x - sx * g.r, g.z - sz * g.r);
      ctx.lineTo(g.x + sx * g.r, g.z + sz * g.r);
      ctx.stroke();
      // pil i passeringsriktningen
      if (i >= ng) {
        const a = 2.6 + g.r * 0.25;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(g.x + nx * a * 1.4, g.z + nz * a * 1.4);
        ctx.lineTo(g.x + sx * a * 0.6, g.z + sz * a * 0.6);
        ctx.lineTo(g.x - sx * a * 0.6, g.z - sz * a * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    });

    // egen rutt
    if (this.route.length) {
      ctx.strokeStyle = COLORS.route;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.beginPath();
      this.route.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.route;
      for (const p of this.route) { ctx.beginPath(); ctx.arc(p[0], p[1], 4 * px, 0, Math.PI * 2); ctx.fill(); }
    }

    // pilotens sikt (ungefär där dimman blir tät)
    if (this.view && this.mode !== 'overview') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([4 * px, 6 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.arc(this.view.x, this.view.z, L.fog.far * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // planet
    if (this.view) {
      const v = this.view;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const rx = -fz, rz = fx;
      const S = Math.max(7 * px, 2.2);
      ctx.fillStyle = this.state && this.state.ph === 'crashed' ? '#ff4d4d' : COLORS.plane;
      ctx.beginPath();
      ctx.moveTo(v.x + fx * S * 1.4, v.z + fz * S * 1.4);
      ctx.lineTo(v.x - fx * S + rx * S, v.z - fz * S + rz * S);
      ctx.lineTo(v.x - fx * S * 0.5, v.z - fz * S * 0.5);
      ctx.lineTo(v.x - fx * S - rx * S, v.z - fz * S - rz * S);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ---- etiketter i skärmkoordinater (roteras inte) ----
    ctx.font = '600 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    L.gates.forEach((g, i) => {
      if (i < ng - 1) return;
      const [x, y] = this.toScreen(g.x, g.z, f);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) return;
      const label = g.finish ? 'MÅL' : String(i + 1);
      ctx.fillStyle = i === ng ? '#000' : 'rgba(0,0,0,0.6)';
      const tw = ctx.measureText(label).width + 8;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - tw / 2, y - 17 - 8, tw, 16, 4) : ctx.rect(x - tw / 2, y - 25, tw, 16);
      ctx.fillStyle = i === ng ? COLORS.next : 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.fillStyle = i === ng ? '#000' : COLORS.text;
      ctx.fillText(label, x, y - 17);
      if (f.k > 2.2 || i === ng) {
        ctx.font = '500 10px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(232,245,238,0.85)';
        ctx.fillText(Math.round(g.y) + ' m', x, y + 14);
        ctx.font = '600 12px -apple-system, system-ui, sans-serif';
      }
    });
    for (const zn of L.zones) {
      const [x, y] = this.toScreen(zn.x, zn.z, f);
      if (x < -60 || y < -20 || x > this.w + 60 || y > this.h + 20) continue;
      ctx.font = '700 11px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(zn.type.toUpperCase(), x + 46, y - 6);
      ctx.font = '500 10px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(zn.note, x + 46, y + 8);
    }
    this.route.forEach((p, i) => {
      const [x, y] = this.toScreen(p[0], p[1], f);
      ctx.font = '700 10px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = COLORS.route;
      ctx.fillText(String(i + 1), x + 9, y - 9);
    });

    if (this.mode !== 'overview') {
      // avståndsringar
      const R = ZOOMS[this.zoomIdx];
      ctx.strokeStyle = COLORS.ring;
      ctx.lineWidth = 1;
      [0.5, 1].forEach((m) => {
        ctx.beginPath(); ctx.arc(f.cx, f.cy, R * m * f.k, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = COLORS.ring;
        ctx.font = '500 10px -apple-system, system-ui, sans-serif';
        ctx.fillText(Math.round(R * m) + ' m', f.cx - R * m * f.k * 0.707 - 14, f.cy - R * m * f.k * 0.707);
      });
      if (this.mode === 'north') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '700 12px -apple-system, system-ui, sans-serif';
        ctx.fillText('N', this.w / 2, 14);
      }
    }
    if (!this.opts.compact) this._drawAltimeter(ctx);
  }

  _drawAltimeter(ctx) {
    const s = this.state;
    if (!s) return;
    const L = this.level;
    const W = 44, H = Math.min(260, this.h - 120);
    const x0 = this.w - W - 12, y0 = (this.h - H) / 2;
    const maxA = L.ceiling;
    const yOf = (a) => y0 + H - (Math.max(0, Math.min(maxA, a)) / maxA) * H;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y0 - 22, W, H + 44);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + W / 2 - 3, y0, 6, H);
    ctx.font = '500 9px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'right';
    for (let a = 0; a <= maxA; a += 10) {
      ctx.fillText(String(a), x0 + W / 2 - 6, yOf(a));
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '700 9px -apple-system, system-ui, sans-serif';
    ctx.fillText('HÖJD', x0 + W / 2, y0 - 12);
    // nästa port: höjdintervall
    const g = L.gates[Math.min(s.ng, L.gates.length - 1)];
    ctx.fillStyle = 'rgba(255,210,63,0.75)';
    const top = yOf(g.y + g.r), bot = yOf(g.y - g.r);
    ctx.fillRect(x0 + W / 2 + 4, top, 8, bot - top);
    // planet
    const py = yOf(s.y);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x0 + W / 2 - 5, py);
    ctx.lineTo(x0 + 4, py - 6);
    ctx.lineTo(x0 + 4, py + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 11px -apple-system, system-ui, sans-serif';
    ctx.fillText(Math.round(s.y) + ' m', x0 + W / 2, y0 + H + 12);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    if (this._down) {
      this.canvas.removeEventListener('pointerdown', this._down);
      this.canvas.removeEventListener('pointerup', this._up);
    }
  }
}
