// "Calibration" page: one card per component in the current build that needs calibrating or adjusting.
// Automatic ones are calibrated by the firmware itself (Serial commands, saved in the ESP32's flash) and can be
// tried here on the simulated board; the rest get step-by-step manual instructions.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SERIAL = 'Open the Serial Monitor (Arduino IDE → Tools → Serial Monitor), set it to <b>115200 baud</b> and line ending <b>Newline</b>.';

export function createCalibration({ page, getOptions, world, nvs, send, onSerial, findPart }) {
  const saved = () => (nvs.data.fireguard || {});
  const fmt = (v, unit, d = 1) => v === undefined ? '<span class="mu">not calibrated (code default)</span>' : `<b>${(+v).toFixed(d)} ${unit}</b>`;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const CARDS = [
    {
      id: 'us', part: 'us', name: 'HC-SR04 tank level sensor', mode: 'auto', when: o => o.level === 'ultrasonic',
      why: 'It measures the distance from the sensor down to the water. The code needs two distances from your own tank, empty and full, to turn that into 0–100 %. The sensor measures both itself.',
      steps: [
        'Mount the sensor where it will stay: above the tank, pointing straight down, centred over the opening.',
        '<b>Switch the pump battery off</b>, or the refill pump starts filling the tank as soon as it is empty.',
        SERIAL,
        'Empty the tank completely and type <code>empty</code>. The ESP32 averages 10 readings and saves the distance.',
        'Fill the tank to your “full” mark (keep it at least 3 cm below the sensor) and type <code>full</code>.',
        'Type <code>cal</code> to see the saved values, or <code>dist</code> to see the distance right now. Switch the pump battery back on.',
        'Done: the values stay in the ESP32’s flash through power-offs and new uploads. Type <code>reset</code> to go back to the defaults.',
      ],
      savedText: () => `Saved: empty ${fmt(saved().tankEmpty, 'cm')}, full ${fmt(saved().tankFull, 'cm')}`,
      actions: [
        { label: '1. Pump battery off + empty the tank + send “empty”', run: async () => { world.pumpPower = false; world.tank = 0; await wait(400); send('empty'); } },
        { label: '2. Fill to the full mark + send “full”', run: async () => { world.pumpPower = false; world.tank = 100; await wait(400); send('full'); } },
        { label: '3. Pump battery back on', run: async () => { world.pumpPower = true; } },
        { label: 'Send “dist”', run: async () => send('dist') },
      ],
    },
    {
      id: 'mq2', part: 'mq2', name: 'MQ-2 gas / smoke sensor', mode: 'auto', when: () => true,
      why: 'Every MQ-2 gives a slightly different voltage in clean air, and it drifts while the heater warms up. Saving its clean-air reading makes that level 0 ppm, so the gas alarm (300 ppm) means the same on every sensor.',
      steps: [
        'Brand new sensor: leave it powered for <b>24–48 hours</b> once (burn-in) before trusting any reading.',
        'Every time after that: power on and wait <b>2–3 minutes</b> for the heater to warm up.',
        'Make sure the air is clean: no gas, smoke, alcohol or perfume nearby. Open a window.',
        SERIAL,
        'Type <code>clean</code>. The ESP32 averages 20 readings over a second and saves the clean-air voltage.',
        'If it warns that the value is high, wait longer, air the room and type <code>clean</code> again.',
        'The small blue knob on the MQ-2 board only sets its DO output, which this build does not use. Leave it.',
      ],
      savedText: () => `Saved clean-air reading: ${fmt(saved().mq2Clean, 'V', 2)}`,
      actions: [
        { label: 'Clear the air + send “clean”', run: async () => { world.gasLeak = 50; await wait(300); send('clean'); } },
      ],
    },
    {
      id: 'dht', part: 'dht', name: 'DHT22 temperature sensor', mode: 'auto', when: () => true,
      why: 'The DHT22 is factory calibrated (±0.5 °C), so this is optional. Only do it if a thermometer you trust disagrees by more than about 1 °C.',
      steps: [
        'Put a trusted thermometer right next to the DHT22, out of the sun and away from your hands, for 10 minutes.',
        SERIAL,
        'Type <code>temp</code> and the thermometer reading, for example <code>temp 29.5</code>. The ESP32 saves the difference as an offset.',
        'Check the LCD: it should now match the thermometer. Type <code>reset</code> to remove the offset.',
      ],
      savedText: () => `Saved offset: ${saved().tempOffset === undefined ? '<span class="mu">none</span>' : `<b>${(+saved().tempOffset).toFixed(1)} °C</b>`}`,
      input: { label: 'Reference thermometer (°C)', value: () => (world.temp + 1).toFixed(1) },
      actions: [
        { label: 'Send “temp …”', run: async v => send('temp ' + v) },
      ],
    },
    {
      id: 'flame', part: 'flame', name: 'IR flame sensor', mode: 'manual', when: () => true,
      why: 'Its sensitivity is set by the blue potentiometer on the board, not in code. Too sensitive and sunlight or a TV remote sets it off; not sensitive enough and it misses a small flame.',
      steps: [
        'Power the build. In a room without direct sunlight, with no flame, look at the board’s second LED (the DO LED).',
        'With a small screwdriver, turn the blue potentiometer until the DO LED just turns <b>off</b>. Then turn a little further the same way.',
        'Hold a lighter 20–30 cm away, outside the model: the DO LED should light up and the LCD show FIRE.',
        'If it misses the lighter, turn back a little. If it triggers on its own (sunlight, lamps), turn further.',
        'Re-check from where the sensor is mounted (behind the house window), since the window takes a bit of the infrared.',
      ],
    },
    {
      id: 'lcd', part: 'lcd', name: '20×4 I2C LCD contrast', mode: 'manual', when: () => true,
      why: 'The contrast is set by the blue potentiometer on the I2C backpack. Out of the box it is often wrong, so the screen looks blank or shows only blocks.',
      steps: [
        'Power the build with the sketch running.',
        'On the back of the LCD, turn the blue potentiometer slowly with a small screwdriver until the text is sharp.',
        'Only a row of solid blocks: turn the other way. Backlight on but nothing at all after adjusting: the backpack may be at address <b>0x3F</b> instead of 0x27. Change <code>LiquidCrystal_I2C lcd(0x27, 20, 4)</code> to 0x3F.',
      ],
    },
    {
      id: 'probe', part: 'probe', name: 'DIY wire probes', mode: 'manual', when: o => o.level === 'probes',
      why: 'The levels come from where the bare wire ends sit, so “calibrating” means placing them at the right heights. There is nothing to set in code.',
      steps: [
        'Measure your tank’s full water height. Mark 10 %, 33 %, 66 % and 95 % of it on the stick, and put COM at the very bottom.',
        'Fix each bare tip at its mark, about 1 cm apart, pointing down or sideways.',
        'Fill the tank slowly and watch the LCD: TANK should step 10 → 33 → 66 → 95 % as the water reaches each tip.',
        'A level that never shows: check that tip’s wire and its 470 kΩ pull-up. A level that shows too early: the tip is too low.',
      ],
    },
    {
      id: 'rgb', part: 'rgb', name: 'RGB LED colours', mode: 'manual', when: o => o.leds === 'rgb',
      why: 'Every brand of RGB LED mixes colours a little differently. Orange and yellow are the ones that usually need a nudge.',
      steps: [
        'Run the sketch and set a fire class that shows orange and yellow (use a hair dryer on the DHT22).',
        'The code uses the values your team tested: yellow <code>{255, 50, 0}</code>, orange <code>{255, 15, 0}</code>, red <code>{255, 0, 0}</code>, green <code>{0, 255, 0}</code>, blue <code>{0, 0, 255}</code>. If a colour still looks off, change the green number of <code>ORANGE[3]</code> or <code>YELLOW[3]</code> a little at a time.',
        'Blue too dim next to the others: lower the red and green numbers of the other colours a little instead of raising blue.',
        'Upload again after each change.',
      ],
    },
  ];

  let reply = {}, active = null;
  onSerial(line => {
    if (!active || !/^(Saved|Distance|Calibration|Warning|No echo|Type:|That is|Commands)/.test(line)) return;
    reply[active] = (reply[active] ? reply[active] + '\n' : '') + line;
    const box = page.querySelector(`[data-reply="${active}"]`); if (box) box.textContent = reply[active];
    const sv = page.querySelector(`[data-saved="${active}"]`), c = CARDS.find(x => x.id === active); if (sv && c && c.savedText) sv.innerHTML = c.savedText();
  });

  function render() {
    const o = getOptions(), list = CARDS.filter(c => c.when(o));
    const auto = list.filter(c => c.mode === 'auto'), manual = list.filter(c => c.mode === 'manual');
    const card = c => `<article class="calc" data-cal="${c.id}">
        <div class="calh"><h3>${esc(c.name)}</h3><span class="badge ${c.mode}">${c.mode === 'auto' ? 'Automatic' : 'Manual'}</span></div>
        <p class="mu">${esc(c.why)}</p>
        <h4>On the real build</h4><ol>${c.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        ${c.actions ? `<div class="calsim"><h4>Try it on the simulated board</h4>
          <div class="calsaved" data-saved="${c.id}">${c.savedText()}</div>
          ${c.input ? `<label class="calin">${esc(c.input.label)} <input type="number" step="0.1" data-in="${c.id}" value="${c.input.value()}"></label>` : ''}
          <div class="row wrap">${c.actions.map((a, i) => `<button class="sm${i === 0 ? ' primary' : ''}" data-act="${c.id}:${i}">${esc(a.label)}</button>`).join('')}</div>
          <pre class="calreply" data-reply="${c.id}">${esc(reply[c.id] || 'The ESP32’s reply appears here.')}</pre></div>` : ''}
        <button class="sm link" data-find="${c.part}">Show it in 3D</button>
      </article>`;
    page.innerHTML = `
      <div class="shoptop"><div><h1>Calibration</h1><small>Components in your build that need calibrating or adjusting. Automatic ones calibrate themselves from a Serial command and save it in the ESP32’s flash.</small></div>
        <div class="row"><button class="sm" id="calReset" title="Send “reset” to the simulated ESP32: clears every saved calibration">Reset all (simulator)</button></div></div>
      <h2>Automatic <span class="mu small">(type a command in the Serial Monitor)</span></h2><div class="calg">${auto.map(card).join('')}</div>
      <h2>Manual <span class="mu small">(a knob or a placement, no code)</span></h2><div class="calg">${manual.map(card).join('')}</div>
      <h2>No calibration needed</h2><div class="notes"><p>ESP32, relay module, buzzer, pumps, ${o.leds === 'rgb' ? 'PCA9685 board' : '74HC595 chips and the single LEDs'} and the voltage dividers work as they are.${o.level === 'ultrasonic' ? '' : ' The pull-up board needs no adjusting either.'}</p>
        <p>All Serial commands: <code>clean</code>, <code>temp 29.5</code>${o.level === 'ultrasonic' ? ', <code>empty</code>, <code>full</code>, <code>dist</code>' : ''}, <code>cal</code> (show saved values), <code>reset</code> (back to the code defaults). The Serial tab on the 3D workbench page has the same input box.</p></div>`;
  }

  page.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]'), find = e.target.closest('[data-find]');
    if (find) return findPart(find.dataset.find);
    if (e.target.id === 'calReset') { active = 'us'; reply = {}; await send('reset'); setTimeout(render, 600); return; }
    if (!act) return;
    const [id, i] = act.dataset.act.split(':'), c = CARDS.find(x => x.id === id);
    active = id; reply[id] = '';
    const box = page.querySelector(`[data-reply="${id}"]`); if (box) box.textContent = 'Sending…';
    const v = page.querySelector(`[data-in="${id}"]`);
    act.disabled = true;
    try { await c.actions[+i].run(v ? v.value : undefined); } finally { act.disabled = false; }
  });

  return { render, cards: CARDS };
}
