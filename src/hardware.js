// Electrical model: nets from wires, voltages, part behaviour, and wiring checks.
import { PARTS, ESP_GPIO_PIN, gpioOf, ADC1, ADC2, INPUT_ONLY, FLASH, STRAP, UART } from './parts.js';

const SUP = { 'esp.3V3': ['3V3', 3.3], 'esp.5V': ['5V', 5], 'esp.GND1': ['GND', 0], 'esp.GND2': ['GND', 0], 'esp.GND3': ['GND', 0], 'psu.VCC': ['PSU', 6], 'psu.GND': ['PGND', 0] };
const PIN_GPIO = {}; for (const g in ESP_GPIO_PIN) PIN_GPIO[ESP_GPIO_PIN[g]] = +g;
const WORST = { gasPpm: 1000, tank: 100, flameVisible: false };

export function buildNets(pins, links) {
  const parent = new Map(pins.map(p => [p, p]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [a, b] of links) { if (!parent.has(a) || !parent.has(b)) continue; const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  const of = new Map(), members = new Map();
  for (const p of pins) { const r = find(p); of.set(p, r); if (!members.has(r)) members.set(r, []); members.get(r).push(p); }
  return { of, members };
}

export class Hardware {
  constructor(world) {
    this.world = world; this.wires = []; this.allPins = []; this.internal = []; this.label = {};
    this.active = null; // Set of part ids in the current build options (null = all)
    for (const d of PARTS) {
      for (const p of d.pins) { const id = d.id + '.' + p.id; this.allPins.push(id); this.label[id] = (d.short || d.id) + ' ' + p.label; }
      for (const [pre, n] of d.internal || []) for (let i = 1; i < n; i++) this.internal.push([d.id + '.' + pre + '0', d.id + '.' + pre + i]);
      for (const [a, b] of d.links || []) this.internal.push([d.id + '.' + a, d.id + '.' + b]); // pass-through pins on the same board
    }
    this.resetMCU(); this.rebuild();
  }
  resetMCU() {
    this.mcu = { mode: {}, level: {}, i2c: { sda: 21, scl: 22 } };
    this.lcd = { rows: [' '.repeat(20), ' '.repeat(20), ' '.repeat(20), ' '.repeat(20)], init: false, backlight: false, cx: 0, cy: 0 };
    this.pixels = new Array(8).fill(0);
    this.sr = { shift: new Array(24).fill(0), out: new Array(24).fill(0) }; // three chained 74HC595
    this.pca = new Array(16).fill(0); // PCA9685 duty per channel, 0..1
    this.warned = new Set();
  }
  // Called by the runtime whenever a GPIO output changes level: clocks the 74HC595 chain on rising edges.
  pinWrite(gpio, level, prev) {
    if (level === prev || !level) return;
    const m = this.members(ESP_GPIO_PIN[gpio]);
    if (m.includes('us.TRIG') && this.vcc('us') >= 4.5) this.usPing = true; // TRIG rising edge: the HC-SR04 fires a ping
    if (this.vcc('sr') < 2) return;
    if (m.includes('sr.CLOCK')) { const v = this.netV('sr.DATA'); this.sr.shift.pop(); this.sr.shift.unshift(v != null && v > 1.6 ? 1 : 0); }
    if (m.includes('sr.LATCH')) this.sr.out = this.sr.shift.slice();
  }
  links() { return [...this.internal, ...this.wires.map(w => [w.a, w.b])]; }
  rebuild() { this.net = buildNets(this.allPins, this.links()); this.issues = this.check(); }

  // ---------- voltages ----------
  members(pin, net = this.net) { return net.members.get(net.of.get(pin)) || [pin]; }
  supplies(pin, net = this.net) { const s = new Set(); for (const p of this.members(pin, net)) if (SUP[p]) s.add(SUP[p][0]); return s; }
  isGround(pin, net = this.net) { const s = this.supplies(pin, net); return s.has('GND') || s.has('PGND'); }
  connected(pin) { return this.members(pin).length > 1; }
  netV(pin, seen = new Set(), worst = false) {
    const root = this.net.of.get(pin); if (seen.has(root)) return null; seen.add(root);
    const m = this.net.members.get(root);
    if (!m) return null;
    for (const p of m) if (SUP[p]) return SUP[p][1];
    if (!worst) for (const p of m) { const g = PIN_GPIO[p]; if (g !== undefined && this.mcu.mode[g] === 'OUTPUT') return this.mcu.level[g] ? 3.3 : 0; }
    for (const p of m) { const d = DRIVERS[p]; if (d) { const v = d(this, seen, worst ? WORST : this.world, worst); if (v != null) return v; } }
    for (const p of m) { const d = WEAK[p]; if (d) { const v = d(this, seen, worst); if (v != null) return v; } } // pull-up resistors lose to any real driver
    if (worst) for (const p of m) if (PIN_GPIO[p] !== undefined && !INPUT_ONLY.includes(PIN_GPIO[p])) return 3.3;
    return null;
  }
  vcc(part, seen = new Set(), worst = false) {
    if (!this.isGround(part + '.GND')) return 0;
    const v = this.netV(part + '.VCC', seen, worst); return v == null ? 0 : v;
  }
  gpioOn(pin) { for (const p of this.members(pin)) if (PIN_GPIO[p] !== undefined) return PIN_GPIO[p]; return null; }

  // pulseIn() on a GPIO: how long ECHO stays HIGH after the last TRIG pulse (µs), or why it can't be measured
  echo(gpio) {
    const m = this.members(ESP_GPIO_PIN[gpio]);
    const direct = m.includes('us.ECHO'), viaDiv = m.includes('div2.OUT') && this.members('div2.IN').includes('us.ECHO');
    if (!direct && !viaDiv) return { why: `nothing is connected to the HC-SR04 ECHO on GPIO${gpio}` };
    const v = this.vcc('us'); if (v < 4.5) return { why: v ? 'the HC-SR04 needs 5 V, it is only getting ' + v.toFixed(1) + ' V' : 'the HC-SR04 has no power' };
    if (!this.usPing) return { why: 'no TRIG pulse was sent before pulseIn() (TRIG HIGH for 10 µs, then LOW)' };
    this.usPing = false; this.lastPing = performance.now();
    return { us: this.world.usDistanceMm() / 1000 / 343 * 2 * 1e6 };
  }

  // ---------- what the outside world sees right now ----------
  evaluate() {
    const o = {}, w = this.world;
    const rv = this.vcc('relay'); o.relayPowered = rv >= 4.5; o.relayWeak = rv > 0 && rv < 4.5;
    for (const k of [1, 2]) { const v = this.netV('relay.IN' + k); o['k' + k] = o.relayPowered && v != null && v < 1.2; }
    const links = this.links();
    links.push(o.k1 ? ['relay.COM1', 'relay.NO1'] : ['relay.COM1', 'relay.NC1']);
    links.push(o.k2 ? ['relay.COM2', 'relay.NO2'] : ['relay.COM2', 'relay.NC2']);
    const dyn = buildNets(this.allPins, links);
    const pump = id => {
      const plus = this.supplies(id + '.P', dyn), minus = this.members(id + '.N', dyn);
      if (plus.has('PSU')) return minus.includes('psu.GND');
      if (plus.has('5V') || plus.has('3V3')) return minus.some(p => /^esp\.GND/.test(p));
      return false;
    };
    o.sprPump = pump('pumpS'); o.refPump = pump('pumpR');
    o.buzz = this.isGround('buzz.N') && (this.netV('buzz.P') ?? 0) > 1.5;
    const lg = this.isGround('panel.GND');
    o.leds = []; o.ledDim = [];
    for (let i = 0; i < 17; i++) { const v = lg ? this.netV('panel.L' + i) : null; o.leds[i] = v != null && v >= 2.4; o.ledDim[i] = o.leds[i] && v < 4; }
    o.lcdV = this.vcc('lcd');
    o.espLed = this.mcu.mode[2] === 'OUTPUT' && !!this.mcu.level[2];
    o.mqLed = this.vcc('mq2') > 2.5 && w.gasPpm >= 400;
    o.flameLed = this.vcc('flame') > 2.5 && w.flameVisible;
    o.usPowered = this.vcc('us') >= 4.5;
    // RGB LEDs: brightness of each colour from the voltage on its leg (PWM average)
    const rg = this.isGround('rgb.GND');
    o.rgb = [0, 1, 2, 3, 4].map(i => [0, 1, 2].map(k => { if (!rg) return 0; const v = this.netV('rgb.' + 'RGB'[k] + i); return v == null ? 0 : Math.max(0, Math.min(1, v / (k ? 4.5 : 3))); }));
    return o;
  }

  // ---------- static wiring checks ----------
  check() {
    const out = [], add = (level, part, msg) => out.push({ level, part, msg });
    for (const [root, m] of this.net.members) {
      if (m.length < 2) continue;
      const sup = new Set(m.filter(p => SUP[p]).map(p => SUP[p][0]));
      const pos = [...sup].filter(s => s !== 'GND' && s !== 'PGND'), gnd = sup.has('GND') || sup.has('PGND');
      if (pos.length && gnd) add('error', null, `Short circuit: ${pos.join(' and ')} is wired straight to GND.`);
      if (sup.has('3V3') && (sup.has('5V') || sup.has('PSU'))) add('error', null, '3.3 V is tied to 5 V or to the battery.');
      if (sup.has('5V') && sup.has('PSU')) add('warn', 'psu', 'Battery + is joined to the ESP32 5V pin: 6 V would be pushed back into the ESP32 and the USB port. Only the grounds should meet.');
      const gp = m.filter(p => PIN_GPIO[p] !== undefined).map(p => PIN_GPIO[p]);
      if (gp.length > 1) add('warn', 'esp', `GPIO${gp.join(' and GPIO')} are wired to each other.`);
      for (const g of gp) {
        if (FLASH.includes(g)) add('error', 'esp', `GPIO${g} is used by the on-board flash. Using it crashes the ESP32.`);
        else if (STRAP.includes(g)) add('warn', 'esp', `GPIO${g} is a boot strapping pin. A module pulling it can stop the ESP32 from booting.`);
        else if (UART.includes(g)) add('warn', 'esp', `GPIO${g} is the USB serial line. You lose Serial Monitor and uploads may fail.`);
        if (sup.has('5V') || sup.has('PSU')) { add('error', 'esp', `5–6 V goes straight into GPIO${g}. That will damage the ESP32.`); continue; }
        if (pos.length || gnd) add('warn', 'esp', `GPIO${g} is tied directly to ${pos[0] || 'GND'}. If the code makes it an OUTPUT it shorts.`);
        const vmax = this.netV(m[0], new Set(), true);
        const drivers = m.filter(p => DRIVERS[p]);
        if (drivers.length && vmax != null && vmax > 3.6) add('error', drivers[0].split('.')[0], `GPIO${g} can see up to ${vmax.toFixed(1)} V from ${this.label[drivers[0]]} (max 3.6 V). ${drivers[0] === 'mq2.AO' ? 'Put the 10k/20k divider in between.' : drivers[0] === 'us.ECHO' ? 'Put the 1k/2k echo divider in between.' : 'Power that module from 3V3 instead.'}`);
        const needsDrive = m.filter(p => /^(relay\.IN\d|sr\.(DATA|CLOCK|LATCH)|panel\.L\d+|buzz\.P|us\.TRIG)$/.test(p));
        if (needsDrive.length && INPUT_ONLY.includes(g)) add('error', needsDrive[0].split('.')[0], `GPIO${g} is input-only, so it can't drive ${this.label[needsDrive[0]]}.`);
        const analog = m.filter(p => /^(div\.OUT|mq2\.AO)$/.test(p));
        if (analog.length) {
          if (!ADC1.includes(g) && !ADC2.includes(g)) add('error', analog[0].split('.')[0], `GPIO${g} has no ADC, so analogRead() can't read ${this.label[analog[0]]}.`);
          else if (ADC2.includes(g)) add('info', analog[0].split('.')[0], `GPIO${g} is ADC2: analogRead() stops working once Wi-Fi is on. Prefer GPIO32–39.`);
        }
      }
    }
    // one jumper per pin: a header pin, a breadboard hole or a battery lead can't take two. Shared signals meet in a breadboard row.
    const ends = {};
    for (const w of this.wires) for (const p of [w.a, w.b]) ends[p] = (ends[p] || 0) + 1;
    for (const [p, n] of Object.entries(ends)) if (n > 1) {
      const id = p.split('.')[0], name = PIN_GPIO[p] !== undefined ? 'GPIO' + PIN_GPIO[p] : this.label[p] || p;
      add('warn', id, `${name} has ${n} jumpers on one pin, which won't fit on the real board. Run one jumper to a breadboard row (SDA/SCL, 6V+/6V−, or a power rail) and plug the others into the same row.`);
    }
    const NEED5 = { us: 'the HC-SR04 needs 5 V and will not echo reliably', mq2: 'its heater needs 5 V, readings will be far too low', relay: 'the relay coils need 5 V and will not click', lcd: 'the text will be very faint' };
    for (const d of PARTS) {
      if (['esp', 'rail', 'pumpS', 'pumpR', 'div'].includes(d.id) || (this.active && !this.active.has(d.id))) continue;
      const hasV = d.pins.some(p => p.id === 'VCC') && d.pins.some(p => p.id === 'GND'); // pull-up boards have no GND pin
      const anyWire = d.pins.some(p => this.connected(d.id + '.' + p.id));
      if (!anyWire) { add('info', d.id, `${d.short} is not wired yet.`); continue; }
      if (hasV && this.connected(d.id + '.VCC') && !this.isGround(d.id + '.GND')) add('warn', d.id, `${d.short}: GND is not connected, so it gets no power.`);
      const v = this.vcc(d.id, new Set(), true);
      if (NEED5[d.id] && v > 0 && v < 4.5) add('warn', d.id, `${d.short} is on ${v} V: ${NEED5[d.id]}.`);
    }
    const on = id => !this.active || this.active.has(id);
    // DIY probes: each probe line needs a strong pull-up; the common wire should not sit on GND all the time
    if (on('probe')) for (let k = 1; k <= 4; k++) {
      const m = this.members('probe.P' + k), g = this.gpioOn('probe.P' + k);
      if (g == null) continue;
      if (!m.some(x => x.startsWith('pull.'))) add(INPUT_ONLY.includes(g) ? 'error' : 'info', 'probe', INPUT_ONLY.includes(g) ? `GPIO${g} has no internal pull-up, so probe ${k} floats when dry. Go through the 470k pull-up board.` : `Probe ${k} uses the ESP32's internal ~45k pull-up, which weak tap water may not pull LOW. The 470k pull-up board is more reliable.`);
    }
    if (on('probe') && this.isGround('probe.COM')) add('info', 'probe', 'The probe common wire is on GND all the time: constant current through the water corrodes the copper fast. Drive it from a GPIO only while reading.');
    if (on('pca') && this.connected('pca.OE') && (this.netV('pca.OE') ?? 0) > 1.5) add('warn', 'pca', 'PCA9685 OE is HIGH, which switches all its outputs off. Leave OE unconnected or tie it to GND.');
    if (on('rgb')) { const miss = Array.from({ length: 15 }, (_, n) => 'RGB'[n % 3] + Math.floor(n / 3)).filter(x => !this.connected('rgb.' + x)); if (miss.length && miss.length < 15) add('warn', 'rgb', `RGB LED leg${miss.length > 1 ? 's' : ''} ${miss.join(', ')} ${miss.length > 1 ? 'are' : 'is'} not connected to the PCA9685.`); if (this.connected('rgb.R0') && !this.isGround('rgb.GND')) add('warn', 'rgb', 'The RGB panel GND (common cathode) is not connected, so no LED can light.'); }
    // real-world notes (info only): 5 V I2C pull-ups and 3.3 V logic into a 5 V 74HC595
    if (on('lcd') && this.vcc('lcd', new Set(), true) >= 4.5 && this.gpioOn('lcd.SDA') != null) add('info', 'lcd', 'The LCD backpack pulls SDA/SCL up to 5 V (4.7k resistors). It usually works, but the ESP32 is a 3.3 V chip: add a 4-channel I2C level shifter in a real build (see Safety notes).');
    if (on('sr') && this.vcc('sr', new Set(), true) >= 4.5) add('info', 'sr', 'A 74HC595 at 5 V needs about 3.5 V for HIGH; the ESP32 gives 3.3 V. It usually works, but a 74HCT595 (same pinout) is guaranteed to.');
    const srv = this.vcc('sr', new Set(), true);
    if (srv > 0 && srv < 4.5) add('info', 'sr', 'The LED driver runs on 3.3 V: blue and green LEDs (about 3 V forward voltage) will be very dim. Use 5 V.');
    const unl = Array.from({ length: 17 }, (_, i) => i).filter(i => !this.connected('panel.L' + i));
    if (unl.length && unl.length < 17) add('warn', 'panel', `LED${unl.length > 1 ? 's' : ''} L${unl.join(', L')} ${unl.length > 1 ? 'are' : 'is'} not connected to the driver.`);
    if (this.connected('panel.L0') && !this.isGround('panel.GND')) add('warn', 'panel', 'The LED panel GND bus is not connected, so no LED can light.');
    if (this.connected('div2.IN') || this.connected('div2.OUT')) if (!this.isGround('div2.GND')) add('warn', 'div2', 'Echo divider GND is not connected, so it does not divide: the GPIO sees the full 5 V echo.');
    if (this.connected('div.IN') || this.connected('div.OUT')) if (!this.isGround('div.GND')) add('warn', 'div', 'Divider GND is not connected, so it does not divide: OUT = IN.');
    const sda = this.gpioOn('lcd.SDA'), scl = this.gpioOn('lcd.SCL');
    if (sda === 22 && scl === 21) add('warn', 'lcd', 'SDA and SCL look swapped (SDA should be GPIO21).');
    else if ((sda != null && sda !== 21) || (scl != null && scl !== 22)) add('info', 'lcd', `LCD is on SDA=GPIO${sda}, SCL=GPIO${scl}. Call Wire.begin(${sda}, ${scl}) in setup().`);
    for (const id of ['pumpS', 'pumpR']) {
      const s = this.supplies(id + '.P');
      if (s.has('5V') || s.has('3V3')) add('error', id, `${id === 'pumpS' ? 'Sprinkler' : 'Refill'} pump is powered from the ESP32. Motor current will brown it out and reset it.`);
      else if (s.has('PSU')) add('warn', id, `${id === 'pumpS' ? 'Sprinkler' : 'Refill'} pump is wired straight to the battery, so it is always on. Go through the relay NO terminal.`);
    }
    for (const k of [1, 2]) if (this.connected('relay.NC' + k)) add('info', 'relay', `NC${k} is closed while the relay is OFF. You probably want NO${k}.`);
    if (this.connected('psu.GND') && !this.supplies('psu.GND').has('GND')) add('warn', 'psu', 'Battery − is not joined to the ESP32 GND. Join it to the GND rail (common ground).');
    const order = { error: 0, warn: 1, info: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }
}

// Output pins that produce a voltage on their own (when the module is powered).
const DRIVERS = {
  'dht.DATA': (hw, seen, env, worst) => { const v = hw.vcc('dht', seen, worst); return v ? v : null; },
  'mq2.AO': (hw, seen, env, worst) => { const v = hw.vcc('mq2', seen, worst); if (!v) return null; return Math.min(v, (0.3 + env.gasPpm / 1000 * 3.9) * (v >= 4.5 ? 1 : 0.35)); },
  'mq2.DO': (hw, seen, env, worst) => { const v = hw.vcc('mq2', seen, worst); if (!v) return null; return env.gasPpm >= 400 ? 0 : v; },
  'flame.DO': (hw, seen, env, worst) => { const v = hw.vcc('flame', seen, worst); if (!v) return null; return env.flameVisible ? 0 : v; },
  'us.ECHO': (hw, seen, env, worst) => { const v = hw.vcc('us', seen, worst); if (!v) return null; return worst ? v : 0; }, // idle LOW, pulses to VCC
  'div2.OUT': (hw, seen, env, worst) => { const vin = hw.netV('div2.IN', seen, worst); if (vin == null) return null; return hw.isGround('div2.GND') ? vin * 2 / 3 : vin; },
  'div.OUT': (hw, seen, env, worst) => { const vin = hw.netV('div.IN', seen, worst); if (vin == null) return null; return hw.isGround('div.GND') ? vin * 2 / 3 : vin; },
};
// PCA9685 outputs: average PWM voltage (duty × VCC); OE pulled HIGH switches them all off
for (let n = 0; n < 16; n++) DRIVERS['pca.PWM' + n] = (hw, seen, env, worst) => {
  const v = hw.vcc('pca', seen, worst); if (!v) return null;
  if (worst) return v;
  if (hw.connected('pca.OE') && (hw.netV('pca.OE', seen) ?? 0) > 1.5) return 0;
  return v * hw.pca[n];
};
// the Uno-size servo shield: same chip, same channel duties (no OE pin broken out)
for (let n = 0; n < 16; n++) DRIVERS['pcas.PWM' + n] = (hw, seen, env, worst) => {
  const v = hw.vcc('pcas', seen, worst); if (!v) return null;
  return worst ? v : v * hw.pca[n];
};
// DIY probes: a wire under water is connected (through the water) to the common wire; if that is LOW, so is the probe
const PROBE_H = [0.10, 0.33, 0.66, 0.95];
for (let k = 1; k <= 4; k++) DRIVERS['probe.P' + k] = (hw, seen, env, worst) => {
  if (worst || env.tank < PROBE_H[k - 1] * 100 || env.tank < 2) return null;
  const com = hw.netV('probe.COM', seen); return com != null && com < 0.8 ? 0.15 : null;
};
// Weak drivers: pull-up resistors only set the level when nothing stronger drives the line
const WEAK = {};
for (let k = 1; k <= 4; k++) for (const s of ['A', 'B']) WEAK['pull.' + s + k] = (hw, seen) => { const v = hw.netV('pull.VCC', seen); return v != null && v >= 2.5 ? v : null; };
for (let i = 0; i < 17; i++) DRIVERS['sr.Q' + i] =(hw, seen, env, worst) => { const v = hw.vcc('sr', seen, worst); if (!v) return null; return worst || hw.sr.out[i] ? v : 0; };
