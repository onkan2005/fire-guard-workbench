// Renderer, camera, bench, the diorama (water source, tank, house) and its animations.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mat, box, cyl, shadow, canvasTex, txt, softSprite, BLACK } from './helpers.js';
import { TANK_FULL_MM, TANK_FACE_MM } from './world.js';

export const VIEWS = {
  bench: { pos: [10, 340, 370], target: [20, 0, 50] },
  diorama: { pos: [-10, 330, 190], target: [-20, 30, -300] },
  top: { pos: [0, 560, 60], target: [0, 0, -40] },
  esp: { pos: [0, 95, 95], target: [0, 0, 0] },
  leds: { pos: [105, 200, 300], target: [105, 5, 80] },
  pumps: { pos: [-60, 150, 10], target: [-95, 5, -170] },
  house: { pos: [105, 150, -110], target: [108, 40, -322] },
};

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a2027');
  scene.fog = new THREE.Fog('#1a2027', 1400, 2600);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.48; controls.minDistance = 30; controls.maxDistance = 1800;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight('#dfe9f5', '#3a3026', 0.35));
  const sun = new THREE.DirectionalLight('#fff4e6', 1.5);
  sun.position.set(260, 600, 320); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 50, far: 1600 });
  scene.add(sun);

  // table + cutting mat
  const table = box(scene, 820, 30, 700, mat('#7a5a3c', { roughness: 0.8 }), -10, -30, -140); table.castShadow = false;
  const matTex = canvasTex(560, 280, g => {
    g.fillStyle = '#2f6b4f'; g.fillRect(-280, -140, 560, 280);
    g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 0.5;
    for (let x = -280; x <= 280; x += 10) { g.beginPath(); g.moveTo(x, -140); g.lineTo(x, 140); g.stroke(); }
    for (let z = -140; z <= 140; z += 10) { g.beginPath(); g.moveTo(-280, z); g.lineTo(280, z); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 0.8;
    for (let x = -250; x <= 250; x += 50) { g.beginPath(); g.moveTo(x, -140); g.lineTo(x, 140); g.stroke(); }
    txt(g, 'FIRE GUARD WORKBENCH', -200, 128, 7, 'rgba(255,255,255,.35)', 'left', 800);
  }, 3);
  const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(560, 280), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
  matMesh.rotation.x = -Math.PI / 2; matMesh.position.set(20, 0.05, 10); matMesh.receiveShadow = true; scene.add(matMesh);

  const dio = buildDiorama(scene);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host); resize();

  let fly = null;
  function goto(name) {
    const v = VIEWS[name]; if (!v) return;
    fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.target) };
  }
  function focus(obj, dist = 140) {
    const c = new THREE.Vector3(); obj.getWorldPosition(c);
    const dir = camera.position.clone().sub(controls.target).normalize();
    fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: c.clone().add(dir.multiplyScalar(dist)), t1: c };
  }
  function flyTo(pos, target) { fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() }; }
  function tick(dt) {
    if (fly) {
      fly.t = Math.min(1, fly.t + dt * 1.6); const e = 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
  }
  camera.position.set(...VIEWS.bench.pos); controls.target.set(...VIEWS.bench.target);
  return { renderer, scene, camera, controls, dio, goto, focus, flyTo, tick, render: () => renderer.render(scene, camera) };
}

// ---------------- diorama ----------------
function buildDiorama(scene) {
  const Y0 = 6, g = new THREE.Group(); scene.add(g);
  box(g, 540, Y0, 250, mat('#5f8b45', { roughness: 0.95 }), -30, 0, -300);
  const label = (text, x, z) => {
    const t = canvasTex(80, 14, c => { c.fillStyle = 'rgba(15,20,25,.75)'; c.beginPath(); c.roundRect(-40, -7, 80, 14, 4); c.fill(); txt(c, text, 0, 0, 7, '#e8eef3'); }, 6);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 14), new THREE.MeshBasicMaterial({ map: t, transparent: true })); m.rotation.x = -Math.PI / 2; m.position.set(x, Y0 + 0.3, z); g.add(m);
  };
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe8f7', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2b8fd6', transparent: true, opacity: 0.72, roughness: 0.1 });

  // water source basin
  const B = { x: -175, z: -300, w: 90, d: 70, h: 45 };
  box(g, B.w, 3, B.d, mat('#d9dde2'), B.x, Y0, B.z);
  for (const [w, d, x, z] of [[B.w, 3, 0, -B.d / 2], [B.w, 3, 0, B.d / 2], [3, B.d, -B.w / 2, 0], [3, B.d, B.w / 2, 0]]) box(g, w, B.h, d, mat('#d9dde2', { roughness: 0.4 }), B.x + x, Y0, B.z + z);
  box(g, B.w - 6, 34, B.d - 6, waterMat, B.x, Y0 + 3, B.z);
  label('WATER SOURCE', B.x, B.z + 60);

  // tank
  // Tall tank read from above by the HC-SR04 (on a bracket over the rim); FULL = water depth when full.
  const T = { x: -60, z: -300, r: 40, h: 90 }, FULL = TANK_FULL_MM, FACE = TANK_FACE_MM;
  const tankWall = shadow(new THREE.Mesh(new THREE.CylinderGeometry(T.r, T.r, T.h, 48, 1, true), glass)); tankWall.position.set(T.x, Y0 + T.h / 2, T.z); tankWall.castShadow = false; g.add(tankWall);
  cyl(g, T.r + 1, 3, mat('#9aa3ab'), T.x, Y0, T.z, 48);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(T.r, 1.2, 8, 48), mat('#9aa3ab')); rim.rotation.x = Math.PI / 2; rim.position.set(T.x, Y0 + T.h, T.z); g.add(rim);
  const wgeo = new THREE.CylinderGeometry(T.r - 1.5, T.r - 1.5, 1, 48); wgeo.translate(0, 0.5, 0);
  const tankWater = new THREE.Mesh(wgeo, waterMat); tankWater.position.set(T.x, Y0 + 3, T.z); g.add(tankWater);
  for (const [f, n] of [[1 / 3, '1/3'], [2 / 3, '2/3'], [1, 'FULL']]) {
    const y = Y0 + 3 + FULL * f;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 1), mat('#e9eef2')); tick.position.set(T.x - 4, y, T.z + T.r + 0.5); g.add(tick);
    const tt = canvasTex(24, 8, c => txt(c, n, -12, 0, 6, '#e9eef2', 'left'), 6);
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(24, 8), new THREE.MeshBasicMaterial({ map: tt, transparent: true })); tm.position.set(T.x + 18, y, T.z + T.r + 1); g.add(tm);
  }
  label('TANK', T.x, T.z + 60);
  // bracket across the rim that holds the HC-SR04 above the water, and its ping (a faint sound cone)
  const brMat = mat('#e9e4d8', { roughness: 0.6 });
  box(g, 2 * T.r + 8, 3, 6, brMat, T.x, Y0 + T.h, T.z - 14);
  for (const sx of [-1, 1]) box(g, 3, 120 - (Y0 + T.h + 3), 3, brMat, T.x + sx * 19, Y0 + T.h + 3, T.z - 12);
  box(g, 46, 2, 26, brMat, T.x, 118, T.z - 1); // the sensor hangs under this plate
  const coneGeo = new THREE.CylinderGeometry(4, 15, 1, 24, 1, true); coneGeo.translate(0, -0.5, 0);
  const pingMat = new THREE.MeshBasicMaterial({ color: '#7fe3ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beams = [-13, 13].map(dx => { const m = new THREE.Mesh(coneGeo, pingMat); m.position.set(T.x - dx, Y0 + 3 + FACE, T.z - 1); g.add(m); return m; });
  let pingA = 0;

  // pumps (submersible)
  const pump = (x, z) => { const p = new THREE.Group(); p.position.set(x, Y0 + 3, z); g.add(p); cyl(p, 8, 16, mat('#1d1f22', { roughness: 0.4 }), 0, 0, 0); cyl(p, 3, 8, mat('#2a2c30'), 0, 16, 0, 12); const rot = cyl(p, 6, 1, mat('#ff7a2f'), 0, 16.5, 0, 6); return rot; };
  const pumpR = pump(B.x - 18, B.z + 10), pumpS = pump(T.x - 12, T.z + 12);

  // pipes
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.55, roughness: 0.15 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const refillCurve = new THREE.CatmullRomCurve3([V(B.x - 18, Y0 + 27, B.z + 10), V(B.x - 18, 80, B.z + 10), V(B.x + 20, 105, -300), V(T.x - 10, 100, -300), V(T.x - 6, Y0 + T.h - 4, -300)]);
  const sprCurve = new THREE.CatmullRomCurve3([V(T.x - 12, Y0 + 27, T.z + 12), V(T.x - 12, Y0 + T.h + 10, T.z + 12), V(T.x + 30, 165, -305), V(110, 165, -310), V(110, Y0 + 88, -310)]);
  for (const c of [refillCurve, sprCurve]) g.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(c, 80, 2.2, 10), tubeMat)));
  const pulses = curve => Array.from({ length: 9 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), new THREE.MeshBasicMaterial({ color: '#58b7ff' })); m.visible = false; g.add(m); return m; });
  const flowR = pulses(), flowS = pulses();

  // house (cutaway: no front wall, see-through roof)
  const H = { x: 110, z: -310, w: 170, d: 120, h: 90 };
  const wall = mat('#e8dcc8', { roughness: 0.85 });
  box(g, H.w, 2, H.d, mat('#b9a58a'), H.x, Y0, H.z);
  box(g, H.w, H.h, 4, wall, H.x, Y0, H.z - H.d / 2 + 2);
  box(g, 4, H.h, H.d, wall, H.x - H.w / 2 + 2, Y0, H.z);
  box(g, 4, H.h, H.d, wall, H.x + H.w / 2 - 2, Y0, H.z);
  const roofMat = new THREE.MeshStandardMaterial({ color: '#a8432f', transparent: true, opacity: 0.32, roughness: 0.7, depthWrite: false, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(H.w + 14, 3, H.d / 2 / Math.cos(0.5) + 8), roofMat);
    r.rotation.x = s * 0.5; r.position.set(H.x, Y0 + H.h + Math.tan(0.5) * H.d / 4, H.z + s * H.d / 4); g.add(r);
  }
  // sprinkler head
  cyl(g, 2.2, 6, METAL(), 110, Y0 + 82, -310, 12); const head = cyl(g, 6, 2, METAL(), 110, Y0 + 80, -310, 16);
  // fuel + gas can
  for (let i = 0; i < 3; i++) { const l = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 34, 10), mat('#5b3a22'))); l.rotation.z = Math.PI / 2; l.rotation.y = i * 1.05; l.position.set(122, Y0 + 5 + i * 1.5, -298); g.add(l); }
  const can = cyl(g, 9, 26, mat('#c0392b', { roughness: 0.35, metalness: 0.3 }), 50, Y0 + 2, -345, 24); cyl(g, 3, 5, BLACK(), 50, Y0 + 28, -345, 12);
  label('HOUSE', H.x, H.z + 75);

  // fire
  const fire = new THREE.Group(); fire.position.set(122, Y0 + 6, -298); g.add(fire);
  const flames = [['#ff5a1f', 16, 48, 0.75], ['#ff9a2e', 11, 38, 0.8], ['#ffd34d', 6, 24, 0.9]].map(([c, r, h, o], i) => {
    const geo = new THREE.ConeGeometry(r, h, 18, 1, true); geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fire.add(m); return m;
  });
  const fireLight = new THREE.PointLight('#ff8a3a', 0, 420, 1.6); fireLight.position.set(0, 25, 0); fire.add(fireLight);

  // particles
  const puff = softSprite('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const sprites = (n, color) => Array.from({ length: n }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; g.add(s); return { s, on: false, l: 0, v: new THREE.Vector3() }; });
  const smoke = sprites(60, '#6b6e73'), gas = sprites(36, '#9be37a');
  const DN = 260, dpos = new Float32Array(DN * 3), dvel = new Float32Array(DN * 3), dOn = new Uint8Array(DN);
  const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const drops = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: '#7cc8ff', size: 2.4, map: softSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false }));
  drops.frustumCulled = false; g.add(drops);
  const spill = new THREE.Mesh(new THREE.BoxGeometry(5, T.h, 2), new THREE.MeshBasicMaterial({ color: '#58b7ff', transparent: true, opacity: 0 })); spill.position.set(T.x + T.r + 2, Y0 + T.h / 2, T.z); g.add(spill);
  let acc = 0, sacc = 0, gacc = 0;

  function spawn(list, x, y, z, spread) { const p = list.find(q => !q.on); if (!p) return; p.on = true; p.l = 0; p.s.visible = true; p.s.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread); p.v.set((Math.random() - 0.5) * 8, 18 + Math.random() * 10, (Math.random() - 0.5) * 8); }

  function update(w, o, dt, time) {
    tankWater.scale.y = Math.max(0.01, FULL * w.tank / 100);
    if (o.ping) pingA = 0.45; pingA = Math.max(0, pingA - dt * 2.5);
    pingMat.opacity = pingA;
    beams.forEach(b => { b.scale.y = Math.max(1, FACE - FULL * w.tank / 100); });
    // fire
    const fl = w.flameVisible, k = fl ? 0.25 + 0.85 * w.hp / 100 : 0;
    fire.visible = fl;
    flames.forEach((m, i) => { const f = 1 + 0.18 * Math.sin(time * (17 + i * 5) + i) + 0.08 * Math.sin(time * 41 + i * 2); m.scale.set(k * (1 + 0.06 * Math.sin(time * 23 + i)), k * f, k); m.rotation.y = time * (0.6 + i * 0.3); });
    fireLight.intensity = fl ? (90000 + 30000 * Math.sin(time * 25)) * k : 0;
    // pumps + flow
    pumpR.rotation.y += o.refPump ? dt * 30 : 0; pumpS.rotation.y += o.sprPump ? dt * 30 : 0;
    const flowing = (list, curve, on, speed) => list.forEach((m, i) => { m.visible = on; if (on) m.position.copy(curve.getPointAt((time * speed + i / list.length) % 1)); });
    flowing(flowR, refillCurve, o.refPump, 0.35); flowing(flowS, sprCurve, w.spraying, 0.45);
    // sprinkler drops
    if (w.spraying) { acc += 160 * dt; while (acc >= 1) { acc--; const i = dOn.indexOf(0); if (i < 0) break; dOn[i] = 1; const a = Math.random() * Math.PI * 2, sp = 25 + Math.random() * 70; dpos.set([110, Y0 + 79, -310], i * 3); dvel.set([Math.cos(a) * sp, -10 - Math.random() * 30, Math.sin(a) * sp], i * 3); } }
    for (let i = 0; i < DN; i++) {
      if (!dOn[i]) { dpos[i * 3 + 1] = -9999; continue; }
      dvel[i * 3 + 1] -= 500 * dt;
      dpos[i * 3] += dvel[i * 3] * dt; dpos[i * 3 + 1] += dvel[i * 3 + 1] * dt; dpos[i * 3 + 2] += dvel[i * 3 + 2] * dt;
      const x = dpos[i * 3], z = dpos[i * 3 + 2];
      if (dpos[i * 3 + 1] < Y0 + 2 || x < H.x - H.w / 2 + 4 || x > H.x + H.w / 2 - 4 || z < H.z - H.d / 2 + 4) dOn[i] = 0;
    }
    dgeo.attributes.position.needsUpdate = true;
    // smoke from fire, gas from the can
    if (fl) { sacc += (8 + 10 * w.hp / 100) * dt; while (sacc >= 1) { sacc--; spawn(smoke, 122, Y0 + 30, -298, 14); } }
    if (w.gasLeak >= 150) { gacc += Math.min(14, w.gasLeak / 60) * dt; while (gacc >= 1) { gacc--; spawn(gas, 50, Y0 + 32, -345, 6); } }
    for (const [list, life, grow, op] of [[smoke, 5, 46, 0.55], [gas, 4, 34, 0.4]]) for (const p of list) {
      if (!p.on) continue; p.l += dt / life;
      if (p.l >= 1) { p.on = false; p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.v, dt); const sz = 8 + grow * p.l; p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = op * Math.sin(Math.PI * p.l);
    }
    spill.material.opacity = w.overflow > 0.2 ? 0.55 : 0;
  }
  return { group: g, update, tankAnchor: tankWall, houseAnchor: head };
}

function METAL() { return mat('#c4c8cf', { metalness: 0.85, roughness: 0.3 }); }
