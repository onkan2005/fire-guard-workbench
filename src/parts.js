// Every component of the Fire Guard project: pins, shopping info and a 3D model built from primitives.
import * as THREE from 'three';
import { TOP, PCB_Y, HDR_TIP, mat, box, cyl, pcb, decal, txt, canvasTex, GOLD, METAL, BLACK, shadow, softSprite, tag } from './helpers.js';

// ---------- ESP32 pin facts ----------
const ESP_LEFT = ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', 'GND1', '13', 'SD2', 'SD3', 'CMD', '5V'];
const ESP_RIGHT = ['GND2', '23', '22', 'TX', 'RX', '21', 'GND3', '19', '18', '5', '17', '16', '4', '0', '2', '15', 'SD1', 'SD0', 'CLK'];
const ALIAS = { VP: 36, VN: 39, TX: 1, RX: 3, SD2: 9, SD3: 10, CMD: 11, SD1: 8, SD0: 7, CLK: 6 };
export const gpioOf = name => (name in ALIAS ? ALIAS[name] : /^\d+$/.test(name) ? +name : null);
export const ESP_GPIO_PIN = {}; // gpio number -> pin id
for (const n of [...ESP_LEFT, ...ESP_RIGHT]) { const g = gpioOf(n); if (g !== null) ESP_GPIO_PIN[g] = 'esp.' + n; }
export const ADC1 = [32, 33, 34, 35, 36, 39], ADC2 = [0, 2, 4, 12, 13, 14, 15, 25, 26, 27];
export const INPUT_ONLY = [34, 35, 36, 39], FLASH = [6, 7, 8, 9, 10, 11], STRAP = [0, 2, 5, 12, 15], UART = [1, 3];

export function espPinInfo(name) {
  const g = gpioOf(name);
  if (name === '3V3') return '3.3 V output from the on-board regulator (about 500 mA shared).';
  if (name === '5V') return '5 V straight from USB (VIN). Use it for 5 V modules.';
  if (name.startsWith('GND')) return 'Ground. All grounds in the project must meet.';
  if (name === 'EN') return 'Enable / reset. Leave unconnected.';
  const f = [];
  if (INPUT_ONLY.includes(g)) f.push('input only, no pull-ups');
  if (ADC1.includes(g)) f.push('ADC1 analog (works with Wi-Fi)');
  if (ADC2.includes(g)) f.push('ADC2 analog (not with Wi-Fi on)');
  if (FLASH.includes(g)) f.push('used by the flash chip: do not use');
  if (STRAP.includes(g)) f.push('boot strapping pin: avoid');
  if (UART.includes(g)) f.push('USB serial: avoid');
  if (g === 21) f.push('default I2C SDA');
  if (g === 22) f.push('default I2C SCL');
  if (g === 2) f.push('blue on-board LED');
  return `GPIO${g}` + (f.length ? ' · ' + f.join(' · ') : ' · general purpose I/O');
}

// ---------- the 17 indicator LEDs (index = shift register output Qn) ----------
const C_ = { Green: '#2fbf5b', Blue: '#2f7de1', Red: '#e5392f', Orange: '#ff7f1e', Yellow: '#f2c230' };
const L = (g, name, label, short) => ({ g, name, color: C_[name], label, short });
export const LED_GROUPS = [
  { key: 'SPR', title: 'SPRINKLER', name: 'Sprinkler pump', off: 'off' },
  { key: 'REF', title: 'REFILL', name: 'Refill pump', off: 'idle' },
  { key: 'TANK', title: 'TANK', name: 'Tank level', off: 'off' },
  { key: 'FIRE', title: 'FIRE CLASS', name: 'Fire class', off: 'no fire' },
  { key: 'FUME', title: 'FUME', name: 'Fume sensor', off: 'off' },
];
export const LED_SPEC = [
  L('SPR', 'Green', 'activated', 'ON'), L('SPR', 'Blue', 'standby', 'STBY'),
  L('REF', 'Red', '1/3 full', '1/3'), L('REF', 'Blue', '2/3 full', '2/3'), L('REF', 'Green', 'full', 'FULL'),
  L('TANK', 'Red', 'empty', 'EMPTY'), L('TANK', 'Orange', 'almost empty', 'LOW'), L('TANK', 'Blue', 'half', 'HALF'), L('TANK', 'Green', 'full', 'FULL'),
  L('FIRE', 'Green', 'low', 'LOW'), L('FIRE', 'Blue', 'moderate', 'MOD'), L('FIRE', 'Yellow', 'high', 'HIGH'), L('FIRE', 'Orange', 'very high', 'V.HI'), L('FIRE', 'Red', 'extreme', 'EXTR'),
  L('FUME', 'Green', 'normal', 'OK'), L('FUME', 'Orange', 'gas', 'GAS'), L('FUME', 'Red', 'fire', 'FIRE'),
];

// LED panel geometry, shared by the 3D model and the Inspect traces.
// Each LED has its own straight lane: pin → resistor → lane → LED (+). Lanes in a row are stacked so the
// farther LEDs use the lanes farther from the row, which means no two lanes ever cross. Every row has its
// own GND rail under its LEDs; the rails join a spine on the right edge that runs to the GND pin.
export const PANEL = (() => {
  const L = { w: 110, pinX: -51, resL: -44, resR: -38, ledX0: -24, ledDX: 10, titleX: 22, spineX: 50, rows: [] };
  let z = 0;
  for (const g of LED_GROUPS) {
    const leds = LED_SPEC.map((l, i) => ({ ...l, i })).filter(l => l.g === g.key), n = leds.length;
    const top = z, ledZ = top + 1.5 + (n - 1) * 2.54 + 4.8, rail = ledZ + 4.2, labelZ = rail + 2.4;
    leds.forEach((l, j) => Object.assign(l, { lane: top + 1.5 + (n - 1 - j) * 2.54, x: L.ledX0 + j * L.ledDX, z: ledZ }));
    L.rows.push({ ...g, top, ledZ, rail, labelZ, leds });
    z = labelZ + 2;
  }
  L.gndZ = z + 1; L.d = z + 4;
  const off = -L.d / 2 + 1.5; // centre the board on z = 0
  for (const r of L.rows) { for (const k of ['top', 'ledZ', 'rail', 'labelZ']) r[k] += off; r.leds.forEach(l => { l.lane += off; l.z += off; }); }
  L.gndZ += off;
  L.byIndex = []; L.rows.forEach(r => r.leds.forEach(l => { L.byIndex[l.i] = { ...l, row: r }; }));
  return L;
})();

// ---------- helpers for builders ----------
const hdrLabels = (g, pins, dx, size = 1.8, align) => pins.forEach(p => txt(g, p.label, p.x + dx, p.z, size, '#f2f2f2', align || (dx < 0 ? 'right' : 'left')));
const screwBlock = (parent, x, z, n, pitch, color = '#2f6fd0', along = 'z') => {
  const len = n * pitch;
  const b = along === 'z' ? box(parent, 8, 9, len, mat(color), x, TOP, z) : box(parent, len, 9, 8, mat(color), x, TOP, z);
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + pitch / 2 + i * pitch;
    const sx = along === 'z' ? x : x + o, sz = along === 'z' ? z + o : z;
    const s = cyl(parent, 1.6, 0.6, METAL(), sx, TOP + 9, sz, 16);
    box(parent, 0.5, 0.4, 2.6, mat('#555'), sx, TOP + 9.6, sz).rotation.y = Math.PI / 4;
  }
  return b;
};
const pot = (parent, x, z) => { box(parent, 6.5, 4, 6.5, mat('#2a63d4'), x, TOP, z); const c = cyl(parent, 1.8, 1, mat('#e8e2cf'), x, TOP + 4, z, 16); box(parent, 3, 0.3, 0.6, mat('#888'), x, TOP + 5, z); };
const smd = (parent, x, z, c = '#222', w = 2, d = 1.2) => box(parent, w, 0.6, d, mat(c), x, TOP, z);
const led = (parent, x, z, color) => { const m = box(parent, 1.6, 0.8, 1, new THREE.MeshStandardMaterial({ color: '#333', emissive: color, emissiveIntensity: 0 }), x, TOP, z); m.userData.on = color; return m; };
const resistor = (parent, x, z, bands, rotY = 0) => {
  const g = new THREE.Group(); g.position.set(x, TOP + 2.2, z); g.rotation.y = rotY; parent.add(g);
  const body = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6.2, 16), mat('#d8c49a'))); body.rotation.z = Math.PI / 2; g.add(body);
  bands.forEach((c, i) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.55, 16), mat(c)); b.rotation.z = Math.PI / 2; b.position.x = -2.2 + i * 1.3; g.add(b); });
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 11, 6), METAL()); lead.rotation.z = Math.PI / 2; g.add(lead);
  return g;
};

// ---------- part definitions ----------
const P = (id, label, x, z, extra = {}) => ({ id, label, x, z, kind: 'header', ...extra });

export const PARTS = [
  {
    id: 'esp', name: 'ESP32 DevKit (38-pin)', short: 'ESP32', pos: [0, 0, 0], owned: true,
    info: 'The brain. Logic is 3.3 V. It reads every sensor, decides, and switches the relay, LCD, LEDs and buzzer.',
    pins: [...ESP_LEFT.map((n, i) => P(n, n.replace(/\d$/, '') === 'GND' ? 'GND' : n, -12.7, -22.86 + i * 2.54)),
      ...ESP_RIGHT.map((n, i) => P(n, n.startsWith('GND') ? 'GND' : n, 12.7, -22.86 + i * 2.54))],
    build(p) {
      const g = p.inner;
      pcb(g, 30, 56, '#16171c', c => {
        p.def.pins.forEach(q => txt(c, q.label, q.x < 0 ? q.x + 2 : q.x - 2, q.z, 1.25, '#e9e9e9', q.x < 0 ? 'left' : 'right', 500));
        txt(c, 'ESP32 DevKitC', 0, 9, 2, '#e9e9e9'); txt(c, 'EN', -8, 23.5, 1.5); txt(c, 'BOOT', 8, 23.5, 1.5);
      });
      box(g, 18, 0.8, 25.5, mat('#1d1e22'), 0, TOP, -14.2);
      decal(g, 18, 6.5, c => { c.strokeStyle = '#c9a24a'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(-7, 2); for (let i = 0; i < 7; i++) { c.lineTo(-7 + i * 2, -2); c.lineTo(-6 + i * 2, -2); c.lineTo(-6 + i * 2, 2); c.lineTo(-5 + i * 2, 2); } c.stroke(); }, 0, TOP + 0.82, -23.5);
      const can = box(g, 16, 2.3, 17.6, METAL(), 0, TOP + 0.8, -10.4);
      decal(g, 15, 16, c => { txt(c, 'ESP32-WROOM-32', 0, -3, 1.7, '#3b3f46', 'center', 700); txt(c, 'Wi-Fi + BT', 0, 0, 1.3, '#3b3f46'); txt(c, 'CE  FCC', 0, 3.2, 1.3, '#3b3f46'); }, 0, TOP + 3.12, -10.4);
      box(g, 8, 3, 6, METAL(), 0, TOP - 0.2, 25.6);
      for (const sx of [-8, 8]) { box(g, 4.2, 1.6, 3.2, METAL(), sx, TOP, 21); cyl(g, 1, 0.8, BLACK(), sx, TOP + 1.6, 21, 12); }
      box(g, 6.5, 1.6, 3.5, BLACK(), -1, TOP, 15); // regulator
      box(g, 5, 1.2, 5, BLACK(), 0, TOP, 7.5);    // USB-UART chip
      p.refs.pwr = led(g, -5, 18.5, '#ff2a2a'); p.refs.pwr.material.emissiveIntensity = 2;
      p.refs.led2 = led(g, 5, 18.5, '#3b7bff');
    },
  },
  {
    id: 'rail', name: 'Power rail board', short: 'Rails', pos: [0, 62, 0], owned: false,
    buy: [1, '830-point breadboard', 'Its power rails share 3.3 V, 5 V and GND between all the modules (shown here as a rail board)', 80, 120],
    info: 'Three rails so many modules can share one supply. Every hole in a rail is connected together.',
    pins: [...Array.from({ length: 12 }, (_, i) => P('3V3_' + i, '3V3', -42 + i * 6, -7)),
      ...Array.from({ length: 12 }, (_, i) => P('5V_' + i, '5V', -42 + i * 6, 0)),
      ...Array.from({ length: 16 }, (_, i) => P('GND_' + i, 'GND', -42 + i * 6, 7))],
    internal: [['3V3_', 12], ['5V_', 12], ['GND_', 16]],
    build(p) {
      pcb(p.inner, 120, 24, '#ecece4', c => {
        const row = (z, col, name) => { c.fillStyle = col; c.fillRect(-46, z - 2.6, 104, 0.5); c.fillRect(-46, z + 2.1, 104, 0.5); txt(c, name, -53, z, 2.6, col, 'center', 800); };
        row(-7, '#f08a24', '3V3'); row(0, '#e5392f', '5V'); row(7, '#2b2f36', 'GND');
      });
    },
  },
  {
    id: 'dht', name: 'DHT22 temperature & humidity', short: 'DHT22', pos: [-125, -78, 0],
    // Assembled: on the back wall of the house, face into the room (rot x 90° stands the board up)
    assembled: { pos: [88, 58, -365.5], rot: [Math.PI / 2, 0, 0], where: 'back wall of the house under a drip shield, away from the spray' },
    buy: [1, 'DHT22 (AM2302) 3-pin module', 'Temperature/humidity. Reads up to 80 °C, so test with warm air, not a flame. The DHT11 is too inaccurate.', 200, 350],
    info: 'Digital one-wire sensor. The module has its own pull-up resistor. Power it from 3V3 so DATA stays at a safe 3.3 V.',
    pins: [P('VCC', '+', 12.5, -2.54, { role: 'vcc' }), P('DATA', 'OUT', 12.5, 0, { role: 'out-digital' }), P('GND', '−', 12.5, 2.54, { role: 'gnd' })],
    build(p) {
      const g = p.inner;
      pcb(g, 30, 24, '#1f5fa8', c => { hdrLabels(c, p.def.pins, -2.4); txt(c, 'DHT22', 0, 10, 2); });
      const body = box(g, 16, 7.5, 20, mat('#f1f1ee', { roughness: 0.8 }), -4, TOP, -1);
      decal(g, 14, 18, c => { c.fillStyle = '#9aa0a6'; for (let r = 0; r < 6; r++) for (let k = 0; k < 4; k++) c.fillRect(-6 + k * 3.2, -7.5 + r * 2.8, 2.2, 1.6); }, -4, TOP + 7.52, -1);
      smd(g, 7, 7); smd(g, 7, -7);
    },
  },
  {
    id: 'mq2', name: 'MQ-2 gas / smoke sensor', short: 'MQ-2', pos: [-125, -25, 0],
    assembled: { pos: [150, 74, -365.5], rot: [Math.PI / 2, 0, 0], where: 'high on the back wall under an open-bottom hood, where smoke collects and spray can’t reach' },
    buy: [1, 'MQ-2 gas/smoke module', 'The fume sensor: detects gas and smoke. Its heater needs 5 V and AO can swing above 3.3 V, so it goes through the divider.', 120, 180],
    info: 'Analog output rises with gas/smoke. Needs a 20–60 s warm-up in real life. AO must go through the 10k/20k divider before the ESP32.',
    pins: [P('VCC', 'VCC', 14, -3.81, { role: 'vcc' }), P('GND', 'GND', 14, -1.27, { role: 'gnd' }), P('DO', 'DO', 14, 1.27, { role: 'out-digital' }), P('AO', 'AO', 14, 3.81, { role: 'out-analog' })],
    build(p) {
      const g = p.inner;
      pcb(g, 34, 24, '#1f5fa8', c => { hdrLabels(c, p.def.pins, -2.4, 1.6); txt(c, 'MQ-2', 6, 9.5, 2); });
      cyl(g, 9.8, 2, mat('#a7a9ad', { metalness: 0.7, roughness: 0.35 }), -5, TOP, 0, 32);
      const mesh = cyl(g, 9.3, 8.5, new THREE.MeshStandardMaterial({ map: canvasTex(20, 20, c => { c.fillStyle = '#8d9096'; c.fillRect(-10, -10, 20, 20); c.strokeStyle = '#55585e'; c.lineWidth = 0.25; for (let i = -10; i < 10; i += 0.9) { c.beginPath(); c.moveTo(i, -10); c.lineTo(i, 10); c.stroke(); c.beginPath(); c.moveTo(-10, i); c.lineTo(10, i); c.stroke(); } }, 8), metalness: 0.6, roughness: 0.45 }), -5, TOP + 2, 0, 32);
      pot(g, 8, -6); p.refs.dled = led(g, 8, 6, '#ff3030'); led(g, 8, 8.5, '#ff3030').material.emissiveIntensity = 1.6;
    },
  },
  {
    id: 'div', name: '10k + 20k voltage divider', short: 'Divider', pos: [-70, -25, 0],
    buy: [1, '10 kΩ + 20 kΩ resistor', 'Voltage divider: scales the MQ-2 output (up to ~4.2 V) down to a safe 2.8 V', 2, 5],
    info: 'OUT = IN × 20k / (10k + 20k) = 2/3 of IN. Without this the MQ-2 can push more than 3.6 V into the ESP32.',
    pins: [P('IN', 'IN', -7, 0, { role: 'div-in' }), P('OUT', 'OUT', 7, -2.54, { role: 'out-analog' }), P('GND', 'GND', 7, 2.54, { role: 'gnd' })],
    build(p) {
      const g = p.inner;
      pcb(g, 20, 18, '#c79c5a', c => { c.fillStyle = '#9b7438'; for (let x = -9; x < 10; x += 2.54) for (let z = -8; z < 9; z += 2.54) { c.beginPath(); c.arc(x, z, 0.45, 0, 7); c.fill(); } hdrLabels(c, [p.def.pins[0]], 2, 1.6, 'left'); hdrLabels(c, p.def.pins.slice(1), -2, 1.6); });
      resistor(g, 0, -5, ['#8a4a1c', '#111', '#f08a24', '#c9a227']);  // 10k
      resistor(g, 0, 5.5, ['#e5392f', '#111', '#f08a24', '#c9a227']); // 20k
    },
  },
  {
    id: 'flame', name: 'IR flame sensor', short: 'Flame', pos: [-125, 25, 0],
    // Assembled: on a shelf OUTSIDE the house's left wall, turned 180° so the IR eye looks at the fire through a clear window (stays dry)
    assembled: { pos: [0, 19, -298], rot: [0, Math.PI, 0], where: 'outside the left wall, looking at the fire through a clear window' },
    buy: [1, 'IR flame sensor module (LM393)', 'Sees an actual flame. DO goes LOW when a flame is detected.', 40, 80],
    info: 'Digital output from a comparator: HIGH = no flame, LOW = flame. Power it from 3V3 so DO never exceeds 3.3 V.',
    pins: [P('VCC', 'VCC', 15.5, -2.54, { role: 'vcc' }), P('GND', 'GND', 15.5, 0, { role: 'gnd' }), P('DO', 'DO', 15.5, 2.54, { role: 'out-digital' })],
    build(p) {
      const g = p.inner;
      pcb(g, 36, 15, '#1f5fa8', c => { hdrLabels(c, p.def.pins, -2.4, 1.6); txt(c, 'FLAME', 2, -5.2, 1.7); });
      const ir = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6, 20), mat('#111', { roughness: 0.15 }))); ir.rotation.z = Math.PI / 2; ir.position.set(-18, TOP + 2.6, 0); g.add(ir);
      const dome = shadow(new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 12), mat('#111', { roughness: 0.15 }))); dome.position.set(-21, TOP + 2.6, 0); g.add(dome);
      pot(g, -6, 0); box(g, 5, 1.6, 4, BLACK(), 4, TOP, 0);
      p.refs.dled = led(g, 9, -4.5, '#30ff60'); led(g, 9, 4.5, '#ff3030').material.emissiveIntensity = 1.6;
    },
  },
  {
    // Mounted on a bracket above the tank, flipped so both transducers look straight down at the water.
    id: 'us', name: 'HC-SR04 ultrasonic tank level sensor', short: 'HC-SR04', pos: [-60, -300, Math.PI], mount: { y: 118, rx: Math.PI }, fixed: true, option: ['level', 'ultrasonic'],
    buy: [1, 'HC-SR04 ultrasonic sensor (waterproof JSN-SR04T for a real tank)', 'Measures the distance down to the water, so it works for any tank height and never touches the water.', 60, 120],
    info: 'Pulse TRIG HIGH for 10 µs; the sensor sends 8 ultrasonic pings and holds ECHO HIGH until the echo returns. pulseIn(ECHO) gives the round-trip time: distance = µs × 0.0343 / 2 cm. Needs 5 V. ECHO is 5 V too, so it goes through the 1 kΩ/2 kΩ divider to GPIO35.',
    pins: [P('VCC', 'VCC', -3.81, 10, { kind: 'edge', role: 'vcc' }), P('TRIG', 'Trig', -1.27, 10, { kind: 'edge', role: 'in-digital' }), P('ECHO', 'Echo', 1.27, 10, { kind: 'edge', role: 'out-digital' }), P('GND', 'Gnd', 3.81, 10, { kind: 'edge', role: 'gnd' })],
    build(p) {
      const g = p.inner;
      pcb(g, 45, 20, '#1f5fa8', c => { p.def.pins.forEach(q => txt(c, q.label, q.x, 7.6, 1.2, '#fff', 'center', 600)); txt(c, 'HC-SR04', 0, -7.8, 1.8, '#fff', 'center', 800); txt(c, 'T', -13, 8, 1.6); txt(c, 'R', 13, 8, 1.6); });
      const meshTex = canvasTex(16, 16, c => { c.fillStyle = '#9a9ea4'; c.fillRect(-8, -8, 16, 16); c.strokeStyle = '#5d6168'; c.lineWidth = 0.22; for (let i = -8; i < 8; i += 0.8) { c.beginPath(); c.moveTo(i, -8); c.lineTo(i, 8); c.stroke(); c.beginPath(); c.moveTo(-8, i); c.lineTo(8, i); c.stroke(); } }, 8);
      for (const x of [-13, 13]) {
        cyl(g, 8, 12, mat('#b7bbc2', { metalness: 0.75, roughness: 0.35 }), x, TOP, -1, 32);
        const face = new THREE.Mesh(new THREE.CircleGeometry(7.3, 32), new THREE.MeshStandardMaterial({ map: meshTex, metalness: 0.5, roughness: 0.5 })); face.rotation.x = -Math.PI / 2; face.position.set(x, TOP + 12.05, -1); g.add(face);
      }
      box(g, 8, 3, 3.5, METAL(), 0, TOP, -5); // crystal
    },
  },
  {
    id: 'div2', name: '1k + 2k divider for the HC-SR04 ECHO', short: 'Echo divider', pos: [-70, 25, 0], option: ['level', 'ultrasonic'],
    buy: [1, '1 kΩ + 2 kΩ resistor', 'Drops the HC-SR04 ECHO from 5 V to 3.3 V for the ESP32', 2, 5],
    info: 'OUT = IN × 2 kΩ / (1 kΩ + 2 kΩ) = ⅔ of IN: the 5 V ECHO pulse becomes 3.3 V, safe for GPIO35.',
    pins: [P('IN', 'IN', -7, 0, { role: 'div-in' }), P('OUT', 'OUT', 7, -2.54, { role: 'out-analog' }), P('GND', 'GND', 7, 2.54, { role: 'gnd' })],
    build(p) {
      const g = p.inner;
      pcb(g, 20, 18, '#c79c5a', c => { c.fillStyle = '#9b7438'; for (let x = -9; x < 10; x += 2.54) for (let z = -8; z < 9; z += 2.54) { c.beginPath(); c.arc(x, z, 0.45, 0, 7); c.fill(); } hdrLabels(c, [p.def.pins[0]], 2, 1.6, 'left'); hdrLabels(c, p.def.pins.slice(1), -2, 1.6); txt(c, 'ECHO', 0, 8, 1.3, '#3b2a12', 'center', 800); });
      resistor(g, 0, -5, ['#8a4a1c', '#111', '#e5392f', '#c9a227']);  // 1k
      resistor(g, 0, 5.5, ['#e5392f', '#111', '#e5392f', '#c9a227']); // 2k
    },
  },
  // ---------- option: DIY copper-wire probes in the tank ----------
  {
    // A plastic stick standing in the tank with bare copper wire ends at 10 / 33 / 66 / 95 % and a common wire at the bottom.
    id: 'probe', name: 'DIY wire-probe level sensor (in the tank)', short: 'Wire probes', pos: [-40, -282, 0], mount: { y: 106 }, fixed: true, option: ['level', 'probes'],
    buy: [1, 'DIY probe: plastic stick + 5 solid-core wires (bare copper ends)', 'Five stripped wire ends at different heights: water touching a wire connects it to the bottom “common” wire. Use 22 AWG solid copper, or stainless screws so they corrode less.', 20, 60],
    info: 'Tap water conducts a little. The common wire at the bottom is pulled LOW while reading; any probe wire under water is connected to it through the water and reads LOW. The highest wet wire tells the level: 10 %, 33 %, 66 % or 95 %. Only power the common wire while reading, or the copper corrodes quickly.',
    pins: ['COM', 'P1', 'P2', 'P3', 'P4'].map((id, i) => P(id, id === 'COM' ? 'COM' : ['10%', '33%', '66%', '95%'][i - 1], -5.08 + i * 2.54, 0, { role: id === 'COM' ? 'probe-com' : 'probe',
      tip: id === 'COM' ? 'Common wire: the bare copper ring at the very bottom of the tank. Goes to ESP32 GPIO 25, which drives it LOW only while reading. Water connects it to every level wire it covers.'
        : `Level wire at ${['10', '33', '66', '95'][i - 1]} % of the tank. Reads LOW when water touches it (water joins it to COM), HIGH through the 470 kΩ pull-up when dry.` })),
    build(p) {
      const g = p.inner, floorY = 9 - 106;
      pcb(g, 22, 13, '#2b2d31', c => {
        p.def.pins.forEach(q => txt(c, q.id === 'COM' ? 'COM' : q.label.replace('%', ''), q.x, 2.6, 0.85, '#fff'));
        txt(c, 'WATER PROBES', 0, -4.6, 1.3, '#cfd3d8', 'center', 700);
        txt(c, 'COM = bottom wire → GPIO25', 0, 4.4, 0.85, '#f2c230', 'center', 700);
        txt(c, 'others: level % wires', 0, 5.7, 0.8, '#cfd3d8', 'center');
      });
      cyl(g, 2.4, -floorY, mat('#e9e4d8', { roughness: 0.7 }), 0, floorY, -6, 16); // the stick
      [0.02, 0.10, 0.33, 0.66, 0.95].forEach((h, i) => {
        const y = 9 + 73.4 * h - 106, col = i === 0 ? '#1d1d1d' : ['#2b8fd6', '#2fbf5b', '#f2c230', '#e5392f'][i - 1];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.55, 8, 20), mat('#c87533', { metalness: 0.8, roughness: 0.35 })); ring.rotation.x = Math.PI / 2; ring.position.set(0, y, -6); g.add(ring); // bare copper
        const lead = new THREE.CatmullRomCurve3([new THREE.Vector3(1.6 + i * 0.5, y, -4), new THREE.Vector3(1.6 + i * 0.5, PCB_Y - 4, -4.5), new THREE.Vector3(p.def.pins[i].x, PCB_Y - 1, -2)]);
        g.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(lead, 30, 0.45, 6), mat(col))));
      });
    },
  },
  {
    id: 'pull', name: '470 kΩ pull-up board for the probes', short: 'Probe pull-ups', pos: [-70, 25, 0], option: ['level', 'probes'],
    buy: [4, '470 kΩ resistor', 'Pull each probe wire up to 3.3 V. Water (tens of kΩ) easily pulls it LOW. The ESP32’s own 45 kΩ pull-ups are too strong for weak tap water.', 1, 2],
    info: 'Four 470 kΩ resistors from 3V3 to each probe line. A dry probe reads HIGH (3.3 V through the resistor); a wet probe is pulled LOW by the water. A-side goes to the probes, B-side to the ESP32 (same node).',
    pins: [P('VCC', '3V3', -10, -6.35, { role: 'vcc' }), ...[1, 2, 3, 4].map(n => P('A' + n, 'A' + n, -10, -6.35 + n * 2.54, { role: 'pull' })), ...[1, 2, 3, 4].map(n => P('B' + n, 'B' + n, 10, -6.35 + n * 2.54, { role: 'pull' }))],
    links: [['A1', 'B1'], ['A2', 'B2'], ['A3', 'B3'], ['A4', 'B4']],
    build(p) {
      const g = p.inner;
      pcb(g, 24, 20, '#c79c5a', c => { c.fillStyle = '#9b7438'; for (let x = -11; x < 12; x += 2.54) for (let z = -9; z < 10; z += 2.54) { c.beginPath(); c.arc(x, z, 0.4, 0, 7); c.fill(); } hdrLabels(c, p.def.pins.slice(0, 5), 1.8, 1.2, 'left'); hdrLabels(c, p.def.pins.slice(5), -1.8, 1.2); txt(c, '4× 470k', 0, -8, 1.4, '#3b2a12', 'center', 800); });
      [1, 2, 3, 4].forEach(n => resistor(g, 0, -6.35 + n * 2.54, ['#e8c32f', '#7a3fb0', '#e8c32f', '#c9a227']).scale.set(0.55, 0.55, 0.55)); // 470k: yellow violet yellow
    },
  },
  {
    id: 'relay', name: '2-channel relay module', short: 'Relay', pos: [118, -78, 0],
    buy: [1, '2-channel 5 V relay module (opto-isolated)', 'Lets the ESP32 switch the two pumps, which run on their own 5 V supply. IN1 = sprinkler, IN2 = refill.', 90, 150],
    info: 'Active-LOW inputs: writing LOW to IN energises the relay. COM connects to NO while energised. Needs 5 V on VCC.',
    pins: [P('GND', 'GND', -22, -3.81, { role: 'gnd' }), P('IN1', 'IN1', -22, -1.27, { role: 'in-digital' }), P('IN2', 'IN2', -22, 1.27, { role: 'in-digital' }), P('VCC', 'VCC', -22, 3.81, { role: 'vcc' }),
      P('NO1', 'NO1', 21, -15, { kind: 'screw', role: 'contact' }), P('COM1', 'COM1', 21, -10, { kind: 'screw', role: 'contact' }), P('NC1', 'NC1', 21, -5, { kind: 'screw', role: 'contact' }),
      P('NO2', 'NO2', 21, 5, { kind: 'screw', role: 'contact' }), P('COM2', 'COM2', 21, 10, { kind: 'screw', role: 'contact' }), P('NC2', 'NC2', 21, 15, { kind: 'screw', role: 'contact' })],
    build(p) {
      const g = p.inner;
      pcb(g, 52, 40, '#1d4ea0', c => { hdrLabels(c, p.def.pins.slice(0, 4), 2.4, 1.6); txt(c, 'K1', -4, -16, 1.8); txt(c, 'K2', -4, 18, 1.8); txt(c, '2 Relay Module', -9, 0, 1.7); p.def.pins.slice(4).forEach(q => txt(c, q.label, 14.5, q.z, 1.3, '#fff', 'right')); });
      for (const z of [-10, 10]) {
        box(g, 19, 15.5, 15, mat('#2f6fe0', { roughness: 0.35 }), 3, TOP, z);
        decal(g, 17, 13, c => { txt(c, 'SRD-05VDC-SL-C', 0, -3, 1.4, '#e8f0ff'); txt(c, '10A 250VAC', 0, 0, 1.3, '#e8f0ff'); txt(c, 'SONGLE', 0, 3.5, 1.8, '#e8f0ff', 'center', 800); }, 3, TOP + 15.52, z);
        box(g, 6, 3.5, 4, mat('#f2f2f2'), -14, TOP, z); // optocoupler
      }
      screwBlock(g, 21, -10, 3, 5); screwBlock(g, 21, 10, 3, 5);
      p.refs.k1 = led(g, -16, -15, '#ff2020'); p.refs.k2 = led(g, -16, 15, '#ff2020'); p.refs.pwr = led(g, -16, 0, '#ff2020');
    },
  },
  {
    id: 'lcd', name: '20×4 I2C LCD', short: 'LCD', pos: [140, -5, 0], tilt: 0.42,
    buy: [1, '20×4 I2C LCD (HD44780 + PCF8574 backpack)', 'Four rows: pump states, tank level, temperature and fire class. A 16×2 is too small.', 300, 450],
    info: 'I2C address 0x27 on most backpacks (0x3F on some). SDA → GPIO21, SCL → GPIO22. Needs 5 V for full contrast.',
    pins: [P('GND', 'GND', -46, -3.81, { role: 'gnd' }), P('VCC', 'VCC', -46, -1.27, { role: 'vcc' }), P('SDA', 'SDA', -46, 1.27, { role: 'i2c' }), P('SCL', 'SCL', -46, 3.81, { role: 'i2c' })],
    build(p) {
      const g = p.inner;
      pcb(g, 98, 60, '#1f7a4d', c => { hdrLabels(c, p.def.pins, 2.4, 1.8); for (let i = 0; i < 16; i++) { c.fillStyle = '#c9a227'; c.beginPath(); c.arc(-36 + i * 2.54, -27.5, 0.6, 0, 7); c.fill(); } });
      box(g, 88, 7, 44, BLACK(), 3, TOP, 0);
      const cv = document.createElement('canvas'); cv.width = 760; cv.height = 200;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(77, 26), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.3 }));
      scr.rotation.x = -Math.PI / 2; scr.position.set(3, TOP + 7.05, 0); g.add(scr);
      p.refs.lcdCanvas = cv; p.refs.lcdTex = tex; p.refs.lcdMat = scr.material;
      // stand legs under the tilted board
      const leg = mat('#2b2d31');
      box(p.group, 90, 24, 4, leg, 0, 0, -24);
    },
  },
  {
    id: 'sr', name: 'LED driver: 3× 74HC595 shift registers', short: 'LED driver', pos: [30, 118, 0], option: ['leds', 'single'],
    buy: [3, '74HCT595 shift register (74HC595 also works)', 'Three chained chips give 24 outputs from just 3 ESP32 pins (DATA, CLOCK, LATCH). 17 are used for the LEDs.', 15, 30],
    info: 'Three 74HC595 chips on a perfboard, chained (Q7′ of one → DS of the next), OE tied to GND and MR to VCC. shiftOut() 3 bytes, then pulse LATCH, and Q0–Q16 light the LEDs. Use 74HCT595 at 5 V so the 3.3 V ESP32 signals are read reliably.',
    pins: [P('VCC', 'VCC', -27, -5.08, { role: 'vcc' }), P('GND', 'GND', -27, -2.54, { role: 'gnd' }), P('DATA', 'DATA', -27, 0, { role: 'in-digital' }), P('CLOCK', 'CLOCK', -27, 2.54, { role: 'in-digital' }), P('LATCH', 'LATCH', -27, 5.08, { role: 'in-digital' }),
      ...Array.from({ length: 17 }, (_, i) => P('Q' + i, 'Q' + i, 27, -20.32 + i * 2.54, { role: 'out-digital' }))],
    build(p) {
      const g = p.inner;
      pcb(g, 60, 50, '#c79c5a', c => {
        c.fillStyle = '#9b7438'; for (let x = -28; x < 29; x += 2.54) for (let z = -23; z < 24; z += 2.54) { c.beginPath(); c.arc(x, z, 0.35, 0, 7); c.fill(); }
        hdrLabels(c, p.def.pins.slice(0, 5), 2.2, 1.5); hdrLabels(c, p.def.pins.slice(5), -2.2, 1.25);
        txt(c, 'LED DRIVER', 0, -22.5, 2, '#3b2a12', 'center', 800);
      });
      [-12, 0, 12].forEach((x, k) => {
        box(g, 7.6, 3.3, 19.3, mat('#1b1b1e', { roughness: 0.6 }), x, TOP + 0.8, 0);
        for (let i = 0; i < 8; i++) for (const s of [-1, 1]) box(g, 1.6, 1.2, 0.5, METAL(), x + s * 4.2, TOP, -8.9 + i * 2.54);
        decal(g, 6.6, 18, c => { c.rotate(Math.PI / 2); txt(c, '74HC595', 0, 0, 1.6, '#d8d8d8', 'center', 700); txt(c, 'U' + (k + 1), 0, 2.2, 1.3, '#9a9a9a'); c.fillStyle = '#333'; c.beginPath(); c.arc(-7.5, -2, 0.6, 0, 7); c.fill(); }, x, TOP + 4.12, 0);
      });
    },
  },
  {
    id: 'panel', name: 'LED indicator panel (17 single 5 mm LEDs)', short: 'LED panel', pos: [130, 104, 0], option: ['leds', 'single'],
    buy: [17, '5 mm LED (5 green, 4 blue, 4 red, 3 orange, 1 yellow)','One single-color LED per state, as the workshop asks: sprinkler, refill, tank level, fire class and fume sensor.', 2, 4],
    info: 'Every LED has its own lane: pin Ln → 330 Ω resistor → LED + (long leg). Each LED’s − leg drops onto its row’s GND rail; the rails join the GND spine on the right. Rows: SPRINKLER (green on, blue standby) · REFILL (red 1/3, blue 2/3, green full) · TANK (red empty, orange almost empty, blue half, green full) · FIRE CLASS (green low → red extreme) · FUME (green normal, orange gas, red fire).',
    pins: [...Array.from({ length: 17 }, (_, i) => P('L' + i, 'L' + i, PANEL.pinX, PANEL.byIndex[i].lane, { role: 'in-digital' })), P('GND', 'GND', PANEL.pinX, PANEL.gndZ, { role: 'gnd' })],
    build(p) {
      const g = p.inner, Lp = PANEL;
      pcb(g, Lp.w, Lp.d, '#1e3a2f', c => {
        // copper (drawn on the board so the wiring is readable even outside Inspect)
        const cu = (pts, w = 0.7, col = 'rgba(214,170,84,.75)') => { c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.beginPath(); pts.forEach(([x, z], k) => k ? c.lineTo(x, z) : c.moveTo(x, z)); c.stroke(); };
        for (const r of Lp.rows) {
          r.leds.forEach(l => {
            cu([[Lp.pinX, l.lane], [Lp.resL, l.lane]]); cu([[Lp.resR, l.lane], [l.x - 1.27, l.lane], [l.x - 1.27, l.z]]);
            cu([[l.x + 1.27, l.z], [l.x + 1.27, r.rail]], 0.7, 'rgba(160,176,188,.8)');
            txt(c, l.short, l.x, r.labelZ, 1.5, '#e6efe9', 'center', 700);
            txt(c, 'L' + l.i, Lp.pinX - 1.7, l.lane, 1.1, '#f2f2f2', 'right', 600);
          });
          cu([[r.leds[0].x - 2, r.rail], [Lp.spineX, r.rail]], 0.9, 'rgba(160,176,188,.8)');
          txt(c, r.title, Lp.titleX, r.ledZ, 2.1, '#ffffff', 'left', 800);
          c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(-Lp.w / 2 + 1, r.top - 0.4, Lp.w - 2, r.labelZ + 1.6 - r.top);
        }
        cu([[Lp.spineX, Lp.rows[0].rail], [Lp.spineX, Lp.gndZ], [Lp.pinX, Lp.gndZ]], 1.1, 'rgba(160,176,188,.9)');
        txt(c, 'GND', Lp.pinX - 1.7, Lp.gndZ, 1.1, '#cfd8de', 'right', 700);
        txt(c, '330 Ω', (Lp.resL + Lp.resR) / 2, Lp.rows[0].top - 0.6, 1.3, '#d8c49a', 'center', 700);
      });
      p.refs.leds = []; const glow = softSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
      Lp.rows.forEach(r => r.leds.forEach(l => {
        const res = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, Lp.resR - Lp.resL, 12), mat('#d8c49a'))); res.rotation.z = Math.PI / 2; res.position.set((Lp.resL + Lp.resR) / 2, TOP + 1.1, l.lane); g.add(res);
        for (const [bx, bc] of [[-1.6, '#e5392f'], [-0.6, '#e5392f'], [0.4, '#8a4a1c'], [1.6, '#c9a227']]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.45, 12), mat(bc)); b.rotation.z = Math.PI / 2; b.position.set((Lp.resL + Lp.resR) / 2 + bx, TOP + 1.1, l.lane); g.add(b); }
        const x = l.x, z = l.z;
        const m = new THREE.MeshStandardMaterial({ color: l.color, emissive: l.color, emissiveIntensity: 0, transparent: true, opacity: 0.82, roughness: 0.15 });
        cyl(g, 2.9, 1, m, x, TOP + 3, z, 20);
        const body = cyl(g, 2.5, 4.5, m, x, TOP + 4, z, 20);
        const dome = shadow(new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m)); dome.position.set(x, TOP + 8.5, z); g.add(dome);
        for (const dx of [-1.27, 1.27]) box(g, 0.45, 3, 0.45, METAL(), x + dx, TOP, z);
        const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: l.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        h.position.set(x, TOP + 8, z); h.scale.set(16, 16, 1); g.add(h);
        p.refs.leds[l.i] = { m, h };
      }));
    },
  },
  // ---------- option: 5 RGB LEDs on a PCA9685 16-channel PWM board ----------
  {
    id: 'pca', name: 'PCA9685 16-channel PWM board (LED driver)', short: 'PCA9685', pos: [30, 118, 0], option: [['leds', 'rgb'], ['board', 'breakout']],
    buy: [1, 'PCA9685 16-channel 12-bit PWM board (I2C, 0x40)', 'Drives the 5 RGB LEDs (15 channels) with real PWM, so orange and yellow are possible. Uses the LCD’s I2C wires, no extra ESP32 pins. Most boards already have a 220 Ω resistor on every output.', 180, 300],
    info: 'An I2C PWM chip: the ESP32 sends “channel n, brightness x” over SDA/SCL (address 0x40) and the board keeps all 16 outputs pulsing at 1 kHz by itself. Each output already has a 220 Ω series resistor. The I2C/power pins on the left are passed through to the right side for chaining.',
    pins: [...['GND', 'OE', 'SCL', 'SDA', 'VCC', 'VP'].map((id, i) => P(id, id === 'VP' ? 'V+' : id, -28.5, -6.35 + i * 2.54, { role: { GND: 'gnd', VCC: 'vcc', SDA: 'i2c', SCL: 'i2c' }[id] || 'in-digital' })),
      ...['GND', 'OE', 'SCL', 'SDA', 'VCC', 'VP'].map((id, i) => P(id + '2', id === 'VP' ? 'V+' : id, 28.5, -6.35 + i * 2.54, { role: 'pass' })),
      ...Array.from({ length: 16 }, (_, n) => P('PWM' + n, String(n), -19.05 + n * 2.54, 10, { role: 'out-pwm' }))],
    links: [['GND', 'GND2'], ['OE', 'OE2'], ['SCL', 'SCL2'], ['SDA', 'SDA2'], ['VCC', 'VCC2'], ['VP', 'VP2']],
    build(p) {
      const g = p.inner;
      pcb(g, 62, 26, '#3b2a7a', c => {
        hdrLabels(c, p.def.pins.slice(0, 6), 2, 1.3); hdrLabels(c, p.def.pins.slice(6, 12), -2, 1.3);
        p.def.pins.slice(12).forEach(q => txt(c, q.label, q.x, 7, 1.1, '#fff'));
        txt(c, 'PCA9685 16-CH PWM', 0, -9, 1.8, '#fff', 'center', 800);
      });
      box(g, 10, 1.6, 10, BLACK(), 0, TOP, -2); // the chip
      decal(g, 9, 9, c => { txt(c, 'PCA9685', 0, 0, 1.5, '#d8d8d8', 'center', 700); }, 0, TOP + 1.62, -2);
      for (let n = 0; n < 16; n++) box(g, 2.5, 2.5, 5, BLACK(), -19.05 + n * 2.54, TOP, 6.2); // V+/GND rows behind each PWM pin
      for (let i = 0; i < 16; i++) smd(g, -19.05 + i * 2.54, 2.6, '#222', 1.6, 0.9); // the 220 Ω resistors
    },
  },
  // ---------- option: the same PCA9685 on an Arduino-Uno-size servo shield ----------
  {
    // 68.6 × 53.3 mm Uno shield. It can't plug onto an ESP32, so SDA/SCL/5V/GND are jumpered from its header sockets.
    id: 'pcas', name: 'PCA9685 16-channel PWM servo shield (Uno size, LED driver)', short: 'Servo shield', pos: [30, 118, 0], option: [['leds', 'rgb'], ['board', 'shield']],
    buy: [1, '16-channel 12-bit PWM servo shield, PCA9685 (Uno size)', 'Same chip and code as the PCA9685 breakout, in Arduino Uno shield form. Wire SDA, SCL, 5V and GND to the ESP32 with jumpers.', 450, 500],
    info: 'Same PCA9685 chip as the breakout (I2C address 0x40, same Adafruit_PWMServoDriver code), on an Arduino Uno shield. It does not plug onto an ESP32: SDA, SCL (top header, next to AREF), 5V and GND (power header) are jumpered to the ESP32 and rails. VCC-select jumper on 5V so the green and blue LEDs are bright. Each channel is a 3-pin servo header (PWM / V+ / GND): only the PWM signal pin is used for an LED, and it already has a 220 Ω resistor. The green V+ screw terminal is servo power: leave it empty.',
    pins: [P('SCL', 'SCL', -24, -24.1, { role: 'i2c' }), P('SDA', 'SDA', -21.46, -24.1, { role: 'i2c' }),
      P('VCC', '5V', -9.38, 24.1, { role: 'vcc' }), P('GND', 'GND', -6.84, 24.1, { role: 'gnd' }),
      P('VP', 'V+', -28.5, 4, { kind: 'screw', role: 'in-digital' }),
      ...Array.from({ length: 16 }, (_, n) => P('PWM' + n, String(n), -14 + Math.floor(n / 4) * 11 + (n % 4) * 2.54, 2, { role: 'out-pwm' }))],
    build(p) {
      const g = p.inner, sx = n => -14 + Math.floor(n / 4) * 11 + (n % 4) * 2.54;
      pcb(g, 68.6, 53.3, '#1f6fb8', c => {
        // proto area
        c.fillStyle = '#c9a15a'; for (let x = -26; x <= 16; x += 2.54) for (let z = -19; z <= -6; z += 2.54) { c.beginPath(); c.arc(x, z, 0.5, 0, 7); c.fill(); }
        txt(c, '16 × 12-BIT PWM / SERVO SHIELD', 0, -12.6, 1.5, '#ffffff', 'center', 800);
        txt(c, 'SCL', -24, -21.2, 1.1, '#fff'); txt(c, 'SDA', -21.46, -21.2, 1.1, '#fff');
        txt(c, '5V', -9.38, 21.2, 1.1, '#fff'); txt(c, 'GND', -6.84, 21.2, 1.1, '#fff');
        for (let n = 0; n < 16; n++) txt(c, String(n), sx(n), -0.4, 1, '#fff');
        txt(c, 'PWM', 30.5, 2, 1, '#fff', 'left'); txt(c, 'V+', 30.5, 4.54, 1, '#fff', 'left'); txt(c, 'GND', 30.5, 7.08, 1, '#fff', 'left');
        txt(c, 'V+  servo power (not used for LEDs)', -31.5, 10.5, 0.95, '#ffe08a', 'left');
        txt(c, 'VCC select: 5V', -21, 15.6, 1, '#fff', 'left');
        txt(c, 'I2C 0x40', 24, -2, 1.1, '#fff');
      });
      // Uno header sockets (decor) along both long edges; the four used pins are real header pins
      for (const [x0, n, z] of [[-26.5, 10, -24.1], [3, 8, -24.1], [-19.5, 8, 24.1], [6, 6, 24.1]]) box(g, n * 2.54, 8.5, 2.5, BLACK(), x0 + (n - 1) * 1.27, TOP - 0.5, z);
      // servo headers: V+ and GND rows behind each PWM pin (the PWM pin itself is drawn as the wire pin)
      for (let n = 0; n < 16; n++) for (const dz of [2.54, 5.08]) { box(g, 2.5, 2.5, 2.5, BLACK(), sx(n), TOP, 2 + dz); box(g, 0.64, 6, 0.64, GOLD(), sx(n), TOP + 2.5, 2 + dz); }
      for (let n = 0; n < 16; n++) smd(g, sx(n), -3.2, '#222', 1.6, 0.9); // 220 Ω output resistors
      box(g, 10, 1.6, 10, BLACK(), 24, TOP, -10); decal(g, 9, 9, c => txt(c, 'PCA9685', 0, 0, 1.5, '#d8d8d8', 'center', 700), 24, TOP + 1.62, -10);
      screwBlock(g, -28.5, 6.5, 2, 5, '#3aa655');                      // V+ / GND servo power terminal
      for (const dx of [0, 2.54, 5.08]) box(g, 0.64, 6, 0.64, GOLD(), -20 + dx, TOP + 2.5, 18.5); // VCC-select header
      box(g, 5.6, 5, 2.6, mat('#2f7de1'), -18.73, TOP + 2, 18.5);       // jumper cap on 5V side
      box(g, 6, 3.5, 6, mat('#222'), -28, TOP, 19); cyl(g, 1.6, 1.2, mat('#333'), -28, TOP + 3.5, 19, 16); // reset button
      p.refs.dled = led(g, 14, 18, '#30ff60');
    },
  },
  {
    id: 'rgb', name: 'RGB LED panel (5 common-cathode RGB LEDs)', short: 'RGB panel', pos: [130, 104, 0], option: ['leds', 'rgb'],
    buy: [5, 'RGB LED 5 mm common cathode (4 legs)', 'One RGB LED per indicator: it can show green, blue, yellow, orange and red, so 5 LEDs replace all 17.', 8, 15],
    info: 'Each RGB LED has a red, a green and a blue LED inside sharing one cathode (the longest leg, to GND). Mixing their brightness from the PCA9685 gives any colour: yellow = red + some green, orange = red + a little green.',
    pins: [...Array.from({ length: 15 }, (_, n) => { const led = Math.floor(n / 3), k = 'RGB'[n % 3]; return P(k + led, k + led, -31, -19.05 + n * 2.54, { role: 'in-digital' }); }), P('GND', 'GND', -31, -19.05 + 15 * 2.54, { role: 'gnd' })],
    build(p) {
      const g = p.inner, rows = [-24, -12, -1, 10, 24];
      pcb(g, 70, 66, '#1e3a2f', c => {
        hdrLabels(c, p.def.pins, -1.8, 1.05, 'right');
        const cu = (pts, col = 'rgba(214,170,84,.75)', w = 0.6) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach(([x, z], k) => k ? c.lineTo(x, z) : c.moveTo(x, z)); c.stroke(); };
        rows.forEach((rz, r) => {
          for (let k = 0; k < 3; k++) {
            const zp = -19.05 + (3 * r + k) * 2.54, xk = -20 + r * 4 + k * 1.2, leg = [4.1, 6.6, 7.9][k], zh = rz + 3 + k * 1.2;
            cu([[-31, zp], [xk, zp], [xk, zh], [leg, zh], [leg, rz]], ['rgba(229,57,47,.85)', 'rgba(47,191,91,.85)', 'rgba(47,125,225,.85)'][k]);
          }
          cu([[5.4, rz], [5.4, rz - 4], [30, rz - 4]], 'rgba(160,176,188,.85)', 0.8);
          txt(c, LED_GROUPS[r].title, 14, rz, 2.1, '#fff', 'left', 800);
        });
        cu([[30, rows[0] - 4], [30, 30], [-25, 30], [-25, 19.05], [-31, 19.05]], 'rgba(160,176,188,.9)', 1);
        txt(c, 'GND BUS', 20, 31.6, 1.3, '#cfd8de');
      });
      p.refs.rgb = []; const glow = softSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
      rows.forEach(rz => {
        const m = new THREE.MeshStandardMaterial({ color: '#e8eef2', emissive: '#000000', transparent: true, opacity: 0.85, roughness: 0.2 });
        cyl(g, 2.9, 1, m, 6, TOP + 3, rz, 20); cyl(g, 2.5, 4.5, m, 6, TOP + 4, rz, 20);
        const dome = shadow(new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m)); dome.position.set(6, TOP + 8.5, rz); g.add(dome);
        for (const lx of [4.1, 5.4, 6.6, 7.9]) box(g, 0.4, 3, 0.4, METAL(), lx, TOP, rz);
        const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#000000', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        h.position.set(6, TOP + 8, rz); h.scale.set(18, 18, 1); g.add(h);
        p.refs.rgb.push({ m, h });
      });
    },
  },
  {
    id: 'buzz', name: 'Active buzzer + S8050 driver', short: 'Buzzer', pos: [222, 38, 0],
    buy: [1, 'Active buzzer 3–5 V module (S8050 transistor driver)', 'Audible alarm for gas and fire. The transistor drives it so the ESP32 pin is not overloaded.', 25, 45],
    info: 'HIGH on SIG turns the transistor on and the buzzer sounds. Active buzzers beep by themselves; no tone() needed.',
    pins: [P('VCC', 'VCC', -10, -2.54, { role: 'vcc' }), P('SIG', 'I/O', -10, 0, { role: 'in-digital' }), P('GND', 'GND', -10, 2.54, { role: 'gnd' })],
    build(p) {
      const g = p.inner;
      pcb(g, 26, 18, '#1f5fa8', c => { hdrLabels(c, p.def.pins, 2.2, 1.5); });
      p.refs.body = cyl(g, 6, 9.5, mat('#121212', { roughness: 0.4 }), 4, TOP, 0, 32);
      decal(g, 6, 6, c => { c.fillStyle = '#333'; c.beginPath(); c.arc(0, 0, 1.2, 0, 7); c.fill(); txt(c, '+', 0, -2.4, 1.6, '#ddd'); }, 4, TOP + 9.52, 0);
      box(g, 3, 3, 1.6, BLACK(), -3, TOP, -5);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.5, 8, 40), new THREE.MeshBasicMaterial({ color: '#ff5a3c', transparent: true, opacity: 0 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(4, TOP + 10, 0); g.add(ring); p.refs.ring = ring;
    },
  },
  {
    // id stays 'psu' so wiring/checks keep working; it is now a 4×AAA battery holder
    id: 'psu', name: '4×AAA battery holder (6 V, with switch)', short: 'Battery', pos: [215, -80, 0],
    buy: [1, '4×AAA battery holder with switch + 4 AAA batteries', 'Separate 6 V power for the pumps (fits 3–6 V pumps). Its − (black lead) must also meet the ESP32 GND.', 120, 220],
    info: 'Four 1.5 V AAA cells in series = 6 V. Feeds only the pumps, through the relay contacts. Red lead = +, black lead = −. Never power pumps from ESP32 pins. A 3×AAA holder (4.5 V) also works; the pumps just run slower.',
    pins: [P('VCC', '+ red', -42, -5, { kind: 'lead', y: 5, role: 'supply' }), P('GND', '− black', -42, 5, { kind: 'lead', y: 5, role: 'gnd' })],
    build(p) {
      const g = p.inner, body = mat('#17181b', { roughness: 0.55 });
      box(g, 48, 3, 60, body, 0, 0, 0);
      for (const [w, d, x, z] of [[48, 2, 0, -29], [48, 2, 0, 29], [2, 60, -23, 0], [2, 60, 23, 0]]) box(g, w, 13, d, body, x, 0, z);
      for (const x of [-10.4, 0, 10.4]) box(g, 0.8, 9, 56, body, x, 3, 0);
      [-15.6, -5.2, 5.2, 15.6].forEach((x, i) => {
        const up = i % 2 === 0 ? 1 : -1; // cells alternate direction, as in a series holder
        const cell = shadow(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 44, 24), mat(i % 2 ? '#1c1c1c' : '#2a5fd0', { roughness: 0.35 }))); cell.rotation.x = Math.PI / 2; cell.position.set(x, 8.2, 0); g.add(cell);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(5.05, 5.05, 9, 24), mat('#d8b25a', { metalness: 0.6, roughness: 0.35 })); band.rotation.x = Math.PI / 2; band.position.set(x, 8.2, up * 15); g.add(band);
        const nub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.2, 12), METAL()); nub.rotation.x = Math.PI / 2; nub.position.set(x, 8.2, up * 22.6); g.add(nub);
        const spring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.5, 6, 16), METAL()); spring.position.set(x, 8.2, -up * 25.5); g.add(spring);
      });
      decal(g, 44, 6, c => { txt(c, '4 × AAA · 6 V', 0, 0, 3.2, '#e8edf2', 'center', 800); }, 0, 13.05, -29);
      box(g, 6, 3, 10, mat('#2a2c30'), 18, 13, 22); box(g, 2.4, 2, 3, mat('#e0e0e0'), 17, 16, 20); // ON/OFF switch
      decal(g, 10, 4, c => { txt(c, 'ON  OFF', 0, 0, 1.6, '#cfd3d8'); }, 18, 16.05, 26);
      // red/black leads out of the holder, ending in tinned tips you plug into the relay / GND rail
      for (const [z, col] of [[-5, '#d22'], [5, '#1d1d1d']]) {
        const c = new THREE.CatmullRomCurve3([new THREE.Vector3(-23, 6, z * 1.6), new THREE.Vector3(-29, 3, z * 1.3), new THREE.Vector3(-36, 2.2, z), new THREE.Vector3(-41, 2.2, z)]);
        g.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.9, 8), mat(col))));
        cyl(g, 0.6, 3, METAL(), -42, 2, z, 8);
      }
      const t = tag('BATTERY 6 V (4×AAA)', 6, '#ffffff', 'rgba(15,20,25,.85)', '#f2c230'); t.position.set(0, 30, 0); g.add(t);
    },
  },
  {
    id: 'pumpS', name: 'Sprinkler pump leads (pump in the tank)', short: 'Sprinkler pump', pos: [-60, -158, 0],
    buy: [2, '3–6 V mini submersible pump', 'One pump sprays the house, one refills the tank. Put a 1N4007 diode across each pump (stripe to +).', 80, 150],
    info: 'The pump sits at the bottom of the tank; its own red (+) and black (−) leads come out here. Red goes to the relay NO1 screw, black to the battery − lead.',
    pins: [P('P', '+ red', -9, -3, { kind: 'lead', y: 5, role: 'load+' }), P('N', '− black', -9, 3, { kind: 'lead', y: 5, role: 'load-' })],
    build: pumpLeads,
  },
  {
    id: 'pumpR', name: 'Refill pump leads (pump in the water source)', short: 'Refill pump', pos: [-175, -158, 0], buyShared: 'pumpS',
    info: 'Pumps water from the source into the tank when the level drops to 30%. Its red (+) lead goes to the relay NO2 screw, black (−) to the battery − lead.',
    pins: [P('P', '+ red', -9, -3, { kind: 'lead', y: 5, role: 'load+' }), P('N', '− black', -9, 3, { kind: 'lead', y: 5, role: 'load-' })],
    build: pumpLeads,
  },
];

// The pump's own two wires: they run straight out of the tank and end in tinned tips (no terminal, no clip).
function pumpLeads(p) {
  const g = p.inner;
  const t = tag(p.def.short.toUpperCase() + ' leads', 6, '#ffffff', 'rgba(15,20,25,.85)', '#2fbf5b'); t.position.set(0, 24, 0); g.add(t);
  for (const [z, col] of [[-3, '#d22'], [3, '#1d1d1d']]) {
    // from the pump in the diorama, through the clip, out to the tip
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(8 + (z > 0 ? 3 : 0), 7.5, -90), new THREE.Vector3(10 + (z > 0 ? 3 : 0), 8, -45), new THREE.Vector3(6, 4, z - 12), new THREE.Vector3(2, 3, z), new THREE.Vector3(-4, 2.5, z), new THREE.Vector3(-8, 2.2, z)]);
    g.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.8, 6), mat(col))));
    cyl(g, 0.55, 3, METAL(), -9, 2, z, 8);
  }
}

export const EXTRA_BUY = [
  [1, 'Silicone tubing 1 m + mini spray nozzle', 'Carries the water and acts as the sprinkler head', 60, 120],
  [2, '1N4007 diode', 'Across each pump to absorb voltage spikes', 4, 10],
  [17, '330 Ω resistor', 'One in series with each indicator LED to limit its current', 1, 2],
  [1, 'Perfboard 7×9 cm (×2)', 'Holds the three 74HC595 chips and the LED panel', 30, 60],
  [3, 'Jumper wire packs (M-M, M-F, F-F)', 'All the connections', 50, 70],
  [1, 'Water container + small box for the “house”', 'Tank, water source and a place to mount sensors', 50, 150],
];

// ---------- instantiate ----------
export function createPart(def) {
  const group = new THREE.Group(); group.name = def.id;
  const inner = new THREE.Group(); group.add(inner);
  if (def.tilt) { inner.rotation.x = def.tilt; inner.position.y = 14; }
  group.position.set(def.pos[0], 0, def.pos[1]); group.rotation.y = def.pos[2] || 0;
  if (def.mount) { inner.rotation.z = def.mount.rz || 0; inner.rotation.x = def.mount.rx || 0; group.position.y = def.mount.y || 0; }
  const p = { id: def.id, def, group, inner, refs: {}, pins: new Map(), bodies: [] };
  def.build(p);
  inner.traverse(o => { if (o.isMesh) { o.userData.part = def.id; p.bodies.push(o); } });
  group.traverse(o => { if (o.isMesh && !o.userData.part) { o.userData.part = def.id; p.bodies.push(o); } });
  const hitGeo = new THREE.SphereGeometry(2.1, 12, 8);
  for (const pd of def.pins) {
    let tipY;
    if (pd.kind === 'screw') tipY = TOP + 9.8;
    else if (pd.kind === 'lead') tipY = pd.y ?? 5; // bare wire tip: no header
    else if (pd.kind === 'edge') { // in-plane header sticking out of the board edge (+z), like the HC-SR04
      box(inner, 2.5, 2.5, 2.5, BLACK(), pd.x, PCB_Y - 0.45, pd.z + 1.25);
      const pin = box(inner, 0.64, 0.64, 6, GOLD(), pd.x, PCB_Y + 0.5, pd.z + 5.5);
      tipY = PCB_Y + 0.8;
    }
    else {
      box(inner, 2.5, 2.5, 2.5, BLACK(), pd.x, TOP, pd.z);
      box(inner, 0.64, 6, 0.64, GOLD(), pd.x, TOP + 2.5, pd.z);
      tipY = HDR_TIP;
    }
    const anchor = new THREE.Object3D(); anchor.position.set(pd.x, tipY, pd.kind === 'edge' ? pd.z + 8.5 : pd.z); inner.add(anchor);
    if (pd.kind === 'edge') anchor.rotation.x = Math.PI / 2; // the "up" of an edge pin points out of the edge
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ color: '#36e2ff', transparent: true, opacity: 0, depthWrite: false }));
    anchor.add(hit);
    const id = def.id + '.' + pd.id;
    hit.userData.pin = id;
    p.pins.set(id, { id, part: def.id, label: pd.label, kind: pd.kind, role: pd.role, anchor, hit, def: pd });
  }
  return p;
}
