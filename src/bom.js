// Complete shopping checklist for the real build. Prices are rough PHP estimates (each).
// opt: only for that build option · optional: nice to have · owned: you already have it
const I = (id, cat, qty, name, why, lo, hi, extra = {}) => ({ id, cat, qty, name, why, lo, hi, ...extra });

export const CATEGORIES = [
  ['brain', 'Brain & power'],
  ['sensors', 'Sensors'],
  ['outputs', 'Outputs & drivers'],
  ['passives', 'Resistors, capacitors & diodes'],
  ['wiring', 'Wiring & prototyping'],
  ['model', 'Model (tank, house, water)'],
  ['tools', 'Tools (if your team has none)'],
];

const ITEMS = [
  I('esp32', 'brain', 1, 'ESP32 DevKit (38-pin)', 'The brain.', 0, 0, { owned: true }),
  I('usb', 'brain', 1, 'USB data cable for the ESP32 (micro-USB or USB-C: match your board)', 'Must be a data cable, not charge-only, or uploads fail.', 60, 150),
  I('charger', 'brain', 1, '5 V 2 A USB phone charger', 'Powers the ESP32 and the 5 V rail (~0.7 A total). A laptop USB port (0.5 A) can cause resets.', 150, 300),
  I('aaaholder', 'brain', 1, '4×AAA battery holder with switch (6 V)', 'Separate power for the pumps, through the relay.', 40, 80),
  I('aaa', 'brain', 8, 'AAA alkaline batteries (4 + 4 spare)', 'Pumps drain them quickly; keep a spare set for the demo video.', 15, 25),

  I('dht22', 'sensors', 1, 'DHT22 (AM2302) temperature & humidity module, 3-pin', 'Room temperature and fire class. Not the DHT11 (too inaccurate, max 50 °C).', 200, 350),
  I('mq2', 'sensors', 1, 'MQ-2 gas/smoke module', 'The fume sensor (gas and smoke).', 120, 180),
  I('flame', 'sensors', 1, 'IR flame sensor module (LM393, 3- or 4-pin)', 'Sees an actual flame.', 40, 80),
  I('hcsr04', 'sensors', 1, 'HC-SR04 ultrasonic sensor', 'Tank level from above (2–400 cm). For a wet/outdoor tank the waterproof JSN-SR04T works the same way.', 60, 120, { opt: ['level', 'ultrasonic'] }),
  I('probewire', 'sensors', 1, 'DIY probes: 1 m of 22 AWG solid copper wire + a plastic stick/straw', 'Five stripped wire ends at 2 / 10 / 33 / 66 / 95 % of the tank height. Stainless screws corrode less than copper.', 20, 60, { opt: ['level', 'probes'] }),

  I('relay', 'outputs', 1, '2-channel 5 V relay module (opto-isolated, with JD-VCC jumper)', 'Switches the two pumps. A “high/low level trigger” version is easiest with a 3.3 V ESP32.', 90, 150),
  I('lcd', 'outputs', 1, '20×4 I2C LCD (HD44780 + PCF8574 backpack)', 'Pump states, tank level, temperature, fire class. Address usually 0x27 (sometimes 0x3F).', 300, 450),
  I('buzzer', 'outputs', 1, 'Active buzzer module 3–5 V (with S8050 transistor)', 'The alarm. Must be ACTIVE (beeps on its own), not passive.', 25, 45),
  I('pumps', 'outputs', 2, '3–6 V mini submersible pump', 'Sprinkler pump (in the tank) and refill pump (in the water source).', 80, 150),
  I('hc595', 'outputs', 3, '74HC595 shift register, DIP-16 (74HCT595 if you can find it)', 'Three chained = 24 outputs from 3 ESP32 pins for the 17 LEDs.', 15, 30, { opt: ['leds', 'single'] }),
  I('socket', 'outputs', 3, '16-pin DIP IC socket', 'Solder the socket, not the chip: easy to replace a dead 74HC595.', 5, 10, { opt: ['leds', 'single'], optional: true }),
  I('leds', 'outputs', 17, '5 mm LEDs: 5 green, 4 blue, 4 red, 3 orange, 1 yellow', 'One LED per workshop state. Buy a few extra of each colour.', 2, 4, { opt: ['leds', 'single'] }),
  I('pca9685', 'outputs', 1, 'PCA9685 16-channel PWM board (I2C)', 'Drives the 5 RGB LEDs with real PWM (orange and yellow). Check it has 220 Ω resistors on the outputs.', 180, 300, { opt: ['leds', 'rgb'] }),
  I('rgbled', 'outputs', 6, 'RGB LED 5 mm, common CATHODE (4 legs), 5 + 1 spare', 'One per indicator. Common anode will NOT work with this wiring.', 8, 15, { opt: ['leds', 'rgb'] }),

  I('r_mq', 'passives', 1, '10 kΩ + 20 kΩ resistor (one of each)', 'MQ-2 divider: keeps GPIO34 under 3.3 V.', 2, 5),
  I('r_echo', 'passives', 1, '1 kΩ + 2 kΩ resistor (one of each)', 'HC-SR04 ECHO divider: 5 V → 3.3 V.', 2, 5, { opt: ['level', 'ultrasonic'] }),
  I('r_led', 'passives', 17, '330 Ω resistor', 'One per LED (~9 mA). 220 Ω pulls too much current from a 74HC595.', 1, 2, { opt: ['leds', 'single'] }),
  I('r_pull', 'passives', 4, '470 kΩ resistor', 'Probe pull-ups: tap water easily pulls these LOW.', 1, 2, { opt: ['level', 'probes'] }),
  I('c100n', 'passives', 4, '100 nF (0.1 µF, code “104”) ceramic capacitor', 'Decoupling: one between VCC and GND right at each 74HC595 (+1 spare). Stops random flicker.', 1, 3, { opt: ['leds', 'single'] }),
  I('c100n_rgb', 'passives', 2, '100 nF (0.1 µF, code “104”) ceramic capacitor', 'Decoupling near the LCD and spare.', 1, 3, { opt: ['leds', 'rgb'] }),
  I('c470u', 'passives', 1, '470 µF 16 V electrolytic capacitor', 'Across the 5 V rail and GND (stripe to GND): absorbs dips when relays click and the MQ-2 heater starts.', 5, 10),
  I('c100u', 'passives', 1, '100 µF 16 V electrolytic capacitor', 'Across the battery + and − (stripe to −): pump start-up surge.', 4, 8),
  I('d4007', 'passives', 2, '1N4007 diode', 'Across each pump, stripe to + (flyback): absorbs the motor’s voltage spikes.', 2, 5),
  I('rkit', 'passives', 1, 'Resistor assortment kit', 'Often cheaper than single values and covers spares.', 120, 250, { optional: true }),

  I('bb830', 'wiring', 1, '830-point breadboard', 'ESP32, dividers and the 3.3 V / 5 V / GND rails.', 80, 120),
  I('bb400', 'wiring', 1, '400-point half breadboard', 'For the LED driver while testing (move to perfboard later).', 50, 80),
  I('perf', 'wiring', 2, 'Perfboard 7×9 cm', 'The final LED panel and driver.', 15, 30),
  I('jmm', 'wiring', 1, 'Jumper wires male–male, 40 pcs', 'Breadboard to breadboard.', 50, 70),
  I('jmf', 'wiring', 1, 'Jumper wires male–female, 40 pcs', 'Breadboard to module pins (DHT22, MQ-2, relay, LCD…).', 50, 70),
  I('jff', 'wiring', 1, 'Jumper wires female–female, 40 pcs', 'Module to module.', 50, 70),
  I('hookup', 'wiring', 1, '22 AWG solid-core hookup wire set (red, black, colours)', 'Neat wiring on the perfboards and longer runs to the house and tank.', 60, 120),
  I('headers', 'wiring', 2, 'Male pin header strip, 40-pin', 'Plug-in connectors on the perfboards.', 10, 20),
  I('screwterm', 'wiring', 4, '2-pin screw terminal block (5.08 mm)', 'Pump leads and battery wires: bare wire clamps in firmly.', 5, 10),
  I('lls', 'wiring', 1, '4-channel I2C logic level shifter (BSS138)', 'Keeps the LCD’s 5 V pull-ups off the ESP32 (SDA/SCL). Recommended.', 40, 70, { optional: true }),
  I('tube', 'wiring', 1, 'Silicone tubing 1 m (fits the pump outlet) + mini spray nozzle', 'Water path and the sprinkler head.', 60, 120),
  I('shrink', 'wiring', 1, 'Heat-shrink tubing assortment', 'Insulates soldered joints, especially near water.', 50, 100),
  I('etape', 'wiring', 1, 'Electrical tape', 'Quick insulation.', 20, 40),
  I('zipties', 'wiring', 1, 'Zip ties + double-sided foam tape', 'Cable management and mounting the sensors.', 30, 60),

  I('tank', 'model', 1, 'Clear plastic container for the tank', 'With the HC-SR04: leave ≥ 2 cm between the sensor and the full water line.', 30, 80),
  I('source', 'model', 1, 'Container for the water source', 'The refill pump sits in it.', 30, 60),
  I('house', 'model', 1, '“House”: shoebox, foam board or acrylic', 'DHT22 and MQ-2 go high on the back wall; the flame sensor sits outside the left wall, looking in through a window.', 0, 100),
  I('shields', 'model', 1, 'Drip shields: a clean plastic bottle or cups', 'Cut small roofs: an awning over the DHT22 and an open-bottom hood over the MQ-2, so spray can’t drip on them but air still gets in.', 0, 20),
  I('window', 'model', 1, 'Clear acrylic or plastic sheet (CD case, clear folder)', 'Window in the house wall for the flame sensor to look through. Check it still sees a lighter from the same distance.', 0, 40),
  I('shelf', 'model', 1, 'Small shelf: popsicle sticks or a foam-board strip', 'Holds the flame sensor outside the house, level with the window.', 0, 20),
  I('coat', 'model', 1, 'Clear nail polish (or keep using hot glue)', 'Paint the back of each sensor board and its pin joints against splashes. Never cover the MQ-2 mesh, the DHT22 grille or the flame sensor’s dark LED.', 30, 60),
  I('enclosure', 'model', 1, 'Project box / food container for the control electronics', 'Keeps water away from the ESP32, relay and battery.', 40, 120),
  I('glue', 'model', 1, 'Hot glue sticks', 'Mounting sensors and tubing.', 20, 40),

  I('iron', 'tools', 1, 'Soldering iron + solder + stand', 'For the perfboards and pump leads.', 250, 600, { optional: true }),
  I('dmm', 'tools', 1, 'Digital multimeter', 'Check 5 V / GND before powering. Strongly recommended.', 250, 500, { optional: true }),
  I('stripper', 'tools', 1, 'Wire stripper / cutter', 'Stripping hookup wire and probe ends.', 80, 200, { optional: true }),
  I('drivers', 'tools', 1, 'Small screwdriver set', 'Screw terminals and the relay.', 50, 150, { optional: true }),
];

export const bomFor = options => ITEMS.filter(it => !it.opt || options[it.opt[0]] === it.opt[1]);

export const SAFETY = [
  ['Will it blow up?', 'No. Wired like the guide, no part is pushed past its maximum ratings: 5 V never reaches an ESP32 pin (dividers on the MQ-2 and HC-SR04, DHT22 and flame sensor on 3.3 V), the pumps never draw from the ESP32, and every LED has a resistor. The real risks are the four gotchas below and water.'],
  ['1. Use a 5 V 2 A phone charger', 'The 5 V rail feeds the MQ-2 heater (~150 mA), two relay coils (~140 mA), the LCD backlight, the LEDs and the ESP32 itself (~250 mA peaks): about 0.7 A. A laptop USB port gives ~0.5 A, so the ESP32 resets when the relays click. Use a phone charger and put the 470 µF capacitor across 5 V and GND.'],
  ['2. Relay may not switch OFF with a 3.3 V ESP32', 'On 5 V opto relay boards, IN is pulled up to 5 V; the ESP32’s HIGH is only 3.3 V, so some boards stay ON. If that happens: remove the JD-VCC jumper, power the VCC pin from 3V3 and the JD-VCC pin from 5V (GND shared). Or buy a relay board with a high/low trigger jumper.'],
  ['3. The LCD puts 5 V on SDA/SCL', 'The PCF8574 backpack pulls SDA/SCL up to 5 V through 4.7 kΩ. It usually survives, but the ESP32 is officially 3.3 V only. A ₱50 4-channel I2C level shifter (LV side = 3V3 + ESP32, HV side = 5 V + LCD/PCA9685) fixes it properly.'],
  ['4. 74HC595 at 5 V with 3.3 V signals', 'A 74HC595 at 5 V wants ≥ 3.5 V for a HIGH; the ESP32 gives 3.3 V. It usually works. For guaranteed results use 74HCT595 (same pinout), or the RGB/PCA9685 option.'],
  ['LED current', '330 Ω per LED ≈ 9 mA, which keeps each 74HC595 under its 70 mA total. Never connect an LED without a resistor.'],
  ['Pumps and water', 'Battery + only through the relay. A 1N4007 across each pump (stripe to +) and 100 µF across the battery. Keep every board above and away from the water; give wires a drip loop; never let water reach the HC-SR04 or probe header pins.'],
  ['Keep the sensors dry', 'Point the sprinkler straight down over the fire. DHT22 and MQ-2 go high on the far wall under drip shields (open at the bottom so air still reaches them); the flame sensor looks in through a clear window from outside. Coat the backs of the boards, seal the pin joints and give each wire a drip loop. Water on the hot MQ-2 can crack it. The code keeps the last dry gas reading and holds the fire class while spraying and for 5 s after, and runs the sprinkler at least 5 s once it starts.'],
  ['MQ-2', 'Its heater gets warm (~50 °C): normal. It needs 1–2 minutes to warm up each time (about 24 h the very first time for accurate readings).'],
  ['Testing safely', 'Don’t light fires inside the model. Test the flame sensor with a lighter held briefly 20–30 cm away, outside the model, and the DHT22 with a hair dryer (it reads up to 80 °C).'],
  ['Before you plug in', 'Unplug USB and the battery while rewiring. With a multimeter, check that 5 V and GND are not shorted and the battery polarity is right. Check the Checks tab here first.'],
];

export const CHIPS = [
  ['Same chip, drop-in', '74HC595, SN74HC595N (Texas Instruments), 74HC595N, HC595: identical pinout and code. 74HC595D is the tiny SMD version (needs an adapter board).'],
  ['Better with the ESP32', '74HCT595: same pinout and code, but reads 3.3 V signals reliably at 5 V. Harder to find in PH stores; check Shopee/Lazada.'],
  ['Similar but NOT drop-in', 'CD4094: same idea, different pins (STROBE instead of latch, different output pins), so the wiring changes. 74LS595: old TTL, weak outputs, avoid. TPIC6B595: power shift register whose outputs connect to GND, so LEDs wire from +5 V and the logic is inverted.'],
  ['Different approach', 'PCA9685 (the RGB option here): 16 PWM outputs over I2C, real brightness control. MCP23017 / PCF8574: I2C port expanders (16 / 8 pins), on/off only.'],
  ['“Level shifter” is something else', 'A BSS138 (4-ch) or TXS0108E (8-ch) level shifter converts 3.3 V ↔ 5 V signals between the ESP32 and 5 V modules. It does not add outputs.'],
  ['Where to buy (PH)', 'Makerlab Electronics, e-Gizmo, Alexan, Deeco and Circuit Rocket stock most of these; Shopee and Lazada have everything (check ratings and that the photo matches the part).'],
];
