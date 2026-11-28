// "Tests" page: the dry-test sketch (for testing the real build before the water container is ready)
// and the step-by-step hardware test cases to do with it, including the lighter tests.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SKETCH_URL = 'hardware-tests/fire_guard_dry_test.ino';

const COMMANDS = [
  ['tank 60', 'Pretend the tank is 60 % full. 20 starts the refill, 100 ends it, 0 = empty.'],
  ['real', 'Use the HC-SR04 for the tank level again.'],
  ['heat 30', 'Add 30 °C to the temperature reading to test the fire classes. heat 0 = off.'],
  ['pump1', 'Run the sprinkler pump for 2 s.'],
  ['pump2', 'Run the refill pump for 2 s.'],
  ['status', 'Print every reading now.'],
  ['clean · temp 29.5 · empty · full · dist · cal · reset', 'The normal calibration commands still work.'],
];

// [what to do, what you should see, needs the lighter?]
const CASES = [
  ['Battery’s <b>red lead unplugged</b> from the 6V+ row (the holder has no switch), plug in USB.', 'LCD shows <code>Fire Guard DRY TEST</code>, then <code>SPR:OFF REF:OFF TEST</code> and <code>TANK:60% HALF*</code>. Relay LEDs off, buzzer quiet. RGB: sprinkler blue, tank blue, fume green.'],
  ['Plug the battery’s red lead into the 6V+ row. Type <code>pump1</code>.', 'Relay 1 clicks, the sprinkler pump runs 2 s, then stops.'],
  ['Type <code>pump2</code>.', 'Relay 2 clicks, the refill pump runs 2 s, then stops.'],
  ['Lighter flame <b>20–30 cm</b> in front of the flame sensor.', 'Flame sensor DO LED on, LCD <code>FIRE</code> and <code>FIRE:LOW</code>, fume LED red, fast beeps. <b>Sprinkler pump runs 3 s</b> while the pretend tank drops 60 → 30 %, then <code>SPR:3s!</code>. Then the <b>refill pump runs about 3 s</b> (<code>REF:ON</code>, tank climbs back to 95 %) and stops.', true],
  ['Take the flame away.', 'About 5 s later <code>SPR:OFF</code>, the beeping stops, LEDs back to normal.', true],
  ['Let the MQ-2 warm up 3 min and type <code>clean</code>. Then press the lighter’s gas button <b>without sparking</b>, 2–3 cm from the MQ-2, for 2 s.', 'Gas rises above 300 ppm: LCD <code>GAS</code>, fume LED orange, slow beeps, <b>no</b> sprinkler. Clears after about 30 s.', true],
  ['Type <code>heat 10</code>, <code>heat 20</code>, <code>heat 30</code>, <code>heat 40</code>, <code>heat 50</code>, waiting 3 s between.', 'Fire class LED: green (LOW) → blue (MODERATE) → yellow (HIGH) → orange (VERY HIGH) → red (EXTREME). LCD <code>FIRE:</code> follows. The sprinkler runs 3 s when it starts.'],
  ['Type <code>heat 0</code>. Hold your hand on the DHT22 for a minute (or a hair dryer from 30 cm).', '<code>T:</code> on the LCD goes up a few degrees.'],
  ['Type <code>tank 50</code>, then <code>tank 20</code>, then <code>tank 0</code>.', 'Tank LED blue → orange → red; LCD HALF → NEAR EMPTY → EMPTY. At 20 % the refill turns on (refill LED red), relay 2 runs 3 s, then <code>REF:3s!</code>.'],
  ['With <code>tank 0</code>, flame at the flame sensor again.', 'Alarm and beeps, but the sprinkler stays <b>OFF</b>: it never pumps from an empty tank.', true],
  ['Type <code>tank 100</code>.', 'Tank LED green, <code>FULL</code>, refill off.'],
  ['Type <code>dist</code> holding your hand flat 10 cm under the HC-SR04.', '<code>Distance to the water: 10.0 cm</code> (± 1 cm).'],
  ['Type <code>real</code> and move your hand closer and farther.', 'TANK % goes up as your hand gets closer. Type <code>tank 60</code> to go back.'],
  ['Type <code>status</code>.', 'One line with every reading.'],
];

export function createTestPage({ page, getOptions, loadIntoSimulator }) {
  let code = null, done = {};
  const KEY = 'fireguard-tests-v1';
  try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { }
  const saveDone = () => { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { } };

  async function getCode() {
    if (code) return code;
    const r = await fetch(SKETCH_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Could not load ' + SKETCH_URL);
    return (code = await r.text());
  }

  function render() {
    const o = getOptions(), match = o.leds === 'rgb' && o.level === 'ultrasonic';
    const n = CASES.filter((_, i) => done[i]).length;
    page.innerHTML = `
      <div class="shoptop"><div><h1>Tests</h1><small>Test the real build before the water container is ready: a dry-test sketch and step-by-step test cases (with a lighter).</small></div>
        <div class="row"><span class="mu small" id="tcount">${n} / ${CASES.length} passed</span><button class="sm" id="tReset">Clear ticks</button></div></div>

      <h2>Why a pump runs as soon as the battery is connected</h2>
      <div class="notes">
        <p><b>Normal sketch, no container:</b> that is the refill pump. The HC-SR04 sees the table far below, reads the tank as empty and starts refilling. The dry-test sketch below pretends the tank level, so this stops.</p>
        <p><b>ESP32 unplugged and a pump still runs:</b> that pump’s red lead is on the relay’s <b>NC</b> screw. Move it to <b>NO</b>.</p>
        <p><b>Both pumps run whenever the ESP32 is on:</b> check that the relay board’s trigger jumper is on <b>L</b> (low-level trigger) and relay VCC is on 5V.</p>
      </div>

      <h2>1. Upload the dry-test sketch</h2>
      <div class="notes">
        <p>Same as the normal Fire Guard sketch, plus: the tank level is <b>pretended</b> (starts at 60 %, drains while spraying and fills while refilling, so a fire runs sprinkler 3 s → refill 3 s), and any pump stops after <b>3 s</b> so it never runs dry for long (<code>3s!</code> on the LCD). When the container is ready, go back to the normal sketch.</p>
        <p>For the build with <b>5 RGB LEDs + PCA9685</b> and the <b>HC-SR04</b>.${match ? '' : ' <b>Your simulator is set to a different build</b>, so “Try it in the simulator” switches it to RGB LEDs + HC-SR04.'}</p>
      </div>
      <div class="row wrap tcodebar">
        <button class="sm primary" id="tCopy">Copy code</button>
        <button class="sm" id="tDownload">Download .ino</button>
        <button class="sm" id="tTry">Try it in the simulator</button>
        <span class="mu small" id="tMsg"></span>
      </div>
      <pre class="tcode" id="tCode">Loading…</pre>

      <h2>2. Serial Monitor commands <span class="mu small">(115200 baud, line ending Newline)</span></h2>
      <table class="ttable"><tbody>${COMMANDS.map(([c, d]) => `<tr><td><code>${esc(c)}</code></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>

      <h2>3. Safety first</h2>
      <div class="notes tsafe">
        <p>🔥 Lighter flame <b>20–30 cm</b> from the flame sensor only. Never near the DHT22, the MQ-2, the wires or the breadboard.</p>
        <p>💨 Gas test with <b>unlit</b> lighter gas only, in a ventilated room. Keep a damp cloth nearby.</p>
        <p>🔋 The battery holder has no switch: to cut the pumps’ power, pull its <b>red lead</b> out of the 6V+ row. Do that before touching the pump wires.</p>
        <p>💧 Pumps: dip them in a cup of water for the pump tests if you can, rather than running them dry.</p>
      </div>

      <h2>4. Test cases <span class="mu small">(tick each one that passes)</span></h2>
      <table class="ttable tcases"><thead><tr><th>#</th><th>Do this</th><th>You should see</th><th>Pass</th></tr></thead><tbody>
        ${CASES.map(([d, e, lighter], i) => `<tr class="${done[i] ? 'ok' : ''}"><td>${i + 1}</td><td>${lighter ? '<span class="badge manual" title="Uses the lighter">🔥 lighter</span> ' : ''}${d}</td><td>${e}</td><td><input type="checkbox" data-case="${i}" ${done[i] ? 'checked' : ''} aria-label="Test ${i + 1} passed"></td></tr>`).join('')}
      </tbody></table>`;
    getCode().then(c => { const el = page.querySelector('#tCode'); if (el) el.textContent = c; })
      .catch(e => { const el = page.querySelector('#tCode'); if (el) el.textContent = e.message; });
  }

  const msg = t => { const m = page.querySelector('#tMsg'); if (m) { m.textContent = t; clearTimeout(msg._t); msg._t = setTimeout(() => { m.textContent = ''; }, 3000); } };
  page.addEventListener('change', e => {
    const i = e.target.dataset.case; if (i === undefined) return;
    if (e.target.checked) done[i] = 1; else delete done[i];
    saveDone(); e.target.closest('tr').classList.toggle('ok', e.target.checked);
    page.querySelector('#tcount').textContent = `${CASES.filter((_, k) => done[k]).length} / ${CASES.length} passed`;
  });
  page.addEventListener('click', async e => {
    const id = e.target.id;
    if (id === 'tReset') { done = {}; saveDone(); render(); return; }
    if (id === 'tCopy') {
      const c = await getCode();
      try { await navigator.clipboard.writeText(c); msg('Copied'); }
      catch { const r = document.createRange(); r.selectNodeContents(page.querySelector('#tCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); msg('Selected: press Ctrl+C'); }
    }
    if (id === 'tDownload') {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([await getCode()], { type: 'text/plain' }));
      a.download = 'fire_guard_dry_test.ino'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (id === 'tTry') tryInSimulator();
  });
  async function tryInSimulator() {
    if (!confirm('Load the dry-test sketch into the simulator and run it?\n\nYour code in the editor is replaced. “Restore default” brings the normal firmware back.')) return;
    loadIntoSimulator(await getCode());
  }

  return { render, cases: CASES, getCode, tryInSimulator };
}
