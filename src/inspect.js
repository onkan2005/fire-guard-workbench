// Inspect mode: fly in to one part, make it see-through, and show its internal connections
// ONE SIGNAL AT A TIME (data path, clock, latch, power, outputs…) with labels at both ends,
// plus a clean 2D schematic. Traces light up with the live signals.
import * as THREE from 'three';
import { TOP } from './helpers.js';
import { LED_SPEC, LED_GROUPS, PANEL } from './parts.js';

const Y = TOP + 0.4;
const NET = { vcc: '#ff4d4d', gnd: '#9fb0bd', data: '#18d1c0', clock: '#ffd23f', latch: '#ff5bd1', chain: '#a77bff', out: '#4dff7a', sig: '#36b7ff' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 74HC595 ----------
// DIP-16 pin positions on our 3D chip model (pin 1 top-left, counter-clockwise).
const chipX = [-12, 0, 12];
const cpin = (k, n) => n <= 8 ? [chipX[k] - 4.2, -8.89 + (n - 1) * 2.54] : [chipX[k] + 4.2, 8.89 - (n - 9) * 2.54];
const QPIN = [15, 1, 2, 3, 4, 5, 6, 7]; // chip pin number of Q0..Q7
export const PINOUT_595 = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4', 5: 'Q5', 6: 'Q6', 7: 'Q7', 8: 'GND', 9: "Q7′", 10: 'MR', 11: 'SHCP', 12: 'STCP', 13: 'OE', 14: 'DS', 15: 'Q0', 16: 'VCC' };
const PIN_NET = { 8: 'gnd', 9: 'chain', 10: 'vcc', 11: 'clock', 12: 'latch', 13: 'gnd', 14: 'data', 16: 'vcc' };

const level = (hw, pin) => { const v = hw.netV(pin); return v != null && v > 1.6; };

// Signal groups shown as buttons. [key, button label, colour, explanation]
const GROUPS = {
  sr: [
    ['data', 'Data path', NET.data, 'DATA (GPIO23) enters U1 at DS, pin 14. When U1 is full, the bit falling out of its Q7′ (pin 9) goes into U2’s DS, and U2’s Q7′ feeds U3. One wire fills all 24 bits.'],
    ['clock', 'Clock', NET.clock, 'CLOCK (GPIO18) goes to SHCP, pin 11, on all three chips. Every rising edge moves every bit one step along the chain.'],
    ['latch', 'Latch', NET.latch, 'LATCH (GPIO13) goes to STCP, pin 12, on all three chips. One pulse copies the 24 shifted bits to the Q outputs at the same moment, so the LEDs never flicker while bits are moving.'],
    ['power', 'Power', NET.vcc, 'VCC goes to pin 16 and to MR (pin 10, so the register is never cleared). GND goes to pin 8 and to OE (pin 13, so the outputs are always switched on).'],
    ['out1', 'U1 outputs', NET.out, 'U1’s Q0–Q7 come out on output pins Q0–Q7 and light L0–L7: sprinkler (2), refill (3) and the first three tank LEDs.'],
    ['out2', 'U2 outputs', NET.out, 'U2’s Q0–Q7 are output pins Q8–Q15: tank FULL, the five fire-class LEDs and the first two fume LEDs.'],
    ['out3', 'U3 outputs', NET.out, 'U3 only uses its Q0, output pin Q16 → L16 (fume, red). Its Q1–Q7 are spare for future LEDs.'],
    ['all', 'Everything', '#cfd8de', 'All 45 internal connections at once.'],
  ],
  panel: [['all', 'All rows', '#cfd8de', 'Every LED has its own straight lane: pin Ln → 220 Ω resistor → along the lane → LED + (long leg). The LED’s − leg (short) drops onto its row’s gray GND rail, and all rails join the GND spine on the right. Lanes never cross: the farther the LED, the farther its lane.'],
    ...LED_GROUPS.map(g => [g.key, g.name, LED_SPEC.find(l => l.g === g.key).color, `${g.name} row: ${LED_SPEC.map((l, i) => l.g === g.key ? `L${i} ${l.name} = ${l.label}` : null).filter(Boolean).join(', ')}.`])],
  div: [['all', 'Divider', NET.sig, 'IN → 10 kΩ → OUT → 20 kΩ → GND. OUT is the middle point: ⅔ of IN.']],
};

const TRACES = {
  sr(hw) {
    const H = { VCC: [-27, -5.08], GND: [-27, -2.54], DATA: [-27, 0], CLOCK: [-27, 2.54], LATCH: [-27, 5.08] };
    const Q = i => [27, -20.32 + i * 2.54];
    const t = [], pw = () => hw.vcc('sr') > 2;
    for (let k = 0; k < 3; k++) {
      const U = 'U' + (k + 1);
      t.push({ a: H.VCC, b: cpin(k, 16), net: 'vcc', grp: 'power', on: pw, la: 'VCC', lb: `${U} VCC·16` });
      t.push({ a: H.VCC, b: cpin(k, 10), net: 'vcc', grp: 'power', on: pw, lb: `MR·10` });
      t.push({ a: H.GND, b: cpin(k, 8), net: 'gnd', grp: 'power', on: () => false, la: 'GND', lb: `GND·8` });
      t.push({ a: H.GND, b: cpin(k, 13), net: 'gnd', grp: 'power', on: () => false, lb: `OE·13` });
      t.push({ a: H.CLOCK, b: cpin(k, 11), net: 'clock', grp: 'clock', on: () => level(hw, 'sr.CLOCK'), la: 'CLOCK in', lb: `${U} SHCP·11` });
      t.push({ a: H.LATCH, b: cpin(k, 12), net: 'latch', grp: 'latch', on: () => level(hw, 'sr.LATCH'), la: 'LATCH in', lb: `${U} STCP·12` });
      if (k === 0) t.push({ a: H.DATA, b: cpin(0, 14), net: 'data', grp: 'data', on: () => level(hw, 'sr.DATA'), la: 'DATA in', lb: 'U1 DS·14' });
      else t.push({ a: cpin(k - 1, 9), b: cpin(k, 14), net: 'chain', grp: 'data', on: () => !!hw.sr.shift[8 * k - 1], la: `U${k} Q7′·9`, lb: `${U} DS·14` });
      for (let b = 0; b < 8; b++) {
        const q = 8 * k + b; if (q > 16) break;
        t.push({ a: cpin(k, QPIN[b]), b: Q(q), net: 'out', grp: 'out' + (k + 1), on: () => !!hw.sr.out[q], la: `Q${b}`, lb: `Q${q} → L${q}`, color: LED_SPEC[q].color });
      }
    }
    return t;
  },
  // flat, lane-shaped traces that follow the copper printed on the board
  panel(hw, o) {
    const t = [], P = PANEL;
    for (const r of P.rows) {
      for (const l of r.leds) {
        const on = () => !!(o() && o().leds[l.i]);
        t.push({ pts: [[P.pinX, l.lane], [P.resL, l.lane]], net: 'sig', grp: l.g, color: l.color, on, la: `L${l.i}` });
        t.push({ pts: [[P.resR, l.lane], [l.x - 1.27, l.lane], [l.x - 1.27, l.z]], net: 'sig', grp: l.g, color: l.color, on, lb: `L${l.i} · ${l.short}` });
        t.push({ pts: [[l.x + 1.27, l.z], [l.x + 1.27, r.rail]], net: 'gnd', grp: l.g, on: () => false });
      }
      t.push({ pts: [[r.leds[0].x - 2, r.rail], [P.spineX, r.rail]], net: 'gnd', grp: r.key, on: () => false, lb: r.key === 'SPR' ? '' : '' });
    }
    t.push({ pts: [[P.spineX, P.rows[0].rail], [P.spineX, P.gndZ], [P.pinX, P.gndZ]], net: 'gnd', grp: '*', on: () => false, lb: 'GND' });
    return t;
  },
  div(hw, o, id = 'div') {
    const vin = () => (hw.netV(id + '.IN') ?? 0) > 0.3, [r1, r2] = id === 'div2' ? ['1 kΩ', '2 kΩ'] : ['10 kΩ', '20 kΩ'];
    return [
      { a: [-7, 0], b: [-3.1, -5], net: 'sig', grp: 'all', on: vin, la: 'IN', lb: r1 },
      { a: [3.1, -5], b: [7, -2.54], net: 'out', grp: 'all', on: vin, lb: 'OUT' },
      { a: [7, -2.54], b: [-3.1, 5.5], net: 'out', grp: 'all', on: vin, lb: r2 },
      { a: [3.1, 5.5], b: [7, 2.54], net: 'gnd', grp: 'all', on: () => false, lb: 'GND' },
    ];
  },
};
TRACES.div2 = (hw, o) => TRACES.div(hw, o, 'div2');
GROUPS.div2 = [['all', 'Echo divider', NET.sig, 'ECHO (5 V) → 1 kΩ → OUT → 2 kΩ → GND. OUT = ⅔ × 5 V = 3.3 V, safe for GPIO35.']];
// which signal group a pin of an inspectable part belongs to (used by "Follow inside")
export function groupForPin(pin) {
  const [part, p] = pin.split('.');
  if (part === 'sr') {
    if (p === 'DATA') return 'data'; if (p === 'CLOCK') return 'clock'; if (p === 'LATCH') return 'latch';
    if (p === 'VCC' || p === 'GND') return 'power';
    const q = +p.slice(1); return 'out' + ((q >> 3) + 1);
  }
  if (part === 'panel') { if (p === 'GND') return 'all'; const i = +p.slice(1); return LED_SPEC[i] ? LED_SPEC[i].g : 'all'; }
  if (part === 'div' || part === 'div2') return 'all';
  return null;
}

// ---------- 3D pieces ----------
function traceMesh(tr) {
  if (tr.pts) { tr.a = tr.pts[0]; tr.b = tr.pts[tr.pts.length - 1]; tr.flat = true; }
  const a = new THREE.Vector3(tr.a[0], Y, tr.a[1]), b = new THREE.Vector3(tr.b[0], Y, tr.b[1]);
  let curve;
  if (tr.pts) { curve = new THREE.CurvePath(); for (let k = 1; k < tr.pts.length; k++) curve.add(new THREE.LineCurve3(new THREE.Vector3(tr.pts[k - 1][0], Y, tr.pts[k - 1][1]), new THREE.Vector3(tr.pts[k][0], Y, tr.pts[k][1]))); }
  else if (tr.flat) curve = new THREE.LineCurve3(a, b);
  else { const m = a.clone().lerp(b, 0.5); m.y += 1.5 + a.distanceTo(b) * 0.16; curve = new THREE.QuadraticBezierCurve3(a, m, b); }
  const col = tr.color || NET[tr.net];
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, toneMapped: false });
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, tr.pts ? (tr.pts.length - 1) * 16 : tr.flat ? 2 : 24, tr.flat ? 0.5 : 0.45, 6), mat); tube.renderOrder = 20; g.add(tube);
  for (const p of [a, b]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), mat); d.position.copy(p); d.renderOrder = 20; g.add(d); }
  const base = new THREE.Color(col).multiplyScalar(0.75), bright = new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.3);
  return { g, mat, tr, base, bright, a, b };
}
function labelSprite(text, size = 6, color = '#ffffff', border = null) {
  const W = Math.max(96, text.length * 21 + 28);
  const c = document.createElement('canvas'); c.width = W; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,18,.88)'; g.beginPath(); g.roundRect(4, 8, W - 8, 48, 12); g.fill();
  if (border) { g.strokeStyle = border; g.lineWidth = 4; g.stroke(); }
  g.fillStyle = color; g.font = 'bold 32px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false })); s.scale.set(size * W / 64, size, 1); s.renderOrder = 22;
  return s;
}
const TITLES = {
  sr: () => [['U1', chipX[0], -14], ['U2', chipX[1], -14], ['U3', chipX[2], -14]],
  panel: () => [],
  div: () => [],
};

// ---------- 2D schematic of the driver ----------
function schematic() {
  // Chips 100 apart; the chain jog, LATCH drop and CLOCK drop each get their own column so no lines cross.
  const X = [124, 224, 324], W = 42, yDS = 62, ySH = 84, yST = 106, yQ7 = 146, yCK = 184, yLT = 200, L0 = 96;
  let s = `<svg viewBox="0 0 384 212" class="schem" role="img" aria-label="Schematic: three chained 74HC595 shift registers">`;
  // CLOCK + LATCH buses: start after the label, drop up into each chip
  s += `<g data-g="clock" class="sg"><text x="4" y="${yCK + 3}" fill="${NET.clock}">GPIO18 CLOCK</text><path d="M${L0} ${yCK}H${X[2] - 18}" stroke="${NET.clock}"/>${X.map(x => `<path d="M${x - 18} ${yCK}V${ySH}H${x}" stroke="${NET.clock}"/><circle cx="${x - 18}" cy="${yCK}" r="2.5" fill="${NET.clock}"/>`).join('')}</g>`;
  s += `<g data-g="latch" class="sg"><text x="4" y="${yLT + 3}" fill="${NET.latch}">GPIO13 LATCH</text><path d="M${L0} ${yLT}H${X[2] - 26}" stroke="${NET.latch}"/>${X.map(x => `<path d="M${x - 26} ${yLT}V${yST}H${x}" stroke="${NET.latch}"/><circle cx="${x - 26}" cy="${yLT}" r="2.5" fill="${NET.latch}"/>`).join('')}</g>`;
  // data path: DATA -> U1 DS, then each Q7' -> next DS
  s += `<g data-g="data" class="sg"><text x="4" y="${yDS + 3}" fill="${NET.data}">GPIO23 DATA</text><path d="M${L0} ${yDS}H${X[0] - 2}" stroke="${NET.data}" marker-end="url(#ar)"/>`;
  for (let k = 0; k < 2; k++) s += `<path d="M${X[k] + W} ${yQ7}H${X[k] + W + 16}V${yDS}H${X[k + 1] - 2}" stroke="${NET.chain}" marker-end="url(#arc)"/>`;
  s += `</g>`;
  // chips
  X.forEach((x, k) => {
    const out = ['L0–L7', 'L8–L15', 'L16'][k];
    s += `<g data-g="out${k + 1}" class="sg chip"><rect x="${x}" y="40" width="${W}" height="118" rx="4" fill="#1b1f24" stroke="#56616b"/>
      <text x="${x + W / 2}" y="33" fill="#e6edf2" text-anchor="middle" font-weight="700">U${k + 1}</text>
      <text x="${x + 4}" y="${yDS + 3}" fill="#9fb0bd">DS</text><text x="${x + 4}" y="${ySH + 3}" fill="#9fb0bd">SHCP</text><text x="${x + 4}" y="${yST + 3}" fill="#9fb0bd">STCP</text>
      <text x="${x + W - 4}" y="${yQ7 + 3}" fill="#9fb0bd" text-anchor="end">Q7′</text>
      <path d="M${x + W} 58H${x + W + 7}M${x + W} 64H${x + W + 7}M${x + W} 70H${x + W + 7}M${x + W} 76H${x + W + 7}" stroke="${NET.out}"/>
      <text x="${x + W / 2}" y="124" fill="${NET.out}" text-anchor="middle" font-size="9">Q0–Q7</text>
      <text x="${x + W / 2}" y="135" fill="${NET.out}" text-anchor="middle" font-size="9">→ ${out}</text></g>`;
  });
  s += `<g data-g="power" class="sg"><text x="225" y="14" fill="${NET.vcc}" text-anchor="middle">every chip: VCC→16 · MR→VCC · GND→8 · OE→GND</text></g>`;
  s += `<defs><marker id="ar" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${NET.data}"/></marker><marker id="arc" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${NET.chain}"/></marker></defs></svg>`;
  return s;
}

export function createInspector({ S, hw, parts, wires, pinName, getOutputs }) {
  let cur = null;
  const card = document.getElementById('inspector');

  function ghost(p, mode) {
    const saved = [];
    p.group.traverse(o => {
      if (!o.isMesh || o.userData.pin) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.some(m => m.metalness > 0.8 || m.blending === THREE.AdditiveBlending)) return;
      if (mode === 'pcb' && !o.userData.pcb) return;
      // the board becomes a dark X-ray film so the glowing traces stand out; chips go glassy
      const conv = m => {
        const c = m.clone(); c.transparent = true; c.depthWrite = false;
        if (o.userData.pcb) { c.color = new THREE.Color(c.map ? '#26343a' : '#0c1418'); c.opacity = 0.9; }
        else c.opacity = 0.18;
        return c;
      };
      saved.push([o, o.material]); o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    return saved;
  }
  function unghost(saved) { for (const [o, orig] of saved) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); o.material = orig; } }

  function open(id, grp) {
    close(false);
    const p = parts.get(id); if (!p) return;
    const gen = TRACES[id];
    const traces = gen ? gen(hw, getOutputs, id).map(traceMesh) : [];
    const group = new THREE.Group(); traces.forEach(t => group.add(t.g)); p.inner.add(group);
    // end labels, de-duplicated (e.g. the header "VCC" is shared by six traces)
    const seen = new Map(), labels = [];
    for (const t of traces) for (const [txt, pt] of [[t.tr.la, t.a], [t.tr.lb, t.b]]) {
      if (!txt) continue; const key = txt + '|' + pt.x.toFixed(1) + '|' + pt.z.toFixed(1);
      if (seen.has(key)) { seen.get(key).grps.add(t.tr.grp); continue; }
      const s = labelSprite(txt, 2.6, '#ffffff', t.tr.color || NET[t.tr.net]); s.position.set(pt.x, Y + 3.2, pt.z); group.add(s);
      const L = { s, grps: new Set([t.tr.grp]) }; seen.set(key, L); labels.push(L);
    }
    for (const [txt, x, z] of (TITLES[id] || (() => []))()) { const s = labelSprite(txt, 4); s.position.set(x, Y + 10, z); group.add(s); }
    const ghosts = gen ? ghost(p, id === 'panel' ? 'pcb' : 'all') : [];
    cur = { id, traces, labels, group, ghosts, grp: null };
    wires.focus(id);
    const box = new THREE.Box3(); p.bodies.forEach(m => { if (m.geometry.type !== 'TubeGeometry') box.union(new THREE.Box3().setFromObject(m)); });
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), d = Math.max(60, Math.max(size.x, size.z) * 1.7);
    // centre the part in the free area to the right of the inspector card
    const stage = document.querySelector('.stage').getBoundingClientRect(), cardW = stage.width > 640 ? 350 : 0;
    const off = new THREE.Vector3(0, d * 1.25, d * 0.42), dist = off.length();
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(S.camera.fov / 2)) * (stage.width / Math.max(1, stage.height));
    c.x -= (cardW / 2) / (stage.width / 2) * halfW;
    S.flyTo(c.clone().add(off), c);
    document.querySelector('.stage').classList.add('inspecting');
    renderCard(p);
    setGroup(grp || (id === 'sr' ? 'data' : 'all'));
  }
  function close(fly = true) {
    if (!cur) return;
    const p = parts.get(cur.id);
    unghost(cur.ghosts); p.inner.remove(cur.group);
    cur.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); });
    cur = null; wires.focus(null); card.hidden = true; document.querySelector('.stage').classList.remove('inspecting');
    if (fly) S.goto('bench');
  }
  function setXray(on) {
    if (!cur) return;
    if (on && !cur.ghosts.length && TRACES[cur.id]) cur.ghosts = ghost(parts.get(cur.id), cur.id === 'panel' ? 'pcb' : 'all');
    if (!on) { unghost(cur.ghosts); cur.ghosts = []; }
  }
  function setGroup(g) {
    if (!cur) return; cur.grp = g;
    const all = g === 'all';
    for (const t of cur.traces) t.g.visible = all || t.tr.grp === g || t.tr.grp === '*';
    for (const L of cur.labels) L.s.visible = !all ? L.grps.has(g) : cur.id === 'div' || cur.id === 'div2';
    card.querySelectorAll('[data-grp]').forEach(b => b.classList.toggle('on', b.dataset.grp === g));
    // chips stay solid unless you're looking at one chip's outputs
    card.querySelectorAll('.schem .sg').forEach(e => e.classList.toggle('dim', !all && e.dataset.g !== g && !(e.classList.contains('chip') && !g.startsWith('out'))));
    const def = (GROUPS[cur.id] || []).find(x => x[0] === g); const why = card.querySelector('#netWhy'); if (why) why.textContent = def ? def[3] : '';
    update(); // refresh the live lists for the new signal straight away
  }

  // ---------- side card ----------
  function pinout() {
    const L = [1, 2, 3, 4, 5, 6, 7, 8], R = [16, 15, 14, 13, 12, 11, 10, 9];
    const col = n => NET[PIN_NET[n]] || (n === 15 || n <= 7 ? NET.out : '#ccc');
    let s = '<svg viewBox="0 0 220 150" class="pinout" role="img" aria-label="74HC595 pinout"><rect x="80" y="8" width="60" height="134" rx="4" fill="#1b1b1e" stroke="#555"/><path d="M102 8a8 8 0 0 0 16 0" fill="#2c2c30" stroke="#555"/><text x="110" y="80" fill="#ccc" font-size="9" text-anchor="middle" transform="rotate(-90 110 80)">74HC595</text>';
    L.forEach((n, i) => { const y = 20 + i * 16; s += `<rect x="72" y="${y - 3}" width="8" height="6" fill="${col(n)}"/><text x="68" y="${y + 3}" fill="#ccc" font-size="9" text-anchor="end">${PINOUT_595[n]}  ${n}</text>`; });
    R.forEach((n, i) => { const y = 20 + i * 16; s += `<rect x="140" y="${y - 3}" width="8" height="6" fill="${col(n)}"/><text x="152" y="${y + 3}" fill="#ccc" font-size="9">${n}  ${PINOUT_595[n]}</text>`; });
    return s + '</svg>';
  }
  const ledFor = q => LED_SPEC[q] ? `L${q} ${LED_SPEC[q].name} ${LED_GROUPS.find(g => g.key === LED_SPEC[q].g).title.toLowerCase()} ${LED_SPEC[q].short}` : 'unused';

  function renderCard(p) {
    const id = p.id, groups = GROUPS[id];
    let body = '';
    if (groups) body += `<h4>Show one signal</h4><div class="netbtns">${groups.map(([k, n, c]) => `<button class="sm" data-grp="${k}"><i style="background:${c}"></i>${esc(n)}</button>`).join('')}</div><p id="netWhy" class="why"></p>`;
    if (id === 'sr') body += `
      <h4>Schematic <span class="mu">(click a line)</span></h4>${schematic()}
      <div class="ioline" id="insIO"></div>
      <h4>Bits right now</h4><div id="insBits"></div>
      <details><summary>74HC595 pinout</summary>${pinout()}</details>
      <details><summary>Which output lights which LED</summary><div class="qmap">${Array.from({ length: 17 }, (_, q) => `<span><b>Q${q}</b> U${(q >> 3) + 1}·Q${q & 7} → ${esc(ledFor(q))}</span>`).join('')}</div></details>`;
    else if (id === 'panel') body += `<div id="insLeds" class="ledlist"></div>`;
    else if (id === 'div' || id === 'div2') body += `<div id="insDiv" class="ioline"></div>`;
    else body += `<p>${esc(p.def.info || '')}</p>`;
    card.innerHTML = `<div class="insh"><div><b>${esc(p.def.name)}</b><span class="mu">Inspect · live · Esc to close</span></div><button class="sm" id="insClose" title="Close (Esc)">✕</button></div>
      <div class="row"><label class="chk"><input type="checkbox" id="insX" checked> X-ray</label><label class="chk"><input type="checkbox" id="insW" checked> Only this part's wires</label></div>
      ${body}<details ${groups ? '' : 'open'}><summary>Pins</summary><table class="pins" id="insPins"></table></details>`;
    card.hidden = false;
    card.querySelector('#insClose').onclick = () => close();
    card.querySelector('#insX').onchange = e => setXray(e.target.checked);
    card.querySelector('#insW').onchange = e => wires.focus(e.target.checked ? id : null);
    card.querySelectorAll('[data-grp]').forEach(b => b.onclick = () => setGroup(b.dataset.grp));
    card.querySelectorAll('.schem .sg').forEach(e => e.addEventListener('click', () => setGroup(e.dataset.g)));
    update();
  }
  const bit = (on, col = '#4dff7a', title = '') => `<i class="bit${on ? ' on' : ''}" style="${on ? `background:${col}` : ''}" title="${esc(title)}"></i>`;
  function update() {
    if (!cur) return;
    const p = parts.get(cur.id), o = getOutputs();
    const v = pin => { const x = hw.netV(pin); return x == null ? '<span class="mu">floating</span>' : x.toFixed(2) + ' V'; };
    const pinsEl = card.querySelector('#insPins');
    if (pinsEl) pinsEl.innerHTML = p.def.pins.map(pd => { const id = p.id + '.' + pd.id, conn = [...new Set(hw.members(id).filter(x => x !== id).map(pinName))].filter(n => !n.startsWith(p.def.short)); return `<tr><td>${esc(pd.label)}</td><td>${conn.length ? esc(conn.slice(0, 3).join(', ')) : '<span class="mu">—</span>'}</td><td>${v(id)}</td></tr>`; }).join('');
    if (cur.id === 'sr') {
      card.querySelector('#insIO').innerHTML = ['DATA', 'CLOCK', 'LATCH'].map(n => `<span>${n} ${bit(level(hw, 'sr.' + n), NET[n.toLowerCase()])}</span>`).join('') + `<span>VCC ${v('sr.VCC')}</span>`;
      card.querySelector('#insBits').innerHTML = [0, 1, 2].map(k => `<div class="bits"><b>U${k + 1}</b><div><small>shift</small>${Array.from({ length: 8 }, (_, b) => bit(hw.sr.shift[8 * k + b], '#a77bff', `bit ${8 * k + b}`)).join('')}</div><div><small>out</small>${Array.from({ length: 8 }, (_, b) => { const q = 8 * k + b; return bit(hw.sr.out[q], LED_SPEC[q] ? LED_SPEC[q].color : '#4dff7a', 'Q' + q + ' ' + ledFor(q)); }).join('')}</div></div>`).join('');
      for (const n of ['data', 'clock', 'latch']) card.querySelectorAll(`.schem [data-g="${n}"]`).forEach(e => e.classList.toggle('hi', level(hw, 'sr.' + n.toUpperCase())));
    } else if (cur.id === 'panel') {
      card.querySelector('#insLeds').innerHTML = LED_SPEC.map((l, i) => (cur.grp === 'all' || cur.grp === l.g) ? `<span>${bit(o.leds[i], l.color)} L${i} ${esc(l.name)} · ${esc(LED_GROUPS.find(g => g.key === l.g).name.toLowerCase())} ${esc(l.label)} <span class="mu">${v('panel.L' + i)}</span></span>` : '').join('');
    } else if (cur.id === 'div' || cur.id === 'div2') {
      card.querySelector('#insDiv').innerHTML = `<span>IN ${v(cur.id + '.IN')}</span><span>OUT ${v(cur.id + '.OUT')}</span>`;
    }
  }
  function frame(t) {
    if (!cur) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    for (const tr of cur.traces) { if (!tr.g.visible) continue; const on = tr.tr.on(); tr.mat.opacity = on ? 1 : 0.7; tr.mat.color.copy(on ? tr.bright : tr.base); if (cur.grp !== 'all' && !on) tr.mat.opacity = 0.75 + 0.25 * pulse; }
  }
  return { open, close, update, frame, setGroup, get current() { return cur && cur.id; } };
}
