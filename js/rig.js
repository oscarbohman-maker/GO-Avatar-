// Flygplanet som helhet i världen: exteriör, cockpit, två figurer och levande instrument.
// Planets lokala system: x höger, y upp, -z framåt (samma som fysiken).
import * as THREE from './lib/three.module.min.js';
import { buildPlane, buildCockpit } from './models.js';
import { Avatar, AVATAR_STYLES } from './avatar.js';
import { skinById, DEFAULT_SKIN } from './skins.js';
import { createSkinSystem } from './skinpack.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// Var cockpiten sitter i förhållande till planets tyngdpunkt (nosen är 6 m fram)
export const COCKPIT_OFFSET = V(0, -0.9, -4.6);

export class PlaneRig {
  // localSeat: 'pilot' | 'copilot' – vems huvud som är kameran (döljs)
  // opts: { maxParticles, rate } – budget för skinens partikeleffekter
  constructor(localSeat = 'pilot', opts = {}) {
    this.localSeat = localSeat;
    // skinens effekter: partiklarna ligger i skin.group, som ägaren lägger i sin scen
    this.budget = { max: opts.maxParticles ?? 220, rate: opts.rate ?? 0.6, highMax: opts.highMax ?? opts.maxParticles ?? 220, highRate: opts.highRate ?? opts.rate ?? 0.6 };
    this.skin = createSkinSystem({ maxParticles: this.budget.max, rate: this.budget.rate });
    this.skinId = DEFAULT_SKIN;
    this.skinTrail = 0;        // spårfart när planet står still (shopen); 0 i spelet där planet flyger på riktigt
    this.skinCam = null;       // kamerans position: inga partiklar skapas nära den i cockpit
    this.envMap = null;
    this.root = new THREE.Group(); this.root.name = 'plan_rig';
    this.root.rotation.order = 'YXZ';

    // Exteriör: modellens nos pekar mot +x, vi vill ha -z
    this.exteriorWrap = new THREE.Group();
    this.exteriorWrap.rotation.y = Math.PI / 2;
    this.exterior = buildPlane();
    this.exteriorWrap.add(this.exterior);
    this.root.add(this.exteriorWrap);
    this.props = ['propeller_h', 'propeller_v'].map((n) => this.exterior.getObjectByName(n));

    // Cockpit
    this.cockpit = buildCockpit();
    this.cockpit.position.copy(COCKPIT_OFFSET);
    this.root.add(this.cockpit);
    this.root.updateMatrixWorld(true);

    this.pilot = new Avatar(-0.6, AVATAR_STYLES.pilot, 'pilot');
    this.copilot = new Avatar(0.6, AVATAR_STYLES.copilot, 'andrepilot');
    this.cockpit.add(this.pilot.group, this.copilot.group);

    // Förstaperson: det egna huvudet döljs (kameran sitter strax intill det)
    (localSeat === 'pilot' ? this.pilot : this.copilot).setHeadVisible(false);
    // Sluten kabin: väggar, tak och bakvägg så att cockpiten ser ut som planet utifrån.
    this._buildCabinShell();
    // Svag varm kabinlampa
    const cabin = new THREE.PointLight(0xffd6a0, 2.2, 3.2, 2);
    cabin.position.set(0, 1.85, -0.15);
    this.cockpit.add(cabin);

    this._setupInstruments();
    this.gest = null;      // pågående gest från navigatören
    this.pressT = 0;
    this.throttleHold = 0;
    this.lastThrottle = 0;
    this.idle = { t: 0, yaw: 0, pitch: -0.2, next: 2 };
    this.view = 'cockpit';
    this.time = 0;
    this._markBase();
  }

  _get(n) { return this.cockpit.getObjectByName(n); }

  // Skin: bygger om planet och klär det i skinet (färger, texturer, extra delar och effekter).
  // Standardplanet ("classic") är modellen som den är.
  setSkin(id) {
    id = skinById(id || DEFAULT_SKIN).id;
    if (this.skinId === id) return;
    this.skinId = id;
    const old = this.exterior;
    const plane = buildPlane();
    this.exteriorWrap.remove(old);
    this.exteriorWrap.add(plane);
    this.exterior = plane;
    // gamla planets geometri och material frigörs (texturerna är delade och ligger kvar)
    old.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.root.updateMatrixWorld(true);
    this._markBase();
    this.skin.dress(plane, id);
    this.exterior.children.forEach((c) => { if (!c.userData.base) c.userData.skinExtra = true; });
    this.props = ['propeller_h', 'propeller_v'].map((n) => this.exterior.getObjectByName(n));
    this._applyEnv();
    this.applyInterior(id);
    // Legendary och Ultra får fler partiklar
    const high = ['legendary', 'ultra'].includes(this.skin.rarity());
    this.skin.setBudget(high ? this.budget.highMax : this.budget.max, high ? this.budget.highRate : this.budget.rate);
  }

  // Cutscenen visar båda figurernas ansikten; i förstaperson är det egna huvudet dolt (kameran sitter där)
  showCrew(on) {
    (this.localSeat === 'pilot' ? this.pilot : this.copilot).setHeadVisible(!!on);
  }

  _markBase() { this.exterior.children.forEach((c) => { c.userData.base = true; }); }

  // ---- Interiören i skinets stil ---------------------------------------------------------
  // Färger på säten, paneler, väggar, knappar, lampor och skärmar efter skinets färger, och
  // spakar och rattar efter sällsynthet. Figurerna rörs inte. Standardplanet får originalet.
  _cockpitMeshes() {
    if (this._cpMeshes) return this._cpMeshes;
    const skip = new Set();
    [this.pilot.group, this.copilot.group].forEach((g) => g.traverse((o) => skip.add(o)));
    const list = [];
    this.cockpit.traverse((o) => { if (o.isMesh && !skip.has(o)) list.push(o); });
    this._cpMeshes = list;
    // originalen sparas så att standardplanet kan få tillbaka dem
    this._orig = new Map();
    list.forEach((o) => {
      const m = o.material;
      if (!m || this._orig.has(m)) return;
      this._orig.set(m, { color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity, metal: m.metalness, rough: m.roughness, map: m.map || null, emap: m.emissiveMap || null });
    });
    list.forEach((o) => { o.userData.origMat = o.material; o.userData.origGeo = o.geometry; });
    return list;
  }

  applyInterior(id) {
    const meta = skinById(id);
    const list = this._cockpitMeshes();
    // återställ allt först
    this._orig.forEach((v, m) => {
      if (v.color) m.color.copy(v.color);
      if (v.emissive) m.emissive.copy(v.emissive);
      m.emissiveIntensity = v.ei; m.metalness = v.metal; m.roughness = v.rough;
      if ((m.map || null) !== v.map || (m.emissiveMap || null) !== v.emap) { m.map = v.map; m.emissiveMap = v.emap; m.needsUpdate = true; }
    });
    if (this._ownTexs) this._ownTexs.forEach((t) => t.dispose());
    this._ownTexs = [];
    list.forEach((o) => { o.material = o.userData.origMat; o.geometry = o.userData.origGeo; });
    if (this._ownMats) { this._ownMats.forEach((m) => m.dispose()); }
    this._ownMats = [];
    if (this._interiorExtras) { this._interiorExtras.forEach((o) => { if (o.parent) o.parent.remove(o); if (o.geometry) o.geometry.dispose(); }); }
    if (this._ownTex) { this._ownTex.dispose(); this._ownTex = null; }
    this._interiorExtras = [];
    if (meta.id === DEFAULT_SKIN) return;

    // färger ur skinets färgprov: den mest färgstarka blir accent
    const C = (h, s2, l) => new THREE.Color().setHSL(((h % 1) + 1) % 1, Math.max(0, Math.min(1, s2)), Math.max(0, Math.min(1, l)));
    const cols = meta.swatch.map((x) => new THREE.Color(x));
    const hsl = cols.map((c) => c.getHSL({}));
    const vivid = (i) => hsl[i].s * (1 - Math.abs(hsl[i].l - 0.5) * 1.4);
    const order = cols.map((_, i) => i).sort((a, b) => vivid(b) - vivid(a));
    const A = hsl[order[0]], B = hsl[order[1] ?? order[0]];
    const avgL = hsl.reduce((a, h) => a + h.l, 0) / hsl.length;
    const dark = avgL < 0.32;
    const rar = meta.rarity;
    const byName = new Map();
    this._orig.forEach((v, m) => { if (!byName.has(m.name)) byName.set(m.name, []); byName.get(m.name).push(m); });
    const set = (name, color, o = {}) => (byName.get(name) || []).forEach((m) => {
      if (color && m.color) m.color.copy(color);
      if (o.e && m.emissive) { m.emissive.copy(o.e); m.emissiveIntensity = o.ei ?? m.emissiveIntensity; }
      if (o.m != null) m.metalness = o.m;
      if (o.r != null) m.roughness = o.r;
    });
    // säten, paneler och väggar
    set('sadel_lader', C(A.h, A.s * 0.6, dark ? 0.24 : 0.34), { r: 0.75 });
    set('sadel_mork', C(A.h, A.s * 0.5, dark ? 0.12 : 0.17));
    set('panel_mork', C(A.h, Math.min(0.55, A.s * 0.6), dark ? 0.1 : 0.2));
    set('panel_ljus', C(A.h, A.s * 0.45, dark ? 0.28 : 0.5), { m: rar === 'common' ? 0 : 0.35, r: 0.4 });
    set('vit_insida', dark ? C(B.h, 0.22, 0.24) : C(A.h, Math.min(0.5, A.s * 0.6 + 0.1), 0.72));
    // knappar och lampor i skinets färger
    const lamp = (i) => { const h = hsl[order[i % order.length]]; return C(h.h, Math.max(0.6, h.s), 0.55); };
    [['lampa_rod', 0], ['lampa_gron', 1], ['lampa_gul', 2]].forEach(([n, i]) => set(n, lamp(i), { e: lamp(i) }));
    const glowA = C(A.h, Math.max(0.65, A.s), 0.5);
    set('radar', C(A.h, 0.6, 0.22), { e: C(A.h, 0.8, 0.3) });
    set('radar_svep', glowA, { e: glowA });
    set('skarm', C(A.h, 0.5, 0.2), { e: C(A.h, 0.7, 0.32) });

    // spakar och rattar efter sällsynthet
    const own = (o) => { const m = new THREE.MeshStandardMaterial(o); this._ownMats.push(m); return m; };
    const metal = { common: { color: 0xb9bcc1, metalness: 0.35, roughness: 0.3 }, epic: { color: 0xe6ebf0, metalness: 0.95, roughness: 0.12 },
      legendary: { color: 0xe2b13c, metalness: 0.9, roughness: 0.22 }, ultra: { color: 0x1c2030, metalness: 0.7, roughness: 0.25 } }[rar];
    const metalM = own({ ...metal, envMap: this.envMap, envMapIntensity: 0.8 });
    const glowM = own({ color: glowA, emissive: glowA, emissiveIntensity: rar === 'ultra' ? 2.2 : 1.4, roughness: 0.2 });
    const gripM = own({ color: rar === 'legendary' ? C(A.h, A.s * 0.6, 0.28) : rar === 'ultra' ? 0x101218 : rar === 'epic' ? 0x1b1d22 : C(A.h, A.s * 0.4, 0.14), roughness: rar === 'epic' ? 0.35 : 0.7, metalness: rar === 'epic' ? 0.4 : 0 });
    const g = (n) => this.cockpit.getObjectByName(n);
    ['pilot', 'andrepilot'].forEach((n) => {
      const arc = g(`rattbage_${n}`), bar = g(`rattbalk_${n}`), hub = g(`ratthub_${n}`);
      if (rar !== 'common') { if (arc) arc.material = metalM; if (bar) bar.material = metalM; }
      if (rar === 'ultra' && hub) hub.material = glowM;
      [-1, 1].forEach((sd) => {
        const grip = g(`rattgrepp_${n}_${sd}`), knob = g(`rattknapp_${n}_${sd}`);
        if (grip) grip.material = gripM;
        if (knob) knob.material = glowM;
        // Ultra: neonlist längs greppen
        if (rar === 'ultra' && grip) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.15, 0.06), glowM);
          strip.position.copy(grip.position); strip.rotation.copy(grip.rotation); strip.position.x += sd * 0.028;
          grip.parent.add(strip); this._interiorExtras.push(strip);
        }
      });
    });
    // gasreglagens knoppar
    const knobGeo = {
      common: null,
      epic: new THREE.CylinderGeometry(0.026, 0.032, 0.05, 10),
      legendary: new THREE.OctahedronGeometry(0.04, 0),
      ultra: new THREE.SphereGeometry(0.03, 18, 12),
    }[rar];
    [0, 1, 2].forEach((i) => {
      const k = g(`gasknopp_${i}`);
      if (!k) return;
      if (knobGeo) k.geometry = knobGeo;
      k.material = rar === 'common' ? own({ color: lamp(i), roughness: 0.4 }) : rar === 'epic' ? metalM : glowM;
      if (rar === 'ultra') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 6, 28), glowM);
        ring.rotation.x = Math.PI / 2;
        k.add(ring); this._interiorExtras.push(ring);
      }
    });
    if (knobGeo) this._interiorExtras.push({ parent: null, geometry: knobGeo });
    ['gasreglage_0', 'gasreglage_1', 'gasreglage_2', 'trimhjul'].forEach((n) => { const o = g(n); if (o && rar !== 'common') o.material = metalM; });

    // ---- väggar och tak: skinets eget mönster (Legendary och mönstrade skins), sci-fi-paneler (Ultra)
    const walls = byName.get('vit_insida') || [], panels = byName.get('panel_mork') || [];
    const texOf = (t, rx, ry) => { if (!t) return null; const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; this._ownTexs.push(c); return c; };
    const body = this.exterior.getObjectByName('flygkropp');
    const bodyMat = body && !body.userData.skinHidden ? body.material : null;
    const canvasTex = (draw) => {
      if (typeof document === 'undefined') return null;
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      draw(cv.getContext('2d'), 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      this._ownTexs.push(t); return t;
    };
    const accentCss = '#' + glowA.getHexString();
    const setMaps = (list, map, color, emap, ei) => list.forEach((m) => {
      m.map = map; m.emissiveMap = emap || null; if (color) m.color.copy(color);
      if (emap) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = ei; }
      m.needsUpdate = true;
    });
    if (rar === 'ultra') {
      // mörka paneler med lysande hexagonlinjer i accentfärgen
      const hex = canvasTex((x, n) => {
        x.fillStyle = '#0d1018'; x.fillRect(0, 0, n, n);
        const r = n / 8, dx = 1.5 * r, dy = Math.sqrt(3) * r;
        x.strokeStyle = accentCss; x.lineWidth = 2.5; x.shadowBlur = 8; x.shadowColor = accentCss;
        for (let i = -1; i <= 6; i++) for (let j = -1; j <= 5; j++) {
          const cx = i * dx, cy = j * dy + (i % 2 ? dy / 2 : 0);
          x.beginPath(); for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3; const px = cx + Math.cos(a) * r * 0.9, py = cy + Math.sin(a) * r * 0.9; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
        }
      });
      if (hex) setMaps(walls, texOf(hex, 3, 3), new THREE.Color(0xffffff), texOf(hex, 3, 3), 0.55);
      set('panel_mork', new THREE.Color(0x111318), { m: 0.6, r: 0.3 });
    } else if (bodyMat && bodyMat.map) {
      // väggarna får samma mönster som planets kropp (kamouflage, zebra, galax, drakfjäll …)
      const glowing = !!bodyMat.emissiveMap;
      setMaps(walls, texOf(bodyMat.map, 2, 2), new THREE.Color(dark ? 0xbfbfbf : 0xffffff), glowing ? texOf(bodyMat.emissiveMap, 2, 2) : null, rar === 'legendary' ? 0.45 : 0.25);
    }
    if (rar === 'epic') {
      // kolfiber på instrumentbrädan och mittkonsolen
      const carbon = canvasTex((x, n) => {
        const q = 16;
        for (let i = 0; i < n / q; i++) for (let j = 0; j < n / q; j++) {
          const hz = (i + j) % 2, gr = hz ? x.createLinearGradient(i * q, 0, i * q + q, 0) : x.createLinearGradient(0, j * q, 0, j * q + q);
          gr.addColorStop(0, '#15161a'); gr.addColorStop(0.5, '#3b3e46'); gr.addColorStop(1, '#15161a');
          x.fillStyle = gr; x.fillRect(i * q, j * q, q, q);
        }
      });
      if (carbon) setMaps(panels, texOf(carbon, 3, 3), new THREE.Color(0xffffff));
      panels.forEach((m) => { m.metalness = 0.35; m.roughness = 0.35; });
    }
    // ---- LED-lister längs fönstren och instrumentbrädan (Epic och uppåt)
    if (rar !== 'common') {
      const ledM = own({ color: glowA, emissive: glowA, emissiveIntensity: rar === 'epic' ? 1.2 : 1.8 });
      const led = (w, h, d, x, y, z, parent = this.cockpit) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ledM); m.position.set(x, y, z); m.name = 'ledlist';
        parent.add(m); this._interiorExtras.push(m);
      };
      [-1, 1].forEach((sd) => led(0.014, 0.012, 2.3, sd * 0.95, 1.136, 0));     // ovanpå fönsterkarmarnas innerkant
      const shield = g('blandskydd');
      if (shield) led(2.2, 0.012, 0.014, 0, 0.056, 0.236, shield);            // framkanten på bländskyddet
      [-1, 1].forEach((sd) => led(0.014, 0.012, 0.9, sd * 0.19, 0.706, -0.55)); // ovanpå mittkonsolen
    }

    // skinets märke mitt på instrumentbrädan (färgprovet i en rund bricka med sällsynthetens ring)
    const dash = g('instrumentpanel');
    if (dash && typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      const gr = x.createConicGradient ? x.createConicGradient(0, 64, 64) : x.createLinearGradient(0, 0, 128, 128);
      meta.swatch.concat(meta.swatch[0]).forEach((col, i, arr) => gr.addColorStop(i / (arr.length - 1), col));
      x.fillStyle = gr; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
      x.lineWidth = 10; x.strokeStyle = { common: '#9aa0a8', epic: '#b07cf0', legendary: '#f2b33d', ultra: '#ff4d8d' }[rar]; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.stroke();
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const badgeM = own({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: rar === 'common' ? 0.25 : 0.6, roughness: 0.3 });
      const geo = new THREE.CircleGeometry(0.036, 32);
      const badge = new THREE.Mesh(geo, badgeM); badge.name = 'skinmarke';
      badge.position.set(0, 0.212, 0.086);
      dash.add(badge); this._interiorExtras.push(badge);
      this._ownTex = tex;
    }
  }

  // Omgivningsljus (reflexer) för planets material, så att metall och blank lack syns som i designen
  setEnvMap(tex) { this.envMap = tex; this._applyEnv(); }
  _applyEnv() {
    if (!this.envMap) return;
    this.exterior.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach((m) => {
        if (!m.isMeshStandardMaterial || m.envMap) return;
        m.envMap = this.envMap; m.envMapIntensity = 0.55; m.needsUpdate = true;
      });
    });
  }

  // Skinets "smäll" vid krasch (färgade partiklar i skinets färger)
  skinPulse(kind) { this.skin.pulse(kind); }

  // Krasch: den del som träffade lossnar som skrot. Vid hård träff (sev >= 0.8) slås hela planet sönder.
  // Skrotet är kopior av modellens delar (delar geometri och material) som läggs i kraschens effekter.
  breakApart(e, fx) {
    const SIDE = {
      'right wing': ['vinge_h', 'vingspets_h', 'motor_h', 'motorring_h', 'spinner_h', 'propeller_h'],
      'left wing': ['vinge_v', 'vingspets_v', 'motor_v', 'motorring_v', 'spinner_v', 'propeller_v'],
      tail: ['stabilisator_h', 'stabilisator_v', 'fena', 'fenspets'],
      nose: ['vindruta_v', 'vindruta_h'],
      body: Math.random() < 0.5 ? ['motor_h', 'motorring_h', 'spinner_h', 'propeller_h'] : ['motor_v', 'motorring_v', 'spinner_v', 'propeller_v'],
    };
    const full = (e.sev || 0) >= 0.8;
    this.root.updateMatrixWorld(true);
    const objs = full ? this.exterior.children.slice() : (SIDE[e.part] || []).map((nm) => this.exterior.getObjectByName(nm));
    if (!full) {
      // skinets extra delar (drakvingar, kanoner …) som sitter på den sida som träffades
      const box = new THREE.Box3(), c = new THREE.Vector3();
      const hit = { 'right wing': (q) => q.z > 1.5, 'left wing': (q) => q.z < -1.5, tail: (q) => q.x < -3.5, nose: (q) => q.x > 3.5 }[e.part];
      if (hit) {
        for (const ch of this.exterior.children) {
          if (!ch.userData.skinExtra || !ch.visible) continue;
          box.setFromObject(ch);
          if (box.isEmpty()) continue;
          box.getCenter(c);
          if (hit(this.exterior.worldToLocal(c))) objs.push(ch);
        }
      }
    }
    const p = new THREE.Vector3(...e.pos), n = new THREE.Vector3(...(e.n || [0, 1, 0]));
    const dir = new THREE.Vector3(...(e.dir || [0, 0, -1]));
    const td = dir.clone().addScaledVector(n, -dir.dot(n));
    const speed = e.speed || 40;
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    for (const obj of objs) {
      if (!obj || !obj.visible) continue;
      obj.matrixWorld.decompose(wp, wq, ws);
      const copy = obj.clone();                           // delar geometri och material med originalet
      copy.position.copy(wp); copy.quaternion.copy(wq); copy.scale.copy(ws);
      obj.visible = false;
      const near = wp.distanceTo(p) < 6 ? 1.4 : 1;          // delar nära träffen kastas hårdast
      const out = wp.clone().sub(p).normalize();
      const v = out.multiplyScalar((full ? 8 : 6) * near).addScaledVector(n, 6).addScaledVector(td, speed * (full ? 0.25 : 0.35)).add(new THREE.Vector3(0, full ? 10 : 6, 0));
      const w = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      fx.addDebris(copy, v, w);
    }
  }

  // Ny start: alla delar tillbaka på planet
  restoreParts() {
    // delar som skinet döljer (t.ex. originalvingarna under drakvingar) förblir dolda
    this.exterior.traverse((c) => { if (c !== this.exterior) c.visible = !c.userData.skinHidden; });
    this.skin.clear();
  }

  // Tillägg till cockpitmodellen (originalet i models.js är orört): referensmodellen
  // har öppna sidor ovanför sidoväggarna och inget tak, men flygplanet utifrån är
  // slutet. Här fylls sidorna, taket och bakväggen i, med ett tonat sidofönster fram.
  _buildCabinShell() {
    const shellMat = this._get('framvagg').material;   // samma vita insida som modellen
    const glassMat = new THREE.MeshStandardMaterial({ name: 'sidoglas', color: 0x27323f, roughness: 0.15, transparent: true, opacity: 0.6 });
    const g = new THREE.Group(); g.name = 'kabinskal';
    // sidopanel i (z, y): från sidoväggens överkant upp till taket, framkanten följer A-stolpen
    const panel = new THREE.Shape([
      [-1.2, 1.02], [1.3, 1.02], [1.3, 2.08], [-0.7, 2.08], [-1.2, 1.3],
    ].map(([z, y]) => new THREE.Vector2(z, y)));
    // fönsteröppning fram (rundade hörn)
    const hole = new THREE.Path();
    const z0 = -0.72, z1 = -0.08, y0 = 1.2, y1 = 1.74, r = 0.08;
    hole.moveTo(z0 + r, y0); hole.lineTo(z1 - r, y0); hole.quadraticCurveTo(z1, y0, z1, y0 + r);
    hole.lineTo(z1, y1 - r); hole.quadraticCurveTo(z1, y1, z1 - r, y1); hole.lineTo(z0 + r, y1);
    hole.quadraticCurveTo(z0, y1, z0, y1 - r); hole.lineTo(z0, y0 + r); hole.quadraticCurveTo(z0, y0, z0 + r, y0);
    panel.holes.push(hole);
    const panelGeo = new THREE.ExtrudeGeometry(panel, { depth: 0.06, bevelEnabled: false });
    panelGeo.rotateY(-Math.PI / 2);   // formens x blir z, extruderingen blir -x
    const glassShape = new THREE.Shape(hole.getPoints());
    const glassGeo = new THREE.ShapeGeometry(glassShape);
    glassGeo.rotateY(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(panelGeo, shellMat);
      m.name = `kabinvagg_${s}`;
      m.position.x = s > 0 ? 1.13 : -1.07;   // geometrin sträcker sig 0.06 åt -x
      g.add(m);
      const gl = new THREE.Mesh(glassGeo, glassMat);
      gl.name = `sidofonster_${s}`;
      gl.position.x = s * 1.1;
      g.add(gl);
    }
    // tak och bakvägg
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 2.0), shellMat);
    roof.name = 'kabintak'; roof.position.set(0, 2.1, 0.3); g.add(roof);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.1, 0.06), shellMat);
    back.name = 'bakvagg'; back.position.set(0, 1.05, 1.3); g.add(back);
    // lister som täcker skarven mellan tak och vindruteram
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, 0.12), shellMat);
    trim.name = 'taklist'; trim.position.set(0, 2.06, -0.72); g.add(trim);
    this.cockpit.add(g);
  }

  // Skapar vridpunkter så att visare, svep och horisont kan röra sig
  _pivotNeedle(gaugeName) {
    const needle = this._get(`${gaugeName}_visare`);
    if (!needle) return null;
    const grp = needle.parent;
    const r = Math.hypot(needle.position.x, needle.position.y) / 0.27;
    const piv = new THREE.Group(); piv.name = `${gaugeName}_visarvrid`;
    grp.add(piv);
    needle.position.set(0, r * 0.27, 0.035);
    needle.rotation.set(0, 0, 0);
    piv.add(needle);
    piv.rotation.z = 0.8;
    return piv;
  }

  _setupInstruments() {
    const c = this.cockpit;
    this.yokes = ['ratt_pilot', 'ratt_andrepilot'].map((n) => this._get(n));
    this.yokeRest = this.yokes.map((y) => y.position.clone());
    this.needles = {};
    ['hastighet', 'kompass', 'hojdmatare', 'varvtal', 'bransle', 'oljetryck', 'temperatur'].forEach((n) => { this.needles[n] = this._pivotNeedle(n); });

    // radarsvep
    const sweep = this._get('radar_pilot_svep');
    this.sweepPivot = new THREE.Group(); sweep.parent.add(this.sweepPivot); this.sweepPivot.add(sweep);
    // konstgjord horisont
    const sky = this._get('horisont_himmel'), ground = this._get('horisont_mark');
    this.horizonPivot = new THREE.Group(); sky.parent.add(this.horizonPivot);
    this.horizonPivot.add(sky, ground);
    this.horizonR = 0.12;

    // gasreglage: vridpunkt vid basen
    c.updateMatrixWorld(true);
    this.levers = [0, 1, 2].map((i) => {
      const lever = this._get(`gasreglage_${i}`), knob = this._get(`gasknopp_${i}`);
      const axis = V(0, 1, 0).applyEuler(lever.rotation);
      const base = lever.position.clone().addScaledVector(axis, -0.1);
      const piv = new THREE.Group(); piv.name = `gasvrid_${i}`; piv.position.copy(base);
      c.add(piv); piv.updateMatrixWorld(true);
      piv.attach(lever); piv.attach(knob);
      return { piv, knob };
    });

    // varningslampa och knappar som kan blinka (egna material)
    const own = (n) => { const o = this._get(n); if (o) o.material = o.material.clone(); return o; };
    this.warn = own('varningslampa');
    this.roofLamps = [own('taklampa'), own('taklampa2')];
    this.roofSwitches = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) this.roofSwitches.push(this._get(`takbrytare_${i}${j}`));
    this.switchIdx = 0;
    this.dashButtons = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) this.dashButtons.push(own(`knapp_${j}${i}`));
    this.screen = own('skarm_mitt');
  }

  // Gester från navigatören: 'left' | 'right' | 'up' | 'down' | 'press'
  gesture(kind) {
    if (kind === 'press') {
      this.pressT = 0.9;
      this.pressSwitch = this.roofSwitches[[8, 9, 6, 7][this.switchIdx++ % 4]];
      return;
    }
    this.gest = { kind, t: 1.8 };
  }

  setView(v) {
    this.view = v;
    const inside = v === 'cockpit';
    this.cockpit.visible = inside;
    this.exteriorWrap.visible = !inside;
  }

  // Punkt i ett barn till cockpiten -> cockpitens koordinater
  _toCockpit(obj, local = V()) {
    const p = local.clone();
    let o = obj;
    while (o && o !== this.cockpit) { o.updateMatrix(); p.applyMatrix4(o.matrix); o = o.parent; }
    return p;
  }

  // st: { x,y,z,yaw,pitch,roll,speed,ix,iy,throttle,accLong,loadN,rollAcc,phase }
  update(dt, st, opts = {}) {
    this.time += dt;
    const R = this.root;
    R.position.set(st.x, st.y, st.z);
    R.rotation.set(st.pitch, st.yaw, st.roll);

    // propellrar
    const spin = (st.phase === 'crashed' ? 4 : 30 + st.speed * 0.9);
    this.props.forEach((p, i) => { if (p) p.rotation.x += (i ? -1 : 1) * spin * dt; });

    // skinets animationer och effekter (inga partiklar vid kameran när man sitter i cockpit)
    R.updateMatrixWorld(true);
    this.skin.update(dt, {
      fly: st.phase === 'fly', alive: st.phase !== 'crashed', trail: this.skinTrail,
      exclude: this.view === 'cockpit' ? this.skinCam : null, excludeR: 6,
    });

    // rattarna följer spaken (rollen = vrid, tippning = in/ut)
    const ix = st.ix || 0, iy = st.iy || 0;
    this.yokes.forEach((y, i) => {
      y.rotation.z += (-ix * 0.75 - y.rotation.z) * Math.min(1, dt * 14);
      const tz = this.yokeRest[i].z + iy * 0.09;
      y.position.z += (tz - y.position.z) * Math.min(1, dt * 14);
    });

    // gasreglage
    const th = st.throttle || 0;
    this.levers.forEach((l, i) => {
      const t = i === 2 ? 0 : -th * 0.4;
      l.piv.rotation.x += (t - l.piv.rotation.x) * Math.min(1, dt * 10);
    });

    // instrument
    const N = this.needles;
    const setN = (n, a) => { if (N[n]) N[n].rotation.z += (-a - N[n].rotation.z) * Math.min(1, dt * 8); };
    setN('hastighet', -2.4 + THREE.MathUtils.clamp((st.speed - 20) / 70, 0, 1) * 4.8);
    if (N.kompass) N.kompass.rotation.z = st.yaw;
    if (N.hojdmatare) N.hojdmatare.rotation.z = -(st.y / 100) * Math.PI * 2;
    setN('varvtal', -1.2 + (th + 1) * 1.1 + Math.sin(this.time * 31) * 0.03);
    setN('bransle', 1.6 - this.time * 0.002);
    setN('oljetryck', 0.5 + Math.sin(this.time * 0.7) * 0.08 + th * 0.2);
    setN('temperatur', 0.2 + Math.sin(this.time * 0.3) * 0.05);
    this.sweepPivot.rotation.z -= dt * 2.6;
    this.horizonPivot.rotation.z = -st.roll;
    this.horizonPivot.position.y = THREE.MathUtils.clamp(-st.pitch * 0.08, -0.03, 0.03);

    const crashed = st.phase === 'crashed';
    const blink = (Math.sin(this.time * 12) > 0) ? 1 : 0;
    if (this.warn) this.warn.material.emissiveIntensity = crashed || st.y < 12 ? 2.5 * blink : 0.25;
    if (this.screen) this.screen.material.emissiveIntensity = 0.6 + 0.2 * Math.sin(this.time * 3);

    // ---- figurer ----
    const accel = V((st.rollAcc || 0) * 1.1, ((st.loadN || 1) - 1) * 9.81, st.accLong || 0);
    const shake = crashed ? 0.03 : 0.0003 + Math.min(0.0012, Math.abs(st.rollAcc || 0) * 0.00004);

    // Pilot: händerna på ratten, höger hand till gasen när man gasar/bromsar
    const yokeP = this.yokes[0];
    const gripL = this._toCockpit(yokeP, V(-0.15, 0.08, 0));
    const gripR = this._toCockpit(yokeP, V(0.15, 0.08, 0));
    if (th !== 0) this.throttleHold = 0.5; else this.throttleHold -= dt;
    const knob = this._toCockpit(this.levers[1].knob);
    const pilotHands = [gripL, this.throttleHold > 0 ? knob.add(V(-0.01, 0.03, 0.02)) : gripR];
    if (crashed) { pilotHands[0] = V(-0.75, 1.55, -0.1); pilotHands[1] = V(-0.45, 1.55, -0.1); }
    const pilotLook = opts.pilotLook || { yaw: 0, pitch: 0 };
    this.pilot.update(dt, {
      hands: pilotHands,
      accel, shake,
      lean: this.pilot.reachDeficit(pilotHands),
      look: { yaw: pilotLook.yaw + (crashed ? 0.3 : 0), pitch: -0.06 + pilotLook.pitch },
      brace: crashed ? 1 : th < 0 ? 0.6 : 0,
    });

    // Andrepilot (navigatören): vila, peka eller trycka på knappar
    const X = 0.6;
    const rest = [V(X - 0.13, 0.72, 0.06), V(X + 0.13, 0.72, 0.06)];
    const cpHands = rest.map((v) => v.clone());
    const point = [false, false];
    let look = { yaw: 0, pitch: -0.15 };
    let sideLean = 0;
    if (this.gest) sideLean = -0.16;   // lutar sig mot piloten när den pekar – syns bättre
    const shL = V(X - 0.215 + (this.copilot.sideLean || 0), 1.23, 0.22);
    if (this.gest) {
      this.gest.t -= dt;
      const dirs = { left: V(-0.75, 0.15, -0.65), right: V(0.25, 0.12, -0.96), up: V(-0.2, 0.92, -0.35), down: V(-0.3, -0.4, -0.86) };
      const d = (dirs[this.gest.kind] || dirs.left).clone().normalize();
      cpHands[0] = shL.clone().addScaledVector(d, 0.86);
      point[0] = true;
      look = { yaw: 0.85, pitch: -0.05 };   // tittar på piloten medan den pekar
      if (this.gest.t <= 0) this.gest = null;
    } else if (this.pressT > 0) {
      this.pressT -= dt;
      const sw = this.pressSwitch;
      const p = this._toCockpit(sw);
      cpHands[0] = p.add(V(0, -0.02, 0.03));
      point[0] = true;
      look = { yaw: 0.25, pitch: 0.7 };
      if (this.pressT < 0.45 && !this._flipped) {
        this._flipped = true;
        sw.rotation.x = -sw.rotation.x;
        this.roofLamps.forEach((l) => { l.material.emissiveIntensity = 3; });
      }
      if (this.pressT <= 0) this._flipped = false;
    } else if (this.localSeat !== 'copilot') {
      // tittar runt lite när den inte gör något
      const I = this.idle;
      I.t += dt;
      if (I.t > I.next) {
        I.t = 0; I.next = 1.5 + Math.random() * 3;
        const r = Math.random();
        I.yaw = r < 0.3 ? 0.8 : r < 0.6 ? 0.15 : -0.2; I.pitch = r < 0.3 ? -0.05 : r < 0.6 ? -0.45 : -0.1;
      }
      look = { yaw: I.yaw, pitch: I.pitch };
    } else {
      look = opts.copilotLook || { yaw: 0.45, pitch: -0.12 };
    }
    this.roofLamps.forEach((l) => { l.material.emissiveIntensity += (1.2 - l.material.emissiveIntensity) * Math.min(1, dt * 3); });
    if (crashed) { cpHands[0] = V(0.45, 1.55, -0.1); cpHands[1] = V(0.75, 1.55, -0.1); }
    this.copilot.update(dt, {
      hands: cpHands, point, accel, shake,
      lean: this.copilot.reachDeficit(cpHands),
      look, brace: crashed ? 1 : 0, sideLean,
    });
  }

  // Cockpitkamerans position och riktning i världen: förstaperson i huvudhöjd,
  // men flyttad in mot planets mitt (mellan den egna stolen och mittkonsolen)
  // och en bit bakåt, så att man ser både sig själv och kompisen med den höga FOV:n.
  // Riktningen följer planet, inte huvudets gung, så kameran är stabil.
  // look = { yaw, pitch } för att titta runt (Q/E eller dra).
  eyePose(seat, outPos, outQuat, look) {
    this.root.updateMatrixWorld(true);
    const av = seat === 'copilot' ? this.copilot : this.pilot;
    const toFriend = seat === 'copilot' ? -1 : 1;     // riktning (x) mot kompisen
    outPos.copy(av.eye).add(V(toFriend * 0.32, 0.03, 0.2));
    this.cockpit.localToWorld(outPos);
    this.cockpit.getWorldQuaternion(outQuat);
    const ly = look ? look.yaw : 0, lp = look ? look.pitch : 0;
    this._eyeQ = this._eyeQ || new THREE.Quaternion();
    // positiv yaw = vänster; vrid en aning mot kompisen
    this._eyeQ.setFromEuler(new THREE.Euler(-0.1 + lp, -toFriend * 0.08 + ly, 0, 'YXZ'));
    outQuat.multiply(this._eyeQ);
  }

  dispose() {
    this.skin.dispose();
    this.pilot.dispose(); this.copilot.dispose();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}
