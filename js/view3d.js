// 3D-vy: renderar världen och planet från en plats i cockpiten eller utifrån.
// Används av piloten (helskärm) och av navigatören (litet fönster).
import * as THREE from './lib/three.module.min.js';
import { World3D } from './world3d.js';
import { PlaneRig } from './rig.js';
import { CrashFX } from './crashfx.js';
import { sfx } from './sfx.js';
import { makeEnvMap } from './envmap.js';
import { EffectComposer } from './lib/post/EffectComposer.js';
import { RenderPass } from './lib/post/RenderPass.js';
import { UnrealBloomPass } from './lib/post/UnrealBloomPass.js';
import { OutputPass } from './lib/post/OutputPass.js';
import { Cutscene, approachPose, followCam, INTRO_LEN, COUNTDOWN_LEN } from './cutscene.js';
import { skinById } from './skins.js';
import { IntroFX } from './cinefx.js';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);

export class View3D {
  // seat: 'pilot' | 'copilot'
  constructor(holder, level, opts = {}) {
    this.holder = holder;
    this.level = level;
    this.seat = opts.seat || 'pilot';
    this.mode = 'auto';   // 'auto' | 'outside'
    const canvas = document.createElement('canvas');
    canvas.className = 'view3d';
    holder.appendChild(canvas);
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);

    this.world = new World3D(level);
    this.world.onThunder = () => sfx.thunder();
    this.denseFog = this.seat === 'pilot';   // navigatören ser genom dimman
    // partikelbudget: mer för Legendary och Ultra (lite mindre på mobil)
    this.rig = new PlaneRig(this.seat, {
      maxParticles: opts.maxParticles ?? 220, rate: opts.rate ?? 0.6,
      highMax: TOUCH ? 280 : 400, highRate: TOUCH ? 0.85 : 1,
    });
    // glöd (bloom): på datorn alltid, på mobil bara i cutscenen
    this.bloomInGame = opts.bloom ?? !TOUCH;
    this.cine = null;
    this.introDone = false;
    this.world.scene.add(this.rig.root);
    this.world.scene.add(this.rig.skin.group);         // skinets partikeleffekter
    try { this.rig.setEnvMap(makeEnvMap(this.renderer)); } catch (e) { console.warn('envmap', e); }
    this.fx = new CrashFX(this.world.scene);   // kraschens effekter (bara när planet nuddar något)
    this.crash = null;
    this._shake = V();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.04, this.world.maxFar + 20);
    this.rig.skinCam = this.camera.position;           // inga skin-partiklar runt kameran i cockpit
    this.blend = 0;          // 0 = utifrån, 1 = cockpit
    this.orbitA = 0;
    this.chasePos = null;
    this.chaseYaw = level.start.yaw;
    this._p = V(); this._q = new THREE.Quaternion();
    this._cp = V(); this._cq = new THREE.Quaternion();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  resize() {
    const w = this.holder.clientWidth || window.innerWidth;
    const h = this.holder.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._composer) { this._composer.setSize(w, h); this._bloom.resolution.set(w, h); }
  }

  // Glöd runt det som lyser (skinens effekter, ljusband, glödande delar)
  _composerFor() {
    if (this._composer) return this._composer;
    const w = this.holder.clientWidth || window.innerWidth, h = this.holder.clientHeight || window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.world.scene, this.camera));
    // bara det som verkligen lyser (glödande skins, ljusband, effekter) får sken; vanliga ytor och lampor nästan inte
    this._bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 1.2);
    c.addPass(this._bloom);
    c.addPass(new OutputPass());
    c.setSize(w, h);
    this._composer = c;
    return c;
  }

  _render(bloom) {
    if (bloom) {
      try { this._composerFor().render(); return; } catch (e) { console.warn('bloom', e); this.bloomInGame = false; this._noBloom = true; }
    }
    this.renderer.render(this.world.scene, this.camera);
  }

  // Förbered allt som annars kompileras eller laddas upp första gången det syns (cockpit, skin,
  // glöd, krascheffekter, cutscenens händelse), så att det inte hackar mitt i spelet.
  warmUp() {
    const r = this.renderer, scene = this.world.scene, rig = this.rig, fx = this.fx;
    if (!this.introFx) this.introFx = new IntroFX(this.world, this.level);
    const vis = { cockpit: rig.cockpit.visible, ext: rig.exteriorWrap.visible };
    rig.cockpit.visible = true; rig.exteriorWrap.visible = true; rig.showCrew(true);
    const tmp = [fx._mesh(true), fx._mesh(false), new THREE.Mesh(fx.cube, fx.concrete)];
    tmp.forEach((m) => { m.visible = true; m.position.set(this.level.start.x, -50, this.level.start.z); fx.root.add(m); });
    const scorch = fx.scorch.visible; fx.scorch.visible = true;
    const undo = rig.skin.prewarm();
    this.introFx.showAllForWarmup(true);
    // Antalet ljuskällor ändras när cockpiten (med sin kabinlampa) visas eller göms, och då behövs andra
    // varianter av alla program. Därför kompileras båda lägena, för skärmen och för glödens bildbuffert.
    const compileBoth = (target) => {
      const prev = r.getRenderTarget();
      r.setRenderTarget(target);
      r.compile(scene, this.camera);                       // med cockpit (kabinlampa tänd)
      rig.cockpit.visible = false;
      r.compile(scene, this.camera);                       // utan cockpit (följekamera, utifrån)
      rig.cockpit.visible = true;
      r.setRenderTarget(prev);
    };
    try {
      compileBoth(null);
      // texturer laddas upp nu, inte när de syns första gången
      const seen = new Set();
      scene.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach((m) => ['map', 'emissiveMap', 'envMap', 'alphaMap'].forEach((k) => { const t = m[k]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); r.initTexture(t); } }));
      });
      // glöden (cutscenen använder den alltid): allt kompileras också för glödens bildbuffert
      // (andra varianter av programmen än för skärmen), och en bild ritas så att glödens egna program kompileras
      if (!this._noBloom) {
        const c = this._composerFor();
        compileBoth(c.readBuffer);
        c.render();
        rig.cockpit.visible = false; c.render(); rig.cockpit.visible = true;
      }
    } catch (e) { console.warn('warmUp', e); }
    this.introFx.showAllForWarmup(false);
    undo();
    fx.scorch.visible = scorch;
    tmp.slice(0, 2).forEach((m) => { fx.root.remove(m); (m.userData.lit ? fx.pool.lit : fx.pool.flat).push(m); });
    fx.root.remove(tmp[2]);
    rig.cockpit.visible = vis.cockpit; rig.exteriorWrap.visible = vis.ext; rig.showCrew(false);
    this.warm = true;
  }

  // Cutscene vid början av banan. opts: se Cutscene. Slutar av sig själv, med Skip, eller när nedräkningen börjar.
  playIntro(root, opts) {
    if (this.cine) this.cine.destroy();
    if (!this.warm) this.warmUp();
    this.introFx.start();
    this.cine = new Cutscene(this, root, { ...opts, level: this.level });
  }

  _endIntro() {
    const c = this.cine;
    this.cine = null;
    this.introDone = true;
    this.rig.showCrew(false);
    // tillbaka till följekameran (vinkel 1); den glider sedan bakom planet och in i cockpit under nedräkningen
    const p = approachPose(this.level, COUNTDOWN_LEN), look = V();
    this.chasePos = V();
    followCam(p, 1, this.chasePos, look);
    this.blend = 0;
    if (c) c.destroy();
    // världens dimma och ljus tillbaka som vanligt
    if (this.introFx) { this.introFx.dispose(); this.introFx = null; }
    this.world._fogK = -1;
    this.world.hemi.intensity = this.world.hemiBase;
  }

  _cineFrame(dt, st) {
    const cine = this.cine, rig = this.rig, cam = this.camera;
    const s2 = cine.planeState(st);
    const dash = cine.inDashcam();
    rig.setView(dash ? 'cockpit' : 'outside');
    rig.showCrew(dash);
    const ifx = this.introFx;
    if (ifx) s2.roll += ifx.roll(cine.t);
    rig.update(dt, s2, dash ? cine.crewLooks() : {});
    this.world.updateGates(0);
    this.world.animate(dt, cam.position, st.ft);
    this.fx.update(dt);
    this.world.setFogMix(0);
    // världens händelse (snöstorm, stenras, utbrott …): dimma, blixtljus, skakningar och åska
    if (ifx) {
      ifx.update(dt, s2, cam.position, dash);
      const f = this.world.scene.fog;
      if (ifx.fog) { f.color.setHex(ifx.fog.color); f.near = ifx.fog.near; f.far = ifx.fog.far; }
      else { f.color.copy(this.world.fogA.color); f.near = this.world.fogA.near; f.far = this.world.fogA.far; }
      if (ifx.flash > 0) f.color.lerp(this._flashCol || (this._flashCol = new THREE.Color(0xfff2e0)), ifx.flash * 0.35);
      this.world.scene.background.copy(f.color);
      this.world.hemi.intensity = this.world.hemiBase + ifx.flash * 2.6;
      for (let n = ifx.takeThunder(); n > 0; n--) sfx.thunder();
    }
    const far = this.world.scene.fog.far + 25;
    if (Math.abs(cam.far - far) > 2) { cam.far = far; cam.updateProjectionMatrix(); }
    const fov = cine.camera(rig, s2, cam.position, cam.quaternion);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // skakande kamera (mindre inne i kabinen)
    const sh = ifx ? ifx.shake * (dash ? 0.25 : 1) : 0;
    if (sh > 0) cam.position.add(V((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    this._render(!this._noBloom);
  }

  gesture(kind) { this.rig.gesture(kind); }

  // Kraschen anpassas efter vad som träffades, var, med vilken del och hur hårt
  gateBurst(e) {
    this.world.gateBurst(e.gate, e.perfect, e.combo);
    // Legendary och Ultra: skinets egen smäll när man flyger genom ringen
    const r = skinById(this.rig.skinId).rarity;
    if (r === 'legendary' || r === 'ultra') this.rig.skinPulse('ring');
  }

  onCrash(e) {
    if (!e || !e.pos) return;
    const d = V(...(e.dir || [0, 0, -1])); d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    this.crash = { pos: V(...e.pos), sev: e.sev || 1, t: 0, dir: d.normalize() };
    this.fx.burst(e);
    this.rig.skinPulse('krasch');                      // skinets egen smäll i skinets färger
    this.rig.breakApart(e, this.fx);
  }

  // Ny runda: delarna tillbaka, skrot och brännmärke bort
  onRespawn() {
    this.crash = null;
    this.fx.clearWreck();
    this.rig.restoreParts();
  }
  setRoute(pts) { this.world.setRoute(pts); }

  // st: planets tillstånd + phase, countdown (cd), nextGate (ng)
  // look: pilotens blick runtom {yaw,pitch}
  frame(dt, st, look) {
    const rig = this.rig;
    // cutscene: slutar när den är klar, eller när nedräkningen redan har börjat (t.ex. hos navigatören)
    if (this.cine) {
      if (st.phase !== 'waiting') this.cine.skip();
      else this.cine.update(dt, rig);
      if (this.cine.done) this._endIntro();
      else { this._cineFrame(dt, st); return; }
    }
    // inflygning: före och under nedräkningen flyger planet in mot startlinjen och når den på GO
    if (st.phase === 'waiting' || st.phase === 'countdown') {
      const p = approachPose(this.level, st.phase === 'countdown' ? Math.max(0, st.cd || 0) : COUNTDOWN_LEN);
      st = { ...st, x: p.x, z: p.z, speed: Math.max(st.speed || 0, 40) };
    }
    rig.update(dt, st, this.seat === 'pilot' ? { pilotLook: look } : { copilotLook: look });
    this.world.updateGates(st.ng || 0);
    this.world.animate(dt, this.camera.position, st.ft);
    this.fx.update(dt);
    if (st.phase === 'crashed' && this.crash) {
      this.crash.t += dt;
      this.fx.trail(V(st.x, st.y, st.z), this.crash.sev);    // vraket ryker och brinner medan det tumlar
    }

    // Vilken kameraposition vill vi ha?
    let target;
    if (this.mode === 'outside') target = 0;
    else if (st.phase === 'fly') target = 1;
    else if (st.phase === 'countdown') target = smooth(Math.min(1, Math.max(0, 1 - (st.cd || 0) / 3)));
    else target = 0;
    if (st.phase === 'countdown' && this.mode !== 'outside') this.blend = target;
    else if (target > this.blend) this.blend = Math.min(target, this.blend + dt * (st.phase === 'fly' ? 2.5 : 1));
    else this.blend = Math.max(target, this.blend - dt * 4);
    if (this._lastPhase === 'crashed' && st.phase === 'fly' && this.mode !== 'outside') this.blend = 1; // efter respawn: direkt in
    this._lastPhase = st.phase;

    // Utifrån-kamera
    if (st.phase !== 'crashed') this.chaseYaw = st.yaw;
    const planeP = V(st.x, st.y, st.z);
    let outPos, outLook;
    if ((st.phase === 'waiting' && !this.introDone) || st.phase === 'finished') {
      this.orbitA += dt * 0.25;
      outPos = V(st.x + Math.sin(this.orbitA) * 24, st.y + 5, st.z + Math.cos(this.orbitA) * 24);
      outLook = planeP.clone();
      this.chasePos = null;
    } else {
      const back = V(Math.sin(this.chaseYaw) * 22, 6, Math.cos(this.chaseYaw) * 22);
      const want = planeP.clone().add(back);
      if (!this.chasePos) this.chasePos = want.clone();
      this.chasePos.lerp(want, Math.min(1, dt * (st.phase === 'crashed' ? 1.5 : 5)));
      outPos = this.chasePos;
      outLook = planeP.clone().add(V(-Math.sin(this.chaseYaw) * 6, 1, -Math.cos(this.chaseYaw) * 6));
      // efter smällen: kameran glider till en plats bakom och ovanför kontaktpunkten och följer den
      if (st.phase === 'crashed' && this.crash) {
        const C = this.crash;
        const want = C.pos.clone().addScaledVector(C.dir, -36).add(V(0, 14, 0));
        if (want.y < C.pos.y + 6) want.y = C.pos.y + 6;
        this.chasePos.lerp(want, Math.min(1, dt * 3));
        outLook = C.pos.clone().add(V(0, 2, 0)).lerp(planeP, 0.3);
      }
    }
    if (outPos.y < 2) outPos.y = 2;

    const cam = this.camera;
    // cockpitpose
    rig.eyePose(this.seat, this._cp, this._cq, this.seat === 'pilot' ? look : null);
    // utifrånpose
    this._p.copy(outPos);
    const m = new THREE.Matrix4().lookAt(outPos, outLook, V(0, 1, 0));
    this._q.setFromRotationMatrix(m);

    const b = this.blend;
    this.world.setFogMix(this.denseFog ? b : 0);
    // rita bara så långt man ser (dimman) – sparar kraft på mobilen
    const far = this.world.scene.fog.far + 25;
    if (Math.abs(cam.far - far) > 2) { cam.far = far; cam.updateProjectionMatrix(); }
    cam.position.copy(this._p).lerp(this._cp, b);
    if (this.fx.shake > 0) cam.position.add(this.fx.shakeOffset(this._shake));   // kameraskak efter smällen
    cam.quaternion.copy(this._q).slerp(this._cq, b);
    const fov = 60 + (95 - 60) * b;   // hög FOV i cockpiten
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    rig.setView(b > 0.88 ? 'cockpit' : 'outside');
    this._render(this.bloomInGame && !this._noBloom);
  }

  destroy() {
    if (this.cine) { this.cine.destroy(); this.cine = null; }
    if (this.introFx) { this.introFx.dispose(); this.introFx = null; }
    if (this._composer) { this._composer.dispose(); this._composer = null; }
    window.removeEventListener('resize', this._resize);
    this.fx.dispose();
    this.rig.dispose();
    this.world.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (_) {}
    this.canvas.remove();
  }
}
