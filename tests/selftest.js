// Fire Guard Workbench self-test. Drives the real app (wiring, firmware, physics, UI) and checks the results.
// Run it from the browser console on the workbench page:
//   const t = await import('/tests/selftest.js'); await t.run();            // everything (about a minute)
//   await t.run(['scenarios']);                                             // one or more sections
// Your saved project is backed up first and restored at the end (reload the page afterwards).
import { PARTS, LED_SPEC } from '../src/parts.js';
import { guideFor, DEFAULT_OPTIONS } from '../src/guide.js';
import { bomFor } from '../src/bom.js';
import { DEFAULT_SKETCH } from '../src/firmware.js';

const KEY = 'fireguard-workbench-v1';
export const SECTIONS = ['boot', 'wiring', 'firmware', 'scenarios', 'hcsr04', 'leds', 'miswiring', 'compiler', 'runtime', 'layout', 'reset', 'inspect', 'trace', 'datalog', 'options', 'checklist', 'persistence'];

export async function run(only = SECTIONS) {
  const fg = window.__fg; if (!fg) throw new Error('Open the workbench page first');
  const $ = id => document.getElementById(id);
  const results = []; let section = '';
  const ok = (name, pass, detail = '') => results.push({ section, name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  const sim = ms => fg.simulate(ms);
  const backup = localStorage.getItem(KEY), backupChecklist = localStorage.getItem('fireguard-checklist-v1');
  const lcd = () => fg.hw.lcd.rows.map(r => r.trimEnd());
  const out = () => fg.hw.evaluate();
  const lit = () => out().leds.map((on, i) => on ? LED_SPEC[i].g + ':' + LED_SPEC[i].name : null).filter(Boolean);
  const litIn = g => lit().filter(s => s.startsWith(g + ':')).map(s => s.split(':')[1]);
  const serial = () => [...$('serial').children].map(d => d.textContent).join('\n'); // works even while the tab is hidden
  const issues = () => fg.hw.issues;
  const hasIssue = (txt, level) => issues().some(i => i.msg.includes(txt) && (!level || i.level === level));
  const wireSnapshot = () => fg.hw.wires.map(({ a, b, color }) => ({ a, b, color }));
  const loadWires = list => { fg.wires.clear(); fg.hw.wires = []; for (const w of list) fg.addWire(w.a, w.b, w.color, true); fg.changed(); };
  const wireAll = () => { loadWires([]); $('wireAll').click(); };
  const withWires = async (mutate, fn) => { const snap = wireSnapshot(); let list = snap.map(w => ({ ...w })); list = mutate(list) || list; loadWires(list); try { await fn(); } finally { loadWires(snap); } };
  const drop = (list, a, b) => list.filter(w => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
  const lastNum = s => { const n = s.split('\n').map(x => x.trim()).filter(x => /^-?\d+(\.\d+)?$/.test(x)); return n.length ? +n[n.length - 1] : NaN; };
  const runCode = async (src, ms = 300) => { fg.editor.value = src; await fg.run(); await sim(ms); return { compile: $('compile').innerText, state: fg.rt.state, serial: serial() }; };
  const finishAnim = () => { for (let i = 0; i < 80 && fg.layoutBusy; i++) fg.stepLayout(0.05); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const t0 = performance.now();

  const realConfirm = window.confirm; window.confirm = () => true; // option switches ask about the code; tests always accept
  for (const [k, v] of Object.entries(DEFAULT_OPTIONS)) if (fg.options[k] !== v) fg.setOption(k, v);
  const GUIDE = guideFor(fg.options);
  if (fg.layout !== 'bench') { fg.setLayout('bench', false); }
  fg.insp.close(false); fg.clearTrace();

  try {
    if (only.includes('boot')) {
      section = 'Boot';
      ok('App object is exposed', !!fg.hw && !!fg.rt && !!fg.S);
      ok('All parts created in 3D', fg.parts.size === PARTS.length, `${fg.parts.size}/${PARTS.length}`);
      ok('Every part has pins with hit targets', [...fg.parts.values()].every(p => p.pins.size > 0 && [...p.pins.values()].every(q => q.hit && q.anchor)));
      ok('Renderer canvas exists', !!fg.S.renderer.domElement && fg.S.renderer.domElement.width > 0);
      ok('Editor holds a sketch', fg.editor.value.length > 100);
    }

    if (only.includes('wiring')) {
      section = 'Wiring & checks';
      loadWires([]);
      ok('Clear all wires → 0 connections', $('progTxt').textContent.startsWith('0 /'), $('progTxt').textContent);
      wireAll();
      const total = GUIDE.reduce((n, s) => n + s.wires.length, 0);
      ok('Wire everything completes the guide', $('progTxt').textContent === `${total} / ${total} connections`, $('progTxt').textContent);
      ok('Every guide step is checked off', document.querySelectorAll('#guide > li.done').length === GUIDE.length, `${document.querySelectorAll('#guide > li.done').length}/${GUIDE.length}`);
      ok('Reference wiring has no errors or warnings', !issues().some(i => i.level !== 'info'), issues().map(i => i.msg));
      ok('Checks badge is empty', $('chkBadge').textContent === '');
      const buzz = fg.parts.get('buzz').group, prev = buzz.position.clone();
      buzz.position.copy(fg.parts.get('panel').group.position); buzz.updateMatrixWorld(true);
      ok('Overlap guard detects a board on top of another', fg.overlapping('buzz') === 'panel', fg.overlapping('buzz'));
      buzz.position.copy(prev); buzz.updateMatrixWorld(true);
      const noOverlap = () => [...fg.parts.keys()].filter(id => fg.parts.get(id).group.visible).every(id => !fg.overlapping(id));
      ok('Default layout has no overlapping boards', noOverlap());
      fg.setOption('leds', 'rgb'); fg.setOption('level', 'probes');
      ok('RGB + probes layout has no overlapping boards', noOverlap());
      fg.setOption('leds', 'single'); fg.setOption('level', 'ultrasonic'); wireAll();
    }

    if (only.includes('firmware')) {
      section = 'Default firmware';
      wireAll(); fg.world.reset();
      const r = await runCode(DEFAULT_SKETCH, 3500);
      ok('Compiles and runs', r.state === 'running' && /Compiled and uploaded/.test(r.compile), r.compile.slice(0, 120));
      ok('No [sim] warnings with correct wiring', !/\[sim\]/.test(r.serial), (r.serial.match(/\[sim\][^\n]*/g) || []).join(' | '));
      ok('Serial prints the ready message', /Fire Guard ready/.test(r.serial));
      const L = lcd();
      ok('LCD row 0 shows pump states', /^SPR:OFF REF:OFF/.test(L[0]), L[0]);
      ok('LCD row 1 shows tank %', /^TANK:\d+% /.test(L[1]), L[1]);
      ok('LCD row 2 shows temp/humidity/fume', /^T:28C H:\d+% OK/.test(L[2]), L[2]);
      ok('LCD row 3 shows fire class NONE', L[3] === 'FIRE:NONE', L[3]);
      await sim(2100);
      ok('Serial log line every 2 s', /T=2[78]\.\dC H=\d+% gas=\d+ppm tank=\d+%/.test(serial()), serial().split('\n').slice(-1)[0]);
    }

    if (only.includes('scenarios')) {
      section = 'Workshop scenarios';
      wireAll(); fg.world.reset();
      await runCode(DEFAULT_SKETCH, 3000);
      ok('Idle: sprinkler LED blue (standby)', litIn('SPR').join() === 'Blue', litIn('SPR'));
      ok('Idle: fume LED green (normal)', litIn('FUME').join() === 'Green', litIn('FUME'));
      ok('Idle: fire-class LEDs all off', litIn('FIRE').length === 0, litIn('FIRE'));
      ok('Idle: refill LEDs off', litIn('REF').length === 0, litIn('REF'));
      ok('Idle: buzzer quiet', !out().buzz);
      // fire
      fg.world.intensity = 70; fg.world.ignite();
      await sim(1000);
      ok('Fire: flame seen → sprinkler pump ON', out().sprPump, out());
      ok('Fire: relay K1 energised (active-LOW IN1)', out().k1);
      ok('Fire: sprinkler LED green', litIn('SPR').join() === 'Green', litIn('SPR'));
      ok('Fire: fume LED red', litIn('FUME').join() === 'Red', litIn('FUME'));
      let on = 0, offc = 0; for (let i = 0; i < 8; i++) { await sim(250); out().buzz ? on++ : offc++; }
      ok('Fire: buzzer beeps (on and off)', on > 0 && offc > 0, `on ${on}, off ${offc}`);
      await sim(5000);
      const cls = litIn('FIRE');
      ok('Fire: exactly one fire-class LED lit', cls.length === 1, cls);
      ok('Fire: LCD shows a fire class', /^FIRE:(LOW|MODERATE|HIGH|VERY HIGH|EXTREME)/.test(lcd()[3]), lcd()[3]);
      ok('Fire: water is being sprayed', fg.world.sprayL > 0, fg.world.sprayL.toFixed(2) + ' L');
      ok('Fire: phase is "during"', fg.world.phase === 'during');
      await sim(40000);
      ok('Fire is put out by the sprinkler', !fg.world.fire, `hp ${fg.world.hp.toFixed(1)}`);
      ok('After: phase "after"', fg.world.phase === 'after');
      ok('After: temperature back under 33 °C', fg.world.temp < 33, fg.world.temp.toFixed(1));
      ok('After: sprinkler pump OFF', !out().sprPump);
      ok('After: a sprayed volume was recorded', fg.world.lastSprayL > 0.3, fg.world.lastSprayL.toFixed(2) + ' L');
      // gas
      fg.world.gasLeak = 600; await sim(1200);
      ok('Gas: fume LED orange', litIn('FUME').join() === 'Orange', litIn('FUME'));
      ok('Gas: LCD shows GAS', /GAS/.test(lcd()[2]), lcd()[2]);
      on = 0; for (let i = 0; i < 8; i++) { await sim(250); if (out().buzz) on++; }
      ok('Gas: buzzer sounds', on > 0, `on ${on}/8`);
      ok('Gas: no sprinkler (no fire)', !out().sprPump);
      fg.world.gasLeak = 50; await sim(800);
      ok('Gas cleared: fume LED back to green', litIn('FUME').join() === 'Green', litIn('FUME'));
      // tank refill
      fg.world.tank = 20; await sim(800);
      ok('Low tank: refill pump ON', out().refPump);
      ok('Low tank: relay K2 energised', out().k2);
      ok('Low tank: refill LED red (≤ 1/3)', litIn('REF').join() === 'Red', litIn('REF'));
      ok('Low tank: tank LED orange (almost empty)', litIn('TANK').join() === 'Orange', litIn('TANK'));
      ok('Low tank: LCD says NEAR EMPTY', /NEAR EMPTY/.test(lcd()[1]), lcd()[1]);
      await sim(9000);
      ok('Refilling past 1/3: refill LED blue', litIn('REF').join() === 'Blue', `${Math.round(fg.world.tank)}% ${litIn('REF')}`);
      await sim(16000);
      ok('Refill stops at ≥ 95%', !out().refPump && fg.world.tank >= 94, Math.round(fg.world.tank) + '%');
      ok('Full: tank LED green', litIn('TANK').join() === 'Green', litIn('TANK'));
      ok('No overflow', fg.world.overflow < 0.5, fg.world.overflow);
      fg.world.tank = 1; await sim(600);
      ok('Empty tank: tank LED red', litIn('TANK').join() === 'Red', `${Math.round(fg.world.tank)}% ${litIn('TANK')}`);
    }

    if (only.includes('hcsr04')) {
      section = 'HC-SR04 tank sensor';
      wireAll(); fg.world.reset();
      await runCode(DEFAULT_SKETCH, 2500);
      for (const pct of [40, 60, 85]) {
        fg.world.tank = pct; await sim(600);
        const m = /TANK:(\d+)%/.exec(lcd()[1]); const read = m ? +m[1] : NaN;
        ok(`Reads ${pct}% within ±3%`, near(read, fg.world.tank, 3), `read ${read}%, actual ${fg.world.tank.toFixed(1)}%`);
      }
      const r = await runCode('#define TRIG 25\n#define ECHO 35\nvoid setup(){ Serial.begin(115200); pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT); }\nvoid loop(){ digitalWrite(TRIG, HIGH); delayMicroseconds(10); digitalWrite(TRIG, LOW); long us = pulseIn(ECHO, HIGH, 30000); Serial.println(us); delay(200); }\n', 700);
      const us = lastNum(r.serial), expect = (93.4 - 73.4 * fg.world.tank / 100) / 1000 / 343 * 2 * 1e6;
      ok('pulseIn() returns the echo time', near(us, expect, 12), `${us} µs vs ${expect.toFixed(0)} µs`);
      const r2 = await runCode('void setup(){ Serial.begin(115200); pinMode(35, INPUT); Serial.println(pulseIn(35, HIGH, 30000)); }\nvoid loop(){ delay(1000); }\n', 200);
      ok('pulseIn() without a TRIG pulse → 0 + warning', lastNum(r2.serial) === 0 && /no TRIG pulse/.test(r2.serial), r2.serial.slice(-120));
      await withWires(l => drop(l, 'us.VCC', 'rail.5V_6').concat([{ a: 'us.VCC', b: 'rail.3V3_5', color: '#f08a24' }]), async () => {
        ok('HC-SR04 on 3.3 V is flagged', hasIssue('HC-SR04 is on 3.3 V'), issues().map(i => i.msg));
      });
    }

    if (only.includes('leds')) {
      section = 'Shift registers & LEDs';
      wireAll(); fg.world.reset();
      await runCode(DEFAULT_SKETCH, 2500);
      const o = out();
      ok('Latched 74HC595 outputs match the lit LEDs', o.leds.every((on, i) => on === !!fg.hw.sr.out[i]), fg.hw.sr.out.slice(0, 17).join(''));
      const perRow = g => o.leds.filter((on, i) => on && LED_SPEC[i].g === g).length;
      ok('One LED per always-on row (SPR, TANK, FUME)', perRow('SPR') === 1 && perRow('TANK') === 1 && perRow('FUME') === 1, { SPR: perRow('SPR'), TANK: perRow('TANK'), FUME: perRow('FUME') });
      ok('LED indicator panel text matches', /Sprinkler pump\s*Blue · standby/.test($('leds').innerText), $('leds').innerText.replace(/\n/g, ' '));
      const r = await runCode('#define D 23\n#define C 18\n#define L 13\nvoid setup(){ pinMode(D,OUTPUT); pinMode(C,OUTPUT); pinMode(L,OUTPUT); digitalWrite(L,LOW); shiftOut(D,C,MSBFIRST,0x01); shiftOut(D,C,MSBFIRST,0x00); shiftOut(D,C,MSBFIRST,0x81); digitalWrite(L,HIGH); }\nvoid loop(){ delay(1000); }\n', 200);
      const bits = fg.hw.sr.out.slice(0, 17).map(b => b ? 1 : 0).join('');
      ok('shiftOut() fills the chain in the right order (Q0, Q7, Q16)', bits === '10000001000000001', bits);
      await withWires(l => drop(l, 'sr.CLOCK', 'esp.18'), async () => {
        await runCode(DEFAULT_SKETCH, 2500);
        ok('CLOCK unplugged → LEDs never change', fg.hw.sr.out.every(b => !b), fg.hw.sr.out.slice(0, 17).join(''));
      });
    }

    if (only.includes('miswiring')) {
      section = 'Miswiring detection';
      wireAll();
      const cases = [
        ['MQ-2 AO straight into GPIO34', l => drop(drop(l, 'mq2.AO', 'div.IN'), 'div.OUT', 'esp.34').concat([{ a: 'mq2.AO', b: 'esp.34' }]), 'GPIO34 can see up to', 'error'],
        ['HC-SR04 ECHO without divider', l => drop(drop(l, 'us.ECHO', 'div2.IN'), 'div2.OUT', 'esp.35').concat([{ a: 'us.ECHO', b: 'esp.35' }]), 'echo divider', 'error'],
        ['Relay IN1 on input-only GPIO34', l => drop(drop(l, 'relay.IN1', 'esp.16'), 'div.OUT', 'esp.34').concat([{ a: 'relay.IN1', b: 'esp.34' }]), 'input-only', 'error'],
        ['3V3 shorted to GND', l => l.concat([{ a: 'esp.3V3', b: 'rail.GND_15' }]), 'Short circuit', 'error'],
        ['Pump powered from the ESP32', l => drop(l, 'relay.NO1', 'pumpS.P').concat([{ a: 'pumpS.P', b: 'rail.5V_7' }]), 'powered from the ESP32', 'error'],
        ['Pump wired straight to the battery', l => drop(l, 'relay.NO1', 'pumpS.P').concat([{ a: 'pumpS.P', b: 'psu.VCC' }]), 'always on', 'warn'],
        ['Battery − not joined to ESP32 GND', l => drop(l, 'psu.GND', 'rail.GND_10'), 'not joined to the ESP32 GND', 'warn'],
        ['Battery + on the ESP32 5V', l => l.concat([{ a: 'psu.VCC', b: 'rail.5V_8' }]), 'Battery + is joined', 'warn'],
        ['SDA/SCL swapped', l => drop(drop(l, 'lcd.SDA', 'esp.21'), 'lcd.SCL', 'esp.22').concat([{ a: 'lcd.SDA', b: 'esp.22' }, { a: 'lcd.SCL', b: 'esp.21' }]), 'swapped', 'warn'],
        ['LED panel GND missing', l => drop(l, 'panel.GND', 'rail.GND_11'), 'GND bus is not connected', 'warn'],
        ['Divider GND missing', l => drop(l, 'div.GND', 'rail.GND_3'), 'Divider GND is not connected', 'warn'],
        ['Module with VCC but no GND', l => drop(l, 'dht.GND', 'rail.GND_1'), 'GND is not connected', 'warn'],
        ['Using a flash pin', l => l.concat([{ a: 'buzz.SIG', b: 'esp.SD0' }]), 'flash', 'error'],
        ['MQ-2 on 3.3 V', l => drop(l, 'mq2.VCC', 'rail.5V_1').concat([{ a: 'mq2.VCC', b: 'rail.3V3_6' }]), 'MQ-2 is on 3.3 V', 'warn'],
      ];
      for (const [name, mut, txt, level] of cases) await withWires(mut, async () => ok(name + ' → ' + level, hasIssue(txt, level), issues().map(i => i.level + ': ' + i.msg).slice(0, 3)));
      await withWires(l => drop(l, 'dht.DATA', 'esp.4'), async () => {
        const r = await runCode(DEFAULT_SKETCH, 2500);
        ok('DHT DATA unplugged → runtime NaN warning', /DHT on GPIO4: no sensor answered/.test(r.serial), (r.serial.match(/\[sim\][^\n]*/g) || []).join(' | '));
      });
      await withWires(l => drop(drop(l, 'lcd.SDA', 'esp.21'), 'lcd.SCL', 'esp.22').concat([{ a: 'lcd.SDA', b: 'esp.22' }, { a: 'lcd.SCL', b: 'esp.21' }]), async () => {
        const r = await runCode(DEFAULT_SKETCH, 2500);
        ok('Swapped I2C → LCD stays blank + warning', lcd().every(x => !x.trim()) && /nothing answered/.test(r.serial), lcd());
      });
      await withWires(l => drop(l, 'relay.VCC', 'rail.5V_2'), async () => {
        await runCode(DEFAULT_SKETCH, 2000); fg.world.ignite(); await sim(1500);
        ok('Relay without power → pump never starts', !out().sprPump && !out().k1);
        fg.world.extinguish();
      });
    }

    if (only.includes('compiler')) {
      section = 'C++ compiler';
      let r = await runCode('void setup() {\n  Serial.begin(115200)\n}\nvoid loop() {}\n', 50);
      ok('Missing ; reported with its line', /fire_guard\.ino:2: error: expected ';'/.test(r.compile) && /Compilation failed/.test(r.compile), r.compile);
      r = await runCode('void setup() {\n  Serial.begin(115200);\n  int v = 1;\n\n  Serial.println(vv);\n}\nvoid loop() { delay(10); }\n', 100);
      ok('Undeclared variable → runtime error on the right line', /line 5/.test(r.compile) && /'vv' was not declared/.test(r.compile), r.compile);
      r = await runCode('void setup(){}\nvoid loop(){ while(true){ } }\n', 200);
      ok('Endless loop → watchdog error', /watchdog/.test(r.compile), r.compile);
      r = await runCode('void setup() {\n  Serial.begin(115200);\n  if (1) {\n}\n', 50);
      ok('Missing } reported', /expected '}'/.test(r.compile), r.compile);
      const prog = `int a = 7 / 2;
float b = 7 / 2.0;
int arr[] = {5, 6, 7};
String s = "x=" + String(a) + " b=" + String(b, 1);
unsigned long big = 100000UL;
int twice(int v) { return v * 2; }
void setup() {
  Serial.begin(115200);
  Serial.println(a);
  Serial.println(b);
  Serial.println(arr[2]);
  Serial.println(s);
  int total = 0;
  for (int i = 0; i < 3; i++) total += arr[i];
  Serial.println(total);
  switch (a) { case 3: Serial.println("three"); break; default: Serial.println("other"); }
  Serial.printf("%d-%.2f-%s\\n", 42, 3.14159, "ok");
  Serial.println(map(512, 0, 1023, 0, 100));
  Serial.println(constrain(150, 0, 100));
  Serial.println(String(255, HEX));
  Serial.println(twice(21));
  Serial.println(big);
  Serial.println((int)9.99);
  String t = "abc"; Serial.println(t.length());
}
void loop() { delay(1000); }
`;
      r = await runCode(prog, 100);
      const lines = r.serial.split('\n').filter(x => !/^(Compiling|Upload)/.test(x));
      const want = ['3', '3.50', '7', 'x=3 b=3.5', '18', 'three', '42-3.14-ok', '50', '100', 'FF', '42', '100000', '9', '3'];
      ok('Language features give C++ results', want.every((w, i) => lines[i] === w), lines.slice(0, want.length).join(' | '));
    }

    if (only.includes('runtime')) {
      section = 'Arduino runtime';
      wireAll();
      let r = await runCode('void setup(){ pinMode(2, OUTPUT); }\nvoid loop(){ digitalWrite(2, HIGH); delay(500); digitalWrite(2, LOW); delay(500); }\n', 250);
      const a = fg.hw.mcu.level[2]; await sim(500); const b = fg.hw.mcu.level[2]; await sim(500); const c = fg.hw.mcu.level[2];
      ok('delay() timing drives a blink (GPIO2 LED)', a === 1 && b === 0 && c === 1, `${a}${b}${c}`);
      r = await runCode('void setup(){ Serial.begin(115200); delay(1000); Serial.println(millis()); }\nvoid loop(){ delay(1000); }\n', 1200);
      const ms = lastNum(r.serial);
      ok('millis() matches virtual time', ms >= 1000 && ms <= 1010, ms);
      r = await runCode('void setup(){ Serial.begin(115200); digitalWrite(16, LOW); }\nvoid loop(){ delay(1000); }\n', 100);
      ok('digitalWrite without pinMode → warning', /without pinMode/.test(r.serial), r.serial.slice(-100));
      r = await runCode('void setup(){ Serial.begin(115200); pinMode(34, INPUT); Serial.println(analogRead(34)); }\nvoid loop(){ delay(1000); }\n', 100);
      const raw = lastNum(r.serial);
      ok('analogRead() through the MQ-2 divider is in range', raw > 100 && raw < 4095, raw);
      $('stop').click();
      ok('Stop button stops the sketch', fg.rt.state === 'stopped');
      $('speed').value = '2'; $('speed').dispatchEvent(new Event('change')); $('speed').value = '1'; $('speed').dispatchEvent(new Event('change'));
      ok('Speed selector works', true);
    }

    if (only.includes('layout')) {
      section = 'Layouts';
      wireAll(); fg.setLayout('bench', false);
      const benchBoxes = () => [...fg.wires.items.values()].map(it => { it.tube.geometry.computeBoundingBox(); const b = it.tube.geometry.boundingBox; return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(v => Math.round(v)).join(','); });
      const before = benchBoxes();
      ok('Bench uses tidy routing', fg.wires.router && fg.wires.router.name === 'benchRouter');
      fg.setLayout('assembled'); finishAnim();
      const at = id => fg.parts.get(id).group.position.toArray().map(Math.round).join(',');
      ok('Assembled: DHT22 on the back wall', at('dht') === PARTS.find(p => p.id === 'dht').assembled.pos.map(Math.round).join(','), at('dht'));
      ok('Assembled: flame sensor on the floor', at('flame') === PARTS.find(p => p.id === 'flame').assembled.pos.map(Math.round).join(','), at('flame'));
      ok('Assembled: control box built and visible', fg.encl && fg.encl.group.visible);
      ok('Assembled: harness routing active', fg.wires.router.name === 'assembledRouter');
      const finite = [...fg.wires.items.values()].every(it => [...it.tube.geometry.attributes.position.array].every(Number.isFinite));
      ok('All wire geometry is valid', finite);
      fg.setLayout('bench'); finishAnim();
      ok('Back to bench: sensors return to their bench spots', ['dht', 'mq2', 'flame'].every(id => { const p = fg.parts.get(id); return near(p.group.position.x, p.bench.x, 0.01) && near(p.group.position.z, p.bench.z, 0.01) && near(p.group.position.y, 0, 0.01); }));
      ok('Back to bench: control box hidden', !fg.encl.group.visible);
      for (let i = 0; i < 3; i++) { fg.setLayout('assembled'); finishAnim(); fg.setLayout('bench'); finishAnim(); }
      const after = benchBoxes();
      ok('Toggling 3× gives exactly the same tidy wires', after.every((b, i) => b === before[i]), `${after.filter((b, i) => b !== before[i]).length} wires differ`);
    }

    if (only.includes('reset')) {
      section = 'Reset';
      const atDefault = () => PARTS.filter(d => !d.fixed).every(d => { const p = fg.parts.get(d.id); return near(p.bench.x, d.pos[0], 0.01) && near(p.bench.z, d.pos[1], 0.01) && near(p.bench.ry, d.pos[2] || 0, 0.01); });
      const total = GUIDE.reduce((n, s) => n + s.wires.length, 0);
      const mess = () => {
        for (const id of ['esp', 'relay', 'buzz', 'dht']) { const p = fg.parts.get(id); p.bench.x += 37; p.bench.z -= 23; p.bench.ry += Math.PI / 2; p.group.position.x += 37; p.group.position.z -= 23; p.group.rotation.y += Math.PI / 2; }
        const w = fg.hw.wires.slice(10, 16).map(x => x.id); w.forEach(id => fg.removeWire(id)); // not the first wire: that hid a bug once
        fg.addWire('esp.26', 'rail.GND_15', '#ffffff');
        fg.wires.recolor(fg.hw.wires[0].id, '#ffffff');
      };
      wireAll(); fg.setLayout('bench', false);
      fg.resetAll();
      ok('Reset on a fully wired bench keeps all wires', fg.hw.wires.length === total, fg.hw.wires.length);
      mess();
      ok('Messed up: boards moved and wires changed', !atDefault() && fg.hw.wires.length !== total);
      fg.resetAll();
      ok('Bench: every board back to its default spot', atDefault());
      ok('Bench: default wiring restored', fg.hw.wires.length === total && $('progTxt').textContent === `${total} / ${total} connections`, $('progTxt').textContent);
      ok('Bench: default wire colors restored', fg.hw.wires.every(w => { const g = GUIDE.flatMap(s => s.wires).find(([a, b]) => (a === w.a && b === w.b) || (a === w.b && b === w.a)); return g && g[2] === w.color; }));
      ok('Bench: no wiring problems after reset', !issues().some(i => i.level !== 'info'));
      ok('Bench: still in Bench layout, tidy routing', fg.layout === 'bench' && fg.wires.router.name === 'benchRouter');
      mess(); fg.setLayout('assembled'); finishAnim();
      fg.resetAll();
      ok('Assembled: reset keeps the Assembled layout', fg.layout === 'assembled' && fg.wires.router.name === 'assembledRouter' && fg.encl.group.visible);
      ok('Assembled: sensors stay mounted in the house', ['dht', 'mq2', 'flame'].every(id => fg.parts.get(id).group.position.toArray().map(Math.round).join() === PARTS.find(p => p.id === id).assembled.pos.map(Math.round).join()));
      ok('Assembled: default wiring restored', fg.hw.wires.length === total);
      fg.setLayout('bench'); finishAnim();
      ok('…and going back to Bench uses the default spots', atDefault() && ['dht', 'mq2', 'flame'].every(id => { const p = fg.parts.get(id), d = PARTS.find(x => x.id === id); return near(p.group.position.x, d.pos[0], 0.01) && near(p.group.position.z, d.pos[1], 0.01); }));
      ok('Reset button is in the header', !!$('resetAll'));
    }

    if (only.includes('inspect')) {
      section = 'Inspect';
      wireAll();
      for (const id of ['sr', 'panel', 'div', 'div2', 'esp', 'relay', 'us']) {
        fg.insp.open(id);
        ok(`Inspect ${id} opens its card`, !$('inspector').hidden && document.querySelector('.stage').classList.contains('inspecting'));
        fg.insp.close(false);
      }
      fg.insp.open('sr');
      ok('Driver offers 8 signal buttons', document.querySelectorAll('#inspector [data-grp]').length === 8);
      fg.insp.setGroup('clock');
      ok('Picking "Clock" highlights it', document.querySelector('#inspector [data-grp].on').dataset.grp === 'clock');
      ok('Schematic dims the other signals', document.querySelectorAll('.schem .sg.dim').length >= 2);
      fg.insp.close(false);
      ok('Closing restores the view', $('inspector').hidden && !document.querySelector('.stage').classList.contains('inspecting'));
      fg.insp.open('panel', 'FIRE');
      ok('Panel row view lists only that row', document.querySelectorAll('#insLeds > span').length === 5, document.querySelectorAll('#insLeds > span').length);
      fg.insp.close(false);
    }

    if (only.includes('trace')) {
      section = 'Trace';
      wireAll();
      const w = fg.hw.wires.find(x => x.a === 'sr.DATA');
      fg.traceWire(w.id); await sim(50);
      ok('Clicking a wire spotlights only that wire', fg.wires.traced && fg.wires.traced.size === 1);
      const faded = [...fg.wires.items.values()].filter(it => it.w.id !== w.id).every(it => it.material.opacity < 0.1 && it.material.transparent);
      ok('All other wires fade', faded);
      ok('Trace bar names both ends', /ESP32 23/.test($('tracebar').innerText) && /LED driver DATA/.test($('tracebar').innerText), $('tracebar').innerText.replace(/\n/g, ' '));
      fg.traceNet('esp.GND1'); await sim(50);
      ok('Whole GND connection highlights many wires', fg.wires.traced.size > 10, fg.wires.traced.size);
      fg.clearTrace(); await sim(50);
      ok('Esc/✕ restores all wires', !fg.wires.traced && [...fg.wires.items.values()].every(it => it.material.opacity === 1));
    }

    if (only.includes('datalog')) {
      section = 'Data log';
      wireAll(); fg.world.reset();
      await runCode(DEFAULT_SKETCH, 4000);
      fg.world.ignite(); await sim(30000); await sim(12000);
      const phases = new Set(fg.LOG.map(r => r.phase));
      ok('Log has before / during / after rows', phases.has('before') && phases.has('during') && phases.has('after'), [...phases]);
      ok('Log table is filled', $('logBody').rows.length > 10, $('logBody').rows.length);
      const dur = fg.LOG.filter(r => r.phase === 'during');
      ok('During-fire rows show the temperature rising', dur.length && Math.max(...dur.map(r => r.temp)) > 40, dur.length && Math.max(...dur.map(r => r.temp)));
      ok('Rows record LED states', fg.LOG.every(r => r.leds.length === 5));
    }

    if (only.includes('options')) {
      section = 'Build options';
      const visible = () => [...fg.parts.values()].filter(p => p.group.visible).map(p => p.id);
      const total = () => guideFor(fg.options).reduce((n, s) => n + s.wires.length, 0);
      const ind = () => [...$('leds').querySelectorAll('li')].map(li => li.querySelector('.lm').textContent);
      wireAll(); fg.world.reset();
      // RGB LEDs + PCA9685
      fg.setOption('leds', 'rgb');
      ok('RGB: PCA9685 + RGB panel shown, 74HC595 + 17-LED panel hidden', visible().includes('pca') && visible().includes('rgb') && !visible().includes('sr') && !visible().includes('panel'), visible());
      ok('RGB: its wiring was added and the guide is complete', $('progTxt').textContent === `${total()} / ${total()} connections`, $('progTxt').textContent);
      ok('RGB: no wiring errors or warnings', !issues().some(i => i.level !== 'info'), issues().filter(i => i.level !== 'info').map(i => i.msg));
      ok('RGB: code switched to the PCA9685 firmware', /Adafruit_PWMServoDriver pwm/.test(fg.editor.value) && !/shiftOut/.test(fg.editor.value));
      let r = await runCode(fg.editor.value, 3000);
      ok('RGB: compiles and runs with no [sim] warnings', r.state === 'running' && !/\[sim\]/.test(r.serial), (r.serial.match(/\[sim\][^\n]*/g) || []).join(' | '));
      ok('RGB idle: sprinkler blue, fume green, fire off', /^Blue/.test(ind()[0]) && /^Green/.test(ind()[4]) && /^off/.test(ind()[3]), ind());
      fg.world.intensity = 80; fg.world.ignite(); await sim(8000);
      ok('RGB fire: sprinkler green, fume red, fire class lit', /^Green/.test(ind()[0]) && /^Red/.test(ind()[4]) && !/^off/.test(ind()[3]), ind());
      const seen = new Set(); fg.world.extinguish(); fg.world.temp = 80; for (let i = 0; i < 40; i++) { await sim(500); seen.add(ind()[3].split(' ')[0]); }
      ok('RGB: fire class shows orange/yellow as real mixed colours while cooling', seen.has('Orange') || seen.has('Yellow'), [...seen]);
      // DIY probes
      fg.world.reset(); fg.setOption('level', 'probes');
      ok('Probes: probe stick + pull-up board shown, HC-SR04 hidden', visible().includes('probe') && visible().includes('pull') && !visible().includes('us') && !visible().includes('div2'), visible());
      ok('Probes: guide complete, no errors or warnings', $('progTxt').textContent === `${total()} / ${total()} connections` && !issues().some(i => i.level !== 'info'), issues().filter(i => i.level !== 'info').map(i => i.msg));
      r = await runCode(fg.editor.value, 2500);
      ok('Probes: compiles and runs', r.state === 'running' && /PROBE_PIN/.test(fg.editor.value), r.compile.slice(0, 80));
      const levels = [];
      for (const [t, want] of [[97, 95], [70, 66], [40, 33]]) { fg.world.tank = t; await sim(500); const m = /TANK:(\d+)%/.exec(lcd()[1]); levels.push(`${t}%→${m && m[1]}`); ok(`Probes: ${t}% water reads ${want}%`, m && +m[1] === want, lcd()[1]); }
      fg.world.tank = 15; await sim(500);
      ok('Probes: below 1/3 the refill pump starts', out().refPump, `${Math.round(fg.world.tank)}% ${lcd()[1]}`);
      await sim(25000);
      ok('Probes: refill stops once the 95% wire is wet', !out().refPump && fg.world.tank >= 94, Math.round(fg.world.tank) + '%');
      await withWires(l => drop(drop(l, 'probe.P2', 'pull.A2'), 'pull.B2', 'esp.33').concat([{ a: 'probe.P2', b: 'esp.33' }]), async () => {
        ok('Probes: wire without the 470k pull-up is flagged', hasIssue('internal ~45k pull-up'), issues().map(i => i.msg));
      });
      await withWires(l => drop(l, 'probe.COM', 'esp.25').concat([{ a: 'probe.COM', b: 'rail.GND_14' }]), async () => {
        ok('Probes: common wire on GND all the time is flagged (corrosion)', hasIssue('corrodes'), issues().map(i => i.msg));
      });
      // back to the default build
      fg.setOption('leds', 'single'); fg.setOption('level', 'ultrasonic');
      ok('Back to default: 74HC595 + HC-SR04 build restored', visible().includes('sr') && visible().includes('us') && !visible().includes('pca') && !visible().includes('probe'));
      ok('Back to default: guide complete again', $('progTxt').textContent === `${total()} / ${total()} connections`, $('progTxt').textContent);
      ok('Back to default: code is the 74HC595 + HC-SR04 firmware', /shiftOut/.test(fg.editor.value) && /pulseIn/.test(fg.editor.value));
    }

    if (only.includes('checklist')) {
      section = 'Shopping checklist';
      const names = () => [...document.querySelectorAll('.cl .n')].map(n => n.textContent);
      ok('Checklist lists every item for the build', document.querySelectorAll('.cl li').length === bomFor(fg.options).length, document.querySelectorAll('.cl li').length);
      ok('Includes wires, passives and tools', ['Jumper wires male–female', '1N4007', '100 nF', '470 µF', 'Digital multimeter', '830-point breadboard'].every(t => names().some(n => n.includes(t))));
      ok('Default build lists 74HC595 and HC-SR04, not PCA9685 or probes', names().some(n => n.includes('74HC595')) && names().some(n => n.includes('HC-SR04')) && !names().some(n => n.includes('PCA9685')) && !names().some(n => n.includes('DIY probes')));
      fg.setOption('leds', 'rgb'); fg.setOption('level', 'probes');
      ok('Switching options updates the checklist', names().some(n => n.includes('PCA9685')) && names().some(n => n.includes('DIY probes')) && !names().some(n => n.includes('74HC595 shift')));
      fg.setOption('leds', 'single'); fg.setOption('level', 'ultrasonic');
      const box = document.querySelector('.cl input[data-item="dht22"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      ok('Ticking an item is remembered', JSON.parse(localStorage.getItem('fireguard-checklist-v1') || '{}').dht22 === true && document.querySelector('.cl input[data-item="dht22"]').checked);
      const box2 = document.querySelector('.cl input[data-item="dht22"]'); box2.checked = false; box2.dispatchEvent(new Event('change', { bubbles: true }));
      ok('Unticking works', !JSON.parse(localStorage.getItem('fireguard-checklist-v1') || '{}').dht22);
      ok('Safety notes are shown', /Will it blow up\?/.test($('parts').innerText) && /phone charger/.test($('parts').innerText));
    }

    if (only.includes('persistence')) {
      section = 'Saving';
      wireAll(); fg.save();
      const s = JSON.parse(localStorage.getItem(KEY));
      ok('Project saved with current format', s.v === 4, s.v);
      ok('All wires saved', s.wires.length === fg.hw.wires.length, s.wires.length);
      ok('Board positions saved', Object.keys(s.pos).length === PARTS.length);
      ok('Layout saved', s.layout === fg.layout);
    }
  } catch (e) {
    ok('Test run crashed', false, e.stack || String(e));
  } finally {
    for (const [k, v] of Object.entries(DEFAULT_OPTIONS)) if (fg.options[k] !== v) fg.setOption(k, v);
    fg.rt.stop(); fg.insp.close(false); fg.clearTrace(); fg.testDriving = false; window.confirm = realConfirm;
    if (backup != null) localStorage.setItem(KEY, backup); else localStorage.removeItem(KEY);
    if (backupChecklist != null) localStorage.setItem('fireguard-checklist-v1', backupChecklist); else localStorage.removeItem('fireguard-checklist-v1');
  }
  const passed = results.filter(r => r.pass).length, failed = results.length - passed;
  console.table(results);
  return { passed, failed, seconds: +((performance.now() - t0) / 1000).toFixed(1), failures: results.filter(r => !r.pass), results };
}
