// skinpack.js – planets skins i spelet: Common, Epic, Legendary och Ultra (10 st per sällsynthet).
// Utseendet (texturer, extra delar, animationer och effekter) kommer från skin-paketet (Claude Design).
// Anpassat för spelet:
//  - effekterna uppdateras av spelets bildloop (update) i stället för en egen loop,
//  - partiklarna ligger i en egen grupp (group) som ägaren lägger i sin scen,
//  - partiklarna återanvänds och är begränsade i antal (budget), så att mobilen inte hackar,
//  - spår: i spelet flyger planet på riktigt, så partiklarna blir kvar bakom av sig själva;
//    i shopen (planet står still) skjuts de bakåt längs planets riktning (trail),
//  - inga partiklar skapas nära en given punkt (cockpit-kameran), så att sikten aldrig skyms.
// Namn, beskrivningar, pris och level-krav finns i js/skins.js.
// createSkinSystem() → { group, dress(plane, id), update(dt, state), pulse(kind), clear(), setBudget(max, rate), dispose() }
import * as THREE from './lib/three.module.min.js';

// texturer ritas en gång och delas av alla vyer (spelet, navigatören, shopen)
const texCache = new Map();
const texClones = new Map();
// högre upplösning på texturerna (skarpare skins): 2× på dator, 1,5× på pekskärm (mindre minne)
const TEX_SCALE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
// standardplanets mått (räknas fram första gången): alla skins får plats inom dem
let REF = null;

export function createSkinSystem(opts = {}) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const R = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;
  const DS = THREE.DoubleSide, ADD = THREE.AdditiveBlending;
  // läget sätts varje bildruta i update()
  const trailV = new THREE.Vector3();            // extra fart bakåt för spår (bara när planet står still)
  let maxP = opts.maxParticles ?? 600, rateMul = opts.rate ?? 1;
  let exclude = null, excludeR2 = 0;             // inga partiklar inom denna radie (cockpit)

  /* ───────── texturer (ritas en gång och cachas) ───────── */
  function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function canvasTex(key, w, h, draw) {
    if (texCache.has(key)) return texCache.get(key);
    if (typeof document === 'undefined') return null;     // utan webbläsare (testerna i Node) ritas inga texturer
    const c = document.createElement('canvas'); c.width = Math.round(w * TEX_SCALE); c.height = Math.round(h * TEX_SCALE);
    const g = c.getContext('2d');
    g.scale(c.width / w, c.height / h);                    // ritkoden använder samma mått som förut
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    texCache.set(key, t); return t;
  }
  const wrapX = (w, x, fn) => { fn(x); fn(x - w); fn(x + w); };
  // pixelbaserad textur: fn(u, v) → [r, g, b] (u runt kroppen, v längs kroppen: 0 = stjärt, 1 = nos)
  function field(key, w, h, fn, after) {
    return canvasTex(key, w, h, (g) => {
      const W = g.canvas.width, Hh = g.canvas.height;
      const img = g.createImageData(W, Hh), d = img.data;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const c = fn(x / W, 1 - y / Hh), i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (after) after(g, w, h);
    });
  }
  const ramp = (stops, x) => {
    x = Math.min(1, Math.max(0, x));
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (x - a) / (b - a || 1);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
    return stops[stops.length - 1][1];
  };
  const hsl = (h, s, l) => { const c = new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l); return [c.r * 255, c.g * 255, c.b * 255]; };
  const S = Math.sin;
  function stars(g, w, h, n, seed, big = 0.04) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, s = r();
      g.fillStyle = `rgba(255,255,255,${0.35 + s * 0.65})`;
      g.fillRect(x, y, s > 0.9 ? 2 : 1, s > 0.9 ? 2 : 1);
      if (r() < big) { g.save(); g.shadowBlur = 8; g.shadowColor = '#ffffff'; g.fillRect(x - 3, y, 7, 1); g.fillRect(x, y - 3, 1, 7); g.restore(); }
    }
  }
  function walkLines(g, w, h, n, seed, style, steps = 14, len = 18) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      let x = r() * w, y = r() * h, a = r() * TAU;
      const pts = [[x, y]];
      for (let k = 0; k < steps; k++) { a += (r() - 0.5) * 1.6; x += Math.cos(a) * len * (0.5 + r()); y += Math.sin(a) * len * (0.5 + r()); pts.push([x, y]); }
      style.forEach(st => {
        g.save(); g.strokeStyle = st.c; g.lineWidth = st.w; g.shadowBlur = st.b || 0; g.shadowColor = st.c; g.lineJoin = 'round';
        wrapX(w, 0, dx => { g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(px + dx, py) : g.moveTo(px + dx, py)); g.stroke(); });
        g.restore();
      });
    }
  }
  const TX = {
    bands: (key, bg, list) => canvasTex(key, 512, 512, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      list.forEach(b => { g.fillStyle = b.c; if (b.u) g.fillRect(b.u[0] * w, 0, (b.u[1] - b.u[0]) * w, h); else g.fillRect(0, (1 - b.v[1]) * h, w, (b.v[1] - b.v[0]) * h); });
    }),
    camo: (key, cols) => canvasTex(key, 512, 512, (g, w, h) => {
      const r = rng(7); g.fillStyle = cols[0]; g.fillRect(0, 0, w, h);
      for (let l = 1; l < cols.length; l++) {
        g.fillStyle = cols[l];
        for (let i = 0; i < 55; i++) { const x = r() * w, y = r() * h, rx = 20 + r() * 55, ry = 12 + r() * 35, a = r() * 3; wrapX(w, x, xx => { g.beginPath(); g.ellipse(xx, y, rx, ry, a, 0, TAU); g.fill(); }); }
      }
    }),
    checker: (key, a, b, nx, ny) => canvasTex(key, 512, 512, (g, w, h) => {
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * w / nx, j * h / ny, w / nx + 1, h / ny + 1); }
    }),
    gradV: (key, stops) => canvasTex(key, 64, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0); stops.forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }),
    waves: (key, bg, fg, n, amp, width, seed) => canvasTex(key, 512, 512, (g, w, h) => {
      const r = rng(seed); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const y0 = (i + 0.5) / n * h + (r() - 0.5) * 8, k = 2 + ((r() * 2) | 0), ph = r() * TAU;
        g.lineWidth = width * (0.6 + r() * 0.8); g.beginPath();
        for (let x = 0; x <= w; x += 8) { const y = y0 + amp * S(x / w * TAU * k + ph); x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
    }),
    tiger: key => canvasTex(key, 512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff9a1f'); gr.addColorStop(1, '#e8730c');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = rng(31); g.fillStyle = '#1b120c';
      for (let i = 0; i < 46; i++) {
        const x = r() * w, y = r() * h, L = 50 + r() * 120, T = 6 + r() * 12, d = r() < 0.5 ? 1 : -1;
        wrapX(w, x, xx => { g.beginPath(); g.moveTo(xx, y - T / 2); g.quadraticCurveTo(xx + L * 0.5, y - T + d * 14, xx + L, y); g.quadraticCurveTo(xx + L * 0.5, y + T + d * 14, xx, y + T / 2); g.fill(); });
      }
    }),
    carbon: key => canvasTex(key, 512, 512, (g, w, h) => {
      const s = 16;
      for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) {
        const hz = (i + j) % 2, gr = hz ? g.createLinearGradient(i * s, 0, i * s + s, 0) : g.createLinearGradient(0, j * s, 0, j * s + s);
        gr.addColorStop(0, '#16171a'); gr.addColorStop(0.5, '#3a3d44'); gr.addColorStop(1, '#16171a');
        g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
      }
    }),
    grid: (key, top, bottom, line) => canvasTex(key, 512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = line; g.lineWidth = 2; g.shadowBlur = 10; g.shadowColor = line;
      for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); }
    }),
    hex: (key, bg, line, glow = 0) => canvasTex(key, 512, 512, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const r = w / 24, dx = 1.5 * r, dy = Math.sqrt(3) * r;
      g.strokeStyle = line; g.lineWidth = 2; g.shadowBlur = glow; g.shadowColor = line;
      for (let i = -1; i <= 17; i++) for (let j = -1; j <= h / dy + 1; j++) {
        const cx = i * dx, cy = j * dy + (i % 2 ? dy / 2 : 0);
        g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3; const px = cx + Math.cos(a) * r * 0.92, py = cy + Math.sin(a) * r * 0.92; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
      }
    }),
    galaxy: key => field(key, 256, 256, (u, v) => {
      const a = 0.5 + 0.5 * S(TAU * 2 * u + 6 * v + 2 * S(TAU * u + 3 * v));
      const b = 0.5 + 0.5 * S(TAU * 3 * u - 9 * v + 1.7);
      const c = 0.5 + 0.5 * S(TAU * u + 13 * v + 4 * S(TAU * 2 * u));
      const neb = Math.pow(a, 3), pink = Math.pow(b * c, 2.5);
      return [12 + 110 * neb + 200 * pink, 6 + 40 * neb + 50 * pink, 30 + 200 * neb + 140 * pink];
    }, (g, w, h) => stars(g, w, h, 520, 11, 0.06)),
    lava: key => canvasTex(key, 512, 512, (g, w, h) => {
      const r = rng(5); g.fillStyle = '#1c0f0a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) { const x = r() * w, y = r() * h, s = 10 + r() * 40; g.fillStyle = `rgba(${40 + r() * 30},${20 + r() * 15},${14},0.6)`; wrapX(w, x, xx => { g.beginPath(); g.arc(xx, y, s, 0, TAU); g.fill(); }); }
      walkLines(g, w, h, 26, 9, [{ c: '#ff4a0a', w: 5, b: 14 }, { c: '#ffc04a', w: 1.6 }]);
    }),
    scales: (key, base, dark, edge) => canvasTex(key, 512, 512, (g, w, h) => {
      const s = 32; g.fillStyle = dark; g.fillRect(0, 0, w, h);
      for (let r = 0; r < h / (s * 0.5) + 2; r++) for (let c = -1; c <= w / s; c++) {
        const x = c * s + (r % 2) * s / 2, y = r * s * 0.5 - s / 2;
        const gr = g.createRadialGradient(x, y + s * 0.15, 2, x, y, s * 0.6); gr.addColorStop(0, base); gr.addColorStop(1, dark);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, s / 2, 0, Math.PI); g.fill();
        g.strokeStyle = edge; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, s / 2 - 1, 0.15, Math.PI - 0.15); g.stroke();
      }
    }),
    lightning: key => canvasTex(key, 512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b1030'); gr.addColorStop(1, '#1d2556');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      walkLines(g, w, h, 14, 21, [{ c: '#6fb6ff', w: 4, b: 16 }, { c: '#ffffff', w: 1.4 }], 16, 16);
    }),
    aurora: key => field(key, 256, 256, (u, v) => {
      const a = 0.5 + 0.5 * S(TAU * 2 * u + 3 * S(TAU * u + v * 4));
      const b = 0.5 + 0.5 * S(TAU * 3 * u - v * 6 + 1.3);
      const cur = Math.pow(a, 4), pur = Math.pow(b, 6);
      return [4 + 60 * cur + 170 * pur, 18 + 235 * cur + 60 * pur, 30 + 150 * cur + 230 * pur];
    }, (g, w, h) => stars(g, w, h, 160, 3, 0)),
    plasma: key => field(key, 256, 256, (u, v) => {
      const n = (S(TAU * 3 * u + v * 9) + S(TAU * 2 * u - v * 13 + 2) + S(TAU * 5 * u + v * 5 + 2 * S(TAU * u))) / 3;
      return ramp([[0, [70, 0, 0]], [0.4, [220, 40, 0]], [0.7, [255, 150, 20]], [0.9, [255, 235, 150]], [1, [255, 255, 255]]], 0.5 + 0.5 * n);
    }),
    void: key => field(key, 256, 256, (u, v) => {
      const n = 0.5 + 0.5 * S(TAU * 2 * u + 14 * v + 2 * S(TAU * 3 * u + v * 5));
      return ramp([[0, [2, 0, 8]], [0.55, [40, 0, 80]], [0.8, [170, 50, 255]], [1, [255, 210, 255]]], Math.pow(n, 1.6));
    }, (g, w, h) => stars(g, w, h, 200, 17, 0.02)),
    irid: key => field(key, 256, 256, (u, v) => hsl(u * 2 + v * 1.3 + 0.08 * S(TAU * 3 * u), 0.65, 0.74)),
    ice: key => field(key, 256, 256, (u, v) => {
      const n = 0.5 + 0.5 * S(TAU * 3 * u + v * 11 + S(TAU * 2 * u) * 2);
      return ramp([[0, [110, 180, 225]], [1, [225, 248, 255]]], n);
    }, (g, w, h) => walkLines(g, w, h, 18, 4, [{ c: 'rgba(255,255,255,0.85)', w: 1.2, b: 4 }], 10, 10)),
    rainbow: key => field(key, 64, 256, (u, v) => hsl(v, 0.85, 0.55)),
    feathers: (key, c1, c2, c3) => canvasTex(key, 512, 512, (g, w, h) => {
      g.fillStyle = c2; g.fillRect(0, 0, w, h);
      for (let r = 0; r < h / 22 + 2; r++) for (let c = -1; c <= w / 32; c++) {
        const x = c * 32 + (r % 2) * 16, y = r * 22 - 10;
        const gr = g.createLinearGradient(x, y - 26, x, y + 26); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, 14, 28, 0, 0, TAU); g.fill();
        g.strokeStyle = c3; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y - 24); g.lineTo(x, y + 24); g.stroke();
      }
    }),
    shark: key => canvasTex(key, 512, 512, (g, w, h) => {
      for (let x = 0; x < w; x++) { const top = 0.5 + 0.5 * Math.cos(TAU * (x / w - 0.75)); const c = Math.round(238 - top * 150); g.fillStyle = `rgb(${c - 8},${c},${c + 10})`; g.fillRect(x, 0, 1, h); }
      const A = [0.11 * w, 0.1 * h], B = [0.39 * w, 0.1 * h], up = [0.25 * w, 0.17 * h], lo = [0.25 * w, 0.27 * h];
      g.fillStyle = '#4a0c10'; g.beginPath(); g.moveTo(...A); g.quadraticCurveTo(...lo, ...B); g.quadraticCurveTo(...up, ...A); g.fill();
      const q = (P0, C, P1, s) => [(1 - s) ** 2 * P0[0] + 2 * (1 - s) * s * C[0] + s * s * P1[0], (1 - s) ** 2 * P0[1] + 2 * (1 - s) * s * C[1] + s * s * P1[1]];
      g.fillStyle = '#ffffff';
      for (let i = 1; i < 14; i++) {
        const s = i / 14, [x1, y1] = q(A, up, B, s), [x2, y2] = q(A, lo, B, s);
        g.beginPath(); g.moveTo(x1 - 7, y1 - 1); g.lineTo(x1 + 7, y1 - 1); g.lineTo(x1, y1 + 13); g.fill();
        g.beginPath(); g.moveTo(x2 - 7, y2 + 1); g.lineTo(x2 + 7, y2 + 1); g.lineTo(x2, y2 - 12); g.fill();
      }
      [0.965, 0.535].forEach(u => { g.fillStyle = '#0b0b0e'; g.beginPath(); g.arc(u * w, 0.11 * h, 10, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(u * w + 3, 0.11 * h - 3, 3, 0, TAU); g.fill(); });
      g.strokeStyle = '#3a4048'; g.lineWidth = 3;
      [0.93, 0.57].forEach(u => { for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(u * w, (0.22 + k * 0.035) * h, 22, -0.9, 0.9); g.stroke(); } });
    }),
    police: key => canvasTex(key, 512, 512, (g, w, h) => {
      g.fillStyle = '#f7f8fa'; g.fillRect(0, 0, w, h);
      const y0 = (1 - 0.56) * h, hh = 0.14 * h, n = 16;
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#1c3f9e' : '#ffd400'; g.fillRect(i * w / n, y0 + j * hh / 2, w / n + 1, hh / 2 + 1); }
      g.fillStyle = '#1c3f9e'; g.fillRect(0, (1 - 0.3) * h, w, 0.05 * h);
    }),
    spots: key => canvasTex(key, 512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      [[0, '#0b1d3a'], [0.25, '#2b5c8a'], [0.5, '#0b1d3a'], [0.75, '#06122a'], [1, '#0b1d3a']].forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = rng(13); g.shadowBlur = 10; g.shadowColor = '#5ff4ff';
      for (let i = 0; i < 170; i++) { const x = r() * w, y = r() * h, s = 1.5 + r() * 5; g.fillStyle = r() < 0.8 ? '#7ff8ff' : '#c49bff'; wrapX(w, x, xx => { g.beginPath(); g.arc(xx, y, s, 0, TAU); g.fill(); }); }
    }),
    goldfil: key => canvasTex(key, 512, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      [[0, '#c9952d'], [0.25, '#ffe08a'], [0.5, '#c9952d'], [0.75, '#f5cf6a'], [1, '#c9952d']].forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(110,70,10,0.75)'; g.lineWidth = 2.2;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x = i * 64 + 32, y = j * 64 + 32;
        g.beginPath(); g.arc(x - 12, y, 12, Math.PI * 0.2, Math.PI * 1.7); g.stroke();
        g.beginPath(); g.arc(x + 12, y, 12, Math.PI * 1.2, Math.PI * 2.7); g.stroke();
        g.beginPath(); g.moveTo(x, y - 28); g.lineTo(x, y + 28); g.stroke();
      }
    }),
    disk: key => field(key, 256, 256, (u, v) => {
      const x = u * 2 - 1, y = v * 2 - 1, r = Math.hypot(x, y), a = Math.atan2(y, x);
      if (r < 0.3 || r > 1) return [0, 0, 0];
      const k = (r - 0.3) / 0.7, sw = 0.5 + 0.5 * S(a * 3 + r * 22);
      const fade = Math.pow(1 - k, 1.6) * (0.55 + 0.45 * sw);
      const c = ramp([[0, [255, 250, 230]], [0.3, [255, 190, 90]], [0.7, [230, 80, 30]], [1, [120, 20, 60]]], k);
      return [c[0] * fade, c[1] * fade, c[2] * fade];
    })
  };
  // sprite-texturer för partiklar
  const glowTex = canvasTex('p_glow', 64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const starTex = canvasTex('p_star', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 + 3, h / 2 - 3); g.lineTo(w, h / 2); g.lineTo(w / 2 + 3, h / 2 + 3); g.lineTo(w / 2, h); g.lineTo(w / 2 - 3, h / 2 + 3); g.lineTo(0, h / 2); g.lineTo(w / 2 - 3, h / 2 - 3); g.closePath(); g.fill();
  });

  /* ───────── partiklar (sprites) ───────── */
  const vfx = new THREE.Group(); vfx.name = 'skin_vfx';
  const P = [], free = [];
  function emit(o) {
    if (maxP <= 0) return;                         // inga partiklar (t.ex. planet som gör kortbilderna)
    if (exclude && o.pos.distanceToSquared(exclude) < excludeR2) return;
    while (P.length >= maxP) killP(0);
    let s = free.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      s.frustumCulled = false;
      vfx.add(s);
    }
    const mat = s.material;
    mat.map = o.tex || glowTex; mat.blending = o.add === false ? THREE.NormalBlending : ADD; mat.opacity = 0;
    mat.rotation = o.spin ? R(0, TAU) : 0;
    s.visible = true; s.position.copy(o.pos); s.scale.setScalar(o.size);
    const p = { s, v: o.vel ? o.vel.clone() : V(), age: 0, life: o.life, size: o.size, grow: o.grow || 0, grav: o.grav || 0, drag: o.drag || 0,
      c0: new THREE.Color(o.c0), c1: new THREE.Color(o.c1 ?? o.c0), op: o.op ?? 1, spin: o.spin || 0 };
    mat.color.copy(p.c0);
    P.push(p);
  }
  function killP(i) { const p = P[i]; p.s.visible = false; free.push(p.s); P.splice(i, 1); }
  function updateP(dt) {
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt;
      if (p.age >= p.life) { killP(i); continue; }
      const k = p.age / p.life;
      p.v.y -= p.grav * dt; if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(Math.max(0.001, p.size + p.grow * p.age));
      p.s.material.color.copy(p.c0).lerp(p.c1, k);
      p.s.material.opacity = p.op * (k < 0.12 ? k / 0.12 : 1) * Math.pow(1 - k, 1.2);
      if (p.spin) p.s.material.rotation += p.spin * dt;
    }
  }
  function clearP() { while (P.length) killP(0); ribbons.forEach((r) => { r.pts.length = 0; }); }

  /* ───────── ljusband: mjuka, sammanhängande spår (Legendary och Ultra) ───────── */
  const RIB_N = 46;
  let ribbons = [];
  function makeRibbon(color, width, intensity) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(RIB_N * 6), col = new Float32Array(RIB_N * 6), idx = [];
    for (let i = 0; i < RIB_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: ADD, depthWrite: false, side: DS, toneMapped: false }));
    mesh.frustumCulled = false; mesh.name = 'ljusband';
    vfx.add(mesh);
    return { mesh, pts: [], color: new THREE.Color(color), width, intensity };
  }
  function clearRibbons() { ribbons.forEach((r) => { vfx.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }); ribbons = []; }
  const _side = V(), _a = V();
  function updateRibbons(c, dt, alive) {
    const LIFE = 0.5;
    for (const r of ribbons) {
      // äldre punkter åldras (och dras bakåt när planet står still i shopen)
      for (const q of r.pts) { q.age += dt; q.p.addScaledVector(trailV, dt); }
      while (r.pts.length && r.pts[r.pts.length - 1].age > LIFE) r.pts.pop();
      if (alive && c) {
        _a.set(...r.at); c.plane.localToWorld(_a);
        _side.set(0, 0, 1).applyQuaternion(c.wq).multiplyScalar(r.width * 0.5 * (c.scale || 1));
        const head = r.pts[0];
        if (!head || head.p.distanceToSquared(_a) > 0.04 || head.age > 0.03) {
          r.pts.unshift({ p: _a.clone(), s: _side.clone(), age: 0 });
          if (r.pts.length > RIB_N) r.pts.length = RIB_N;
        } else { head.p.copy(_a); head.s.copy(_side); }
      }
      const pa = r.mesh.geometry.attributes.position.array, ca = r.mesh.geometry.attributes.color.array;
      const n = r.pts.length;
      for (let i = 0; i < RIB_N; i++) {
        const q = r.pts[Math.min(i, n - 1)];
        const j = i * 6;
        if (!q || i >= n) { pa.fill(0, j, j + 6); ca.fill(0, j, j + 6); continue; }
        const k = n > 1 ? i / (n - 1) : 0;
        const fade = Math.pow(1 - k, 1.4) * Math.max(0, 1 - q.age / LIFE) * r.intensity;
        const wk = 1 - k * 0.65;                         // smalnar av bakåt
        pa[j] = q.p.x + q.s.x * wk; pa[j + 1] = q.p.y + q.s.y * wk; pa[j + 2] = q.p.z + q.s.z * wk;
        pa[j + 3] = q.p.x - q.s.x * wk; pa[j + 4] = q.p.y - q.s.y * wk; pa[j + 5] = q.p.z - q.s.z * wk;
        ca[j] = ca[j + 3] = r.color.r * fade; ca[j + 1] = ca[j + 4] = r.color.g * fade; ca[j + 2] = ca[j + 5] = r.color.b * fade;
      }
      r.mesh.geometry.attributes.position.needsUpdate = true;
      r.mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  /* ───────── samma storlek som standardplanet ───────── */
  // planets utbredning i planets egna koordinater (bara det som syns; ljusstrålar, glorior och partiklar räknas inte)
  const SKIP = new Set(['dragstrale', 'jet', 'warpring', 'strale', 'korona', 'halo']);
  function measure(plane) {
    plane.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(plane.matrixWorld).invert();
    const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
    plane.traverse((o) => {
      if (!o.isMesh || !o.geometry || SKIP.has(o.name)) return;
      for (let q = o; q && q !== plane; q = q.parent) if (!q.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      m.multiplyMatrices(inv, o.matrixWorld);
      tmp.copy(o.geometry.boundingBox).applyMatrix4(m);
      box.union(tmp);
    });
    return box;
  }
  // hur långt ut från planets mitt (sett ovanifrån) något når – samma oavsett hur delarna snurrar eller kretsar
  const _c = V(), _m = new THREE.Matrix4();
  function reach(plane) {
    plane.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(plane.matrixWorld).invert();
    let R = 0;
    plane.traverse((o) => {
      if (!o.isMesh || !o.geometry || SKIP.has(o.name)) return;
      for (let q = o; q && q !== plane; q = q.parent) if (!q.visible) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      _m.multiplyMatrices(inv, o.matrixWorld);
      _c.copy(bs.center).applyMatrix4(_m);
      R = Math.max(R, Math.hypot(_c.x, _c.z) + bs.radius * _m.getMaxScaleOnAxis());
    });
    return R;
  }

  /* ───────── byggstenar ───────── */
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0, ...o });
  const glowM = (c, i = 1.6, o = {}) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.3, ...o });
  const addM = (c, op = 0.6) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: ADD, depthWrite: false, side: DS });
  const glassM = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.6 });
  function add(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale, name) {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.name = name || 'skin_del'; parent.add(m); return m;
  }
  function bone(parent, a, b, r0, r1, mat, name) {
    const A = V(...a), B = V(...b), d = B.clone().sub(A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 8), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    m.name = name || 'skin_ben'; parent.add(m); return m;
  }
  // platt vinge/fena: punkter [x, z] (sd speglar till vänster sida)
  function flatWing(pts, depth, sd = 1) {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * sd)));
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 2 });
    geo.rotateX(Math.PI / 2); geo.translate(0, depth / 2, 0); return geo;
  }
  // stående fena: punkter [x, y]
  function finGeo(pts, depth) {
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 2 });
    geo.translate(0, 0, -depth / 2); return geo;
  }
  // drakvinge som pekar ut längs +z (byggs en gång, speglas för vänster sida)
  function dragonWing(mem, boneM, s = 1) {
    const g = new THREE.Group(); g.name = 'drakvinge';
    const tips = [[0.4, 7.4], [-1.0, 6.3], [-2.0, 4.5], [-2.3, 2.3]], J = [0.9, 3.0];
    const sh = new THREE.Shape(); sh.moveTo(1.1, 0);
    sh.quadraticCurveTo(1.9, 1.6, J[0] + 0.25, J[1]); sh.quadraticCurveTo(1.1, 5.4, tips[0][0], tips[0][1]);
    const pts = tips.concat([[-1.5, 0]]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, k = 0.74;
      sh.quadraticCurveTo(J[0] + (mx - J[0]) * k, J[1] + (mz - J[1]) * k, b[0], b[1]);
    }
    sh.lineTo(1.1, 0);
    const geo = new THREE.ShapeGeometry(sh, 14); geo.rotateX(Math.PI / 2);
    add(g, geo, mem, [0, 0, 0], [0, 0, 0], null, 'drakvinge_hinna');
    bone(g, [0.6, 0, 0.1], [J[0], 0.05, J[1]], 0.16, 0.11, boneM);
    tips.forEach(tp => bone(g, [J[0], 0.05, J[1]], [tp[0], 0.02, tp[1]], 0.08, 0.025, boneM));
    add(g, new THREE.ConeGeometry(0.1, 0.45, 6), boneM, [J[0] + 0.3, 0.1, J[1]], [0, 0, -Math.PI / 2], null, 'drakklo');
    g.scale.setScalar(s); return g;
  }
  // fjädervinge som pekar ut längs +z
  function featherWing(mA, mB, n = 12, span = 6.6, len0 = 1.6) {
    const g = new THREE.Group(); g.name = 'fjadervinge';
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), L = len0 + f * 1.8;
      const geo = new THREE.BoxGeometry(L, 0.05, 0.52 - f * 0.12); geo.translate(-L / 2, 0, 0);
      const m = add(g, geo, i % 2 ? mA : mB, [0.9 - f * 1.1, f * 0.25, 0.5 + f * (span - 0.5)], [-0.05, f * 0.55, 0], null, 'fjader_' + i);
      m.userData.f = f;
    }
    for (let i = 0; i < n - 3; i++) {
      const f = i / (n - 4), L = 0.9 + f * 0.5;
      const geo = new THREE.BoxGeometry(L, 0.05, 0.55); geo.translate(-L / 2, 0, 0);
      add(g, geo, i % 2 ? mB : mA, [1.15 - f * 0.9, 0.06 + f * 0.25, 0.4 + f * span * 0.8], [0, f * 0.4, 0], null, 'tackfjader_' + i);
    }
    return g;
  }
  // höger + vänster exemplar runt ett gångjärn. flap() lyfter båda uppåt.
  function pair(plane, make, pos, name) {
    return [1, -1].map(sd => {
      const pv = new THREE.Group(); pv.name = `${name}_${sd > 0 ? 'h' : 'v'}`;
      pv.position.set(pos[0], pos[1], pos[2] * sd); pv.userData.side = sd;
      const w = make(sd); if (sd < 0) w.scale.z *= -1; pv.add(w); plane.add(pv); return pv;
    });
  }
  const flap = (pvs, a) => pvs.forEach(p => { p.rotation.x = -p.userData.side * a; });
  // överkantens höjd på flygkroppen (för taggar längs ryggen)
  const topY = x => { let r = 1; if (x > 3) r = Math.max(0.2, 1 - (x - 3) * 0.28); else if (x < -2) r = Math.max(0.45, 1 - (-2 - x) * 0.17); return r + (x < -1.5 ? 0.035 * (-1.5 - x) ** 2 : 0); };
  function arcLine(color, n = 12, op = 0.95) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, blending: ADD, depthWrite: false }));
    l.frustumCulled = false; l.name = 'blixtbage'; return l;
  }
  function setArc(line, a, b, jag) {
    const p = line.geometry.attributes.position, n = p.count;
    for (let i = 0; i < n; i++) { const f = i / (n - 1), j = (i === 0 || i === n - 1) ? 0 : jag * Math.sin(f * Math.PI); p.setXYZ(i, a.x + (b.x - a.x) * f + R(-j, j), a.y + (b.y - a.y) * f + R(-j, j), a.z + (b.z - a.z) * f + R(-j, j)); }
    p.needsUpdate = true;
  }
  const H = { std, glowM, addM, glassM, add, bone, flatWing, finGeo, dragonWing, featherWing, pair, flap, topY, arcLine, setArc, TX };

  /* ───────── punkter på originalplanet (lokala koordinater) ───────── */
  const BODY = [[-4.5, 0.75, 0], [-3, 0.95, 0], [-1.5, 1, 0], [0, 1, 0], [1.5, 1, 0], [3, 0.95, 0], [4.5, 0.7, 0], [0, 0, 1], [0, 0, -1], [2, 0, 1], [2, 0, -1], [-2, 0, 1], [-2, 0, -1],
    [0.3, -0.35, 2.5], [0.3, -0.3, -2.5], [0.2, -0.2, 4.5], [0.2, -0.2, -4.5], [0, -0.1, 6.4], [0, -0.1, -6.4]];
  const TIPS = [[-0.1, -0.05, 6.6], [-0.1, -0.05, -6.6]];
  const ENG = [[-0.45, -0.25, 2.5], [-0.45, -0.25, -2.5]];
  const TAIL = [[-6.2, 0.75, 0]];
  const NOSE = [[6.2, 0, 0]];
  const EDGE = []; for (let z = 1.2; z <= 6.5; z += 0.6) [1, -1].forEach(s => EDGE.push([-0.6 + z / 6.6 * 0.65, -0.45 + z * 0.06, z * s]));
  const hue = (sp, s = 1, l = 0.6, jit = 0.12) => t => new THREE.Color().setHSL(((t * sp + Math.random() * jit) % 1 + 1) % 1, s, l);

  /* ───────── skins ───────── */
  const p = (c, o = {}) => ({ c, ...o });
  const SKINS = [];
  const def = (rarity, id, name, desc, swatch, o) => SKINS.push({ rarity, id, name, desc, swatch, ...o });

  // ── COMMON: färg och mönster ──
  def('common', 'klassisk-rod', 'Klassisk röd', 'Röd kropp med vita vingar.', ['#c62828', '#f4f3f0'], { paint: { body: p('#c62828'), wing: p('#f4f3f0'), tail: p('#c62828'), tip: p('#f4f3f0') } });
  def('common', 'himmelsbla', 'Himmelsblå', 'Ljusblå med vit rand längs ryggen.', ['#5aa9e6', '#ffffff'], { paint: { body: p('#ffffff', { map: () => TX.bands('t_himmel', '#5aa9e6', [{ u: [0.71, 0.79], c: '#ffffff' }, { u: [0.9, 0.97], c: '#1f4e8c' }, { u: [0.53, 0.6], c: '#1f4e8c' }]) }), wing: p('#e9f4fb'), tail: p('#5aa9e6'), tip: p('#1f4e8c') } });
  def('common', 'kamouflage', 'Kamouflage', 'Militärt grönt kamouflage.', ['#4b5d3a', '#6b7b46', '#2f3a26'], { paint: { body: p('#ffffff', { r: 0.8, map: () => TX.camo('t_camo', ['#4b5d3a', '#6b7b46', '#2f3a26', '#8a8a5c']) }), tip: p('#2f3a26'), ring: p('#2f3a26') } });
  def('common', 'rutig-racer', 'Rutig racer', 'Gul racer med rutflagga på vingarna.', ['#f2c230', '#111111', '#ffffff'], { paint: { body: p('#f2c230', { r: 0.3 }), wing: p('#ffffff', { map: () => TX.checker('t_rutor', '#111111', '#ffffff', 8, 8) }), tail: p('#ffffff', { map: () => TX.checker('t_rutor', '#111111', '#ffffff', 8, 8) }), tip: p('#111111'), ring: p('#111111') } });
  def('common', 'solnedgang', 'Solnedgång', 'Tonar från rött till gult.', ['#ff4e50', '#fc913a', '#f9d423'], { paint: { body: p('#ffffff', { map: () => TX.gradV('t_sol', [[0, '#ff4e50'], [0.5, '#fc913a'], [1, '#f9d423']]) }), wing: p('#fc913a'), tail: p('#ff4e50'), tip: p('#f9d423') } });
  def('common', 'polis', 'Polis', 'Vit med blågul rutad rand.', ['#f7f8fa', '#1c3f9e', '#ffd400'], { paint: { body: p('#ffffff', { map: () => TX.police('t_polis') }), wing: p('#f7f8fa'), tail: p('#1c3f9e'), tip: p('#ffd400') } });
  def('common', 'mintglass', 'Mintglass', 'Pastellgrön med rosa detaljer.', ['#9fe3c9', '#f6fffb', '#ff8fab'], { paint: { body: p('#9fe3c9', { r: 0.35 }), wing: p('#f6fffb'), tail: p('#9fe3c9'), tip: p('#ff8fab'), ring: p('#ff8fab') } });
  def('common', 'svart-matt', 'Svart matt', 'Mattsvart med orange accenter.', ['#1f2023', '#ff7a1a'], { paint: { body: p('#1f2023', { r: 0.9 }), tip: p('#ff7a1a'), ring: p('#ff7a1a'), spinner: p('#ff7a1a') } });
  def('common', 'zebra', 'Zebra', 'Svartvita zebraränder.', ['#ffffff', '#111111'], { paint: { body: p('#ffffff', { map: () => TX.waves('t_zebra', '#f5f5f2', '#121212', 18, 9, 11, 3) }), tip: p('#121212'), ring: p('#121212') } });
  def('common', 'retropost', 'Retropost', 'Postgul med blå fönsterlinje.', ['#f5c400', '#1b4fa0'], { paint: { body: p('#ffffff', { map: () => TX.bands('t_post', '#f5c400', [{ u: [0.9, 0.99], c: '#1b4fa0' }, { u: [0.51, 0.6], c: '#1b4fa0' }]) }), wing: p('#f5c400'), tail: p('#1b4fa0'), tip: p('#1b4fa0') } });

  // ── EPIC: metall, glöd och lätta effekter ──
  const trail = (at, c0, c1, o = {}) => ({ at, rate: 40, idle: 0.15, life: [0.4, 0.75], size: [0.25, 0.42], grow: 0.6, c0, c1, op: 0.9, ...o });
  const glint = (c, o = {}) => ({ at: BODY, rate: 7, idle: 0.8, life: [0.3, 0.6], size: [0.6, 1.0], c0: c, tex: 'star', trail: false, vspread: 0.05, ...o });
  def('epic', 'neon-natt', 'Neon natt', 'Mörk kropp med lysande cyan nät och neonspår.', ['#14161f', '#36f1ff', '#1a4cff'], {
    paint: { body: p('#ffffff', { map: () => TX.hex('t_neon', '#101219', '#36f1ff', 8), e: '#ffffff', ei: 1, emap: true, m: 0.3 }), tip: p('#36f1ff', { e: '#36f1ff', ei: 2 }), ring: p('#36f1ff', { e: '#36f1ff', ei: 2 }) },
    fx: [trail(TIPS, '#36f1ff', '#1a4cff'), trail(ENG, '#9ffcff', '#1a4cff', { rate: 25, size: [0.3, 0.5] })]
  });
  def('epic', 'krom', 'Krom', 'Spegelblank krom som glittrar.', ['#e7ebf0', '#9fb4c8', '#ffffff'], {
    paint: { body: p('#eef2f6', { m: 0.4, r: 0.12 }), tip: p('#9fb4c8', { m: 0.4, r: 0.1 }), ring: p('#9fb4c8', { m: 0.4 }) }, fx: [glint('#ffffff', { rate: 10 })]
  });
  def('epic', 'guldrush', 'Guldrush', 'Blankt guld med glitterspår.', ['#e2b13c', '#fff1b8'], {
    paint: { body: p('#e2b13c', { m: 0.4, r: 0.2 }), tip: p('#fff1b8', { e: '#ffd76a', ei: 1.2 }), ring: p('#fff1b8', { e: '#ffd76a', ei: 1.2 }) },
    fx: [trail(TIPS.concat(TAIL), '#ffe27a', '#b67a12', { tex: 'star', size: [0.35, 0.6], grow: 0 }), glint('#fff6c8')]
  });
  def('epic', 'hajtand', 'Hajtand', 'Hajmun med tänder på nosen.', ['#8a96a2', '#ffffff', '#4a0c10'], {
    paint: { body: p('#ffffff', { map: () => TX.shark('t_haj') }), wing: p('#6d7b86'), tail: p('#6d7b86'), tip: p('#3a4048') },
    fx: [{ at: TIPS.concat(ENG), rate: 22, idle: 0.1, life: [0.6, 1.1], size: [0.15, 0.3], grow: 0.4, c0: '#e6f7ff', c1: '#9fd6ff', op: 0.7, add: false, grav: -1 }]
  });
  def('epic', 'tiger', 'Tiger', 'Tigerränder och glödande spår.', ['#ff9a1f', '#1b120c'], {
    paint: { body: p('#ffffff', { map: () => TX.tiger('t_tiger') }), tip: p('#1b120c'), ring: p('#1b120c') },
    fx: [trail(ENG.concat(TIPS), '#ffb347', '#c2410c', { size: [0.18, 0.3] })]
  });
  def('epic', 'iskristall', 'Iskristall', 'Isblå kristall med snöglitter.', ['#bfe8ff', '#6fb4e6', '#ffffff'], {
    paint: { body: p('#ffffff', { map: () => TX.ice('t_is'), e: '#9fe8ff', ei: 0.25, emap: true, r: 0.15, m: 0.2 }), tip: p('#e9fbff', { e: '#9fe8ff', ei: 1.3 }), ring: p('#e9fbff', { e: '#9fe8ff', ei: 1.3 }) },
    fx: [trail(TIPS.concat(TAIL), '#ffffff', '#9fe8ff', { tex: 'star', size: [0.3, 0.5], grow: 0, rate: 30 }), glint('#e9fbff')]
  });
  def('epic', 'lavasten', 'Lavasten', 'Svart sten med glödande sprickor.', ['#1c0f0a', '#ff4a0a', '#ffc04a'], {
    paint: { body: p('#ffffff', { map: () => TX.lava('t_lava'), e: '#ffffff', ei: 1.2, emap: true, r: 0.85 }), tip: p('#ff6a1a', { e: '#ff4a0a', ei: 1.5 }), ring: p('#ff6a1a', { e: '#ff4a0a', ei: 1.5 }) },
    fx: [{ at: BODY, rate: 18, idle: 0.6, life: [0.8, 1.5], size: [0.1, 0.2], c0: '#ffc04a', c1: '#ff3a0a', grav: -2, vspread: 0.6 }]
  });
  def('epic', 'synthwave', 'Synthwave', '80-talsrutnät i lila och rosa.', ['#2b0b4a', '#ff3fa4', '#36f1ff'], {
    paint: { body: p('#ffffff', { map: () => TX.grid('t_synth', '#ff3fa4', '#2b0b4a', '#36f1ff'), e: '#ffffff', ei: 0.8, emap: true }), tip: p('#ff3fa4', { e: '#ff3fa4', ei: 2 }), ring: p('#36f1ff', { e: '#36f1ff', ei: 2 }) },
    fx: [trail([TIPS[0]], '#ff3fa4', '#7a1fff'), trail([TIPS[1]], '#36f1ff', '#7a1fff')]
  });
  def('epic', 'kolfiber', 'Kolfiber', 'Vävd kolfiber med röda glödringar.', ['#2a2c31', '#16171a', '#ff2a2a'], {
    paint: { body: p('#ffffff', { map: () => TX.carbon('t_kol'), r: 0.35, m: 0.3 }), tip: p('#ff2a2a', { e: '#ff2a2a', ei: 1.8 }), ring: p('#ff2a2a', { e: '#ff2a2a', ei: 2.2 }), spinner: p('#ff2a2a', { e: '#ff2a2a', ei: 1.4 }) },
    fx: [trail(ENG, '#ff6a5a', '#7a0000', { rate: 30, size: [0.35, 0.55] })]
  });
  def('epic', 'regnbage', 'Regnbåge', 'Alla färger och ett regnbågsspår.', ['#ff4e50', '#f9d423', '#3bd16f', '#36a3ff', '#a24bff'], {
    paint: { body: p('#ffffff', { map: () => TX.rainbow('t_regnbage') }), wing: p('#ffffff'), tip: p('#ffffff') },
    fx: [trail(TIPS.concat(TAIL), hue(0.4, 1, 0.6), null, { rate: 55 })]
  });
  SKINS.filter(s => s.rarity === 'epic').forEach(s => s.fx.forEach(e => { if (e.c1 == null) e.c1 = e.c0; }));

  // ── LEGENDARY ──
  const dragonFace = (c, eyeColor, hornColor) => {
    const pl = c.plane;
    c.ex.eyes = [1, -1].map(sd => add(pl, new THREE.SphereGeometry(0.11, 12, 10), glowM(eyeColor, 3), [5.12, 0.33, 0.6 * sd], [0, 0, 0], null, 'drakoga'));
    const horn = std(hornColor, { roughness: 0.5 });
    [1, -1].forEach(sd => add(pl, new THREE.ConeGeometry(0.16, 0.95, 10), horn, [3.9, 0.85, 0.32 * sd], [sd * 0.3, 0, 1.0], null, 'drakhorn'));
    const spikeM = std('#2a0907', { roughness: 0.6 });
    for (let x = -4; x <= 2.5; x += 0.8) add(pl, new THREE.ConeGeometry(0.14, 0.42, 6), spikeM, [x, topY(x) + 0.12, 0], [0, 0, 0.35], null, 'ryggtagg');
    c.ex.mouth = new THREE.Object3D(); c.ex.mouth.position.set(6.25, -0.1, 0); pl.add(c.ex.mouth);
  };
  const breathe = (c, dt, opts) => {
    c.br = (c.br ?? R(1.5, 3)) - dt;
    if (c.br < 0) { c.br = R(2.8, 4.2); c.breathT = 1.1; }
    if (c.breathT > 0) {
      c.breathT -= dt;
      for (let i = 0; i < 3; i++) c.emitLocal(c.ex.mouth.position, [R(10, 16), R(-1.2, 0.6), R(-1.2, 1.2)], opts);
    }
  };
  def('legendary', 'galax', 'Galax', 'Levande rymdtapet med stjärnor, nebulosaspår och två månar.', ['#0c0620', '#7a4dff', '#ff4fd8', '#7fd4ff'], {
    paint: { body: p('#ffffff', { map: () => TX.galaxy('t_galax'), e: '#ffffff', ei: 0.95, emap: true }), tip: p('#c8a2ff', { e: '#c8a2ff', ei: 2 }), ring: p('#7fd4ff', { e: '#7fd4ff', ei: 2 }), spinner: p('#c8a2ff', { e: '#c8a2ff', ei: 1.5 }) },
    build(c) {
      const orbit = new THREE.Group(); orbit.name = 'manbana'; c.plane.add(orbit); c.ex.orbit = orbit;
      add(orbit, new THREE.SphereGeometry(0.38, 20, 14), glowM('#bfe3ff', 1.6), [0, 1.2, 8], [0, 0, 0], null, 'mane');
      add(orbit, new THREE.SphereGeometry(0.24, 16, 12), glowM('#ff9ff0', 1.8), [0, -0.8, -7], [0, 0, 0], null, 'mane');
    },
    anim(c, dt, t, fly) {
      c.ex.orbit.rotation.y += dt * (fly ? 1.4 : 0.6); c.ex.orbit.rotation.z = Math.sin(t * 0.5) * 0.3;
      c.scroll(dt * 0.015, dt * 0.004); c.glow(0.85 + 0.25 * Math.sin(t * 2.2));
    },
    fx: [{ at: TAIL.concat(TIPS, ENG), rate: 60, idle: 0.25, life: [0.8, 1.4], size: [0.5, 0.9], grow: 1.1, c0: '#7a4dff', c1: '#ff4fd8', op: 0.7 },
      { at: BODY, rate: 16, idle: 0.8, life: [0.4, 0.9], size: [0.5, 0.9], c0: '#ffffff', tex: 'star', vspread: 0.15 }]
  });
  def('legendary', 'drakeld', 'Drakeld', 'Drakfjäll, flaxande drakvingar, horn och eldsprut.', ['#8e1b12', '#ff6a2a', '#2a0907', '#ffd21a'], {
    paint: { body: p('#ffffff', { map: () => TX.scales('t_drake_rod', '#c2321c', '#3a0907', '#ff6a2a'), e: '#ff3b1a', ei: 0.35, emap: true, r: 0.55 }) },
    hide: ['wing', 'tip', 'engine', 'ring', 'spinner', 'blade'], hideProps: true,
    build(c) {
      const mem = std('#b3261e', { side: DS, emissive: '#ff3b1a', emissiveIntensity: 0.3, roughness: 0.7, transparent: true, opacity: 0.93 });
      c.ex.wings = pair(c.plane, () => dragonWing(mem, std('#3a0d0a', { roughness: 0.6 }), 1), [0.2, 0.15, 0.85], 'drakvinge');
      dragonFace(c, '#ffd21a', '#e8dcc0');
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.1 + (fly ? 0.5 : 0.25) * Math.sin(t * (fly ? 5 : 2.4)));
      c.ex.eyes.forEach(e => e.material.emissiveIntensity = 2.5 + Math.sin(t * 6) * 0.8 + (c.breathT > 0 ? 3 : 0));
      breathe(c, dt, { life: [0.35, 0.7], size: [0.4, 0.7], grow: 2.4, c0: '#ffe08a', c1: '#d22a0a', drag: 1.4 });
    },
    fx: [{ at: TAIL, rate: 45, idle: 0.4, life: [0.5, 0.9], size: [0.5, 0.8], grow: 1.4, c0: '#ffb347', c1: '#b3200a' },
      { at: BODY, rate: 14, idle: 0.7, life: [0.8, 1.6], size: [0.1, 0.18], c0: '#ffc04a', c1: '#ff3a0a', grav: -2, vspread: 0.6 }]
  });
  def('legendary', 'fenix', 'Fenix', 'Flammande fjädervingar och en svans av eld.', ['#ff8a1a', '#ffd23a', '#c2410c'], {
    paint: { body: p('#ffffff', { map: () => TX.feathers('t_fenix', '#ffd23a', '#e2550c', '#7a1f05'), e: '#ff7a10', ei: 0.45, emap: true }), tail: p('#ff8a1a', { e: '#ff5a00', ei: 0.8 }) },
    hide: ['wing', 'tip', 'engine', 'ring', 'spinner', 'blade'], hideProps: true,
    build(c) {
      const mA = std('#ff8a1a', { emissive: '#ff5a00', emissiveIntensity: 0.9 }), mB = std('#ffd23a', { emissive: '#ffb000', emissiveIntensity: 0.8 });
      c.ex.fm = [mA, mB];
      c.ex.wings = pair(c.plane, () => featherWing(mA, mB, 12, 6.8), [0.4, -0.2, 0.8], 'fenixvinge');
      const tailG = new THREE.Group(); tailG.name = 'fenixstjart'; tailG.position.set(-6, 0.75, 0); c.plane.add(tailG); c.ex.tail = tailG;
      for (let i = 0; i < 5; i++) { const geo = new THREE.BoxGeometry(2.6, 0.05, 0.32); geo.translate(-1.3, 0, 0); add(tailG, geo, i % 2 ? mA : mB, [0, 0, 0], [0, (i - 2) * 0.22, 0.12], null, 'stjartfjader'); }
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.08 + (fly ? 0.3 : 0.16) * Math.sin(t * (fly ? 3.6 : 2)));
      c.ex.fm[0].emissiveIntensity = 0.8 + 0.3 * Math.sin(t * 9); c.ex.fm[1].emissiveIntensity = 0.75 + 0.3 * Math.sin(t * 7 + 1);
      c.ex.tail.rotation.z = Math.sin(t * 3) * 0.12; c.ex.tail.rotation.y = Math.sin(t * 2) * 0.1;
    },
    fx: [{ at: [[-8.4, 0.9, 0], [-6.5, 0.8, 0]], rate: 70, idle: 0.4, life: [0.5, 1.0], size: [0.6, 1.0], grow: 1.6, c0: '#ffe08a', c1: '#d22a0a' },
      { at: [[-1.5, 0.2, 3], [-2, 0.4, 5], [-2.4, 0.5, 7], [-1.5, 0.2, -3], [-2, 0.4, -5], [-2.4, 0.5, -7]], rate: 50, idle: 0.35, life: [0.35, 0.7], size: [0.35, 0.6], grow: 1, c0: '#ffd23a', c1: '#ff3a0a' },
      { at: BODY, rate: 12, idle: 0.6, life: [0.8, 1.6], size: [0.1, 0.2], c0: '#fff0a0', c1: '#ff5a00', grav: -2, vspread: 0.7 }]
  });
  def('legendary', 'isdrake', 'Isdrake', 'Isfjäll, frostiga drakvingar och isande andedräkt.', ['#2b6f9e', '#bff4ff', '#e9fbff'], {
    paint: { body: p('#ffffff', { map: () => TX.scales('t_drake_is', '#6fc7f0', '#123a5a', '#d6fbff'), e: '#7fe7ff', ei: 0.3, emap: true, r: 0.3, m: 0.2 }) },
    hide: ['wing', 'tip', 'engine', 'ring', 'spinner', 'blade'], hideProps: true,
    build(c) {
      const mem = std('#9fe8ff', { side: DS, emissive: '#5fd0ff', emissiveIntensity: 0.45, roughness: 0.15, transparent: true, opacity: 0.6, depthWrite: false });
      c.ex.wings = pair(c.plane, () => dragonWing(mem, std('#e9fbff', { roughness: 0.25, emissive: '#bff4ff', emissiveIntensity: 0.3 }), 1), [0.2, 0.15, 0.85], 'isvinge');
      dragonFace(c, '#7ff8ff', '#f4fbff');
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.1 + (fly ? 0.45 : 0.22) * Math.sin(t * (fly ? 4.5 : 2.2)));
      c.ex.eyes.forEach(e => e.material.emissiveIntensity = 2.5 + Math.sin(t * 5) * 0.8 + (c.breathT > 0 ? 3 : 0));
      breathe(c, dt, { life: [0.4, 0.8], size: [0.35, 0.6], grow: 2, c0: '#ffffff', c1: '#5fd0ff', drag: 1.3 });
    },
    fx: [{ at: TAIL.concat([[-1, 0.4, 6.5], [-1, 0.4, -6.5]]), rate: 45, idle: 0.35, life: [0.6, 1.1], size: [0.35, 0.6], grow: 0.9, c0: '#e9fbff', c1: '#5fd0ff' },
      { at: BODY, rate: 14, idle: 0.8, life: [0.5, 1.0], size: [0.4, 0.7], c0: '#ffffff', tex: 'star', vspread: 0.2 }]
  });
  def('legendary', 'askstorm', 'Åskstorm', 'Blixtar som slår mellan vingspetsarna och fenan.', ['#0b1030', '#6fb6ff', '#ffffff'], {
    paint: { body: p('#ffffff', { map: () => TX.lightning('t_blixt'), e: '#ffffff', ei: 0.9, emap: true, m: 0.2 }), tip: p('#cfe8ff', { e: '#9fd0ff', ei: 2.5 }), ring: p('#cfe8ff', { e: '#9fd0ff', ei: 2.5 }) },
    build(c) {
      c.ex.arcs = [arcLine('#cfe8ff', 14), arcLine('#cfe8ff', 14), arcLine('#9fd0ff', 12)];
      c.ex.arcs.forEach(l => c.plane.add(l));
      c.ex.ends = [[V(-0.1, -0.05, 6.6), V(-5.9, 2.7, 0)], [V(-0.1, -0.05, -6.6), V(-5.9, 2.7, 0)], [V(-0.4, -0.25, 2.5), V(-0.4, -0.25, -2.5)]];
    },
    anim(c, dt, t) {
      c.arcT = (c.arcT ?? 0) - dt;
      if (c.arcT < 0) {
        c.arcT = R(0.05, 0.09);
        c.ex.arcs.forEach((l, i) => { l.visible = Math.random() < 0.7; if (l.visible) { const [a, b] = c.ex.ends[i]; setArc(l, a, b, 0.55); for (let k = 0; k < 2; k++) c.emitLocal(a.clone().lerp(b, Math.random()), [0, 0, 0], { life: [0.15, 0.3], size: [0.4, 0.7], c0: '#e6f3ff', tex: 'star' }); } });
        c.glow(Math.random() < 0.12 ? 2.4 : 0.8);
        if (Math.random() < 0.1) c.scroll(Math.random(), 0);
      }
    },
    fx: [trail(TIPS.concat(TAIL), '#cfe8ff', '#3b6bff', { rate: 45 }), { at: BODY, rate: 18, idle: 0.8, life: [0.15, 0.35], size: [0.5, 0.8], c0: '#ffffff', tex: 'star', trail: false }]
  });
  def('legendary', 'nordljus', 'Nordljus', 'Rörliga norrsken på kroppen och ett band av ljus efter planet.', ['#031018', '#3bffa0', '#aa50ff'], {
    paint: { body: p('#ffffff', { map: () => TX.aurora('t_norrsken'), e: '#ffffff', ei: 0.95, emap: true }), tip: p('#59ffb1', { e: '#59ffb1', ei: 2 }), ring: p('#aa50ff', { e: '#aa50ff', ei: 2 }) },
    build(c) {
      const gm = glowM('#59ffb1', 2.2);
      [1, -1].forEach(sd => bone(c.plane, [1.62, -0.42, 0.9 * sd], [0.9, -0.04, 6.55 * sd], 0.035, 0.035, gm, 'ljuskant'));
      c.ex.edge = gm;
    },
    anim(c, dt, t) { c.scroll(dt * 0.05, dt * 0.02); c.ex.edge.emissiveIntensity = 1.6 + Math.sin(t * 3) * 0.8; c.ex.edge.emissive.setHSL(0.42 + Math.sin(t * 0.7) * 0.12, 1, 0.5); },
    fx: [{ at: TIPS.concat(TAIL), rate: 55, idle: 0.3, life: [1.1, 1.8], size: [0.7, 1.2], grow: 1.5, c0: '#3bffa0', c1: '#aa50ff', op: 0.5, trailSpeed: 11 },
      { at: BODY, rate: 6, idle: 1, life: [0.5, 1], size: [0.4, 0.7], c0: '#e0fff2', tex: 'star' }]
  });
  def('legendary', 'spektral', 'Spektral', 'Ett genomskinligt spökplan som pulserar och lämnar slöjor efter sig.', ['#bfe9ff', '#8fd8ff', '#ffffff'], {
    paint: { body: p('#cdeeff', { e: '#8fd8ff', ei: 0.9, op: 0.55 }), wing: p('#cdeeff', { e: '#8fd8ff', ei: 0.9, op: 0.45 }), tip: p('#ffffff', { e: '#bff4ff', ei: 2 }), engine: p('#cdeeff', { e: '#8fd8ff', ei: 0.9, op: 0.5 }), ring: p('#ffffff', { e: '#bff4ff', ei: 2 }) },
    build(c) { c.ex.eyes = [1, -1].map(sd => add(c.plane, new THREE.SphereGeometry(0.13, 12, 10), glowM('#7ff8ff', 3), [5.1, 0.3, 0.62 * sd], [0, 0, 0], null, 'spokoga')); },
    anim(c, dt, t) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.4);
      Object.values(c.mats).forEach(m => { if (m.transparent && m.userData.op) m.opacity = m.userData.op * (0.6 + 0.6 * k); });
      c.glow(0.6 + 0.6 * k);
    },
    fx: [{ at: BODY.concat(TAIL), rate: 26, idle: 0.6, life: [1.4, 2.2], size: [0.6, 1.0], grow: 1.5, c0: '#ffffff', c1: '#9fd8ff', op: 0.35, add: false },
      { at: TIPS, rate: 30, idle: 0.6, life: [0.4, 0.8], size: [0.4, 0.7], grow: 0.8, c0: '#7ff8ff', c1: '#2a6bff', grav: -1.5 }]
  });
  def('legendary', 'tomrum', 'Tomrum', 'Ett tomrum med virvlande ringar som drar in ljus.', ['#02000a', '#a64bff', '#ffd2ff'], {
    paint: { body: p('#ffffff', { map: () => TX.void('t_tomrum'), e: '#ffffff', ei: 0.85, emap: true }), tip: p('#d79bff', { e: '#b44dff', ei: 2.4 }), ring: p('#d79bff', { e: '#b44dff', ei: 2.4 }) },
    build(c) {
      const rg = new THREE.Group(); rg.name = 'tomrumsringar'; rg.position.set(0.5, 0.1, 0); c.plane.add(rg); c.ex.rings = rg;
      const g1 = new THREE.TorusGeometry(2.0, 0.06, 8, 96); g1.rotateY(Math.PI / 2);
      c.ex.r1 = add(rg, g1, addM('#c27bff', 0.9), [0, 0, 0], [0, 0, 0], null, 'ring');
      c.ex.r2 = add(rg, g1, addM('#ff8af0', 0.6), [0, 0, 0], [0.6, 0, 0], [1.25, 1.25, 1.25], 'ring');
      rg.traverse(o => { o.userData.noShadow = true; });
    },
    anim(c, dt, t) {
      c.ex.r1.rotation.x += dt * 1.5; c.ex.r2.rotation.z = Math.sin(t) * 0.4; c.ex.r2.rotation.x -= dt * 0.9;
      c.scroll(dt * 0.03, 0); c.glow(0.75 + 0.25 * Math.sin(t * 3));
      c.suck = (c.suck ?? 0) + dt * 30;
      while (c.suck > 1) { c.suck -= 1; const a = R(0, TAU), r = 3.6, x = R(-4, 4); c.emitLocal([x, Math.cos(a) * r, Math.sin(a) * r], [0, -Math.cos(a + 0.5) * 3.2, -Math.sin(a + 0.5) * 3.2], { life: [0.7, 1.0], size: [0.18, 0.32], c0: '#ffd2ff', c1: '#7a1fff' }); }
    },
    fx: [trail(TAIL, '#b44dff', '#1a0033', { rate: 40, size: [0.5, 0.8], grow: 1 })]
  });
  def('legendary', 'diamant', 'Diamant', 'Skimrande pärlemor och kristaller som byter färg.', ['#bfe7ff', '#ffc4f2', '#c8ffd6', '#fff3b0'], {
    paint: { body: p('#ffffff', { map: () => TX.irid('t_irid'), m: 0.35, r: 0.1, e: '#ffffff', ei: 0.15, emap: true }), tip: p('#ffffff', { m: 0.35, r: 0.05, e: '#ffffff', ei: 0.6 }) },
    build(c) {
      c.ex.shards = [];
      const shard = (pos, sc, rot) => { const m = add(c.plane, new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.82, metalness: 0.2, roughness: 0.08 }), pos, rot, sc, 'kristall'); c.ex.shards.push(m); };
      for (let x = -3.5; x <= 2.6; x += 1.2) shard([x, topY(x) + 0.35, 0], [0.6, 1.6, 0.6], [0, 0, -0.35]);
      [1, -1].forEach(sd => shard([-0.05, 0.25, 6.6 * sd], [1, 2.2, 1], [sd * 0.2, 0, 0]));
    },
    anim(c, dt, t) { c.ex.shards.forEach((s, i) => { s.material.emissive.setHSL((t * 0.15 + i * 0.09) % 1, 0.9, 0.55); s.material.color.copy(s.material.emissive); s.rotation.y += dt * 0.8; }); c.scroll(dt * 0.02, dt * 0.01); },
    fx: [{ at: BODY.concat(TIPS), rate: 24, idle: 0.9, life: [0.4, 0.9], size: [0.5, 0.9], c0: hue(0.3, 1, 0.75, 1), tex: 'star', vspread: 0.15 },
      trail(TIPS, hue(0.4, 1, 0.7, 0.3), null, { rate: 35 })]
  });
  def('legendary', 'solflamma', 'Solflamma', 'Ytan kokar av plasma, med en korona och solutbrott.', ['#ffb347', '#ff5a00', '#fff3b0'], {
    paint: { body: p('#ffffff', { map: () => TX.plasma('t_plasma'), e: '#ffffff', ei: 1.1, emap: true }), tip: p('#fff3b0', { e: '#ffb347', ei: 2.5 }), ring: p('#fff3b0', { e: '#ffb347', ei: 2.5 }) },
    build(c) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb347', transparent: true, opacity: 0.45, blending: ADD, depthWrite: false }));
      sp.scale.setScalar(15); sp.position.set(0, 0.3, 0); sp.name = 'korona'; c.plane.add(sp); c.ex.corona = sp;
    },
    anim(c, dt, t) {
      c.scroll(dt * 0.04, dt * 0.03); c.glow(1 + 0.25 * Math.sin(t * 4));
      c.ex.corona.scale.setScalar(14 + Math.sin(t * 2) * 1.5); c.ex.corona.material.opacity = 0.38 + 0.12 * Math.sin(t * 3.1);
      c.flare = (c.flare ?? 1) - dt;
      if (c.flare < 0) {
        c.flare = R(1.0, 1.8);
        const b = BODY[(Math.random() * BODY.length) | 0], up = b[1] >= 0 ? 1 : -1, r = R(0.8, 1.4);
        for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; c.emitLocal([b[0] + Math.cos(a) * r, b[1] + up * Math.sin(a) * r, b[2]], [0, up * 0.5, 0], { life: [0.5, 0.8], size: [0.35, 0.55], c0: '#fff3b0', c1: '#ff3a0a' }); }
      }
    },
    fx: [{ at: TAIL.concat(ENG), rate: 50, idle: 0.35, life: [0.5, 0.9], size: [0.5, 0.8], grow: 1.3, c0: '#fff3b0', c1: '#ff3a0a' },
      { at: BODY, rate: 14, idle: 0.8, life: [0.8, 1.4], size: [0.12, 0.2], c0: '#ffe08a', c1: '#ff5a00', grav: -2.5, vspread: 0.8 }]
  });

  // ── ULTRA: helt ombyggda modeller ──
  const U = (id, name, desc, swatch, o) => def('ultra', id, name, desc, swatch, { hideAll: true, hideProps: true, ...o });
  U('stjarnjagare', 'Stjärnjägare', 'Ett rymdskepp med deltavingar, laserkanoner och warpringar.', ['#1b2233', '#36f1ff', '#ff3a4a'], {
    build(c) {
      const pl = c.plane;
      const hull = std('#ffffff', { map: TX.hex('t_skepp', '#1b2233', '#36f1ff', 6), emissive: '#ffffff', emissiveIntensity: 0.7, emissiveMap: TX.hex('t_skepp', '#1b2233', '#36f1ff', 6), metalness: 0.3, roughness: 0.35 });
      const g = new THREE.CylinderGeometry(0.25, 1.15, 10.5, 6, 1); g.rotateZ(-Math.PI / 2); g.scale(1, 0.62, 1);
      add(pl, g, hull, [0.2, 0.1, 0], [0, 0, 0], null, 'skrov');
      c.ex.canopy = add(pl, new THREE.SphereGeometry(1, 24, 16), glassM('#5ff3ff'), [1.6, 0.55, 0], [0, 0, 0], [1.9, 0.55, 0.62], 'cockpitglas');
      const wingM = std('#232c40', { metalness: 0.3, roughness: 0.4 }), edge = glowM('#36f1ff', 2.4);
      c.ex.lasers = [];
      [1, -1].forEach(sd => {
        add(pl, flatWing([[2.4, 0.6], [-4.0, 6.8], [-5.0, 6.8], [-4.4, 0.6]], 0.14, sd), wingM, [0, 0, 0], [0, 0, 0], null, 'deltavinge');
        bone(pl, [2.4, 0.09, 0.6 * sd], [-4.0, 0.09, 6.8 * sd], 0.05, 0.05, edge, 'vingkant');
        add(pl, new THREE.CylinderGeometry(0.12, 0.12, 2, 10), std('#3a4458', { metalness: 0.35 }), [-3.6, 0, 6.8 * sd], [0, 0, Math.PI / 2], null, 'laserkanon');
        c.ex.lasers.push(add(pl, new THREE.SphereGeometry(0.16, 12, 10), glowM('#ff3a4a', 3), [-2.55, 0, 6.8 * sd], [0, 0, 0], null, 'laserspets'));
        add(pl, finGeo([[-3.2, 0], [-5.0, 2.0], [-5.6, 2.0], [-5.4, 0]], 0.1), wingM, [0, 0.3, 1.0 * sd], [sd * 0.35, 0, 0], null, 'stjartfena');
        add(pl, new THREE.CylinderGeometry(0.5, 0.38, 1.4, 16), std('#3a4458', { metalness: 0.35 }), [-5.3, 0.1, 0.85 * sd], [0, 0, Math.PI / 2], null, 'motor');
        const disc = new THREE.CircleGeometry(0.36, 24); disc.rotateY(-Math.PI / 2);
        add(pl, disc, new THREE.MeshBasicMaterial({ color: '#9ffcff' }), [-6.02, 0.1, 0.85 * sd], [0, 0, 0], null, 'motorglod');
      });
      const rg = new THREE.TorusGeometry(1.6, 0.06, 8, 64); rg.rotateY(Math.PI / 2);
      c.ex.warp = add(pl, rg, addM('#36f1ff', 0.9), [-7, 0.1, 0], [0, 0, 0], null, 'warpring'); c.ex.warp.userData.noShadow = true;
    },
    anim(c, dt, t, fly) {
      c.ex.lasers.forEach((l, i) => l.material.emissiveIntensity = (Math.sin(t * 6 + i * Math.PI) > 0.3) ? 4 : 0.6);
      c.ex.canopy.material.emissiveIntensity = 0.4 + 0.25 * Math.sin(t * 2);
      const w = c.ex.warp; w.visible = fly;
      if (fly) { const k = (t * 1.25) % 1; w.scale.setScalar(0.5 + k * 2.2); w.position.x = -7 - k * 5; w.material.opacity = 0.9 * (1 - k); }
    },
    fx: [{ at: [[-6.1, 0.1, 0.85], [-6.1, 0.1, -0.85]], vel: [-6, 0, 0], rate: 110, idle: 0.35, life: [0.25, 0.45], size: [0.6, 0.85], grow: -0.6, c0: '#e8fdff', c1: '#2a7bff' },
      trail([[-4.7, 0, 6.8], [-4.7, 0, -6.8]], '#ff3a4a', '#5a0010', { rate: 40, size: [0.2, 0.35] }),
      { at: BODY, rate: 10, idle: 0.6, life: [0.3, 0.6], size: [0.5, 0.8], c0: '#bff9ff', tex: 'star' }]
  });
  U('urdrake', 'Urdrake', 'En hel drake med svajande svans, enorma vingar och eldsprut.', ['#3b0d0a', '#ff4a1a', '#ffd21a'], {
    build(c) {
      const pl = c.plane;
      const scaleM = std('#ffffff', { map: TX.scales('t_urdrake', '#7a1a10', '#14030a', '#ff5a1a'), emissive: '#ffffff', emissiveIntensity: 0.35, emissiveMap: TX.scales('t_urdrake', '#7a1a10', '#14030a', '#ff5a1a'), roughness: 0.55 });
      const sph = new THREE.SphereGeometry(1, 20, 14), spike = std('#1a0503', { roughness: 0.6 }), N = 16;
      c.ex.seg = [];
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1), x = 4.2 - f * 11.5;
        const r = f < 0.15 ? 0.55 + f / 0.15 * 0.5 : 1.05 * (1 - Math.pow((f - 0.15) / 0.85, 1.4)) + 0.12;
        const y = 0.2 + (f < 0.15 ? (0.15 - f) * 2 : 0);
        const m = add(pl, sph, scaleM, [x, y, 0], [0, 0, 0], [r * 1.35, r, r], 'drakkropp');
        const s = add(m, new THREE.ConeGeometry(0.14, 0.5, 6), spike, [0, 1.05, 0], [0, 0, 0.3], [1 / (r * 1.35), 1 / r, 1 / r], 'ryggtagg');
        s.userData.k = 1;
        c.ex.seg.push({ m, f, y });
      }
      add(pl, new THREE.ConeGeometry(0.45, 0.9, 4), spike, [-7.6, 0.2, 0], [0, 0, Math.PI / 2], [1, 1, 0.3], 'svansspets');
      const head = new THREE.Group(); head.name = 'drakhuvud'; head.position.set(5.4, 0.75, 0); pl.add(head); c.ex.head = head;
      add(head, new THREE.BoxGeometry(1.5, 0.7, 0.85), scaleM, [0, 0, 0], [0, 0, 0], null, 'skalle');
      add(head, new THREE.BoxGeometry(1.1, 0.45, 0.62), scaleM, [1.0, -0.08, 0], [0, 0, 0], null, 'nos');
      const jaw = new THREE.Group(); jaw.name = 'kake'; jaw.position.set(-0.4, -0.32, 0); head.add(jaw); c.ex.jaw = jaw;
      add(jaw, new THREE.BoxGeometry(1.8, 0.16, 0.58), scaleM, [0.9, 0, 0], [0, 0, 0], null, 'underkake');
      const tooth = std('#f4ecd8');
      for (let i = 0; i < 5; i++) [1, -1].forEach(sd => add(head, new THREE.ConeGeometry(0.05, 0.18, 5), tooth, [1.45 - i * 0.2, -0.33, 0.24 * sd], [Math.PI, 0, 0], null, 'tand'));
      const horn = std('#e8dcc0', { roughness: 0.5 });
      [1, -1].forEach(sd => add(head, new THREE.ConeGeometry(0.17, 1.4, 10), horn, [-0.6, 0.45, 0.3 * sd], [sd * 0.4, 0, 1.15], null, 'horn'));
      c.ex.eyes = [1, -1].map(sd => add(head, new THREE.SphereGeometry(0.1, 12, 10), glowM('#ffd21a', 3), [0.35, 0.18, 0.43 * sd], [0, 0, 0], null, 'oga'));
      c.ex.mouth = new THREE.Object3D(); c.ex.mouth.position.set(1.7, -0.25, 0); head.add(c.ex.mouth);
      const mem = std('#8a1a10', { side: DS, emissive: '#ff3b1a', emissiveIntensity: 0.25, roughness: 0.75, transparent: true, opacity: 0.94 });
      c.ex.wings = pair(pl, () => dragonWing(mem, std('#2a0907', { roughness: 0.6 }), 1.3), [0.9, 0.9, 0.9], 'urdrakvinge');
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.25 + (fly ? 0.5 : 0.3) * Math.sin(t * (fly ? 3.2 : 1.7)));
      c.ex.seg.forEach(({ m, f, y }, i) => { const k = Math.max(0, (f - 0.3) / 0.7); m.position.z = Math.sin(t * 2.2 - i * 0.5) * 0.55 * Math.pow(k, 1.3); m.position.y = y + Math.sin(t * 1.7 - i * 0.4) * 0.15 * k; });
      c.ex.head.position.y = 0.75 + Math.sin(t * 1.8) * 0.1; c.ex.head.rotation.z = Math.sin(t * 1.3) * 0.06;
      c.br = (c.br ?? 2) - dt;
      if (c.br < 0) { c.br = R(3.5, 5); c.breathT = 1.4; }
      const open = c.breathT > 0;
      c.ex.jaw.rotation.z += ((open ? -0.5 : -0.05) - c.ex.jaw.rotation.z) * Math.min(1, dt * 8);
      c.ex.eyes.forEach(e => e.material.emissiveIntensity = open ? 6 : 2.5 + Math.sin(t * 4));
      if (open) {
        c.breathT -= dt;
        const mp = c.ex.mouth.getWorldPosition(V()), dir = V(1, -0.15, 0).applyQuaternion(c.ex.head.getWorldQuaternion(new THREE.Quaternion()));
        for (let i = 0; i < 4; i++) emit({ pos: mp.clone(), vel: dir.clone().multiplyScalar(R(12, 18)).add(V(R(-1.5, 1.5), R(-1.5, 1.5), R(-1.5, 1.5))).add(trailV), life: R(0.45, 0.8), size: R(0.5, 0.8), grow: 3, c0: '#ffe08a', c1: '#c21a05', drag: 1.3 });
      }
    },
    fx: [{ at: [[-7.6, 0.2, 0], [-6, 0.3, 0]], rate: 40, idle: 0.4, life: [0.6, 1.1], size: [0.4, 0.7], grow: 1.2, c0: '#ff8a3a', c1: '#5a0a05' },
      { at: [[-4, 1, 0], [-2, 1.1, 0], [0, 1.1, 0], [2, 0.9, 0], [-1, 0, 1], [-1, 0, -1]], rate: 18, idle: 0.8, life: [0.8, 1.6], size: [0.1, 0.2], c0: '#ffc04a', c1: '#ff3a0a', grav: -2.2, vspread: 0.7 }]
  });
  U('robotfalk', 'Robotfalk', 'En mekanisk falk med segmenterade vingar och en pulserande kärna.', ['#9aa3b0', '#38e8ff', '#ff2a3a'], {
    build(c) {
      const pl = c.plane;
      const metal = std('#ffffff', { map: TX.hex('t_robot', '#9aa3b0', '#5d6673'), metalness: 0.4, roughness: 0.3 }), dark = std('#2b3038', { metalness: 0.3, roughness: 0.4 });
      const cyan = glowM('#38e8ff', 2.2); c.ex.cyan = cyan;
      const body = new THREE.CapsuleGeometry(0.85, 4.2, 8, 20); body.rotateZ(Math.PI / 2);
      add(pl, body, metal, [0, 0.2, 0], [0, 0, 0], null, 'robotkropp');
      c.ex.core = add(pl, new THREE.SphereGeometry(0.45, 20, 14), glowM('#38e8ff', 2.5), [1.2, -0.62, 0], [0, 0, 0], null, 'karna');
      const ring = new THREE.TorusGeometry(0.62, 0.06, 8, 40); ring.rotateX(Math.PI / 2);
      add(pl, ring, dark, [1.2, -0.62, 0], [0, 0, 0], null, 'karnring');
      const head = new THREE.Group(); head.name = 'robothuvud'; head.position.set(3.4, 0.75, 0); pl.add(head); c.ex.head = head;
      add(head, new THREE.BoxGeometry(1.3, 0.9, 0.95), metal, [0, 0, 0], [0, 0, 0], null, 'huvud');
      c.ex.visor = add(head, new THREE.BoxGeometry(0.1, 0.22, 0.9), glowM('#ff2a3a', 3), [0.66, 0.12, 0], [0, 0, 0], null, 'visir');
      add(head, new THREE.ConeGeometry(0.28, 0.9, 4), std('#e0b040', { metalness: 0.4, roughness: 0.3 }), [0.95, -0.15, 0], [0, 0, -Math.PI / 2], null, 'nabb');
      [1, -1].forEach(sd => add(head, new THREE.BoxGeometry(0.5, 0.1, 0.3), dark, [-0.4, 0.5, 0.3 * sd], [sd * 0.3, 0, 0.5], null, 'orfena'));
      c.ex.panels = [];
      c.ex.wings = pair(pl, () => {
        const g = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const f = i / 5, L = 1.9 - f * 0.6, pz = 0.6 + i * 1.0, px = -f * 1.6 - 0.2;
          const pn = new THREE.Group(); pn.position.set(px, f * 0.15, pz); pn.rotation.y = f * 0.25; g.add(pn); c.ex.panels.push(pn);
          add(pn, new THREE.BoxGeometry(L, 0.12, 0.95), metal, [0, 0, 0], [0, 0, 0], null, 'vingpanel');
          add(pn, new THREE.BoxGeometry(0.08, 0.14, 0.95), cyan, [L / 2, 0, 0], [0, 0, 0], null, 'panelkant');
        }
        return g;
      }, [0.5, 0.5, 0.8], 'robotvinge');
      const tail = new THREE.Group(); tail.name = 'stjartsolfjader'; tail.position.set(-2.6, 0.25, 0); pl.add(tail); c.ex.tail = tail;
      for (let i = 0; i < 5; i++) { const geo = new THREE.BoxGeometry(2.2, 0.08, 0.42); geo.translate(-1.1, 0, 0); const f = add(tail, geo, metal, [0, 0, 0], [0, (i - 2) * 0.22, 0], null, 'stjartplatta'); add(f, new THREE.BoxGeometry(0.1, 0.1, 0.42), cyan, [-2.2, 0, 0], [0, 0, 0], null, 'stjartkant'); }
      [1, -1].forEach(sd => { add(pl, new THREE.CylinderGeometry(0.22, 0.28, 0.6, 12), dark, [-2.9, -0.4, 0.45 * sd], [0, 0, Math.PI / 2], null, 'jetmotor'); });
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.15 + (fly ? 0.32 : 0.18) * Math.sin(t * (fly ? 4 : 2)));
      c.ex.panels.forEach((pn, i) => pn.rotation.x = Math.sin(t * 3 + i) * 0.06);
      c.ex.core.material.emissiveIntensity = 1.6 + 1.2 * Math.sin(t * 5); c.ex.core.scale.setScalar(1 + 0.08 * Math.sin(t * 5));
      c.ex.visor.scale.y = Math.sin(t * 1.3) > 0.97 ? 0.15 : 1;
      c.ex.cyan.emissiveIntensity = 1.8 + 0.7 * Math.sin(t * 4);
      c.ex.tail.rotation.y = Math.sin(t * 1.4) * 0.15; c.ex.head.rotation.y = Math.sin(t * 0.9) * 0.18;
    },
    fx: [{ at: [[-3.25, -0.4, 0.45], [-3.25, -0.4, -0.45]], vel: [-5, 0, 0], rate: 70, idle: 0.35, life: [0.25, 0.45], size: [0.4, 0.6], grow: -0.4, c0: '#d6fbff', c1: '#2a7bff' },
      { at: [[-1.7, 0.85, 6.4], [-1.7, 0.85, -6.4], [-1.2, 0.8, 4.6], [-1.2, 0.8, -4.6]], rate: 30, idle: 0.6, life: [0.15, 0.35], size: [0.4, 0.7], c0: '#bff9ff', tex: 'star', trail: false },
      trail([[-1.8, 0.8, 6.5], [-1.8, 0.8, -6.5]], '#38e8ff', '#1a3cff', { rate: 35 })]
  });
  U('tefat', 'Tefat', 'Ett snurrande UFO med ljuskrans, en liten pilot och en dragstråle.', ['#c9d1db', '#7dffb0', '#a24bff'], {
    build(c) {
      const pl = c.plane;
      const disc = new THREE.Group(); disc.name = 'tefat'; pl.add(disc); c.ex.disc = disc;
      const pts = [[0.01, -0.7], [1.6, -0.62], [3.4, -0.25], [4.3, 0], [3.4, 0.3], [2.0, 0.48], [1.3, 0.55]].map(([x, y]) => new THREE.Vector2(x, y));
      add(disc, new THREE.LatheGeometry(pts, 48), std('#c9d1db', { metalness: 0.4, roughness: 0.25, side: DS }), [0, 0, 0], [0, 0, 0], null, 'skal');
      const rim = new THREE.TorusGeometry(4.15, 0.12, 8, 64); rim.rotateX(Math.PI / 2);
      add(disc, rim, std('#3a4050', { metalness: 0.35 }), [0, 0, 0], [0, 0, 0], null, 'kant');
      c.ex.lights = [];
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; c.ex.lights.push(add(disc, new THREE.SphereGeometry(0.18, 10, 8), glowM('#ffffff', 2.5), [Math.cos(a) * 3.95, 0.06, Math.sin(a) * 3.95], [0, 0, 0], null, 'lampa')); }
      const under = new THREE.TorusGeometry(1.7, 0.12, 8, 48); under.rotateX(Math.PI / 2);
      c.ex.under = add(disc, under, glowM('#a24bff', 2), [0, -0.68, 0], [0, 0, 0], null, 'undering');
      add(pl, new THREE.SphereGeometry(1.5, 32, 16, 0, TAU, 0, Math.PI / 2), glassM('#6ff6ff'), [0, 0.5, 0], [0, 0, 0], null, 'kupol');
      const alien = new THREE.Group(); alien.name = 'pilot'; alien.position.set(0, 0.9, 0); pl.add(alien); c.ex.alien = alien;
      add(alien, new THREE.SphereGeometry(0.45, 20, 14), std('#7ee36a', { roughness: 0.5 }), [0, 0, 0], [0, 0, 0], [1, 1.15, 1], 'huvud');
      [1, -1].forEach(sd => add(alien, new THREE.SphereGeometry(0.13, 12, 10), std('#0c0c10', { roughness: 0.1 }), [0.36, 0.08, 0.16 * sd], [0, 0, 0], [0.6, 1.4, 1], 'oga'));
      const beam = new THREE.ConeGeometry(2.6, 7, 40, 1, true);
      c.ex.beam = add(pl, beam, addM('#7dffb0', 0.22), [0, -4.2, 0], [0, 0, 0], null, 'dragstrale'); c.ex.beam.userData.noShadow = true;
    },
    anim(c, dt, t, fly) {
      c.ex.disc.rotation.y += dt * (fly ? 2.2 : 0.9); c.ex.disc.rotation.z = Math.sin(t * 1.3) * 0.06;
      c.ex.lights.forEach((l, i) => l.material.emissive.setHSL((i / 18 + t * 0.5) % 1, 1, 0.55));
      c.ex.beam.material.opacity = 0.14 + 0.1 * Math.sin(t * 4); c.ex.beam.rotation.y += dt * 0.8;
      c.ex.under.material.emissiveIntensity = 1.5 + Math.sin(t * 6);
      c.ex.alien.rotation.y = Math.sin(t * 0.8) * 0.6; c.ex.alien.position.y = 0.9 + Math.sin(t * 3) * 0.04;
    },
    fx: [{ at: c => { const a = R(0, TAU), r = R(0, 2.2); return [c.plane.localToWorld(V(Math.cos(a) * r, -7, Math.sin(a) * r))]; }, vel: [0, 4.5, 0], rate: 30, idle: 1, life: [1.0, 1.5], size: [0.2, 0.4], c0: '#c8ffd9', c1: '#3bd16f', trail: false },
      { at: c => { const a = R(0, TAU); return [c.plane.localToWorld(V(Math.cos(a) * 4.3, 0, Math.sin(a) * 4.3))]; }, rate: 30, idle: 0.6, life: [0.3, 0.6], size: [0.5, 0.8], c0: hue(0.5, 1, 0.7, 1), tex: 'star' }]
  });
  U('kvantkristall', 'Kvantkristall', 'Svävande kristallskärvor runt en lysande kärna, i alla färger.', ['#e9fbff', '#ff9ff0', '#9ffcff', '#fff3b0'], {
    build(c) {
      const pl = c.plane, cm = () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.82, metalness: 0.2, roughness: 0.08 });
      c.ex.core = add(pl, new THREE.OctahedronGeometry(1.3, 0), new THREE.MeshStandardMaterial({ color: '#e9fbff', emissive: '#bff9ff', emissiveIntensity: 1, flatShading: true, metalness: 0.2, roughness: 0.1 }), [0.5, 0.2, 0], [0, 0, 0], [3.2, 1, 1], 'karna');
      c.ex.shards = [];
      const sh = (pos, sc, rot) => { const m = add(pl, new THREE.OctahedronGeometry(0.5, 0), cm(), pos, rot, sc, 'skarva'); m.userData.base = V(...pos); c.ex.shards.push(m); };
      [1, -1].forEach(sd => { for (let i = 0; i < 7; i++) sh([0.6 - i * 0.35, 0.1 + i * 0.05, (1.4 + i * 0.85) * sd], [1.8, 0.35, 0.9], [0, sd * 0.3, 0]); });
      sh([-5, 1, 0], [0.8, 1.8, 0.3], [0, 0, -0.4]); sh([-5.4, 0.6, 0.8], [0.6, 1.2, 0.3], [0.4, 0, -0.4]); sh([-5.4, 0.6, -0.8], [0.6, 1.2, 0.3], [-0.4, 0, -0.4]); sh([5, 0.2, 0], [2.2, 0.6, 0.6], [0, 0, 0]);
      const tg = new THREE.TorusGeometry(2.3, 0.05, 8, 80);
      c.ex.rings = [add(pl, tg, addM('#9ffcff', 0.9), [0.5, 0.2, 0], [0, Math.PI / 2, 0], null, 'gyroring'), add(pl, tg, addM('#ff9ff0', 0.8), [0.5, 0.2, 0], [Math.PI / 2, 0, 0], [1.15, 1.15, 1.15], 'gyroring')];
      c.ex.rings.forEach(r => r.userData.noShadow = true);
    },
    anim(c, dt, t) {
      c.ex.shards.forEach((s, i) => { s.position.y = s.userData.base.y + Math.sin(t * 2 + i * 0.7) * 0.18; s.rotation.x += dt * (0.4 + (i % 3) * 0.2); const h = (t * 0.15 + i * 0.07) % 1; s.material.emissive.setHSL(h, 0.9, 0.55); s.material.color.setHSL(h, 0.7, 0.75); });
      c.ex.core.material.emissiveIntensity = 0.8 + 0.4 * Math.sin(t * 3); c.ex.core.rotation.x += dt * 0.6;
      c.ex.rings[0].rotation.x += dt * 1.1; c.ex.rings[1].rotation.y += dt * 0.8;
    },
    fx: [{ at: c => [c.ex.shards[(Math.random() * c.ex.shards.length) | 0].getWorldPosition(V())], rate: 40, idle: 0.8, life: [0.4, 0.8], size: [0.6, 1.0], c0: hue(0.3, 1, 0.75, 1), tex: 'star', vspread: 0.2 },
      trail([[-5.5, 1, 0], [-0.9, 0.4, 6.5], [-0.9, 0.4, -6.5]], hue(0.4, 1, 0.65, 0.3), null, { rate: 55 })]
  });
  U('eldfagel', 'Eldfågel', 'En fågel av eld med gigantiska flammande vingar som återföds i en nova.', ['#ffd23a', '#ff8a1a', '#c2410c', '#fff3b0'], {
    build(c) {
      const pl = c.plane;
      const fm = std('#ffffff', { map: TX.feathers('t_eldfagel', '#ffe27a', '#e2550c', '#7a1f05'), emissive: '#ffffff', emissiveIntensity: 0.6, emissiveMap: TX.feathers('t_eldfagel', '#ffe27a', '#e2550c', '#7a1f05') });
      c.ex.body = fm;
      add(pl, new THREE.SphereGeometry(1, 28, 18), fm, [0, 0, 0], [0, 0, 0], [3.0, 0.95, 0.95], 'fagelkropp');
      add(pl, new THREE.SphereGeometry(0.65, 20, 14), fm, [3.0, 0.55, 0], [0, 0, 0], null, 'fagelhuvud');
      add(pl, new THREE.ConeGeometry(0.2, 0.8, 8), std('#ffcf4a', { metalness: 0.4, roughness: 0.3 }), [3.85, 0.45, 0], [0, 0, -Math.PI / 2 - 0.15], null, 'nabb');
      [1, -1].forEach(sd => add(pl, new THREE.SphereGeometry(0.09, 10, 8), glowM('#fff6c8', 4), [3.45, 0.7, 0.42 * sd], [0, 0, 0], null, 'oga'));
      const crest = glowM('#ffd23a', 2);
      for (let i = 0; i < 3; i++) add(pl, new THREE.ConeGeometry(0.12, 0.9 - i * 0.15, 6), crest, [2.8 - i * 0.25, 1.15 - i * 0.05, 0], [0, 0, 0.9 + i * 0.15], null, 'tofs');
      const mA = std('#ff8a1a', { emissive: '#ff5a00', emissiveIntensity: 1 }), mB = std('#ffd23a', { emissive: '#ffb000', emissiveIntensity: 0.9 });
      c.ex.fm = [mA, mB];
      c.ex.wings = pair(pl, () => featherWing(mA, mB, 14, 7.4, 1.8), [0.6, 0.4, 0.7], 'eldvinge');
      const tail = new THREE.Group(); tail.name = 'eldstjart'; tail.position.set(-2.8, 0.1, 0); pl.add(tail); c.ex.tail = [];
      for (let i = 0; i < 7; i++) { const piv = new THREE.Group(); piv.rotation.y = (i - 3) * 0.12; tail.add(piv); const geo = new THREE.BoxGeometry(4.5, 0.05, 0.35); geo.translate(-2.25, 0, 0); add(piv, geo, i % 2 ? mA : mB, [0, 0, 0], [0, 0, 0], null, 'stjartfjader'); c.ex.tail.push(piv); }
    },
    anim(c, dt, t, fly) {
      flap(c.ex.wings, 0.2 + (fly ? 0.42 : 0.24) * Math.sin(t * (fly ? 4.5 : 2.2)));
      c.ex.fm.forEach((m, i) => m.emissiveIntensity = 0.8 + 0.35 * Math.sin(t * 10 + i * 2) + Math.random() * 0.15);
      c.ex.body.emissiveIntensity = 0.55 + 0.15 * Math.sin(t * 6);
      c.ex.tail.forEach((pv, i) => pv.rotation.z = Math.sin(t * 3 - i * 0.6) * 0.15);
      c.nova = (c.nova ?? 3) - dt;
      if (c.nova < 0) {
        c.nova = 5;
        for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; c.emitLocal([0, 0.3, 0], [Math.cos(a) * 14, R(-1, 1), Math.sin(a) * 14], { life: [0.6, 0.9], size: [0.6, 0.9], grow: 1, c0: '#fff3b0', c1: '#ff3a0a', drag: 1.5, trail: false }); }
      }
    },
    fx: [{ at: [[-7.3, 0.2, 0], [-5.5, 0.2, 0.6], [-5.5, 0.2, -0.6]], rate: 90, idle: 0.45, life: [0.5, 1.0], size: [0.7, 1.1], grow: 1.8, c0: '#ffe08a', c1: '#d22a0a' },
      { at: [[-1.5, 0.5, 3], [-2, 0.6, 5], [-2.6, 0.7, 7], [-1.5, 0.5, -3], [-2, 0.6, -5], [-2.6, 0.7, -7]], rate: 60, idle: 0.4, life: [0.35, 0.7], size: [0.4, 0.7], grow: 1.2, c0: '#ffd23a', c1: '#ff3a0a' },
      { at: [[-3, 0.8, 0], [-1, 1, 0], [1, 0.9, 0]], rate: 10, idle: 0.6, life: [1.2, 2], size: [0.6, 1], grow: 1.2, c0: '#3a2a26', c1: '#9a9590', op: 0.35, add: false, grav: -1.5 }]
  });
  U('stormvakt', 'Stormvakt', 'Ett blixtskepp med stormmoln som kretsar runt och slår ned blixtar.', ['#141a33', '#6fb6ff', '#4a5061', '#ffffff'], {
    build(c) {
      const pl = c.plane;
      const hull = std('#ffffff', { map: TX.lightning('t_blixt'), emissive: '#ffffff', emissiveIntensity: 0.9, emissiveMap: TX.lightning('t_blixt'), metalness: 0.25, roughness: 0.35 });
      c.ex.hull = hull;
      const body = new THREE.CapsuleGeometry(0.75, 6.5, 8, 20); body.rotateZ(Math.PI / 2);
      add(pl, body, hull, [0, 0, 0], [0, 0, 0], null, 'stormkropp');
      add(pl, new THREE.SphereGeometry(1, 20, 14), glassM('#9fd0ff'), [2.2, 0.55, 0], [0, 0, 0], [1.5, 0.5, 0.55], 'cockpitglas');
      const wm = std('#141a33', { metalness: 0.3, roughness: 0.4 }), edge = glowM('#9fd0ff', 2.6);
      [1, -1].forEach(sd => {
        add(pl, flatWing([[-1.6, 0.5], [0.9, 6.4], [0.2, 6.6], [-2.6, 0.5]], 0.14, sd), wm, [0, -0.1, 0], [0, 0, 0], null, 'framsvept_vinge');
        bone(pl, [-1.6, -0.02, 0.5 * sd], [0.9, -0.02, 6.4 * sd], 0.05, 0.05, edge, 'vingkant');
        add(pl, flatWing([[3.2, 0.5], [2.8, 2.0], [2.4, 2.0], [2.3, 0.5]], 0.08, sd), wm, [0, 0.05, 0], [0, 0, 0], null, 'nosvinge');
      });
      add(pl, finGeo([[-2.5, 0.6], [-4.0, 2.6], [-4.6, 2.6], [-4.3, 0.6]], 0.12), wm, [0, 0, 0], [0, 0, 0], null, 'fena');
      const ring = new THREE.Group(); ring.name = 'stormmoln'; pl.add(ring); c.ex.ring = ring; c.ex.clouds = [];
      const cmat = std('#4a5061', { emissive: '#3a4a80', emissiveIntensity: 0.25, flatShading: true, roughness: 0.9 }); c.ex.cmat = cmat;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU, cl = new THREE.Group(); cl.name = 'moln'; cl.position.set(Math.cos(a) * 7.8, (i % 2 ? 1.2 : -0.6), Math.sin(a) * 7.8); ring.add(cl);
        for (let k = 0; k < 3; k++) add(cl, new THREE.IcosahedronGeometry(R(0.8, 1.2), 1), cmat, [R(-0.9, 0.9), R(-0.2, 0.3), R(-0.6, 0.6)], [0, 0, 0], null, 'molnbit');
        c.ex.clouds.push(cl);
      }
      c.ex.arcs = [0, 1, 2, 3].map(() => { const l = arcLine('#e6f3ff', 16); pl.add(l); return l; });
    },
    anim(c, dt, t) {
      c.ex.ring.rotation.y += dt * 0.5;
      c.ex.clouds.forEach((cl, i) => cl.position.y += Math.sin(t * 1.5 + i) * 0.004);
      c.arcT = (c.arcT ?? 0) - dt;
      if (c.arcT < 0) {
        c.arcT = R(0.06, 0.1); let hit = false;
        c.ex.arcs.forEach(l => {
          l.visible = Math.random() < 0.5;
          if (!l.visible) return; hit = true;
          const cl = c.ex.clouds[(Math.random() * 6) | 0], a = c.plane.worldToLocal(cl.getWorldPosition(V())), b = V(R(-3, 3), R(-0.3, 0.6), R(-0.5, 0.5));
          setArc(l, a, b, 0.8);
          c.emitLocal(b, [0, 0, 0], { life: [0.15, 0.3], size: [0.8, 1.2], c0: '#ffffff', tex: 'star' });
        });
        c.ex.hull.emissiveIntensity = hit && Math.random() < 0.3 ? 2.4 : 0.9;
        c.ex.cmat.emissiveIntensity = hit ? R(0.4, 1.4) : 0.25;
      }
    },
    fx: [trail([[0.5, -0.1, 6.5], [0.5, -0.1, -6.5], [-4.3, 2.4, 0]], '#cfe8ff', '#3b6bff', { rate: 55 }),
      { at: [[-4, 0, 0], [-2, 0.6, 0], [0, 0.7, 0], [2, 0.6, 0]], rate: 20, idle: 0.8, life: [0.15, 0.3], size: [0.5, 0.8], c0: '#e6f3ff', tex: 'star', trail: false }]
  });
  U('singularitet', 'Singularitet', 'Ett svart hål med en snurrande ackretionsskiva, jetstrålar och ljus som sugs in.', ['#000000', '#ffb347', '#e04e1e', '#8fb4ff'], {
    build(c) {
      const pl = c.plane, g = new THREE.Group(); g.name = 'singularitet'; g.position.set(0, 0.3, 0); pl.add(g);
      add(g, new THREE.SphereGeometry(1.6, 32, 24), new THREE.MeshBasicMaterial({ color: '#000000' }), [0, 0, 0], [0, 0, 0], null, 'handelsehorisont');
      const disk = new THREE.Group(); disk.rotation.set(-1.25, 0, 0.2); g.add(disk); c.ex.diskG = disk;
      const dm = new THREE.MeshBasicMaterial({ map: TX.disk('t_skiva'), transparent: true, blending: ADD, depthWrite: false, side: DS });
      c.ex.disk = add(disk, new THREE.RingGeometry(2.0, 6.5, 128, 1), dm, [0, 0, 0], [0, 0, 0], null, 'ackretionsskiva');
      const rUV = c.ex.disk.geometry.attributes.uv, rp = c.ex.disk.geometry.attributes.position;
      for (let i = 0; i < rUV.count; i++) rUV.setXY(i, rp.getX(i) / 13 + 0.5, rp.getY(i) / 13 + 0.5);
      c.ex.photon = add(g, new THREE.TorusGeometry(1.75, 0.08, 12, 96), new THREE.MeshBasicMaterial({ color: '#ffe0b0' }), [0, 0, 0], [-1.25 + Math.PI / 2, 0, 0.2], null, 'fotonring');
      const jm = addM('#8fb4ff', 0.35); c.ex.jm = jm;
      const jet = new THREE.ConeGeometry(0.5, 7, 16, 1, true);
      add(disk, jet, jm, [0, 0, 4.6], [-Math.PI / 2, 0, 0], null, 'jet');
      add(disk, jet, jm, [0, 0, -4.6], [Math.PI / 2, 0, 0], null, 'jet');
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#8a5cff', transparent: true, opacity: 0.35, blending: ADD, depthWrite: false }));
      halo.scale.setScalar(10); halo.name = 'halo'; g.add(halo); c.ex.halo = halo;
      g.traverse(o => { o.userData.noShadow = true; });
    },
    anim(c, dt, t, fly) {
      c.ex.disk.rotation.z -= dt * (fly ? 1.8 : 1.1);
      c.ex.jm.opacity = 0.25 + 0.15 * Math.random();
      c.ex.halo.material.opacity = 0.28 + 0.1 * Math.sin(t * 2); c.ex.halo.scale.setScalar(9.5 + Math.sin(t * 1.5) * 0.8);
      c.ex.photon.scale.setScalar(1 + 0.03 * Math.sin(t * 7));
      c.suck = (c.suck ?? 0) + dt * 45;
      const dg = c.ex.diskG, center = dg.getWorldPosition(V()), nrm = V(0, 0, 1).transformDirection(dg.matrixWorld);
      while (c.suck > 1) {
        c.suck -= 1;
        const a = R(0, TAU), pos = dg.localToWorld(V(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 0));
        const inward = center.clone().sub(pos), tang = nrm.clone().cross(inward).normalize();
        emit({ pos, vel: inward.multiplyScalar(0.75).add(tang.multiplyScalar(3.5)), life: R(0.9, 1.3), size: R(0.2, 0.35), c0: '#ffe0b0', c1: '#ff5a1a' });
      }
    },
    fx: [trail([[-1.8, 0.3, 0]], '#8a5cff', '#1a0033', { rate: 45, size: [0.6, 1], grow: 1.2 })]
  });
  U('gyllene-kolossen', 'Gyllene kolossen', 'Ett gyllene skepp med tre par änglavingar, gloria och ljusstrålar.', ['#c9952d', '#ffe08a', '#ffffff'], {
    build(c) {
      const pl = c.plane;
      const gold = std('#ffffff', { map: TX.goldfil('t_guld'), metalness: 0.4, roughness: 0.25, emissive: '#ffcc66', emissiveIntensity: 0.15 }); c.ex.gold = gold;
      const body = new THREE.CapsuleGeometry(0.95, 8, 10, 24); body.rotateZ(Math.PI / 2);
      add(pl, body, gold, [0, 0, 0], [0, 0, 0], null, 'guldkropp');
      add(pl, new THREE.ConeGeometry(0.5, 2, 24), gold, [5.8, 0, 0], [0, 0, -Math.PI / 2], null, 'nosspets');
      for (let i = 0; i < 5; i++) add(pl, new THREE.ConeGeometry(0.12, 0.6, 6), gold, [1 + i * 0.5, 1.0, 0], [0, 0, 0], null, 'krona');
      const wA = std('#ffffff', { emissive: '#fff3d0', emissiveIntensity: 0.35, roughness: 0.4 }), wB = std('#ffe08a', { metalness: 0.35, roughness: 0.3, emissive: '#ffcc66', emissiveIntensity: 0.3 });
      c.ex.wings = [
        pair(pl, () => featherWing(wA, wB, 12, 7.5, 1.8), [0.8, 0.3, 0.85], 'angelvinge1'),
        pair(pl, () => featherWing(wB, wA, 10, 6.0, 1.5), [0.1, 0.65, 0.8], 'angelvinge2'),
        pair(pl, () => featherWing(wA, wB, 8, 4.5, 1.2), [-0.6, 1.0, 0.75], 'angelvinge3')
      ];
      const halo = new THREE.Group(); halo.name = 'gloria'; halo.position.set(-1.5, 2.9, 0); pl.add(halo); c.ex.halo = halo;
      const t1 = new THREE.TorusGeometry(2.2, 0.09, 12, 80); t1.rotateY(Math.PI / 2);
      add(halo, t1, glowM('#ffd76a', 1.6, { metalness: 0.3 }), [0, 0, 0], [0, 0, 0], null, 'gloriaring');
      const t2 = new THREE.TorusGeometry(2.7, 0.04, 8, 80); t2.rotateY(Math.PI / 2);
      c.ex.halo2 = add(halo, t2, addM('#ffffff', 0.8), [0, 0, 0], [0, 0, 0], null, 'gloriaring2');
      const rays = new THREE.Group(); rays.name = 'ljusstralar'; halo.add(rays); c.ex.rays = rays; c.ex.rayM = addM('#ffe08a', 0.3);
      for (let i = 0; i < 12; i++) { const geo = new THREE.PlaneGeometry(0.14, 3.6); geo.translate(0, 2.4, 0); geo.rotateY(Math.PI / 2); add(rays, geo, c.ex.rayM, [0, 0, 0], [i / 12 * TAU, 0, 0], null, 'strale'); }
      halo.traverse(o => { if (o.material && o.material.blending === ADD) o.userData.noShadow = true; });
    },
    anim(c, dt, t, fly) {
      c.ex.wings.forEach((w, i) => flap(w, 0.15 + i * 0.12 + (fly ? 0.3 : 0.16) * Math.sin(t * (fly ? 3.4 : 1.8) - i * 0.6)));
      c.ex.halo.rotation.x += dt * 0.4; c.ex.halo2.rotation.x -= dt * 1.2;
      c.ex.rays.rotation.x += dt * 0.6; c.ex.rayM.opacity = 0.2 + 0.12 * Math.sin(t * 3);
      c.ex.gold.emissiveIntensity = 0.12 + 0.1 * Math.sin(t * 2.5);
    },
    fx: [{ at: BODY, rate: 26, idle: 0.9, life: [0.4, 0.9], size: [0.5, 0.9], c0: '#fff3b0', tex: 'star', vspread: 0.15 },
      trail([[-2.6, 0.5, 7.6], [-2.6, 0.5, -7.6], [-2.4, 0.9, 6], [-2.4, 0.9, -6]], '#ffffff', '#ffd76a', { rate: 50 }),
      trail([[-5.4, 0, 0]], '#ffe08a', '#b67a12', { rate: 40, size: [0.5, 0.8], grow: 1 })]
  });
  U('leviatan', 'Leviatan', 'En rymdval med lysande prickar, simmande fenor och ett spår av stjärnstoft.', ['#0b1d3a', '#5ff4ff', '#c49bff', '#2b5c8a'], {
    build(c) {
      const pl = c.plane;
      const prof = new THREE.SplineCurve([[0.05, -6.5], [0.3, -6], [0.6, -5], [0.95, -3.5], [1.35, -1.5], [1.6, 0.5], [1.65, 2.5], [1.5, 4.2], [1.15, 5.3], [0.6, 5.9], [0.05, 6.1]].map(q => new THREE.Vector2(...q))).getPoints(60);
      const geo = new THREE.LatheGeometry(prof, 48); geo.rotateZ(-Math.PI / 2);
      const skin = std('#ffffff', { map: TX.spots('t_prickar'), emissive: '#ffffff', emissiveIntensity: 0.8, emissiveMap: TX.spots('t_prickar'), roughness: 0.5 });
      c.ex.skin = skin;
      add(pl, geo, skin, [0, 0, 0], [0, 0, 0], null, 'valkropp');
      [1, -1].forEach(sd => add(pl, new THREE.SphereGeometry(0.14, 12, 10), glowM('#7ff8ff', 3), [4.4, 0.3, 1.22 * sd], [0, 0, 0], null, 'valoga'));
      const finM = std('#1b3a66', { side: DS, emissive: '#5ff4ff', emissiveIntensity: 0.35, roughness: 0.5 });
      const fin = new THREE.ShapeGeometry(new THREE.Shape([[0.4, 0], [-0.6, 2.8], [-1.4, 2.6], [-0.8, 0]].map(q => new THREE.Vector2(...q)))); fin.rotateX(Math.PI / 2);
      c.ex.fins = pair(pl, () => { const g = new THREE.Group(); add(g, fin, finM, [0, 0, 0], [0, 0, 0], null, 'bukfena'); return g; }, [2.2, -0.7, 1.3], 'fena');
      add(pl, finGeo([[-1.8, 1.2], [-2.8, 2.2], [-3.3, 2.1], [-3.2, 1.0]], 0.12), finM, [0, 0, 0], [0, 0, 0], null, 'ryggfena');
      const fl = new THREE.Group(); fl.name = 'stjartfena'; fl.position.set(-6.3, 0.05, 0); pl.add(fl); c.ex.fluke = fl;
      const lobe = new THREE.ShapeGeometry(new THREE.Shape([[0, 0], [-1.6, 2.4], [-2.4, 2.6], [-1.4, 0.4]].map(q => new THREE.Vector2(...q)))); lobe.rotateX(Math.PI / 2);
      add(fl, lobe, finM, [0, 0, 0], [0, 0, 0], null, 'lob');
      add(fl, lobe, finM, [0, 0, 0], [0, 0, 0], [1, 1, -1], 'lob');
    },
    anim(c, dt, t, fly) {
      const sp = fly ? 2.6 : 1.4;
      c.ex.fluke.rotation.z = Math.sin(t * sp) * 0.35;
      flap(c.ex.fins, 0.15 + Math.sin(t * sp + 1) * 0.25);
      c.ex.skin.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 2);
      c.scroll(dt * 0.01, 0);
    },
    fx: [{ at: [[-8, 0, 1.5], [-8, 0, -1.5], [-6.5, 0, 0]], rate: 45, idle: 0.4, life: [0.8, 1.4], size: [0.4, 0.7], c0: '#bff9ff', c1: '#7a4dff', tex: 'star' },
      { at: [[-3, 1.5, 0], [0, 1.6, 0], [3, 1.4, 0], [0, 0, 1.6], [0, 0, -1.6]], rate: 14, idle: 0.8, life: [1.2, 2], size: [0.2, 0.35], c0: '#7ff8ff', c1: '#2a6bff', grav: -1, vspread: 0.3 }]
  });

  const byId = Object.fromEntries(SKINS.map(s => [s.id, s]));

  /* ───────── måla planet ───────── */
  function slotOf(n) {
    if (n === 'flygkropp') return 'body';
    if (n.startsWith('vinge_')) return 'wing';
    if (n.startsWith('stabilisator_') || n === 'fena') return 'tail';
    if (n.startsWith('vingspets_') || n === 'fenspets') return 'tip';
    if (n.startsWith('motorring_')) return 'ring';
    if (n.startsWith('motor_')) return 'engine';
    if (n.startsWith('spinner_')) return 'spinner';
    if (n.startsWith('blad_')) return 'blade';
    if (n.startsWith('vindruta_') || n.startsWith('fonster_')) return 'glass';
    if (n === 'dorr') return 'door';
    return null;
  }
  const REPEAT = { body: [1, 1], wing: [0.3, 0.3], tail: [0.35, 0.35], engine: [1, 1] };
  function texFor(tex, slot) {
    if (!tex) return null;
    const rep = REPEAT[slot] || [1, 1];
    if (rep[0] === 1 && rep[1] === 1) return tex;
    const key = tex.uuid + slot;
    if (!texClones.has(key)) { const t2 = tex.clone(); t2.repeat.set(...rep); t2.needsUpdate = true; texClones.set(key, t2); }
    return texClones.get(key);
  }
  function makeMat(spec, slot, id) {
    const m = new THREE.MeshStandardMaterial({ name: `skin_${id}_${slot}`, color: spec.c ?? '#ffffff', roughness: spec.r ?? 0.45, metalness: spec.m ?? 0 });
    const map = spec.map ? texFor(spec.map(), slot) : null;
    if (map) m.map = map;
    if (spec.e != null) { m.emissive = new THREE.Color(spec.e); m.emissiveIntensity = spec.ei ?? 1; if (spec.emap && map) m.emissiveMap = map; }
    if (spec.op != null) { m.transparent = true; m.opacity = spec.op; m.userData.op = spec.op; m.depthWrite = false; }
    if (slot === 'body' || slot === 'glass') m.side = DS;
    m.userData.ei = m.emissiveIntensity;
    return m;
  }
  let cur = null;
  const RARE = { legendary: { rate: 1.35, size: 1.15, ribbon: 0.32, glow: 1.25 }, ultra: { rate: 1.5, size: 1.2, ribbon: 0.45, glow: 1.5 } };
  function dress(plane, id) {
    const skin = byId[id] || null;
    cur = null; clearP(); clearRibbons();
    if (!REF) REF = reach(plane);                     // standardplanet, innan något ändras
    if (!skin) return plane;
    const Pn = skin.paint || {}, hide = new Set(skin.hide || []);
    const spec = {
      body: Pn.body, wing: Pn.wing ?? Pn.body, tail: Pn.tail ?? Pn.wing ?? Pn.body, engine: Pn.engine ?? Pn.body,
      tip: Pn.tip, ring: Pn.ring ?? Pn.tip, spinner: Pn.spinner, blade: Pn.blade, glass: Pn.glass, door: Pn.door ?? Pn.tip
    };
    const mats = {};
    plane.traverse(o => {
      if (!o.isMesh) return;
      const slot = slotOf(o.name); if (!slot) return;
      if (skin.hideAll || hide.has(slot)) { o.visible = false; o.userData.skinHidden = true; return; }
      const sp = spec[slot]; if (!sp) return;
      mats[slot] = mats[slot] || makeMat(sp, slot, skin.id);
      o.material = mats[slot];
    });
    const rare = RARE[skin.rarity];
    const c = { plane, skin, mats, ex: {}, t: 0, boost: 1, wq: new THREE.Quaternion(), shadowFixed: false, scale: 1, sizeK: rare ? rare.size : 1,
      emitters: (skin.fx || []).map(e => ({ ...e, acc: 0, rate: e.rate * (rare ? rare.rate : 1) })) };
    const maps = new Set(); Object.values(mats).forEach(m => { if (m.map) maps.add(m.map); if (m.emissiveMap) maps.add(m.emissiveMap); });
    c.scroll = (dx, dy) => maps.forEach(t => { t.offset.x = (t.offset.x + dx) % 1; t.offset.y = (t.offset.y + dy) % 1; });
    c.glow = k => Object.values(mats).forEach(m => { if (m.emissiveMap) m.emissiveIntensity = m.userData.ei * k; });
    c.emitLocal = (pos, vel, o) => {
      const wp = c.plane.localToWorld(Array.isArray(pos) ? V(...pos) : pos.clone());
      const wv = (Array.isArray(vel) ? V(...vel) : vel.clone()).applyQuaternion(c.wq);
      if (o.trail !== false) wv.add(trailV);
      emit({ pos: wp, vel: wv, life: R(...o.life), size: R(...o.size), grow: o.grow, c0: o.c0, c1: o.c1, op: o.op, add: o.add, grav: o.grav, drag: o.drag, tex: o.tex === 'star' ? starTex : glowTex, spin: o.tex === 'star' ? R(-3, 3) : 0 });
    };
    plane.updateMatrixWorld(true);
    if (skin.build) skin.build(c, H);
    // samma storlek som standardplanet: det man ser stämmer med det man krockar med
    const k = Math.min(1, REF / Math.max(reach(plane), 1e-3));
    if (k < 0.995) { plane.scale.setScalar(k); plane.updateMatrixWorld(true); }
    const box = measure(plane);
    c.scale = k;
    // ljusband från vingspetsarna (och stjärten på Ultra) i skinets färger
    if (rare) {
      const cols = skin.swatch.map((x) => new THREE.Color(x)).sort((a, b) => (b.r + b.g + b.b) * (0.5 + b.getHSL({}).s) - (a.r + a.g + a.b) * (0.5 + a.getHSL({}).s));
      const cx = (box.min.x + box.max.x) / 2 - (box.max.x - box.min.x) * 0.1, cy = (box.min.y + box.max.y) / 2;
      const zt = Math.max(-box.min.z, box.max.z) * 0.92;
      const add = (at, col, w) => { const r = makeRibbon(col.clone().multiplyScalar(rare.glow), w, 1); r.at = at; ribbons.push(r); };
      add([cx, cy, zt], cols[0], rare.ribbon);
      add([cx, cy, -zt], cols[Math.min(1, cols.length - 1)], rare.ribbon);
      if (skin.rarity === 'ultra') add([box.min.x + 0.3, cy, 0], cols[Math.min(2, cols.length - 1)], rare.ribbon * 1.3);
    }
    cur = c;
    return plane;
  }

  /* ───────── effekter varje bildruta ───────── */
  function spawnFrom(c, e, fly) {
    const pts = typeof e.at === 'function' ? e.at(c) : e.at;
    const pt = pts[(Math.random() * pts.length) | 0];
    const pos = Array.isArray(pt) ? c.plane.localToWorld(V(...pt)) : pt.clone();
    const sp = e.spread ?? 0.15; pos.add(V(R(-sp, sp), R(-sp, sp), R(-sp, sp)));
    const vel = e.vel ? V(...e.vel).applyQuaternion(c.wq) : V();
    const vs = e.vspread ?? 0.4; vel.add(V(R(-vs, vs), R(-vs, vs), R(-vs, vs)));
    if (fly && e.trail !== false) vel.addScaledVector(trailV, (e.trailSpeed ?? 14) / 14);
    const col = v => (typeof v === 'function' ? v(c.t) : v);
    const star = e.tex === 'star';
    emit({ pos, vel, life: R(...e.life), size: R(...e.size) * c.boost * c.sizeK * c.scale, grow: e.grow, c0: col(e.c0), c1: col(e.c1 ?? e.c0), op: e.op, add: e.add, grav: e.grav, drag: e.drag, tex: star ? starTex : glowTex, spin: star ? R(-3, 3) : 0 });
  }
  // state: { fly: planet flyger, alive: planet är helt (inte kraschat), trail: spårfart när planet står still,
  //         exclude: punkt (världen) där inga partiklar får skapas, excludeR: radie }
  const FWD = V(1, 0, 0);
  function update(dt, state = {}) {
    dt = Math.min(0.05, dt);
    const c = cur;
    exclude = state.exclude || null; excludeR2 = (state.excludeR || 0) ** 2;
    if (c && c.plane.parent) {
      c.t += dt;
      const fly = !!state.fly, alive = state.alive !== false;
      c.plane.updateMatrixWorld(true); c.plane.getWorldQuaternion(c.wq);
      trailV.copy(FWD).applyQuaternion(c.wq).multiplyScalar(-(fly ? state.trail || 0 : 0));
      if (alive) {
        try { if (c.skin.anim) c.skin.anim(c, dt, c.t, fly); } catch (err) { console.warn('skin-animation', c.skin.id, err); c.skin.anim = null; }
        c.emitters.forEach(e => {
          e.acc += e.rate * (fly ? 1 : (e.idle ?? 0.3)) * c.boost * rateMul * dt;
          let n = 0;
          while (e.acc >= 1 && n++ < 12) { e.acc -= 1; spawnFrom(c, e, fly); }
          if (e.acc > 1) e.acc = 0;
        });
      }
      c.boost += (1 - c.boost) * Math.min(1, dt * 1.5);
      updateRibbons(c, dt, alive);
    } else updateRibbons(null, dt, false);
    updateP(dt);
  }

  // reaktion: klick på planet eller krasch → skinnets egen explosion av effekter
  function pulse(kind = 'klick') {
    const c = cur; if (!c || !c.plane.parent) return;
    c.boost = kind === 'krasch' ? 3 : 2.2;
    const center = c.plane.getWorldPosition(V()), cols = c.skin.swatch;
    const n = kind === 'krasch' ? 90 : kind === 'ring' ? 36 : 50;
    for (let i = 0; i < n; i++) {
      const d = V(R(-1, 1), R(-0.6, 1), R(-1, 1)).normalize();
      emit({ pos: center.clone().add(d.clone().multiplyScalar(R(0.5, 2))), vel: d.multiplyScalar(R(6, 16)), life: R(0.5, 1.1), size: R(0.4, 0.8), grow: 0.6, drag: 1.6,
        c0: cols[(Math.random() * cols.length) | 0], c1: cols[(Math.random() * cols.length) | 0], tex: Math.random() < 0.4 ? starTex : glowTex });
    }
  }
  return {
    group: vfx,
    list: SKINS,
    byId,
    dress,
    update,
    pulse,
    clear: () => { clearP(); },
    rarity: () => (cur ? cur.skin.rarity : null),
    setBudget(max, rate) { maxP = max; rateMul = rate; while (P.length > maxP) killP(0); },
    // Förbered: skapa alla partiklar nu och visa en av varje sort en stund (så att de kan kompileras).
    // Returnerar en funktion som döljer dem igen.
    prewarm() {
      while (free.length + P.length < maxP) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
        sp.frustumCulled = false; sp.visible = false; vfx.add(sp); free.push(sp);
      }
      const shown = free.slice(-2);
      shown.forEach((sp, i) => { sp.visible = true; sp.material.map = i ? starTex : glowTex; sp.material.blending = i ? ADD : THREE.NormalBlending; sp.position.set(0, -60, 0); });
      ribbons.forEach((r) => { r.mesh.visible = true; });
      return () => { shown.forEach((sp) => { sp.visible = false; }); };
    },
    dispose() { cur = null; clearP(); clearRibbons(); free.forEach((sp) => { sp.material.dispose(); vfx.remove(sp); }); free.length = 0; },
  };
}
