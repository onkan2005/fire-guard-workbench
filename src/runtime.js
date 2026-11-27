// Runs a transpiled sketch against the simulated hardware with a virtual clock.
import { transpile } from './transpile.js';
import { ESP_GPIO_PIN, INPUT_ONLY, ADC1, ADC2 } from './parts.js';

const macro = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
const LINE_OFFSET = 3;

for (const [k, f] of Object.entries({
  toInt() { return parseInt(this, 10) || 0; }, toFloat() { return parseFloat(this) || 0; }, toDouble() { return parseFloat(this) || 0; },
  equals(o) { return this == o; }, equalsIgnoreCase(o) { return this.toLowerCase() === String(o).toLowerCase(); },
  compareTo(o) { return this < o ? -1 : this > o ? 1 : 0; }, c_str() { return String(this); },
})) if (!String.prototype[k]) Object.defineProperty(String.prototype, k, { value: f, writable: true, configurable: true });

export class Runtime {
  constructor(hw, world, out) { Object.assign(this, { hw, world, out, state: 'stopped', gen: 0, vt: 0, timers: [], iter: 0, busy: false, lastError: null }); }

  compile(code) {
    const r = transpile(code);
    try { this.factory = new Function('__api', `with(__api){return (async function(){\n${r.js}\n;return {setup: typeof setup==='function'?setup:null, loop: typeof loop==='function'?loop:null};})}`); }
    catch (e) { r.error = e.message; this.factory = null; }
    return r;
  }

  async start(code) {
    this.stop();
    const r = this.compile(code);
    if (r.error) { this.state = 'error'; return r; }
    this.hw.resetMCU(); this.vt = 0; this.timers = []; this.lastError = null; this.serialLine = '';
    const gen = ++this.gen; this.state = 'running';
    this.out.sys('Upload complete. Hard resetting via RTS pin…'); // before the sketch prints anything, like a real upload
    let prog;
    try { prog = await this.factory(makeApi(this))(); }
    catch (e) { this.fail(e); return r; }
    this.main(prog, gen);
    return r;
  }
  async main(prog, gen) {
    try {
      if (prog.setup) { this.iter = 0; await prog.setup(); }
      while (this.gen === gen) { this.iter = 0; if (prog.loop) await prog.loop(); await this.sleep(1); }
    } catch (e) { if (this.gen === gen) this.fail(e); }
  }
  stop() { this.gen++; this.timers = []; if (this.state === 'running') this.state = 'stopped'; }
  fail(e) {
    this.state = 'error'; this.gen++; this.timers = [];
    const m = /<anonymous>:(\d+):(\d+)/.exec(e && e.stack || '');
    const line = m ? +m[1] - LINE_OFFSET : null;
    let msg = e && e.message || String(e);
    const nd = /^(\w+) is not defined$/.exec(msg);
    if (nd) msg = `'${nd[1]}' was not declared in this scope (or its library is not simulated)`;
    const nf = /^(.+) is not a function$/.exec(msg);
    if (nf) msg = `${nf[1]} is not a function the simulator knows`;
    this.lastError = { msg, line };
    this.out.sys(`Runtime error${line ? ' on line ' + line : ''}: ${msg}`, 'error');
    this.out.onError && this.out.onError(this.lastError);
  }
  sleep(ms) { return new Promise(res => this.timers.push({ due: this.vt + Math.max(0, +ms || 0), res })); }

  // Advance virtual time by `ms`, waking the sketch whenever its delay() ends. `step(sec)` moves physics.
  async advance(ms, step) {
    if (this.busy) return; this.busy = true;
    try {
      const end = this.vt + ms; let guard = 0;
      while (this.state === 'running' && guard++ < 600) {
        let bi = -1; for (let i = 0; i < this.timers.length; i++) if (bi < 0 || this.timers[i].due < this.timers[bi].due) bi = i;
        if (bi < 0 || this.timers[bi].due > end) break;
        const t = this.timers.splice(bi, 1)[0];
        if (t.due > this.vt) { step((t.due - this.vt) / 1000); this.vt = t.due; }
        this.iter = 0; t.res(); await macro();
      }
      if (end > this.vt) { step((end - this.vt) / 1000); this.vt = end; }
    } finally { this.busy = false; }
  }
}

function fmtNum(v, f) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v !== 'number') return String(v);
  if (Number.isNaN(v)) return 'nan';
  if (f === undefined) return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (Number.isInteger(v) && [2, 8, 16].includes(f)) return (v >>> 0).toString(f).toUpperCase();
  if (Number.isInteger(v) && f === 10) return String(v);
  return v.toFixed(f);
}
function printf(fmt, args) {
  let i = 0;
  return String(fmt).replace(/%([-0 +]*)(\d*)(?:\.(\d+))?(l{0,2}|h{0,2})([diufsxXc%])/g, (a, fl, w, p, len, t) => {
    if (t === '%') return '%';
    const v = args[i++]; let s;
    switch (t) {
      case 'd': case 'i': case 'u': s = String(Math.trunc(Number(v))); break;
      case 'f': s = Number(v).toFixed(p === undefined ? 6 : +p); break;
      case 'x': s = (Number(v) >>> 0).toString(16); break; case 'X': s = (Number(v) >>> 0).toString(16).toUpperCase(); break;
      case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : String(v)[0]; break;
      default: s = String(v); if (p !== undefined) s = s.slice(0, +p);
    }
    if (w) s = fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') && t !== 's' ? '0' : ' ');
    return s;
  });
}

function makeApi(rt) {
  const { hw, world, out } = rt, mcu = hw.mcu;
  const warnOnce = (k, msg) => { if (!hw.warned.has(k)) { hw.warned.add(k); out.sys(msg, 'warn'); } };
  const pin = p => { const id = ESP_GPIO_PIN[p]; if (!id) warnOnce('nopin' + p, `[sim] GPIO${p} does not exist on this board.`); return id; };
  let adcBits = 12, seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const noise = a => (Math.random() - 0.5) * 2 * a;

  const write = s => {
    rt.serialLine += s;
    let i; while ((i = rt.serialLine.indexOf('\n')) >= 0) { out.serial(rt.serialLine.slice(0, i).replace(/\r$/, '')); rt.serialLine = rt.serialLine.slice(i + 1); }
    if (rt.serialLine.length > 400) { out.serial(rt.serialLine); rt.serialLine = ''; }
  };
  const Serial = {
    begin() { }, end() { }, flush() { }, available: () => 0, read: () => -1, peek: () => -1,
    print: (v, f) => { const s = fmtNum(v, f); write(s); return s.length; },
    println: (v = '', f) => { const s = fmtNum(v, f) + '\n'; write(s); return s.length; },
    printf: (f, ...a) => { const s = printf(f, a); write(s); return s.length; },
    write: v => { write(typeof v === 'number' ? String.fromCharCode(v) : String(v)); return 1; },
  };

  class DHT {
    constructor(p, type = 22) { this.pin = p; this.type = type; this.started = false; }
    begin() { this.started = true; }
    _ok() {
      const ok = this.started && hw.gpioOn('dht.DATA') === this.pin && hw.vcc('dht') >= 3;
      if (!ok) warnOnce('dht' + this.pin, this.started ? `[sim] DHT on GPIO${this.pin}: no sensor answered (check the DATA wire and power). Reads return NaN.` : '[sim] dht.begin() was never called. Reads return NaN.');
      return ok;
    }
    readTemperature(f = false) { if (!this._ok()) return NaN; let t = Math.min(80, world.temp + noise(0.08)); t = this.type === 11 ? Math.round(t) : Math.round(t * 10) / 10; return f ? t * 1.8 + 32 : t; }
    readHumidity() { if (!this._ok()) return NaN; const h = world.hum + noise(0.3); return this.type === 11 ? Math.round(h) : Math.round(h * 10) / 10; }
    computeHeatIndex(t) { return t; }
  }

  class LiquidCrystal_I2C {
    constructor(addr = 0x27, cols = 16, rows = 2) { this.addr = addr; this.cols = cols; this.rowsN = rows; }
    _link() {
      const { sda, scl } = mcu.i2c;
      const ok = this.addr === 0x27 && hw.gpioOn('lcd.SDA') === sda && hw.gpioOn('lcd.SCL') === scl && hw.vcc('lcd') >= 3;
      if (!ok) warnOnce('lcd', `[sim] I2C: nothing answered at 0x${this.addr.toString(16).toUpperCase()} on SDA=GPIO${sda}, SCL=GPIO${scl}.` + (this.addr !== 0x27 ? ' This LCD backpack is at 0x27.' : ' Check the LCD wires and power.'));
      return ok;
    }
    init() { if (this._link()) { hw.lcd.init = true; this.clear(); } }
    begin() { this.init(); }
    backlight() { if (this._link()) hw.lcd.backlight = true; }
    noBacklight() { if (this._link()) hw.lcd.backlight = false; }
    clear() { if (this._link()) { hw.lcd.rows = hw.lcd.rows.map(() => ' '.repeat(20)); hw.lcd.cx = hw.lcd.cy = 0; } }
    home() { if (this._link()) hw.lcd.cx = hw.lcd.cy = 0; }
    setCursor(c, r) { if (this._link()) { hw.lcd.cx = c | 0; hw.lcd.cy = r | 0; } }
    print(v, f) {
      const s = fmtNum(v, f);
      if (!this._link() || !hw.lcd.init) return s.length;
      const L = hw.lcd;
      for (const ch of s) {
        if (L.cy >= 0 && L.cy < 4 && L.cx >= 0 && L.cx < 20) L.rows[L.cy] = L.rows[L.cy].slice(0, L.cx) + ch + L.rows[L.cy].slice(L.cx + 1);
        L.cx++;
        if (L.cx >= 20) { L.cx = 0; L.cy = { 0: 2, 2: 1, 1: 3, 3: 0 }[L.cy] ?? 0; } // HD44780 line order
      }
      return s.length;
    }
    write(c) { return this.print(typeof c === 'number' ? String.fromCharCode(c) : c); }
    cursor() { } noCursor() { } blink() { } noBlink() { } display() { } noDisplay() { } createChar() { } scrollDisplayLeft() { } scrollDisplayRight() { }
  }

  // Adafruit PWM Servo Driver library (PCA9685, I2C address 0x40 by default)
  class Adafruit_PWMServoDriver {
    constructor(addr = 0x40) { this.addr = addr; this.freq = 200; }
    _link() {
      const { sda, scl } = mcu.i2c;
      const id = hw.active && hw.active.has('pcas') ? 'pcas' : 'pca'; // breakout or servo shield: same chip
      const ok = this.addr === 0x40 && hw.gpioOn(id + '.SDA') === sda && hw.gpioOn(id + '.SCL') === scl && hw.vcc(id) >= 2.3;
      if (!ok) warnOnce('pca', `[sim] I2C: no PCA9685 answered at 0x${this.addr.toString(16).toUpperCase()} on SDA=GPIO${sda}, SCL=GPIO${scl}.` + (this.addr !== 0x40 ? ' This board is at 0x40.' : ' Check its SDA/SCL wires and power.'));
      return ok;
    }
    begin() { this._link(); }
    setPWMFreq(f) { this.freq = f; } setOscillatorFrequency() { } sleep() { } wakeup() { } reset() { if (this._link()) hw.pca.fill(0); }
    setPWM(ch, on, off) {
      if (ch < 0 || ch > 15 || !this._link()) return;
      hw.pca[ch] = off >= 4096 ? 0 : on >= 4096 ? 1 : (((off - on) % 4096) + 4096) % 4096 / 4096;
    }
    setPin(ch, val, invert = false) { if (ch < 0 || ch > 15 || !this._link()) return; let d = Math.max(0, Math.min(4095, val)) / 4095; if (invert) d = 1 - d; hw.pca[ch] = d; }
  }

  const color = (r, g, b) => (((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
  class Adafruit_NeoPixel {
    constructor(n = 8, p = -1) { this.n = n; this.pin = p; this.buf = new Array(n).fill(0); this.br = 255; this.started = false; }
    static Color(r, g, b) { return color(r, g, b); }
    Color(r, g, b) { return color(r, g, b); }
    ColorHSV(h = 0, s = 255, v = 255) { h = (h % 65536) / 65536 * 6; const i = Math.floor(h), f = h - i, S = s / 255, V = v / 255, p = V * (1 - S), q = V * (1 - S * f), t = V * (1 - S * (1 - f)); const [r, g, b] = [[V, t, p], [q, V, p], [p, V, t], [p, q, V], [t, p, V], [V, p, q]][i % 6]; return color(r * 255, g * 255, b * 255); }
    gamma32(c) { return c; }
    begin() { this.started = true; }
    setPin(p) { this.pin = p; }
    numPixels() { return this.n; }
    setBrightness(b) { this.br = Math.max(0, Math.min(255, b | 0)); }
    getBrightness() { return this.br; }
    setPixelColor(i, r, g, b) { if (i < 0 || i >= this.n) return; this.buf[i] = g === undefined ? r >>> 0 : color(r, g, b); }
    getPixelColor(i) { return this.buf[i] || 0; }
    fill(c = 0, first = 0, count = 0) { const e = count ? Math.min(this.n, first + count) : this.n; for (let i = first; i < e; i++) this.buf[i] = c >>> 0; }
    clear() { this.buf.fill(0); }
    show() {
      if (!this.started) { warnOnce('neobegin', '[sim] strip.begin() was never called; show() does nothing.'); return; }
      if (hw.gpioOn('led.DIN') !== this.pin || hw.vcc('led') < 3) { warnOnce('neo' + this.pin, `[sim] LED stick: no data arriving from GPIO${this.pin} (check DIN wire and power).`); return; }
      const k = (this.br + 1) / 256;
      for (let i = 0; i < 8; i++) { if (i >= this.n) break; const c = this.buf[i] || 0; hw.pixels[i] = color(((c >> 16) & 255) * k, ((c >> 8) & 255) * k, (c & 255) * k); }
    }
  }

  const level = (p, v) => { const prev = mcu.level[p] || 0; mcu.level[p] = v ? 1 : 0; hw.pinWrite(p, mcu.level[p], prev); };
  const setOut = (p, v) => { if (!pin(p)) return; mcu.mode[p] = 'OUTPUT'; level(p, v); };
  const ledcCh = {};
  const api = {
    HIGH: 1, LOW: 0, INPUT: 1, OUTPUT: 3, INPUT_PULLUP: 5, INPUT_PULLDOWN: 9, LED_BUILTIN: 2,
    DHT11: 11, DHT22: 22, DHT21: 21, AM2301: 21, NEO_GRB: 0x52, NEO_RGB: 0x06, NEO_RGBW: 0x1B, NEO_KHZ800: 0, NEO_KHZ400: 0x100,
    DEC: 10, HEX: 16, BIN: 2, OCT: 8, PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI,
    A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, ADC_0db: 0, ADC_2_5db: 1, ADC_6db: 2, ADC_11db: 3, WL_CONNECTED: 3, WIFI_STA: 1,
    Serial, DHT, LiquidCrystal_I2C, Adafruit_NeoPixel, Adafruit_PWMServoDriver,
    Wire: { begin(sda, scl) { if (sda != null && scl != null) mcu.i2c = { sda, scl }; }, setClock() { } },
    WiFi: { begin() { warnOnce('wifi', '[sim] Wi-Fi is not simulated; pretending to be connected.'); }, status: () => 3, mode() { }, disconnect() { }, localIP: () => '192.168.4.2', RSSI: () => -55 },
    pinMode(p, m) {
      if (!pin(p)) return;
      if (m === 3) { if (INPUT_ONLY.includes(p)) warnOnce('io' + p, `[sim] GPIO${p} is input-only; pinMode(OUTPUT) has no effect.`); else { mcu.mode[p] = 'OUTPUT'; mcu.level[p] = mcu.level[p] || 0; } }
      else { mcu.mode[p] = 'INPUT'; mcu.pull = mcu.pull || {}; mcu.pull[p] = m === 5 ? 'up' : m === 9 ? 'down' : null; }
    },
    digitalWrite(p, v) {
      if (!pin(p)) return;
      if (mcu.mode[p] !== 'OUTPUT') { warnOnce('dw' + p, `[sim] digitalWrite(${p}) without pinMode(${p}, OUTPUT): the pin does not change.`); return; }
      level(p, v);
    },
    MSBFIRST: 1, LSBFIRST: 0,
    // pulseIn(pin, HIGH, timeoutUs): length of the next HIGH pulse in µs, 0 on timeout (used for the HC-SR04 ECHO)
    pulseIn(p, state = 1, timeout = 1000000) {
      if (!pin(p)) return 0;
      if (mcu.mode[p] === 'OUTPUT') { warnOnce('pio' + p, `[sim] pulseIn(${p}) on a pin set to OUTPUT; use pinMode(${p}, INPUT).`); return 0; }
      if (state !== 1) return 0;
      const r = hw.echo(p);
      if (r.us == null) { warnOnce('echo' + p + r.why, `[sim] pulseIn(${p}) timed out: ${r.why}.`); return 0; }
      const us = Math.round(r.us + noise(4));
      return us > timeout ? 0 : us;
    },
    shiftOut(d, c, order, v) {
      if (mcu.mode[d] !== 'OUTPUT' || mcu.mode[c] !== 'OUTPUT') { warnOnce('so' + d + c, `[sim] shiftOut(${d}, ${c}, …): set both pins to OUTPUT with pinMode() first.`); return; }
      for (let i = 0; i < 8; i++) { level(d, order === 0 ? (v >> i) & 1 : (v >> (7 - i)) & 1); level(c, 1); level(c, 0); }
    },
    digitalRead(p) {
      const id = pin(p); if (!id) return 0;
      if (mcu.mode[p] === 'OUTPUT') return mcu.level[p] ? 1 : 0;
      const v = hw.netV(id);
      if (v == null) { const pl = mcu.pull && mcu.pull[p]; return pl === 'up' ? 1 : pl === 'down' ? 0 : (Math.random() < 0.5 ? 1 : 0); }
      return v > 1.65 ? 1 : 0;
    },
    analogRead(p) {
      const id = pin(p); if (!id) return 0;
      if (!ADC1.includes(p) && !ADC2.includes(p)) { warnOnce('adc' + p, `[sim] GPIO${p} has no ADC; analogRead returns 0.`); return 0; }
      let v = mcu.mode[p] === 'OUTPUT' ? (mcu.level[p] ? 3.3 : 0) : hw.netV(id);
      if (v == null) v = 0.15 + Math.random() * 0.3;
      if (v > 3.6) warnOnce('ov' + p, `[sim] GPIO${p} is seeing ${v.toFixed(2)} V. Above 3.6 V damages a real ESP32.`);
      const max = (1 << adcBits) - 1;
      return Math.max(0, Math.min(max, Math.round(v / 3.3 * max + noise(max / 512))));
    },
    analogReadResolution(b) { adcBits = Math.max(9, Math.min(12, b | 0)); }, analogSetAttenuation() { }, analogSetPinAttenuation() { },
    analogWrite(p, v) { setOut(p, v > 0); },
    tone(p, f, d) { setOut(p, 1); if (d) rt.sleep(d).then(() => { mcu.level[p] = 0; }); }, noTone(p) { setOut(p, 0); },
    ledcSetup() { }, ledcAttachPin(p, ch) { ledcCh[ch] = p; setOut(p, 0); }, ledcAttach(p) { setOut(p, 0); return true; },
    ledcWrite(pc, duty) { const p = ledcCh[pc] ?? pc; setOut(p, duty > 0); }, ledcWriteTone(pc, f) { const p = ledcCh[pc] ?? pc; setOut(p, f > 0); },
    millis: () => Math.floor(rt.vt), micros: () => Math.floor(rt.vt * 1000),
    delay: ms => rt.sleep(ms), delayMicroseconds: us => rt.sleep(us / 1000), yield() { },
    map: (x, a, b, c, d) => Math.trunc((x - a) * (d - c) / (b - a) + c),
    constrain: (x, a, b) => Math.min(b, Math.max(a, x)), min: Math.min, max: Math.max, abs: Math.abs, fabs: Math.abs, sq: x => x * x,
    pow: Math.pow, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    exp: Math.exp, log: Math.log, log10: Math.log10, isnan: Number.isNaN, isinf: x => !Number.isFinite(x) && !Number.isNaN(x),
    random: (a, b) => b === undefined ? Math.floor(rnd() * a) : a + Math.floor(rnd() * (b - a)), randomSeed: s => { seed = (Math.abs(s | 0) % 2147483646) + 1; },
    F: s => s,
    __S: (v, f) => fmtNum(v, f),
    __int: v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; },
    __g: () => { if (++rt.iter > 200000) throw new Error('A loop ran 200000 times without delay(). On a real ESP32 the watchdog would reset the board here.'); },
  };
  return api;
}
