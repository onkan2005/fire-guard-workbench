import * as THREE from 'three';
import { createScene } from './scene.js';
import { PARTS, createPart, espPinInfo, EXTRA_BUY, LED_GROUPS, LED_SPEC } from './parts.js';
import { WireLayer } from './wires.js';
import { createInspector, groupForPin } from './inspect.js';
import { Hardware } from './hardware.js';
import { World, TANK_LITRES } from './world.js';
import { Runtime } from './runtime.js';
import { GUIDE, autoColor } from './guide.js';
import { createEditor } from './editor.js';
import { DEFAULT_SKETCH } from './firmware.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'fireguard-workbench-v1';

// ---------- state ----------
const S = createScene($('view'));
const world = new World();
const hw = new Hardware(world);
const parts = new Map(), pinMap = new Map(), hitMeshes = [], bodyMeshes = [];
for (const def of PARTS) {
  const p = createPart(def); S.scene.add(p.group); parts.set(def.id, p);
  for (const [id, pin] of p.pins) { pinMap.set(id, pin); hitMeshes.push(pin.hit); }
  bodyMeshes.push(...p.bodies);
}
const wires = new WireLayer(S.scene, id => pinMap.get(id));
let lastO = null;
const insp = createInspector({ S, hw, parts, wires, pinName: id => hw.label[id] || id, getOutputs: () => lastO || hw.evaluate() });
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { }
// Save format 2 = single-LED panel layout. Older saves used the WS2812 stick: their board positions
// overlap the new panel and their sketch drives LEDs that no longer exist, so upgrade them.
const SAVE_V = 4, migrated = []; // v3: bigger LED panel with per-LED lanes; v4: HC-SR04 replaces the water level sensor
if (saved.code !== undefined && saved.v !== SAVE_V) {
  if (saved.pos) { delete saved.pos; migrated.push('board positions were reset to the new layout'); }
  if (/WL_POWER_PIN|analogRead\(WL_PIN/.test(saved.code || '') && !/pulseIn/.test(saved.code || '')) { saved.oldCode = saved.code; saved.code = DEFAULT_SKETCH; migrated.push('your sketch was switched to the HC-SR04 tank firmware (the old one is kept in the browser console as __fg.oldSketch)'); }
  else if (/Adafruit_NeoPixel/.test(saved.code || '') && !/shiftOut/.test(saved.code || '')) { saved.oldCode = saved.code; saved.code = DEFAULT_SKETCH; migrated.push('your sketch was switched to the new 74HC595 LED firmware (the old one is kept in the browser console as __fg.oldSketch)'); }
}
for (const [id, pos] of Object.entries(saved.pos || {})) { const p = parts.get(id); if (p && !p.def.fixed) { p.group.position.x = pos[0]; p.group.position.z = pos[1]; p.group.rotation.y = pos[2] || 0; } }
// every part remembers its bench spot separately, so "Assembled" can move it away and bring it back
for (const p of parts.values()) p.bench = { x: p.group.position.x, z: p.group.position.z, ry: p.group.rotation.y };
let layout = saved.layout === 'assembled' ? 'assembled' : 'bench';
S.scene.updateMatrixWorld(true);
let wid = 0;
function save() {
  try {
    const pos = {}; for (const [id, p] of parts) pos[id] = [p.bench.x, p.bench.z, p.bench.ry];
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE_V, wires: hw.wires.map(({ a, b, color }) => ({ a, b, color })), code: editor.value, pos, layout }));
  } catch { }
}

// ---------- Bench layout / Assembled ----------
const mounted = p => layout === 'assembled'; // in Assembled everything is installed (sensors in the house, the rest in the box)
function poseFor(p, mode) {
  if (mode === 'assembled' && p.def.assembled) { const a = p.def.assembled; return { pos: new THREE.Vector3(...a.pos), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.rot)) }; }
  return { pos: new THREE.Vector3(p.bench.x, (p.def.mount && p.def.mount.y) || 0, p.bench.z), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.bench.ry, 0)) };
}
let layoutAnim = null;
function setLayout(mode, animate = true) {
  layout = mode;
  document.querySelectorAll('[data-layout]').forEach(b => { b.classList.toggle('on', b.dataset.layout === mode); b.setAttribute('aria-pressed', b.dataset.layout === mode); });
  wires.router = benchRouter; if (encl) encl.group.visible = false; if (ties) ties.visible = false; wires.refreshAll();
  const items = [...parts.values()].filter(p => p.def.assembled).map(p => ({ p, from: { pos: p.group.position.clone(), quat: p.group.quaternion.clone() }, to: poseFor(p, mode) }));
  if (!animate) { items.forEach(({ p, to }) => { p.group.position.copy(to.pos); p.group.quaternion.copy(to.quat); p.group.updateMatrixWorld(true); }); finishLayout(); }
  else layoutAnim = { t: 0, items };
  save();
}
// once everything has landed: lay out the cable loom (and the box + harnesses when assembled), then re-route every wire
function finishLayout() {
  const ids = [...parts.values()].filter(p => !p.def.fixed && (layout === 'bench' || zoneOf(p.id + '.') === 'box')).map(p => p.id);
  computeTrunk(ids);
  if (layout === 'assembled') { buildEnclosure(); wires.router = assembledRouter; }
  else wires.router = benchRouter;
  buildTies(); wires.refreshAll();
}

// ---------- tidy wire routing ----------
// Every wire rises straight up from its pin to its own overhead lane, runs at right angles into one shared
// trunk line (the cable loom, held by cable ties), and drops straight down at the other end.
let trunk = { z: 0, x0: -100, x1: 200 }, ties = null;
const laneY = seed => 46 + (seed % 7) * 1.6, laneZ = seed => ((seed % 5) - 2) * 1.7;
function computeTrunk(ids) {
  const bb = new THREE.Box3(); ids.forEach(id => bb.union(footprint(id)));
  trunk = { z: Math.round((bb.min.z + bb.max.z) / 2), x0: bb.min.x + 10, x1: bb.max.x - 10 };
}
function buildTies() {
  if (ties) { S.scene.remove(ties); ties.traverse(o => o.geometry && o.geometry.dispose()); }
  ties = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 0.6 }), geo = new THREE.TorusGeometry(7.5, 0.7, 6, 20);
  for (let x = trunk.x0; x <= trunk.x1; x += 45) { const t = new THREE.Mesh(geo, m); t.position.set(x, 51, trunk.z); t.rotation.y = Math.PI / 2; t.scale.set(1, 0.85, 1); ties.add(t); }
  S.scene.add(ties);
}
const lift = (e, n) => e.start.clone().addScaledVector(e.up, n);
function shortRoute(a, b, seed) {
  const a1 = lift(a, 4), b1 = lift(b, 4), y = Math.max(a1.y, b1.y) + 5 + (seed % 3) * 1.5;
  return [a.start, a1, V3(a1.x, y, a1.z), V3(b1.x, y, a1.z), V3(b1.x, y, b1.z), b1, b.start];
}
function trunkRoute(a, b, seed) {
  const Y = laneY(seed), zt = trunk.z + laneZ(seed), a1 = lift(a, 5), b1 = lift(b, 5);
  const ya = Math.max(Y, a1.y + 4), yb = Math.max(Y, b1.y + 4);
  return [a.start, a1, V3(a1.x, ya, a1.z), V3(a1.x, ya, zt), V3(b1.x, yb, zt), V3(b1.x, yb, b1.z), b1, b.start];
}
function benchRouter(w, a, b, seed) { return a.start.distanceTo(b.start) < 40 ? shortRoute(a, b, seed) : trunkRoute(a, b, seed); }

// ---------- control box + cable harnesses (Assembled layout) ----------
const ZONE = { dht: 'house', mq2: 'house', flame: 'house', us: 'tank', pumpS: 'pumpS', pumpR: 'pumpR' };
const zoneOf = pin => ZONE[pin.split('.')[0]] || 'box';
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
let encl = null;
function buildEnclosure() {
  if (encl) { S.scene.remove(encl.group); encl.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const bb = new THREE.Box3();
  for (const p of parts.values()) if (zoneOf(p.id + '.') === 'box') bb.union(footprint(p.id));
  const m = 12, minX = bb.min.x - m, maxX = bb.max.x + m, minZ = bb.min.z - m, maxZ = bb.max.z + m, h = 60; // tall enough to hide the loom
  const w = maxX - minX, d = maxZ - minZ, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: '#cfd6dd', transparent: true, opacity: 0.25, roughness: 0.25, depthWrite: false, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#7f8b96', roughness: 0.5 });
  // floor sits clearly above the mat (top at y = 0.8) and is nudged towards the camera in depth,
  // otherwise the two nearly-coplanar surfaces flicker through each other (z-fighting)
  const floorMat = new THREE.MeshStandardMaterial({ color: '#262c32', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), floorMat); floor.position.set(cx, 0.3, cz); floor.receiveShadow = true; g.add(floor);
  for (const [ww, dd, x, z] of [[w, 3, cx, minZ], [w, 3, cx, maxZ], [3, d, minX, cz], [3, d, maxX, cz]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, h, dd), wallMat); wall.position.set(x, h / 2, z); wall.renderOrder = 2; g.add(wall);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.6, 1.8, dd + 0.6), rimMat); rim.position.set(x, h, z); rim.castShadow = true; g.add(rim);
  }
  const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 96; const lg = lc.getContext('2d');
  lg.fillStyle = 'rgba(20,26,32,.85)'; lg.fillRect(0, 0, 1024, 96); lg.fillStyle = '#ffd36b'; lg.font = 'bold 54px system-ui, sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText('FIRE GUARD CONTROL BOX', 512, 50);
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(120, 11.25), new THREE.MeshBasicMaterial({ map: lt, toneMapped: false })); label.position.set(cx, h / 2, maxZ + 1.7); g.add(label);
  const gland = V3(Math.max(minX + 25, Math.min(maxX - 25, -20)), h + 2, minZ);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 1.6, 10, 24), new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 0.6 })); ring.position.copy(gland).setY(h - 6); g.add(ring);
  encl = { group: g, minX, maxX, minZ, maxZ, h, gland };
  // cable sleeves along each harness, plus the grommet where the house harness goes through the wall
  const sleeveMat = new THREE.MeshStandardMaterial({ color: '#1f2428', transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false });
  for (const z of ['house', 'tank', 'pumpS', 'pumpR']) {
    const path = harnessPath(z);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), 160, z === 'house' ? 4.4 : 3.4, 10), sleeveMat); tube.renderOrder = 3; g.add(tube);
  }
  const hole = new THREE.Mesh(new THREE.TorusGeometry(5.5, 1.4, 10, 24), ring.material); hole.position.set(27, 24, -340); hole.rotation.y = Math.PI / 2; g.add(hole);
  S.scene.add(g);
}
// shared route of each harness, from the box's back grommet to where it reaches its sensors
function harnessPath(zone) {
  const G = encl.gland, up = V3(G.x, G.y + 6, G.z - 6), down = V3(G.x, 3, encl.minZ - 12);
  if (zone === 'house') return [G, up, down, V3(12, 9.5, -185), V3(12, 9.5, -338), V3(24, 24, -340), V3(36, 24, -342), V3(40, 26, -356)];
  if (zone === 'tank') return [G, up, down, V3(-24, 9.5, -185), V3(-24, 9.5, -248), V3(-32, 60, -258)];
  const p = parts.get(zone).group.position;
  return [G, up, down, V3(p.x + 6, 3, p.z + 14)];
}
function assembledRouter(w, a, b, seed) {
  const za = zoneOf(w.a), zb = zoneOf(w.b);
  if (za === 'box' && zb === 'box') return benchRouter(w, a, b, seed); // inside the box: through the loom
  if (za !== 'box' && zb !== 'box' || !encl) return null;
  const remoteFirst = za !== 'box', boxE = remoteFirst ? b : a, remE = remoteFirst ? a : b, zone = remoteFirst ? za : zb;
  const off = V3(((seed % 5) - 2) * 1.1, ((Math.floor(seed / 5) % 3) - 1) * 1.1, ((seed % 3) - 1) * 0.6); // keeps the bundle round
  const G = encl.gland, Y = laneY(seed), zt = trunk.z + laneZ(seed), b1 = lift(boxE, 5), yb = Math.max(Y, b1.y + 4);
  // pin → up → loom → along the loom to the grommet column → back wall → grommet → harness → sensor
  const pts = [boxE.start.clone(), b1, V3(b1.x, yb, b1.z), V3(b1.x, yb, zt), V3(G.x + off.x, yb, zt), V3(G.x + off.x, yb, encl.minZ + 8),
    ...harnessPath(zone).map(p => p.clone().add(off)), lift(remE, 10), remE.start.clone()];
  return remoteFirst ? pts.reverse() : pts;
}
function stepLayout(dt) {
  if (!layoutAnim) return;
  layoutAnim.t = Math.min(1, layoutAnim.t + dt / 1.4);
  const e = layoutAnim.t < 0.5 ? 4 * layoutAnim.t ** 3 : 1 - Math.pow(-2 * layoutAnim.t + 2, 3) / 2;
  for (const { p, from, to } of layoutAnim.items) {
    p.group.position.lerpVectors(from.pos, to.pos, e);
    p.group.position.y += Math.sin(Math.PI * e) * 60; // lift up and over while travelling
    p.group.quaternion.slerpQuaternions(from.quat, to.quat, e);
    p.group.updateMatrixWorld(true); wires.refreshPart(p.id);
  }
  if (layoutAnim.t >= 1) { layoutAnim = null; finishLayout(); save(); }
}

// ---------- wires ----------
function addWire(a, b, color, quiet) {
  if (a === b || !pinMap.has(a) || !pinMap.has(b)) return;
  if (hw.wires.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return;
  const w = { id: 'w' + (++wid), a, b, color: color || autoColor(a, b) };
  hw.wires.push(w); wires.add(w); if (wires.focused) wires.focus(wires.focused);
  if (!quiet) changed();
}
function removeWire(id) { hw.wires = hw.wires.filter(w => w.id !== id); wires.remove(id); selWire(null); changed(); }
function changed() { hw.rebuild(); renderGuide(); renderChecks(); save(); if (typeof tracedWire !== 'undefined' && tracedWire) traceWire(tracedWire); else if (typeof tracedPin !== 'undefined' && tracedPin) traceNet(tracedPin); }
for (const w of saved.wires || []) addWire(w.a, w.b, w.color, true);
hw.rebuild();

// ---------- editor + runtime ----------
const editor = createEditor($('editor'), saved.code || DEFAULT_SKETCH, () => { clearTimeout(editor._t); editor._t = setTimeout(save, 400); });
const serialEl = $('serial');
function serialAdd(text, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; serialEl.appendChild(d);
  while (serialEl.childNodes.length > 800) serialEl.firstChild.remove();
  if ($('autoscroll').checked) serialEl.scrollTop = serialEl.scrollHeight;
}
const rt = new Runtime(hw, world, {
  serial: t => serialAdd(t),
  sys: (t, lvl) => serialAdd(t, lvl === 'warn' ? 'warn' : lvl === 'error' ? 'error' : 'sys'),
  onError: e => { editor.markError(e.line); compileMsg(`<span class="e">Runtime error${e.line ? ' on line ' + e.line : ''}: ${esc(e.msg)}</span>`); setStatus(); },
});
const compileMsg = html => { $('compile').innerHTML = html; };

function lint(src) {
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n').map(l => l.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').replace(/\/\/.*$/, '').trim());
  const errs = []; let depth = 0;
  lines.forEach((l, i) => {
    for (const c of l) { if (c === '{') depth++; else if (c === '}') depth--; }
    if (!l || l.startsWith('#')) return;
    if (/[;{},(\[+\-*/%&|=<>?:!^~]$/.test(l) || /^(if|else|for|while|switch|do)\b/.test(l) && /\)$|else$|do$/.test(l) || /\belse$/.test(l)) return;
    let j = i + 1; while (j < lines.length && !lines[j]) j++;
    const nx = lines[j] || '';
    if (/^[{.?:+\-*/%&|=<>)\]]/.test(nx) || nx.startsWith('<<')) return;
    errs.push({ line: i + 1, msg: `expected ';' at end of line ${i + 1}` });
  });
  if (depth > 0) errs.push({ line: lines.length, msg: `expected '}' at end of input (${depth} unclosed)` });
  if (depth < 0) errs.push({ line: null, msg: "extra '}' without a matching '{'" });
  return errs;
}

async function run() {
  save(); $('serial').innerHTML = '';
  const code = editor.value, errs = lint(code);
  serialAdd('Compiling sketch for ESP32 Dev Module…', 'sys');
  if (errs.length) {
    editor.markError(errs[0].line);
    compileMsg(errs.map(e => `<span class="e">fire_guard.ino${e.line ? ':' + e.line : ''}: error: ${esc(e.msg)}</span>`).join('\n') + '\n<span class="e">Compilation failed.</span>');
    serialAdd('Compilation failed.', 'error'); tab('right', 'code'); setStatus(); return;
  }
  editor.markError(null);
  LOG.length = 0; $('logBody').innerHTML = ''; lastLogVt = -1e9; lastSig = ''; logChartDirty = true;
  const r = await rt.start(code);
  if (/Adafruit_NeoPixel/.test(code) && !/shiftOut/.test(code)) r.warnings.unshift('This sketch drives a WS2812 LED stick, but the build now uses 17 single LEDs on 74HC595 shift registers, so no LED will light. Click "Restore default" for the shiftOut() firmware.');
  const warn = r.warnings.map(w => `<span class="w">warning: ${esc(w)}</span>`).join('\n');
  if (r.error) {
    compileMsg(`<span class="e">error: ${esc(r.error)}</span>${warn ? '\n' + warn : ''}\n<span class="e">Compilation failed.</span>`);
    serialAdd('Compilation failed.', 'error');
  } else if (rt.state !== 'error') {
    compileMsg(`<span class="o">Compiled and uploaded. Libraries: ${esc(r.includes.join(', ') || 'none')}.</span>${warn ? '\n' + warn : ''}`);
  }
  setStatus();
}
function setStatus() {
  const el = $('status'); el.className = 'pill ' + (rt.state === 'running' ? 'running' : rt.state === 'error' ? 'error' : '');
  el.textContent = rt.state === 'running' ? 'Running ' + clock(rt.vt) : rt.state === 'error' ? 'Crashed' : 'Stopped';
}
const clock = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
$('run').onclick = run;
$('stop').onclick = () => { rt.stop(); hw.resetMCU(); serialAdd('Sketch stopped.', 'sys'); setStatus(); };
$('resetCode').onclick = () => { if (confirm('Replace your sketch with the default Fire Guard firmware?')) { editor.value = DEFAULT_SKETCH; save(); } };
$('dlIno').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain' })); a.download = 'fire_guard.ino'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
$('clrSerial').onclick = () => { serialEl.innerHTML = ''; };
let speed = 1; $('speed').onchange = e => { speed = +e.target.value; };

// ---------- tabs / views ----------
function tab(side, name) {
  const panel = document.querySelector('.panel.' + side);
  panel.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  panel.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name === 'log') drawLogChart();
}
document.querySelectorAll('.panel').forEach(p => p.querySelectorAll('.tabs button').forEach(b => b.onclick = () => tab(p.classList.contains('left') ? 'left' : 'right', b.dataset.tab)));
document.querySelectorAll('.views button').forEach(b => b.onclick = () => { document.querySelectorAll('.views button').forEach(x => x.classList.toggle('on', x === b)); S.goto(b.dataset.view); });

// ---------- build guide ----------
const same = (a, b) => hw.net.of.get(a) === hw.net.of.get(b);
const pinName = id => hw.label[id] || id;
function renderGuide() {
  let done = 0, total = 0;
  $('guide').innerHTML = GUIDE.map((st, i) => {
    const ok = st.wires.map(([a, b]) => same(a, b)); const n = ok.filter(Boolean).length; done += n; total += ok.length;
    return `<li class="${n === ok.length ? 'done' : ''}"><h3><span class="n">${n === ok.length ? '✓' : i + 1}</span>${esc(st.title)}</h3><p>${esc(st.why)}</p>
      <ul>${st.wires.map(([a, b, c], k) => `<li data-a="${a}" data-b="${b}" class="${ok[k] ? 'ok' : ''}"><span class="dot" style="background:${c}"></span>${esc(pinName(a))} → ${esc(pinName(b))}</li>`).join('')}</ul>
      ${n < ok.length ? `<button class="sm" data-step="${i}">Wire this step</button>` : ''}</li>`;
  }).join('');
  $('progTxt').textContent = `${done} / ${total} connections`; $('progBar').style.width = (100 * done / total) + '%';
  $('progSub').textContent = done === total ? 'All wired. Press Upload & run.' : done === 0 ? 'Start with the power rails.' : '';
}
$('guide').addEventListener('click', e => {
  const b = e.target.closest('button[data-step]');
  if (b) { for (const [a, c, col] of GUIDE[+b.dataset.step].wires) if (!same(a, c)) addWire(a, c, col, true); changed(); return; }
  const li = e.target.closest('li[data-a]');
  if (li) { flash([li.dataset.a, li.dataset.b]); S.focus(pinMap.get(li.dataset.b).anchor, 160); }
});
$('wireAll').onclick = () => { for (const st of GUIDE) for (const [a, b, c] of st.wires) if (!same(a, b)) { addWire(a, b, c, true); hw.rebuild(); } changed(); };
$('clearWires').onclick = () => { if (!hw.wires.length || confirm('Remove all ' + hw.wires.length + ' wires?')) { wires.clear(); hw.wires = []; selWire(null); changed(); } };

// ---------- parts & cost ----------
(function renderParts() {
  const peso = n => '₱' + n.toLocaleString();
  let lo = 0, hi = 0, rows = '';
  const items = PARTS.filter(d => d.buy).map(d => d.buy).concat(EXTRA_BUY);
  for (const [q, n, , a, b] of items) { lo += q * a; hi += q * b; rows += `<tr><td>${q}×</td><td>${esc(n)}</td><td>${peso(q * a)}–${peso(q * b)}</td></tr>`; }
  $('parts').innerHTML = PARTS.map(d => `<div class="pcard" data-part="${d.id}" tabindex="0"><h3>${esc(d.name)}</h3><p>${esc(d.info)}</p>${d.buy ? `<div class="buy">Buy: ${d.buy[0]}× ${esc(d.buy[1])} · about ₱${d.buy[3]}–${d.buy[4]} each</div>` : d.owned ? '<div class="buy">You already own this.</div>' : ''}</div>`).join('')
    + `<h3 style="margin:10px 0 0;font-size:14px">Shopping list</h3><table class="shop"><tr><th>Qty</th><th>Item</th><th>Est.</th></tr>${rows}<tr><th></th><th>Total (without ESP32)</th><th>${peso(lo)}–${peso(hi)}</th></tr></table>
    <p class="mu small">Rough PHP prices. Check Makerlab, E-Gizmo, Circuit Rocket, Shopee or Lazada. The relay must be the opto-isolated 2-channel board, the buzzer must be active, the LCD 20×4 with I2C backpack.</p>`;
  $('parts').addEventListener('click', e => { const c = e.target.closest('[data-part]'); if (c) selectPart(c.dataset.part, true); });
  $('parts').addEventListener('keydown', e => { if (e.key === 'Enter') { const c = e.target.closest('[data-part]'); if (c) selectPart(c.dataset.part, true); } });
})();

// ---------- checks ----------
function renderChecks() {
  const is = hw.issues, e = is.filter(i => i.level === 'error').length, w = is.filter(i => i.level === 'warn').length;
  const b = $('chkBadge'); b.textContent = e || w || ''; b.className = 'badge ' + (e ? 'e' : w ? 'w' : '');
  const name = id => (PARTS.find(d => d.id === id) || {}).short || 'Wiring';
  $('checks').innerHTML = (is.length ? is : [{ level: 'ok', part: null, msg: 'No problems found.' }]).map(i => `<li class="${i.level}" data-part="${i.part || ''}"><small>${i.level === 'ok' ? 'OK' : i.level} · ${esc(name(i.part))}</small>${esc(i.msg)}</li>`).join('');
}
$('checks').addEventListener('click', e => { const li = e.target.closest('li[data-part]'); if (li && li.dataset.part) selectPart(li.dataset.part, true); });

// ---------- 3D interaction ----------
const canvas = S.renderer.domElement, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const tip = $('tip'), selbar = $('selbar');
let hoverPin = null, pending = null, drag = null, down = null, selPart = null, flashT = 0, flashPins = [];
const setNdc = e => { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, S.camera); };
const pick = list => { const h = ray.intersectObjects(list, false); return h.length ? h[0] : null; };
// pins are tiny and their hit spheres overlap: pick the one whose centre is closest to the ray
const _c = new THREE.Vector3();
const pickPin = () => {
  const h = ray.intersectObjects(hitMeshes, false); if (!h.length) return null;
  let best = null, bd = Infinity;
  for (const x of h) { x.object.getWorldPosition(_c); const d = ray.ray.distanceSqToPoint(_c); if (d < bd) { bd = d; best = x; } }
  return best;
};
const plane = (y = 0) => { const p = new THREE.Vector3(); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null; };

function flash(ids) { flashPins = ids; flashT = 2.2; }
function selWire(id) {
  wires.select(id);
  if (!id) { if (!selPart) selbar.style.display = 'none'; return; }
  selPart = null; const w = hw.wires.find(x => x.id === id);
  selbar.innerHTML = `<span>Wire: ${esc(pinName(w.a))} ↔ ${esc(pinName(w.b))}</span>` + ['#e5392f', '#f08a24', '#222428', '#2fbf5b', '#2b8fd6', '#f2c230', '#b06ee0', '#ffffff'].map(c => `<button class="sm" data-col="${c}" title="Color" style="width:22px;height:22px;padding:0;background:${c}"></button>`).join('') + '<button class="sm" id="delWire">Delete</button>';
  selbar.style.display = 'flex';
  $('delWire').onclick = () => removeWire(id);
  selbar.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { wires.recolor(id, b.dataset.col); save(); });
}

// ---------- trace a connection end to end ----------
const tracebar = $('tracebar');
let tracedPin = null, tracePins = null;
const prio = p => p.startsWith('esp.') ? 0 : p.startsWith('rail.') ? 2 : 1;
function traceNet(pin) {
  tracedPin = pin;
  const m = hw.members(pin); tracePins = new Set(m);
  const ids = new Set(hw.wires.filter(w => tracePins.has(w.a) || tracePins.has(w.b)).map(w => w.id));
  wires.trace(ids);
  const seen = new Set(), names = [];
  for (const p of [...m].sort((a, b) => prio(a) - prio(b))) {
    const lab = p.startsWith('rail.') ? 'Rails ' + p.split('.')[1].replace(/_\d+$/, '') : pinName(p);
    if (!seen.has(lab)) { seen.add(lab); names.push(lab); }
  }
  const follow = new Map();
  for (const p of m) { const part = p.split('.')[0], g = groupForPin(p); if (g && !follow.has(part)) follow.set(part, [p, g]); }
  const v = hw.netV(pin);
  tracebar.innerHTML = `<b>Traced</b><div class="path">${names.map(n => `<span>${esc(n)}</span>`).join('<i>⟷</i>')}</div>
    <span class="mu">${ids.size} wire${ids.size === 1 ? '' : 's'} · now ${v == null ? 'floating' : v.toFixed(2) + ' V'}</span>
    ${[...follow].map(([part, [p, g]]) => `<button class="sm primary" data-follow="${part}" data-g="${g}">Follow inside ${esc(parts.get(part).def.short)} →</button>`).join('')}
    <button class="sm" id="trClose" title="Stop tracing (Esc)">✕</button>`;
  tracebar.style.display = 'flex';
  tracebar.querySelectorAll('[data-follow]').forEach(b => b.onclick = () => { const part = b.dataset.follow, g = b.dataset.g; clearTrace(); selbar.style.display = 'none'; tip.style.display = 'none'; insp.open(part, g); });
  $('trClose').onclick = clearTrace;
}
function clearTrace() { tracedPin = null; tracedWire = null; tracePins = null; wires.trace(null); tracebar.style.display = 'none'; }
// Spotlight ONE wire: everything else fades out; its two pins pulse.
let tracedWire = null;
function traceWire(id) {
  const w = hw.wires.find(x => x.id === id); if (!w) { clearTrace(); return; }
  tracedWire = id; tracedPin = null; tracePins = new Set([w.a, w.b]);
  wires.trace(new Set([id]));
  const n = hw.wires.filter(x => { const m = new Set(hw.members(w.a)); return m.has(x.a) || m.has(x.b); }).length, v = hw.netV(w.a);
  tracebar.innerHTML = `<b>Wire</b><div class="path"><span>${esc(pinName(w.a))}</span><i>⟷</i><span>${esc(pinName(w.b))}</span></div>
    <span class="mu">now ${v == null ? 'floating' : v.toFixed(2) + ' V'}</span>
    ${n > 1 ? `<button class="sm" id="trNet" title="Also highlight every other wire on this same connection">Show whole connection (${n} wires)</button>` : ''}
    <button class="sm" id="trClose" title="Show all wires again (Esc)">✕</button>`;
  tracebar.style.display = 'flex';
  if ($('trNet')) $('trNet').onclick = () => traceNet(w.a);
  $('trClose').onclick = () => { clearTrace(); selWire(null); };
}
function selectPart(id, focus) {
  wires.select(null); selPart = id; const p = parts.get(id);
  selbar.innerHTML = `<span><b>${esc(p.def.name)}</b></span><button class="sm primary" id="inspPart" title="Fly in close and see the internal connections (or double-click the part)">Inspect</button>${p.def.fixed ? '<span class="mu">fixed in place</span>' : mounted(p) ? `<span class="mu">${p.def.assembled ? 'mounted: ' + esc(p.def.assembled.where) : 'in the control box'}</span>` : '<button class="sm" id="rotPart">Rotate 90°</button>'}<button class="sm" id="infoPart">Info</button>`;
  $('inspPart').onclick = () => { selbar.style.display = 'none'; insp.open(id); };
  selbar.style.display = 'flex';
  if ($('rotPart')) $('rotPart').onclick = () => rotatePart(id);
  $('infoPart').onclick = () => { tab('left', 'parts'); const c = document.querySelector(`.pcard[data-part="${id}"]`); c && c.scrollIntoView({ block: 'center' }); c && c.focus(); };
  if (focus) S.focus(p.group, id === 'lcd' || id === 'rail' ? 190 : 150);
}
// footprint on the bench (x/z only) of a part's own meshes, ignoring decorative leads
function footprint(id) {
  const p = parts.get(id), b = new THREE.Box3(), tmp = new THREE.Box3();
  p.group.updateMatrixWorld(true);
  p.bodies.forEach(m => { if (m.geometry.type === 'TubeGeometry') return; tmp.setFromObject(m); b.union(tmp); });
  return b.expandByScalar(-1);
}
function overlapping(id) {
  const a = footprint(id);
  for (const other of parts.keys()) {
    if (other === id || parts.get(other).def.fixed || mounted(parts.get(other))) continue;
    const b = footprint(other);
    if (a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z) return other;
  }
  return null;
}
let noticeT;
function notice(text) { const h = $('hint'); h.textContent = text; h.style.borderColor = 'var(--warn)'; clearTimeout(noticeT); noticeT = setTimeout(() => { h.innerHTML = 'Click a pin, then another pin, to connect a jumper. Drag a board to move it, double-click it to inspect. Right-drag pans, scroll zooms. <kbd>Del</kbd> removes the selected wire, <kbd>Esc</kbd> cancels.'; h.style.borderColor = ''; }, 4500); }
function rotatePart(id) { const p = parts.get(id); if (p.def.fixed || mounted(p)) return; p.group.rotation.y += Math.PI / 2; p.bench.ry = p.group.rotation.y; p.group.updateMatrixWorld(true); wires.refreshPart(id); save(); }

function pinTip(id) {
  const pin = pinMap.get(id), part = parts.get(pin.part);
  const info = pin.part === 'esp' ? espPinInfo(id.split('.')[1]) : (pin.def.role || '').replace('out-', 'output, ').replace('in-', 'input, ').replace('vcc', 'power in').replace('gnd', 'ground');
  const others = [...new Set(hw.members(id).filter(x => x !== id).map(pinName))].filter(n => n !== pinName(id));
  const v = hw.netV(id);
  return `<b>${esc(part.def.short)} · ${esc(pin.label)}</b><span class="mu">${esc(info)}</span><br>${others.length ? 'Connected to: ' + esc(others.slice(0, 6).join(', ')) + (others.length > 6 ? '…' : '') : '<span class="mu">Not connected</span>'}<br>Now: <span class="v">${v == null ? 'floating' : v.toFixed(2) + ' V'}</span>${pending ? `<br><span class="mu">${pending === id ? 'Click another pin to finish' : 'Click to connect from ' + esc(pinName(pending))}</span>` : `<br><span class="mu">Click: start a wire · Shift+click or right-click: trace</span>`}`;
}
function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const r = canvas.getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14; if (x + 300 > r.width) x -= 320; if (y + 120 > r.height) y -= 130; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return; setNdc(e);
  const hp = pickPin(), hb = !hp && pick(bodyMeshes), hwv = !hp && pick(wires.meshes());
  down = { x: e.clientX, y: e.clientY, pin: hp && hp.object.userData.pin, wire: hwv && hwv.object.userData.wire, part: hb && hb.object.userData.part, dist: Math.min(hb ? hb.distance : 1e9, hwv ? hwv.distance : 1e9) };
  if (down.wire && hb && hb.distance < hwv.distance) down.wire = null;
  if (down.part && !down.pin && !pending && !down.wire && mounted(parts.get(down.part))) down.mountedPart = true;
  if (down.part && !down.pin && !pending && !(down.wire) && !parts.get(down.part).def.fixed && !mounted(parts.get(down.part)) && !layoutAnim) {
    const p = parts.get(down.part), pt = plane(0);
    if (pt) { drag = { p, off: p.group.position.clone().sub(pt), start: p.group.position.clone(), started: false }; S.controls.enabled = false; }
  }
}, { capture: true });

canvas.addEventListener('pointermove', e => {
  setNdc(e);
  if (drag) {
    if (!drag.started && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) drag.started = true;
    if (drag.started) {
      const pt = plane(0); if (pt) {
        const g = drag.p.group; g.position.x = Math.round((pt.x + drag.off.x) / 2.54) * 2.54; g.position.z = Math.round((pt.z + drag.off.z) / 2.54) * 2.54;
        g.position.x = Math.max(-390, Math.min(370, g.position.x)); g.position.z = Math.max(-170, Math.min(200, g.position.z));
        g.updateMatrixWorld(true); wires.refreshPart(drag.p.id);
      }
      tip.style.display = 'none'; return;
    }
  }
  const hp = pickPin();
  hoverPin = hp ? hp.object.userData.pin : null;
  wires.hover = null;
  if (hoverPin) { showTip(e, pinTip(hoverPin)); canvas.style.cursor = 'crosshair'; }
  else {
    const hb = pick(bodyMeshes), hwv = !pending && pick(wires.meshes());
    if (hwv && (!hb || hwv.distance < hb.distance)) {
      const w = hw.wires.find(x => x.id === hwv.object.userData.wire), v = w && hw.netV(w.a);
      if (w) { wires.hover = w.id; showTip(e, `<b>Wire</b>${esc(pinName(w.a))} ⟷ ${esc(pinName(w.b))}<br>Now: <span class="v">${v == null ? 'floating' : v.toFixed(2) + ' V'}</span><br><span class="mu">Click to trace where it goes</span>`); canvas.style.cursor = 'pointer'; }
    } else { tip.style.display = 'none'; canvas.style.cursor = pending ? 'crosshair' : hb ? 'grab' : ''; }
  }
  if (pending) {
    let to;
    if (hoverPin) { to = wires.end(hoverPin).start; } else { const pt = plane(20); to = pt || wires.end(pending).start; }
    wires.showBand(pending, to);
  }
});

canvas.addEventListener('pointerup', e => {
  const wasDrag = drag && drag.started;
  if (drag) {
    S.controls.enabled = true;
    if (wasDrag) {
      const hit = overlapping(drag.p.id);
      if (hit) { drag.p.group.position.copy(drag.start); drag.p.group.updateMatrixWorld(true); wires.refreshPart(drag.p.id); notice(`${drag.p.def.short} would sit on top of ${parts.get(hit).def.short}, so it was moved back.`); }
      drag.p.bench.x = drag.p.group.position.x; drag.p.bench.z = drag.p.group.position.z;
      finishLayout(); // the loom follows the new arrangement
      save();
    }
    drag = null;
  }
  if (!down || wasDrag) { down = null; return; }
  const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5; const d = down; down = null;
  if (!click) return;
  if (d.pin && e.shiftKey && !pending) { traceNet(d.pin); return; }
  if (d.pin) {
    if (pending && pending !== d.pin) { addWire(pending, d.pin); flash([pending, d.pin]); pending = null; wires.showBand(null); }
    else if (pending === d.pin) { pending = null; wires.showBand(null); }
    else { pending = d.pin; selWire(null); }
    return;
  }
  if (pending) { pending = null; wires.showBand(null); return; }
  if (d.wire) { selWire(d.wire); traceWire(d.wire); return; }
  if (d.part) { selectPart(d.part, false); return; }
  selPart = null; selWire(null); selbar.style.display = 'none'; clearTrace();
});
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; wires.hover = null; });
// right-click (without dragging) on a pin or wire traces it; right-drag still pans
let rdown = null;
canvas.addEventListener('pointerdown', e => { if (e.button === 2) rdown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!rdown || Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > 5) return;
  setNdc(e);
  const hp = pickPin(); if (hp) { traceNet(hp.object.userData.pin); return; }
  const hwv = pick(wires.meshes()); if (hwv) { const w = hw.wires.find(x => x.id === hwv.object.userData.wire); if (w) traceWire(w.id); }
});
canvas.addEventListener('dblclick', e => {
  setNdc(e); if (pickPin()) return;
  const hb = pick(bodyMeshes); if (!hb) return;
  selbar.style.display = 'none'; insp.open(hb.object.userData.part);
});

addEventListener('keydown', e => {
  const typing = /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
  if (typing) return;
  if (e.key === 'Escape' && (tracedPin || tracedWire) && !pending) { clearTrace(); selWire(null); return; }
  if (e.key === 'Escape' && insp.current && !pending) { insp.close(); return; }
  if (e.key === 'Escape') { pending = null; wires.showBand(null); selWire(null); selPart = null; selbar.style.display = 'none'; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && wires.selected) { e.preventDefault(); removeWire(wires.selected); }
  if ((e.key === 'r' || e.key === 'R') && selPart) rotatePart(selPart);
});

// ---------- environment HUD ----------
$('bFire').onclick = () => { world.flameVisible ? world.extinguish() : world.ignite(); };
$('int').oninput = e => { world.intensity = +e.target.value; $('vInt').textContent = e.target.value + ' °C'; };
$('gas').oninput = e => { world.gasLeak = +e.target.value; $('vGas').textContent = e.target.value + ' ppm'; };
$('bDrain').onclick = () => { world.tank = Math.max(0, world.tank - 25); };
$('bWorld').onclick = () => { world.reset(); $('int').value = 70; $('gas').value = 50; $('vInt').textContent = '70 °C'; $('vGas').textContent = '50 ppm'; };
let audio = null, buzzOsc = null, buzzGain = null;
$('bSound').onclick = e => {
  if (!audio) { try { audio = new AudioContext(); buzzOsc = audio.createOscillator(); buzzOsc.type = 'square'; buzzOsc.frequency.value = 2400; buzzGain = audio.createGain(); buzzGain.gain.value = 0; buzzOsc.connect(buzzGain).connect(audio.destination); buzzOsc.start(); } catch { audio = null; } }
  if (!audio) return;
  const on = audio.state !== 'running' || e.currentTarget.getAttribute('aria-pressed') !== 'true';
  if (on) audio.resume(); else audio.suspend();
  e.currentTarget.setAttribute('aria-pressed', on); e.currentTarget.textContent = on ? 'Sound on' : 'Sound off';
};
function click() {
  if (!audio || audio.state !== 'running') return;
  const b = audio.createBuffer(1, 600, audio.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 90);
  const s = audio.createBufferSource(); s.buffer = b; const g = audio.createGain(); g.gain.value = 0.25; s.connect(g).connect(audio.destination); s.start();
}

// ---------- per-frame visuals ----------
const C = new THREE.Color();
let lcdKey = '', prevK = [false, false];
function drawLcd(o) {
  const p = parts.get('lcd'), cv = p.refs.lcdCanvas, L = hw.lcd, on = o.lcdV >= 3;
  const key = [on, o.lcdV, L.backlight, L.init, ...L.rows].join('|'); if (key === lcdKey) return; lcdKey = key;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, cw = (W - 20) / 20, ch = (H - 16) / 4;
  g.fillStyle = !on ? '#0b1526' : L.backlight ? '#2350d8' : '#13254f'; g.fillRect(0, 0, W, H);
  if (on) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 20; c++) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(10 + c * cw + 2, 8 + r * ch + 3, cw - 4, ch - 6); }
    if (!L.init) { g.fillStyle = 'rgba(220,230,255,.55)'; for (const r of [0, 2]) for (let c = 0; c < 20; c++) g.fillRect(10 + c * cw + 2, 8 + r * ch + 3, cw - 4, ch - 6); }
    else {
      g.fillStyle = o.lcdV < 4.5 ? 'rgba(235,242,255,.3)' : '#eef4ff'; g.font = `bold ${Math.round(ch * 0.78)}px ui-monospace, Consolas, monospace`; g.textBaseline = 'middle'; g.textAlign = 'center';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 20; c++) { const s = L.rows[r][c]; if (s && s !== ' ') g.fillText(s, 10 + c * cw + cw / 2, 8 + r * ch + ch / 2 + 1); }
    }
  }
  p.refs.lcdTex.needsUpdate = true; p.refs.lcdMat.emissiveIntensity = on && L.backlight ? 0.75 : 0.1;
}
function visuals(o, dt, time) {
  const R = id => parts.get(id).refs;
  const lit = (m, on, k = 2.2) => { m.material.emissiveIntensity = on ? k : 0; };
  lit(R('esp').led2, o.espLed, 3);
  lit(R('relay').pwr, o.relayPowered || o.relayWeak, 1.8); lit(R('relay').k1, o.k1); lit(R('relay').k2, o.k2);
  if (o.k1 !== prevK[0] || o.k2 !== prevK[1]) { click(); prevK = [o.k1, o.k2]; }
  lit(R('mq2').dled, o.mqLed); lit(R('flame').dled, o.flameLed);
  R('panel').leds.forEach(({ m, h }, i) => {
    const on = o.leds[i], k = o.ledDim[i] ? 0.35 : 1;
    m.emissiveIntensity = on ? 1.1 * k : 0; m.opacity = on ? 0.95 : 0.6; h.material.opacity = on ? 0.85 * k : 0;
  });
  if (lp.dirty !== o.leds.join()) renderLedPanel(o.leds);
  const ring = R('buzz').ring; ring.material.opacity = o.buzz ? 0.7 * (1 - (time * 3 % 1)) : 0; const s = 1 + (time * 3 % 1) * 1.2; ring.scale.set(s, s, s);
  if (buzzGain) buzzGain.gain.setTargetAtTime(o.buzz ? 0.05 : 0, audio.currentTime, 0.005);
  drawLcd(o);
  const pinsOn = pending ? 0.12 : 0;
  for (const [id, pin] of pinMap) {
    let op = pinsOn, col = '#36e2ff';
    if (id === hoverPin) op = 0.6;
    if (id === pending) { op = 0.85; col = '#ffd24a'; }
    if (tracePins && tracePins.has(id) && !id.startsWith('rail.')) { op = 0.55 + 0.3 * Math.sin(time * 5); col = '#7cff9a'; }
    if (flashT > 0 && flashPins.includes(id)) { op = 0.4 + 0.4 * Math.sin(time * 12); col = '#7cff9a'; }
    pin.hit.material.opacity = op; pin.hit.material.color.set(col);
  }
  if (flashT > 0) flashT -= dt;
}
function hud(o) {
  const b = (on, t) => `<span class="${on ? 'on' : ''}">${t} <b>${on ? 'ON' : 'off'}</b></span>`;
  const warn = [];
  if (world.dry > 0.5) warn.push('<span class="bad">Sprinkler pump running dry!</span>');
  if (world.overflow > 0.2) warn.push('<span class="bad">Tank overflowing!</span>');
  if (hw.issues.some(i => i.level === 'error')) warn.push('<span class="bad">Wiring errors: see Checks</span>');
  const spray = world.sprayL > 0 ? `<b>${world.sprayL.toFixed(2)} L</b> now` : `last <b>${world.lastSprayL.toFixed(2)} L</b>`;
  $('read').innerHTML = `<span>Phase <b>${world.phase}</b> fire</span><span>Room <b>${world.temp.toFixed(1)} °C</b> · ${Math.round(world.hum)}%</span><span>Gas <b>${world.gasPpm} ppm</b></span><span>Tank <b>${Math.round(world.tank)}%</b> (${(world.tank * TANK_LITRES / 100).toFixed(1)} L)</span>${b(o.sprPump, 'Sprinkler pump')}<span>Sprayed ${spray}</span>${b(o.refPump, 'Refill pump')}${b(o.buzz, 'Buzzer')}${warn.join('')}`;
  const fb = $('bFire'); fb.textContent = world.flameVisible ? 'Put out fire' : 'Ignite fire'; fb.classList.toggle('on', world.flameVisible);
}

// ---------- LED indicator panel ----------
// which LEDs in each row are lit, e.g. Tank level -> [Blue]
const groupsLit = leds => LED_GROUPS.map(gr => ({ gr, lit: LED_SPEC.filter((l, i) => l.g === gr.key && leds[i]) }));
const lp = { dirty: '' };
function renderLedPanel(leds = new Array(17).fill(false)) {
  lp.dirty = leds.join();
  $('leds').innerHTML = groupsLit(leds).map(({ gr, lit }, i) => {
    const col = lit.length ? lit[0].color : '';
    const meaning = lit.length ? lit.map(l => `${l.name} · ${l.label}`).join(' + ') : `off · ${gr.off}`;
    return `<li><i class="ld" style="${col ? `background:${col};box-shadow:0 0 10px ${col}` : ''}"></i><span>${gr.name}</span><span class="lm">${meaning}</span></li>`;
  }).join('');
}
$('lpToggle').onclick = () => { const p = $('ledpanel'); p.classList.toggle('closed'); $('lpToggle').setAttribute('aria-expanded', !p.classList.contains('closed')); };
// small screens: fold the LED panel and the controls so the 3D view stays visible (also when the window is resized)
const narrow = matchMedia('(max-width: 700px)'), phone = matchMedia('(max-width: 600px)');
const fitSmall = () => {
  $('ledpanel').classList.toggle('closed', narrow.matches);
  $('hud').classList.toggle('closed', phone.matches); $('hudToggle').setAttribute('aria-expanded', !phone.matches); $('hudToggle').textContent = phone.matches ? 'Controls ▸' : 'Controls ▾';
};
narrow.addEventListener('change', fitSmall); phone.addEventListener('change', fitSmall); fitSmall();
$('hudToggle').onclick = () => { const c = $('hud').classList.toggle('closed'); $('hudToggle').setAttribute('aria-expanded', !c); $('hudToggle').textContent = c ? 'Controls ▸' : 'Controls ▾'; };
renderLedPanel();

// ---------- data log (before / during / after the fire) ----------
const LOG = [];
let lastLogVt = -1e9, lastSig = '';
function maybeLog(o) {
  const gl = groupsLit(o.leds), leds = gl.map(x => x.lit.map(l => l.name).join('+') || 'off'), pix = gl.map(x => x.lit.length ? x.lit[0].color : '');
  const sig = [world.phase, o.sprPump, o.refPump, o.buzz, world.flameVisible, ...leds].join();
  if (rt.vt - lastLogVt < 1000 && sig === lastSig) return;
  lastLogVt = rt.vt; lastSig = sig;
  const row = { t: rt.vt / 1000, phase: world.phase, temp: +world.temp.toFixed(1), hum: Math.round(world.hum), gas: world.gasPpm, flame: world.flameVisible, tank: Math.round(world.tank),
    spr: o.sprPump, ref: o.refPump, sprayed: +(world.sprayL || world.lastSprayL).toFixed(2), leds, pix, buzz: o.buzz };
  LOG.push(row); if (LOG.length > 5000) LOG.shift();
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${clock(rt.vt)}</td><td>${row.phase}</td><td>${row.temp} °C</td><td>${row.hum}%</td><td>${row.gas} ppm</td><td>${row.flame ? 'yes' : 'no'}</td><td>${row.tank}%</td><td>${row.spr ? 'ON' : 'off'}</td><td>${row.ref ? 'ON' : 'off'}</td><td>${row.sprayed} L</td><td>${row.pix.map((c, i) => `<i class="c" style="background:${c || '#2a333b'}" title="${row.leds[i]}"></i>`).join('')} ${row.leds.join('·')}</td><td>${row.buzz ? 'ON' : 'off'}</td>`;
  const body = $('logBody'); body.prepend(tr); while (body.rows.length > 400) body.deleteRow(400);
  logChartDirty = true;
}
let logChartDirty = false;
function drawLogChart() {
  logChartDirty = false;
  const cv = $('logChart'), g = cv.getContext('2d'), W = cv.width, H = cv.height, P = 34;
  g.fillStyle = '#0d1216'; g.fillRect(0, 0, W, H);
  const rows = LOG.slice(-600); if (rows.length < 2) { g.fillStyle = '#8ea2b0'; g.font = '14px system-ui'; g.fillText('Run the sketch to start logging.', P, H / 2); renderPhases(); return; }
  const t0 = rows[0].t, t1 = rows.at(-1).t || 1, X = t => P + (t - t0) / Math.max(1, t1 - t0) * (W - P - 10), Y = (v, max) => H - 22 - v / max * (H - 40);
  for (const r of rows) if (r.phase === 'during') { g.fillStyle = 'rgba(255,122,47,.13)'; g.fillRect(X(r.t) - 2, 8, 4, H - 30); }
  g.strokeStyle = '#2a3640'; g.fillStyle = '#8ea2b0'; g.font = '11px system-ui'; g.lineWidth = 1;
  for (const v of [0, 20, 40, 60, 80]) { g.beginPath(); g.moveTo(P, Y(v, 90)); g.lineTo(W - 10, Y(v, 90)); g.stroke(); g.fillText(v + '°', 4, Y(v, 90) + 4); }
  const line = (f, max, col) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); rows.forEach((r, i) => { const x = X(r.t), y = Y(f(r), max); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  line(r => r.temp, 90, '#ff7a2f'); line(r => r.tank, 111, '#36b7ff');
  g.fillStyle = '#ff7a2f'; g.fillText('Temperature °C', P + 4, 16); g.fillStyle = '#36b7ff'; g.fillText('Tank %', P + 110, 16); g.fillStyle = 'rgba(255,160,110,.9)'; g.fillText('shaded = fire burning', P + 170, 16);
  g.fillStyle = '#8ea2b0'; g.fillText(clock(t0 * 1000), P, H - 6); g.fillText(clock(t1 * 1000), W - 50, H - 6);
  renderPhases();
}
function renderPhases() {
  const ph = p => { const r = LOG.filter(x => x.phase === p); if (!r.length) return '—'; const ts = r.map(x => x.temp); return `${Math.min(...ts)}–${Math.max(...ts)} °C · ${r.length} rows`; };
  $('phases').innerHTML = ['before', 'during', 'after'].map(p => `<div class="${world.phase === p ? 'on' : ''}"><b>${p} fire</b>${ph(p)}</div>`).join('');
}
$('logClr').onclick = () => { LOG.length = 0; $('logBody').innerHTML = ''; drawLogChart(); };
$('logCsv').onclick = () => {
  const head = 'time_s,phase,temp_c,humidity_pct,gas_ppm,flame,tank_pct,sprinkler,refill,sprayed_l,led_sprinkler,led_refill,led_tank,led_fire_class,led_fume,buzzer';
  const csv = [head, ...LOG.map(r => [r.t.toFixed(1), r.phase, r.temp, r.hum, r.gas, r.flame ? 1 : 0, r.tank, r.spr ? 1 : 0, r.ref ? 1 : 0, r.sprayed, ...r.leds, r.buzz ? 1 : 0].join(','))].join('\n');
  download(new Blob([csv], { type: 'text/csv' }), 'fire-guard-log.csv');
};
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
drawLogChart();

// ---------- video + screenshot for the documentation ----------
let rec = null;
$('rec').onclick = () => {
  if (rec) { rec.stop(); return; }
  const stream = canvas.captureStream(30), chunks = [];
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  try { rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined); } catch { alert('Video recording is not supported in this browser.'); return; }
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => { download(new Blob(chunks, { type: 'video/webm' }), `fire-guard-simulation-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`); rec = null; $('rec').classList.remove('recording'); $('rec').textContent = '● Record'; };
  rec.start(500); $('rec').classList.add('recording'); $('rec').textContent = '■ Stop recording';
};
$('shot').onclick = () => { S.render(); canvas.toBlob(b => download(b, 'fire-guard-3d.png')); };

// ---------- live wire glow: signal wires (not power) light up while they are HIGH ----------
let glowOn = true;
function liveHigh() {
  const cache = new Map();
  return w => {
    const root = hw.net.of.get(w.a);
    if (!cache.has(root)) { const v = hw.netV(w.a); cache.set(root, v != null && v > 1.6 && hw.supplies(w.a).size === 0); }
    return cache.get(root);
  };
}
$('bGlow').onclick = e => { glowOn = !glowOn; e.currentTarget.setAttribute('aria-pressed', glowOn); e.currentTarget.textContent = glowOn ? 'Wire glow on' : 'Wire glow off'; };

// ---------- main loop ----------
let last = performance.now(), hudT = 0;
const step = sec => { const o = hw.evaluate(); world.sprPump = o.sprPump; world.refPump = o.refPump; world.step(sec); if (rt.state === 'running') maybeLog(o); };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (rt.state === 'running') rt.advance(dt * 1000 * speed, step); else step(dt * speed);
  const o = hw.evaluate(), t = now / 1000;
  lastO = o; o.ping = hw.lastPing && performance.now() - hw.lastPing < 120;
  stepLayout(dt);
  visuals(o, dt, t); S.dio.update(world, o, dt, t); insp.frame(t);
  wires.update(t, glowOn ? liveHigh() : null); S.tick(dt); S.render();
  if ((hudT -= dt) <= 0) { hudT = 0.12; hud(o); setStatus(); insp.update(); if (logChartDirty && $('tab-log').classList.contains('on')) drawLogChart(); }
  requestAnimationFrame(frame);
}
renderGuide(); renderChecks();
document.querySelectorAll('[data-layout]').forEach(b => b.onclick = () => {
  if (b.dataset.layout === layout || layoutAnim) return;
  insp.close(false); clearTrace();
  setLayout(b.dataset.layout);
  S.goto(b.dataset.layout === 'assembled' ? 'house' : 'bench');
  notice(b.dataset.layout === 'assembled' ? 'Assembled: DHT22 and MQ-2 are on the house’s back wall, the flame sensor is on the floor facing the fire. Wires stay connected.' : 'Bench layout: everything laid out flat for wiring. Drag boards to rearrange.');
});
setLayout(layout, false);

// ---------- Reset: every board back to its default spot + the default wiring (code is kept) ----------
function resetAll() {
  if (layoutAnim) return;
  insp.close(false); clearTrace(); selWire(null); selPart = null; selbar.style.display = 'none'; pending = null; wires.showBand(null);
  for (const p of parts.values()) {
    const [x, z, ry = 0] = p.def.pos;
    p.bench = { x, z, ry };
    if (p.def.fixed) continue;
    p.group.position.set(x, (p.def.mount && p.def.mount.y) || 0, z);
    p.group.quaternion.setFromEuler(new THREE.Euler(0, ry, 0));
    p.group.updateMatrixWorld(true);
  }
  wires.clear(); hw.wires = []; hw.rebuild(); // rebuild first, or the old connections would make every guide wire look "already done"
  for (const st of GUIDE) for (const [a, b, c] of st.wires) if (hw.net.of.get(a) !== hw.net.of.get(b)) { addWire(a, b, c, true); hw.rebuild(); }
  setLayout(layout, false); // re-applies the current layout (sensors in the house when assembled) and re-routes every wire
  changed();
  S.goto(layout === 'assembled' ? 'house' : 'bench');
  notice('Reset: every board is back in its default spot with the default wiring. Your code was not changed.');
}
$('resetAll').onclick = () => { if (confirm('Reset every board and wire to the default layout?\n\nThis replaces your current wiring and board positions (in both Bench layout and Assembled). Your code is kept.')) resetAll(); };
if (migrated.length) { compileMsg(`<span class="w">Upgraded your saved project to the single-LED build: ${esc(migrated.join('; '))}.</span>`); save(); }
requestAnimationFrame(frame);
// handy for debugging in the console: __fg.simulate(5000) runs 5 s of virtual time without rendering
window.__fg = {
  hw, world, rt, parts, run, S, wires, insp, editor, oldSketch: saved.oldCode, overlapping, addWire, removeWire, changed,
  setLayout, finishLayout, resetAll, traceWire, traceNet, clearTrace, LOG, save,
  get layout() { return layout; }, get layoutBusy() { return !!layoutAnim; }, get encl() { return encl; },
  stepLayout: dt => stepLayout(dt), // lets tests finish the layout animation without waiting for frames
  simulate: async ms => { for (let t = 0; t < ms; t += 50) { if (rt.state === 'running') await rt.advance(50, step); else step(0.05); } const o = hw.evaluate(); visuals(o, 0.05, performance.now() / 1000); S.dio.update(world, o, 0.05, performance.now() / 1000); wires.update(performance.now() / 1000, null); S.render(); return o; } };
