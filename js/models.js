// Flygplan (exteriör) och cockpit (interiör).
// Exakt överföring av referensen reference/models.js (buildPlane/buildCockpit):
// samma mått, positioner, rotationer, färger och delnamn. Enheter i meter, y uppåt.
// Flygplanets nos pekar mot +x. Cockpitens framriktning är −z och golvet ligger på y = 0.
import * as THREE from './lib/three.module.min.js';

const M = (name, color, o = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: 0.5, metalness: 0, ...o });
const glow = (name, color, i = 1.2) => M(name, color, { emissive: color, emissiveIntensity: i, roughness: 0.3 });

function mesh(geo, mat, name, pos = [0, 0, 0], rot = [0, 0, 0], parent) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name; m.position.set(...pos); m.rotation.set(...rot);
  if (parent) parent.add(m);
  return m;
}

// Rundad låda centrerad i origo
export function rbox(w, h, d, r = 0.02) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, iw = w - 2 * r, ih = h - 2 * r;
  s.moveTo(x, y - r); s.lineTo(x + iw, y - r); s.quadraticCurveTo(x + iw + r, y - r, x + iw + r, y);
  s.lineTo(x + iw + r, y + ih); s.quadraticCurveTo(x + iw + r, y + ih + r, x + iw, y + ih + r);
  s.lineTo(x, y + ih + r); s.quadraticCurveTo(x - r, y + ih + r, x - r, y + ih);
  s.lineTo(x - r, y); s.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 4, curveSegments: 6 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

function beam(a, b, w, h, mat, name, parent) {
  a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
  const m = new THREE.Mesh(rbox(w, h, a.distanceTo(b), Math.min(w, h) * 0.3), mat);
  m.name = name; m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b);
  parent.add(m); return m;
}

/* ───────────── FLYGPLAN ───────────── */
export function buildPlane() {
  const g = new THREE.Group(); g.name = 'flygplan';
  const white = M('vit_lack', 0xf4f3f0, { roughness: 0.4 });
  const grey = M('ljusgra', 0xc6c9ce, { roughness: 0.35, metalness: 0.2 });
  const glass = M('fonster', 0x27323f, { roughness: 0.15 });
  const black = M('propeller', 0x2a2b2e, { roughness: 0.6 });
  const gold = M('guld', 0xb68235, { roughness: 0.4 });

  const prof = new THREE.SplineCurve([
    [0.02, -6.2], [0.3, -6.0], [0.5, -5.0], [0.8, -3.5], [1.0, -2.0], [1.0, 0], [1.0, 3.0],
    [0.93, 4.2], [0.72, 5.2], [0.42, 5.8], [0.12, 6.08], [0.0, 6.12],
  ].map((p) => new THREE.Vector2(...p))).getPoints(80);
  const upturn = (geo) => {
    geo.rotateZ(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (x < -1.5) p.setY(i, p.getY(i) + 0.035 * (-1.5 - x) ** 2); }
    geo.computeVertexNormals(); return geo;
  };
  const fus = mesh(upturn(new THREE.LatheGeometry(prof, 64)), white, 'flygkropp', [0, 0, 0], [0, 0, 0], g);
  fus.material.side = THREE.DoubleSide;

  // vindruta: skivor av nosens yta
  const nose = prof.filter((p) => p.y > 4.25 && p.y < 5.15).map((p) => new THREE.Vector2(p.x * 1.006, p.y));
  const top = Math.PI * 1.5;
  [[top - 0.8, 0.74], [top + 0.06, 0.74]].forEach(([s, l], i) => {
    mesh(upturn(new THREE.LatheGeometry(nose, 24, s, l)), glass, `vindruta_${i ? 'h' : 'v'}`, [0, 0, 0], [0, 0, 0], g).material.side = THREE.DoubleSide;
  });

  // kabinfönster
  const win = rbox(0.24, 0.32, 0.06, 0.05);
  for (let i = 0; i < 9; i++) {
    const x = -1.7 + i * 0.5;
    mesh(win, glass, `fonster_h${i}`, [x, 0.3, 0.955], [-0.3, 0, 0], g);
    mesh(win, glass, `fonster_v${i}`, [x, 0.3, -0.955], [0.3, 0, 0], g);
  }
  // dörr
  mesh(rbox(0.5, 0.9, 0.03, 0.08), grey, 'dorr', [-2.45, 0.05, 0.985], [-0.05, 0, 0], g);

  const halfWing = (pts, depth, bevel, side) => {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * side)));
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4 });
    geo.rotateX(Math.PI / 2); geo.translate(0, depth / 2, 0); return geo;
  };
  const wing = [[1.3, 0], [0.55, 6.6], [-0.25, 6.6], [-0.9, 0]];
  const tail = [[-4.95, 0], [-5.75, 2.3], [-6.25, 2.3], [-6.25, 0]];
  [1, -1].forEach((sd) => {
    const n = sd > 0 ? 'h' : 'v';
    mesh(halfWing(wing, 0.16, 0.05, sd), white, `vinge_${n}`, [0.3, -0.45, 0], [sd * -0.06, 0, 0], g);
    mesh(halfWing(tail, 0.09, 0.03, sd), white, `stabilisator_${n}`, [0, 0.62, 0], [sd * -0.04, 0, 0], g);
    mesh(rbox(0.7, 0.05, 0.12, 0.02), gold, `vingspets_${n}`, [-0.15, -0.45 + sd * 0 + 0.4, sd * 6.62], [0, 0, 0], g).position.y = -0.45 + 0.4 + 0.0;
  });
  // vingspetsarnas höjd med dihedral
  g.children.filter((c) => c.name.startsWith('vingspets')).forEach((c) => {
    c.position.set(-0.03, -0.45 + 6.62 * Math.sin(0.06), Math.sign(c.position.z) * 6.62 * Math.cos(0.06));
    c.rotation.x = -Math.sign(c.position.z) * 0.06;
  });

  const fin = new THREE.Shape([[-4.1, 0.6], [-5.55, 2.75], [-6.25, 2.75], [-6.3, 0.7]].map((p) => new THREE.Vector2(...p)));
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 4 });
  finGeo.translate(0, 0, -0.05);
  mesh(finGeo, white, 'fena', [0, 0, 0], [0, 0, 0], g);
  const capGeo = new THREE.ExtrudeGeometry(new THREE.Shape([[-5.42, 2.55], [-5.55, 2.75], [-6.25, 2.75], [-6.26, 2.55]].map((p) => new THREE.Vector2(...p))), { depth: 0.1, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 4 });
  capGeo.translate(0, 0, -0.05);
  mesh(capGeo, gold, 'fenspets', [0, 0.003, 0], [0, 0, 0], g);

  // motorer
  const nacGeo = new THREE.CapsuleGeometry(0.42, 1.5, 12, 40); nacGeo.rotateZ(Math.PI / 2);
  const spinGeo = new THREE.ConeGeometry(0.2, 0.42, 32); spinGeo.rotateZ(-Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.33, 0.07, 16, 48); ringGeo.rotateY(Math.PI / 2);
  const bladeGeo = rbox(0.04, 0.85, 0.15, 0.018);
  [2.5, -2.5].forEach((z, i) => {
    const n = i ? 'v' : 'h', y = -0.45 + Math.abs(z) * Math.sin(0.06);
    mesh(nacGeo, white, `motor_${n}`, [0.85, y + 0.05, z], [0, 0, 0], g);
    mesh(ringGeo, gold, `motorring_${n}`, [1.98, y + 0.05, z], [0, 0, 0], g);
    mesh(spinGeo, grey, `spinner_${n}`, [2.22, y + 0.05, z], [0, 0, 0], g);
    const prop = new THREE.Group(); prop.name = `propeller_${n}`; prop.position.set(2.12, y + 0.05, z); g.add(prop);
    for (let b = 0; b < 3; b++) {
      const piv = new THREE.Group(); piv.rotation.x = b * Math.PI * 2 / 3 + i * 0.5; prop.add(piv);
      mesh(bladeGeo, black, `blad_${n}${b}`, [0, 0.5, 0], [0.35, 0, 0], piv);
    }
  });
  return g;
}

/* ───────────── COCKPIT ───────────── */
export function buildCockpit() {
  const g = new THREE.Group(); g.name = 'cockpit';
  const shell = M('vit_insida', 0xe9e7e2, { roughness: 0.6 });
  const panel = M('panel_mork', 0x3d4046, { roughness: 0.55 });
  const panelL = M('panel_ljus', 0x8d9198, { roughness: 0.5 });
  const black = M('svart', 0x1d1e21, { roughness: 0.5 });
  const face = M('matartavla', 0xf2f0ea, { roughness: 0.4 });
  const seat = M('sadel_lader', 0x8a5a24, { roughness: 0.7 });
  const seatDk = M('sadel_mork', 0x4a3420, { roughness: 0.7 });
  const metal = M('metall', 0xb9bcc1, { roughness: 0.3, metalness: 0.35 });
  const glass = M('glas', 0xbfe0f2, { transparent: true, opacity: 0.18, roughness: 0.05 });
  const red = glow('lampa_rod', 0xe0392b), green = glow('lampa_gron', 0x3bd16f), yellow = glow('lampa_gul', 0xf2c230);
  const radar = glow('radar', 0x1f9e4e, 0.7), screen = glow('skarm', 0x1d3f7a, 0.6);
  const sky = M('horisont_bla', 0x3b8fd9), ground = M('horisont_brun', 0x8a5a2b);

  // skal
  mesh(rbox(2.3, 0.08, 2.7, 0.03), panel, 'golv', [0, 0.04, -0.05], [0, 0, 0], g);
  [-1, 1].forEach((s) => {
    mesh(rbox(0.1, 1.0, 2.7, 0.04), shell, `sidovagg_${s}`, [s * 1.12, 0.54, -0.05], [0, 0, 0], g);
    mesh(rbox(0.22, 0.08, 2.4, 0.03), shell, `fonsterkarm_${s}`, [s * 1.07, 1.06, 0], [0, 0, 0], g);
  });
  mesh(rbox(2.3, 1.0, 0.1, 0.04), shell, 'framvagg', [0, 0.54, -1.36], [0, 0, 0], g);

  // instrumentpanel
  const dash = new THREE.Group(); dash.name = 'instrumentpanel'; dash.position.set(0, 0.98, -1.08); dash.rotation.x = -0.32; g.add(dash);
  mesh(rbox(2.14, 0.6, 0.14, 0.04), panel, 'panelplatta', [0, 0, 0], [0, 0, 0], dash);
  mesh(rbox(0.5, 0.5, 0.02, 0.01), panelL, 'mittsektion', [0, 0, 0.075], [0, 0, 0], dash);
  mesh(rbox(2.3, 0.1, 0.5, 0.05), shell, 'blandskydd', [0, 0.3, -0.12], [0.32, 0, 0], dash);
  mesh(rbox(2.14, 0.7, 0.5, 0.05), panel, 'panelhus', [0, -0.08, -0.33], [0, 0, 0], dash);

  const fz = 0.072;
  const bezel = new THREE.CylinderGeometry(1, 1, 1, 40); bezel.rotateX(Math.PI / 2);
  function gauge(x, y, r, name, kind = 'face') {
    const grp = new THREE.Group(); grp.name = name; grp.position.set(x, y, fz); dash.add(grp);
    const b = mesh(bezel, black, `${name}_ram`, [0, 0, 0.012], [0, 0, 0], grp); b.scale.set(r, r, 0.03);
    if (kind === 'radar') {
      const f = mesh(bezel, radar, `${name}_skarm`, [0, 0, 0.028], [0, 0, 0], grp); f.scale.set(r * 0.86, r * 0.86, 0.006);
      [0.3, 0.6].forEach((k, i) => mesh(new THREE.TorusGeometry(r * 0.86 * k, 0.003, 6, 40), green, `${name}_ring${i}`, [0, 0, 0.032], [0, 0, 0], grp));
      mesh(new THREE.BoxGeometry(r * 1.7, 0.005, 0.003), green, `${name}_kors1`, [0, 0, 0.032], [0, 0, 0], grp);
      mesh(new THREE.BoxGeometry(0.005, r * 1.7, 0.003), green, `${name}_kors2`, [0, 0, 0.032], [0, 0, 0], grp);
      mesh(new THREE.BoxGeometry(r * 0.8, 0.012, 0.004), glow('radar_svep', 0x9dffb8, 1.5), `${name}_svep`, [r * 0.38, r * 0.15, 0.034], [0, 0, 0.4], grp);
    } else if (kind === 'horizon') {
      const h1 = new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.006, 40, 1, false, 0, Math.PI); h1.rotateX(Math.PI / 2);
      mesh(h1, sky, `${name}_himmel`, [0, 0, 0.028], [0, 0, Math.PI / 2 + 0.15], grp);
      mesh(h1, ground, `${name}_mark`, [0, 0, 0.028], [0, 0, -Math.PI / 2 + 0.15], grp);
      mesh(new THREE.BoxGeometry(r * 1.1, 0.01, 0.004), yellow, `${name}_plan`, [0, 0, 0.033], [0, 0, 0], grp);
    } else {
      const f = mesh(bezel, face, `${name}_tavla`, [0, 0, 0.028], [0, 0, 0], grp); f.scale.set(r * 0.84, r * 0.84, 0.006);
      for (let t = 0; t < 8; t++) { const a = t / 8 * Math.PI * 2; mesh(new THREE.BoxGeometry(0.004, r * 0.16, 0.003), black, `${name}_streck${t}`, [Math.sin(a) * r * 0.68, Math.cos(a) * r * 0.68, 0.032], [0, 0, -a], grp); }
      mesh(new THREE.BoxGeometry(0.008, r * 0.62, 0.004), red, `${name}_visare`, [Math.sin(-0.8) * r * 0.27, Math.cos(-0.8) * r * 0.27, 0.035], [0, 0, 0.8], grp);
    }
  }
  function btn(x, y, mat, name, r = 0.022) {
    mesh(bezel, black, `${name}_fot`, [x, y, fz + 0.006], [0, 0, 0], dash).scale.set(r * 1.35, r * 1.35, 0.012);
    mesh(bezel, mat, name, [x, y, fz + 0.018], [0, 0, 0], dash).scale.set(r, r, 0.016);
  }
  // pilot (vänster)
  gauge(-0.6, 0.02, 0.13, 'radar_pilot', 'radar');
  gauge(-0.88, 0.14, 0.07, 'hastighet');
  gauge(-0.88, -0.1, 0.07, 'kompass');
  gauge(-0.33, 0.14, 0.07, 'hojdmatare');
  gauge(-0.33, -0.1, 0.07, 'varvtal');
  // andrepilot (höger)
  gauge(0.6, 0.04, 0.12, 'horisont', 'horizon');
  gauge(0.88, 0.14, 0.065, 'bransle');
  gauge(0.88, -0.1, 0.065, 'oljetryck');
  gauge(0.36, -0.14, 0.055, 'temperatur');
  // knappar i mitten
  [[red, yellow, green], [green, red, yellow]].forEach((row, j) => row.forEach((m, i) => btn(-0.12 + i * 0.12, 0.14 - j * 0.11, m, `knapp_${j}${i}`)));
  mesh(rbox(0.26, 0.08, 0.02, 0.01), metal, 'auto_knapp', [0, -0.1, fz + 0.01], [0, 0, 0], dash);
  mesh(rbox(0.36, 0.08, 0.012, 0.005), screen, 'skarm_mitt', [0, -0.21, fz + 0.004], [0, 0, 0], dash);
  btn(-0.6, -0.2, red, 'varningslampa', 0.018);
  // vippbrytare
  for (let i = 0; i < 6; i++) {
    const x = 0.32 + i * 0.065;
    mesh(rbox(0.035, 0.05, 0.012, 0.004), black, `vippbas_${i}`, [x, 0.24, fz + 0.006], [0, 0, 0], dash);
    mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.05, 10), metal, `vippa_${i}`, [x, 0.25, fz + 0.03], [i % 2 ? 0.9 : 2.2, 0, 0], dash);
  }

  // rattar
  const yokeArc = new THREE.TorusGeometry(0.15, 0.022, 12, 32, Math.PI);
  [-0.6, 0.6].forEach((x, i) => {
    const n = i ? 'andrepilot' : 'pilot';
    const y = new THREE.Group(); y.name = `ratt_${n}`; y.position.set(x, 0.86, -0.62); g.add(y);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 20), metal, `rattstang_${n}`, [0, 0, -0.18], [Math.PI / 2, 0, 0], y);
    mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 24), panelL, `ratthub_${n}`, [0, 0, 0], [Math.PI / 2, 0, 0], y);
    mesh(yokeArc, black, `rattbage_${n}`, [0, 0.03, 0], [0, 0, Math.PI], y);
    mesh(rbox(0.32, 0.04, 0.04, 0.015), black, `rattbalk_${n}`, [0, 0.0, 0], [0, 0, 0], y);
    [-1, 1].forEach((s) => {
      mesh(new THREE.CapsuleGeometry(0.028, 0.13, 6, 16), black, `rattgrepp_${n}_${s}`, [s * 0.15, 0.08, 0], [0, 0, s * -0.15], y);
      mesh(bezel, red, `rattknapp_${n}_${s}`, [s * 0.15, 0.17, 0], [Math.PI / 2, 0, 0], y).scale.set(0.012, 0.012, 0.012);
    });
  });
  // pedaler
  [-0.6, 0.6].forEach((x) => [-1, 1].forEach((s) =>
    mesh(rbox(0.1, 0.18, 0.03, 0.01), panelL, `pedal_${x}_${s}`, [x + s * 0.11, 0.2, -1.12], [-0.5, 0, 0], g)));

  // mittkonsol och gasreglage
  mesh(rbox(0.38, 0.62, 1.0, 0.04), panel, 'mittkonsol', [0, 0.35, -0.55], [0, 0, 0], g);
  mesh(rbox(0.32, 0.02, 0.8, 0.01), panelL, 'konsoltopp', [0, 0.665, -0.55], [0, 0, 0], g);
  [[-0.08, 0], [0.0, 0.08], [0.08, -0.05]].forEach(([x, dz], i) => {
    const mat = i === 2 ? red : black;
    mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 10), metal, `gasreglage_${i}`, [x, 0.77, -0.62 + dz], [0.3, 0, 0], g);
    mesh(i === 2 ? rbox(0.05, 0.04, 0.05, 0.015) : new THREE.SphereGeometry(0.03, 20, 14), mat, `gasknopp_${i}`, [x, 0.87, -0.59 + dz], [0, 0, 0], g);
  });
  const trim = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 32); trim.rotateZ(Math.PI / 2);
  mesh(trim, black, 'trimhjul', [0.2, 0.5, -0.4], [0, 0, 0], g);

  // sidopanel (vänster)
  mesh(rbox(0.05, 0.3, 0.7, 0.02), panel, 'sidopanel', [-1.05, 0.82, -0.6], [0, 0, 0], g);
  [[red, -0.8], [yellow, -0.62], [green, -0.44]].forEach(([m, z], i) => {
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 20), m, `sidolampa_${i}`, [-1.02, 0.88, z], [0, 0, Math.PI / 2], g);
    mesh(rbox(0.03, 0.05, 0.035, 0.008), metal, `sidobrytare_${i}`, [-1.015, 0.76, z], [0, 0, 0], g);
  });

  // stolar
  [-0.6, 0.6].forEach((x, i) => {
    const n = i ? 'andrepilot' : 'pilot';
    const s = new THREE.Group(); s.name = `stol_${n}`; s.position.set(x, 0, 0.35); g.add(s);
    mesh(rbox(0.3, 0.3, 0.35, 0.03), panel, `stolfot_${n}`, [0, 0.23, 0], [0, 0, 0], s);
    mesh(rbox(0.58, 0.14, 0.58, 0.06), seat, `sits_${n}`, [0, 0.45, 0], [0, 0, 0], s);
    mesh(rbox(0.58, 0.8, 0.16, 0.07), seat, `rygg_${n}`, [0, 0.9, 0.33], [0.14, 0, 0], s);
    mesh(rbox(0.34, 0.2, 0.14, 0.06), seat, `nackstod_${n}`, [0, 1.42, 0.41], [0.14, 0, 0], s);
    mesh(rbox(0.4, 0.5, 0.02, 0.01), seatDk, `ryggsom_${n}`, [0, 0.92, 0.237], [0.14, 0, 0], s);
    [-1, 1].forEach((k) => mesh(rbox(0.07, 0.07, 0.42, 0.03), seatDk, `armstod_${n}_${k}`, [k * 0.33, 0.66, 0.05], [0, 0, 0], s));
    [-1, 1].forEach((k) => mesh(rbox(0.05, 0.02, 0.62, 0.008), seatDk, `bälte_${n}_${k}`, [k * 0.14, 1.0, 0.24], [1.45, 0, 0], s));
  });

  // ram runt vindrutan
  const fr = [
    [[-1.1, 1.32, -1.2], [-0.95, 2.0, -0.7]], [[1.1, 1.32, -1.2], [0.95, 2.0, -0.7]], [[0, 1.3, -1.25], [0, 2.0, -0.7]],
    [[-0.95, 2.0, -0.7], [0.95, 2.0, -0.7]],
    [[-0.95, 2.0, -0.7], [-0.95, 2.0, 0.2]], [[0.95, 2.0, -0.7], [0.95, 2.0, 0.2]],
    [[-1.12, 1.06, 0.2], [-0.95, 2.0, 0.2]], [[1.12, 1.06, 0.2], [0.95, 2.0, 0.2]],
  ];
  fr.forEach(([a, b], i) => beam(a, b, 0.08, 0.08, shell, `ram_${i}`, g));
  mesh(rbox(0.7, 0.05, 0.75, 0.02), shell, 'takbalk', [0, 2.03, -0.35], [0, 0, 0], g);
  // takpanel
  mesh(rbox(0.6, 0.06, 0.6, 0.02), panel, 'takpanel', [0, 1.96, -0.3], [0, 0, 0], g);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
    mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), metal, `takbrytare_${i}${j}`, [-0.2 + i * 0.1, 1.91, -0.45 + j * 0.15], [0.5, 0, 0], g);
  }
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 20), red, 'taklampa', [0.18, 1.925, -0.08], [0, 0, 0], g);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 20), green, 'taklampa2', [0.06, 1.925, -0.08], [0, 0, 0], g);
  // vindrutor
  [[-0.55, 1], [0.55, 1]].forEach(([x], i) => {
    beam([x, 1.31, -1.22], [x * 0.9, 2.0, -0.7], 1.05, 0.01, glass, `vindruta_${i}`, g).castShadow = false;
  });
  return g;
}
