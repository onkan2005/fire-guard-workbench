# Fire Guard Workbench

**Live demo: https://fire-guard-workbench.vercel.app**

A 3D build-and-code simulator for the ESP32 Fire Guard project (fire detection, auto-sprinkler and tank refill).
You wire the real parts together on a 3D bench, write the real Arduino C++ sketch, press **Upload & run**,
and watch the house, tank and pumps react.

No build step and no internet needed: plain ES modules, with Three.js r160 vendored in `vendor/`.

## Run it

```bash
cd ~/LaravelProjects/arduino-workshop
./serve.sh            # no-cache server, so a normal reload always gets the latest code
```

Open <http://localhost:5173>. Any static server works, including `php -S localhost:5173`.
To use it in a Laravel app, copy this folder into `public/workbench` and open `/workbench/`.

## What you can do

- **Assemble.** All parts start on the bench: ESP32 DevKit, power rails, DHT22, MQ-2 with its 10k/20k divider,
  IR flame sensor, an HC-SR04 ultrasonic tank-level sensor above the tank (ECHO through a divider of three 1 kΩ resistors: 1k on top, 1k + 1k in series below), 2-channel relay, 20×4 I2C LCD, an LED panel of 17 single 5 mm LEDs
  (one per workshop state, each with a 220 Ω resistor) driven by three chained 74HC595 shift registers on GPIO23/18/13, buzzer, a 4×AAA battery holder (6 V) for the pumps,
  and the two pumps' own red/black leads. Drag a board to move it, and press **R** (or *Rotate 90°*) to turn it.
- **Wire.** Click a pin, then another pin, to add a jumper. Click a wire to recolor or delete it (**Del**).
  Hover any pin to see what it is, what it connects to, and its live voltage.
  The **Build guide** checks each step electrically, so any hole on the right rail counts. *Wire this step* and
  *Wire everything* do it for you.
- **Check.** The **Checks** tab is a live electrical rules check: shorts, 5 V into a GPIO, MQ-2 without the divider,
  outputs on input-only pins (34–39), ADC2 and boot-strapping pins, missing grounds, pumps powered from the ESP32,
  swapped SDA/SCL, and more.
- **Code.** The editor holds a real Arduino sketch (`fire_guard.ino`). It is translated to JavaScript and runs
  against the simulated pins, so wiring mistakes show up exactly as on real hardware: a DHT that returns `NaN`,
  an LCD that never lights, a relay that won't click. Use **Download .ino** to flash the same sketch to your board.
- **Simulate.** Ignite a fire, set its strength, leak gas, or drain the tank. The sensors see it, the sketch decides,
  the relay switches the pumps, water flows, the sprinkler puts the fire out and the tank refills.
  Turn on **Sound** for the buzzer and relay clicks.

Your wires, board positions and code are saved in the browser (localStorage).

## Build options

Pick them at the top of the **Build guide** tab; the 3D parts, wiring guide, firmware and shopping list all follow.

| Option | Choice A (default) | Choice B |
|---|---|---|
| LED indicators | 17 single 5 mm LEDs on three chained **74HC595** shift registers (DATA 23, CLOCK 18, LATCH 13), 330 Ω each | 5 common-cathode **RGB LEDs** on a **PCA9685** 16-channel PWM board sharing the LCD's I2C bus (real orange/yellow by mixing) |
| PCA9685 board (RGB only) | Small **breakout** board | Uno-size **servo shield** (same chip and code), jumpered to the breadboard's SDA/SCL rows, 5V and GND |
| Tank level | **HC-SR04** ultrasonic above the tank (TRIG 25, ECHO 35 through a 1k / 1k+1k divider) | **DIY wire probes**: bare copper wires at 10/33/66/95 % (GPIO 32/33/26/14 through 470 kΩ pull-ups), common wire on GPIO25 driven LOW only while reading |

**One jumper per pin.** When several pins share a signal they meet in a breadboard row, never on one pin: GPIO21/22 go to the
breadboard's **SDA** and **SCL** rows, where the LCD and the PCA9685 plug in too; the battery's red and black leads go to the
**6V+** and **6V−** rows, which feed both relay COM terminals and take both pump black leads (one wire joins 6V− to the GND rail).
The Checks tab warns about any pin with two jumpers.

Or click a part in 3D and use **Replace ▾** in its toolbar to swap it for an alternative (74HC595 ↔ PCA9685, breakout ↔ servo shield, HC-SR04 ↔ wire probes).

## Shopping checklist & safety

The **Shopping & photos** page (top bar) has a tickable shopping checklist for the chosen build (modules, resistors,
capacitors, diodes, wires, consumables, tools) with PHP estimates, plus **Real build: safety & gotchas** and
**Which chips can I use?** notes. Each item takes a reference photo: drop a picture on its card, click to pick one,
or hover and paste (Ctrl+V). Click a photo to zoom. Photos stay in this browser (IndexedDB); **Save with photos**
exports one HTML file with every photo, tick and note.
Print and CSV export are there too.

The side panels hide with the **‹ ›** buttons on the edges of the 3D view (or the **[** and **]** keys).

## Calibration

The **Calibration** page (top bar) lists every component in your build that needs calibrating or adjusting.

- **Automatic** (the firmware calibrates itself from a Serial Monitor command, 115200 baud, line ending Newline, and saves it in the ESP32's flash with the Preferences library, so it survives power-off and new uploads):
  - **HC-SR04**: `empty` with the tank empty, `full` with it filled to your full mark (unplug the battery’s red lead from the 6V+ row first). `dist` shows the distance now.
  - **MQ-2**: `clean` in clean air after warm-up: that reading becomes 0 ppm.
  - **DHT22** (optional): `temp 29.5` with a trusted thermometer's reading saves an offset.
  - `cal` shows the saved values, `reset` goes back to the defaults in the code.
- **Manual**: flame sensor sensitivity (its potentiometer), LCD contrast (backpack potentiometer), DIY probe heights, RGB colour mix.

Each automatic card can also be tried on the simulated board, and the Serial tab has an input box for the same commands.

## Real-world faults & fixes

In the **Build guide** tab, open **Real-world faults & fixes** to switch on problems found on the real build and see what they do:
pump red on **NC** instead of NO, battery black or red lead unplugged, a **5 V relay board that stays on** with the ESP32's 3.3 V HIGH,
the relay trigger jumper on **H**, and **pump motor noise** that garbles the I2C LCD, plus the fix: **1N4007 diodes** across the pumps.
The wiring ones move the real jumpers. **Load the dry-test code** runs the sketch from the Tests page, which releases the relay pins
for OFF and re-syncs the LCD.

## Tests page

The **Tests** page (top bar) has the dry-test sketch (pretend tank level, pumps stop after 3 s, Serial commands) with Copy / Download /
Try in the simulator, and the step-by-step hardware test cases with tick boxes.

## Keeping the sensors dry

In the Assembled layout the sprinkler sprays a narrow cone straight down over the fire. The DHT22 and MQ-2 sit high
on the back wall under drip shields (open at the bottom so air still reaches them), and the flame sensor sits on a
shelf outside the left wall, looking in through a clear window. The firmware runs the sprinkler at least 5 s once it
starts, keeps the last dry gas reading while spraying, and holds the fire class while spraying and for 5 s after.

## Workshop extras

- **LED indicators panel** (top right of the 3D view): what each row of LEDs shows right now, in the workshop's words.
- **Data log** tab: a row every simulated second and on every change, split into *before / during / after* the fire,
  with a temperature + tank chart and **Download CSV**.
- **Water sprayed**: the HUD shows litres sprayed per activation (10 L tank, so 1% = 0.1 L).
- **● Record** saves a WebM video of the 3D view; **Screenshot** saves a PNG. Use them for the documentation video.

## Simulated Arduino API

`pinMode`, `digitalWrite/Read`, `analogRead` (12-bit, 0–3.3 V), `analogReadResolution`, `millis`, `micros`,
`delay`, `map`, `constrain`, `min/max/abs`, `random`, `tone/noTone`, `ledc*`, `Serial.print/println/printf`,
`Wire.begin(sda, scl)`, `String(...)`, plus these libraries:

| Library | Class | Notes |
|---|---|---|
| DHT sensor library | `DHT dht(pin, DHT22)` | `readTemperature()`, `readHumidity()`; `NaN` when not wired |
| LiquidCrystal I2C | `LiquidCrystal_I2C lcd(0x27, 20, 4)` | `init`, `backlight`, `clear`, `setCursor`, `print`; the backpack answers at 0x27 |
| (core) | `shiftOut(data, clock, MSBFIRST, byte)` | clocks the 74HC595 chain bit by bit; pulse LATCH to show the result |
| Adafruit NeoPixel | `Adafruit_NeoPixel strip(8, pin, NEO_GRB + NEO_KHZ800)` | `begin`, `setBrightness`, `setPixelColor`, `Color`, `ColorHSV`, `fill`, `clear`, `show` |
| WiFi | `WiFi` | stub: pretends to connect |

How the pieces behave: the relay inputs are active-LOW, the flame sensor's DO goes LOW on a flame,
the MQ-2 AO goes up to about 4.2 V (2.8 V after the divider), and the HC-SR04 answers `pulseIn()` with the round-trip time to the water surface (distance = µs × 0.0343 / 2 cm).

### Limits of the C++ translation

It handles the usual sketch style (globals, functions, `#define`, arrays, `String`, casts, `for/while/switch`).
It does not handle classes or structs you write yourself, pointers, references, `char` arithmetic, or `sprintf` into buffers.
Integer division is only truncated when the result is stored in an integer variable (`int x = a / b;`).
A plain `(a / b) % 2` inside an expression uses real division, so write `a % (2 * b) < b` instead.
A missing `;` is reported like a compiler error. A loop that never calls `delay()` trips a watchdog error.

## Self-test

`tests/selftest.js` drives the real app and checks 225 things: wiring and checks, the default firmware, every
workshop scenario (fire, gas, refill, LEDs, LCD, buzzer), the HC-SR04, the 74HC595 chain, miswiring detection,
the C++ translation, timing, layouts, Inspect, Trace, the data log and saving. Open the workbench, then in the
browser console:

```js
const t = await import('/tests/selftest.js'); await t.run();        // or t.run(['scenarios', 'hcsr04'])
```

Your saved project is restored afterwards; reload the page when it finishes.

## Files

```
index.html, styles.css     page and layout
src/main.js                UI, mouse interaction, main loop
src/scene.js               renderer, camera, bench, diorama (house, tank, pumps, fire, water)
src/parts.js               every part: pins, 3D model, shopping info
src/wires.js               3D jumper wires
src/hardware.js            nets, voltages, part behaviour, wiring checks
src/world.js               physics: heat, fire, gas, water
src/transpile.js           Arduino C++ → async JavaScript
src/runtime.js             virtual-clock runner + Arduino API and libraries
src/firmware.js            the default Fire Guard sketch
src/guide.js               reference wiring / build steps
vendor/three               Three.js r160 (MIT)
```

In the browser console, `__fg.simulate(5000)` advances 5 s of simulated time. This is handy when the tab is in the background.
