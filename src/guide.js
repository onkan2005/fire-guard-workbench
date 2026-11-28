// The reference wiring, as a step-by-step build guide.
// Any hole on the same rail counts, because steps are checked electrically (same net), not by exact hole.
// Steps with `option` only apply to that build option (see OPTIONS / guideFor()).
const LED_COLORS = ['#2fbf5b', '#2f7de1', '#e5392f', '#2f7de1', '#2fbf5b', '#e5392f', '#ff7f1e', '#2f7de1', '#2fbf5b', '#2fbf5b', '#2f7de1', '#f2c230', '#ff7f1e', '#e5392f', '#2fbf5b', '#ff7f1e', '#e5392f'];

// RGB panel wiring from a PCA9685 (breakout `pca` or servo shield `pcas`): channel 3n → red leg of LED n, 3n+1 → green, 3n+2 → blue
function rgbPanelStep(drv, board, note) {
  return { title: 'RGB LED panel (5 LEDs)', part: 'rgb', option: [['leds', 'rgb'], ['board', board]], why: `Channel 3n → red leg of LED n, 3n+1 → green, 3n+2 → blue (${note}). The shared cathode goes to GND.`,
    wires: [...Array.from({ length: 15 }, (_, n) => [drv + '.PWM' + n, 'rgb.' + 'RGB'[n % 3] + Math.floor(n / 3), ['#e5392f', '#2fbf5b', '#2f7de1'][n % 3]]), ['rgb.GND', 'rail.GND_11', '#222428']] };
}

export const GUIDE = [
  { title: 'Power rails', part: 'rail', why: 'Bring 3.3 V, 5 V and GND from the ESP32 to the breadboard rails so every module can share them. A pin only ever takes one jumper: when several pins share a signal, they meet in a breadboard row.',
    wires: [['esp.3V3', 'rail.3V3_0', '#f08a24'], ['esp.5V', 'rail.5V_0', '#e5392f'], ['esp.GND1', 'rail.GND_0', '#222428']] },
  { title: 'DHT22 temperature sensor', part: 'dht', why: 'Powered from 3V3 so its DATA line never goes above 3.3 V. Pins on the module: GND → GND rail, VCC → 3V3 rail, DAT → GPIO4.',
    wires: [['dht.VCC', 'rail.3V3_1', '#f08a24'], ['dht.GND', 'rail.GND_1', '#222428'], ['dht.DATA', 'esp.4', '#2fbf5b']] },
  { title: 'MQ-2 gas sensor + divider', part: 'mq2', why: 'The heater needs 5 V. AO goes through the 10k/20k divider so GPIO34 sees at most ~2.8 V.',
    wires: [['mq2.VCC', 'rail.5V_1', '#e5392f'], ['mq2.GND', 'rail.GND_2', '#222428'], ['mq2.AO', 'div.IN', '#b06ee0'], ['div.OUT', 'esp.34', '#b06ee0'], ['div.GND', 'rail.GND_3', '#222428']] },
  { title: 'IR flame sensor', part: 'flame', why: 'Powered from 3V3. DO goes LOW when a flame is seen. DO → GPIO27.',
    wires: [['flame.VCC', 'rail.3V3_2', '#f08a24'], ['flame.GND', 'rail.GND_4', '#222428'], ['flame.DO', 'esp.27', '#f2c230']] },
  { title: 'Tank level: HC-SR04 ultrasonic', part: 'us', option: ['level', 'ultrasonic'], why: 'Looks down at the water from above the tank. Needs 5 V. TRIG → GPIO25. ECHO outputs 5 V, so it goes through the divider to GPIO35: three 1 kΩ resistors, one on top (ECHO → OUT) and two in series below (OUT → GND, together 2 kΩ).',
    wires: [['us.VCC', 'rail.5V_6', '#e5392f'], ['us.GND', 'rail.GND_5', '#222428'], ['us.TRIG', 'esp.25', '#2fa8a8'], ['us.ECHO', 'div2.IN', '#2b8fd6'], ['div2.OUT', 'esp.35', '#2b8fd6'], ['div2.GND', 'rail.GND_12', '#222428']] },
  { title: 'Tank level: DIY wire probes', part: 'probe', option: ['level', 'probes'], why: 'Each probe wire goes through the 470k pull-up board to its GPIO (10% → 32, 33% → 33, 66% → 26, 95% → 14). The common wire → GPIO25, held LOW only while reading.',
    wires: [['probe.P1', 'pull.A1', '#2b8fd6'], ['probe.P2', 'pull.A2', '#2fbf5b'], ['probe.P3', 'pull.A3', '#f2c230'], ['probe.P4', 'pull.A4', '#e5392f'],
      ['pull.B1', 'esp.32', '#2b8fd6'], ['pull.B2', 'esp.33', '#2fbf5b'], ['pull.B3', 'esp.26', '#f2c230'], ['pull.B4', 'esp.14', '#e5392f'],
      ['pull.VCC', 'rail.3V3_7', '#f08a24'], ['probe.COM', 'esp.25', '#9aa3ab']] },
  { title: '2-channel relay', part: 'relay', why: 'VCC → 5V, GND → GND, IN1 → GPIO16 (sprinkler), IN2 → GPIO17 (refill); inputs are active-LOW. On the 3-pin header (JD-VCC, VCC, GND) put the jumper cap on JD-VCC–VCC: it powers the relay coils. Without it the LEDs light but the relays never click.',
    wires: [['relay.JDVCC', 'relay.JVCC', '#f2c230'], ['relay.VCC', 'rail.5V_2', '#e5392f'], ['relay.GND', 'rail.GND_6', '#222428'], ['relay.IN1', 'esp.16', '#e0559a'], ['relay.IN2', 'esp.17', '#8bc34a']] },
  { title: '20×4 I2C LCD', part: 'lcd', option: ['leds', 'single'], why: 'I2C bus through the breadboard’s SDA and SCL rows: GPIO21 → SDA row, GPIO22 → SCL row, then LCD SDA and SCL into the same rows (one jumper per hole, never two on one pin). 5 V for proper contrast.',
    wires: [['lcd.VCC', 'rail.5V_3', '#e5392f'], ['lcd.GND', 'rail.GND_7', '#222428'], ['esp.21', 'rail.SDA_0', '#2b8fd6'], ['esp.22', 'rail.SCL_0', '#f2c230'], ['lcd.SDA', 'rail.SDA_1', '#2b8fd6'], ['lcd.SCL', 'rail.SCL_1', '#f2c230']] },
  { title: '20×4 I2C LCD (own I2C bus)', part: 'lcd', option: ['leds', 'rgb'], why: 'The LCD gets its own I2C bus, away from the PCA9685: SDA → GPIO18, SCL → GPIO23, with short jumpers straight to the ESP32 (the code calls Wire.begin(18, 23)). 5 V for proper contrast.',
    wires: [['lcd.VCC', 'rail.5V_3', '#e5392f'], ['lcd.GND', 'rail.GND_7', '#222428'], ['lcd.SDA', 'esp.18', '#2b8fd6'], ['lcd.SCL', 'esp.23', '#f2c230']] },
  { title: 'LED driver (3× 74HC595)', part: 'sr', option: ['leds', 'single'], why: 'Three chained shift registers turn 3 ESP32 pins into 24 outputs. DATA → GPIO23, CLOCK → GPIO18, LATCH → GPIO13. Powered from 5 V.',
    wires: [['sr.VCC', 'rail.5V_4', '#e5392f'], ['sr.GND', 'rail.GND_8', '#222428'], ['sr.DATA', 'esp.23', '#00c2a8'], ['sr.CLOCK', 'esp.18', '#f2c230'], ['sr.LATCH', 'esp.13', '#b06ee0']] },
  { title: 'LED indicator panel (17 LEDs)', part: 'panel', option: ['leds', 'single'], why: 'Each driver output Qn goes to LED Ln (each LED has its own 330 Ω resistor). The panel GND bus joins the GND rail.',
    wires: [...Array.from({ length: 17 }, (_, i) => ['sr.Q' + i, 'panel.L' + i, LED_COLORS[i]]), ['panel.GND', 'rail.GND_11', '#222428']] },
  { title: 'LED driver (PCA9685, I2C)', part: 'pca', option: [['leds', 'rgb'], ['board', 'breakout']], why: 'SDA → GPIO21, SCL → GPIO22 (Wire1 in the code). The LCD has its own bus on GPIO18/23, so the two never share wires. VCC from 5 V so the green and blue LEDs are bright. OE stays unconnected (outputs on).',
    wires: [['pca.VCC', 'rail.5V_4', '#e5392f'], ['pca.GND', 'rail.GND_8', '#222428'], ['pca.SDA', 'esp.21', '#2b8fd6'], ['pca.SCL', 'esp.22', '#f2c230']] },
  rgbPanelStep('pca', 'breakout', 'the PCA9685 board has the resistors'),
  { title: 'LED driver (PCA9685 servo shield, I2C)', part: 'pcas', option: [['leds', 'rgb'], ['board', 'shield']], why: 'The Uno-style servo shield does not plug onto an ESP32: use male-to-female jumpers from its header pins. SDA → GPIO21 and SCL → GPIO22 (Wire1 in the code; the LCD has its own bus on GPIO18/23), 5V and GND from the rails, VCC-select jumper on 5V so the green and blue LEDs are bright. The green V+ screw terminal is servo power: leave it empty.',
    wires: [['pcas.VCC', 'rail.5V_4', '#e5392f'], ['pcas.GND', 'rail.GND_8', '#222428'], ['pcas.SDA', 'esp.21', '#2b8fd6'], ['pcas.SCL', 'esp.22', '#f2c230']] },
  rgbPanelStep('pcas', 'shield', 'use only the PWM (signal) pin of each servo header; the shield has 220 Ω resistors on the outputs'),
  { title: 'Buzzer', part: 'buzz', why: 'A bare 2-pin active buzzer: long leg (+) → GPIO19, short leg (−) → GND rail. HIGH on GPIO19 makes it beep. Female jumpers slide onto the legs, or plug the buzzer into the breadboard and jumper from its columns.',
    wires: [['buzz.P', 'esp.19', '#b06ee0'], ['buzz.N', 'rail.GND_9', '#222428']] },
  { title: 'Pump power: AAA batteries through the relay', part: 'psu', why: 'The battery has one red and one black lead, so they go into the breadboard’s 6V+ and 6V− rows. 6V+ row → both relay COM terminals; each NO feeds a pump’s red lead; each pump’s black lead → the 6V− row. One wire joins 6V− to the GND rail (common ground), and the pump current stays off the ESP32’s GND rail.',
    wires: [['psu.VCC', 'rail.BATP_0', '#e5392f'], ['rail.BATP_1', 'relay.COM1', '#e5392f'], ['rail.BATP_2', 'relay.COM2', '#e5392f'], ['relay.NO1', 'pumpS.P', '#e5392f'], ['relay.NO2', 'pumpR.P', '#e5392f'],
      ['psu.GND', 'rail.BATN_0', '#222428'], ['pumpS.N', 'rail.BATN_1', '#222428'], ['pumpR.N', 'rail.BATN_2', '#222428'], ['rail.BATN_3', 'rail.GND_10', '#222428']] },
];

// ---------- build options ----------
// `when`: the option only matters (and is only shown) in that build, e.g. the PWM board only with RGB LEDs
export const OPTIONS = {
  leds: { title: 'LED indicators', choices: { single: '17 single LEDs + 74HC595', rgb: '5 RGB LEDs + PCA9685' } },
  board: { title: 'PCA9685 board', when: ['leds', 'rgb'], choices: { breakout: 'Small breakout board', shield: 'Servo shield (Uno size)' } },
  level: { title: 'Tank level sensor', choices: { ultrasonic: 'HC-SR04 ultrasonic', probes: 'DIY wire probes' } },
};
export const DEFAULT_OPTIONS = { leds: 'single', board: 'breakout', level: 'ultrasonic' };
// an `option` is one [key, value] pair or a list of them (all must match)
const optPairs = opt => !opt ? [] : Array.isArray(opt[0]) ? opt : [opt];
export const inBuild = (opt, options) => optPairs(opt).every(([k, v]) => options[k] === v);
export const optionKeys = opt => optPairs(opt).map(([k]) => k);
export const guideFor = options => GUIDE.filter(s => inBuild(s.option, options));

const SIGNAL = ['#2fbf5b', '#2b8fd6', '#f2c230', '#b06ee0', '#00c2a8', '#e0559a', '#8bc34a', '#ff8a3d'];
let si = 0;
export function autoColor(a, b) {
  const s = a + ' ' + b;
  if (/3V3/.test(s)) return '#f08a24';
  if (/GND|\.N\b/.test(s)) return '#222428';
  if (/5V|VCC|\.P\b|COM|NO\d/.test(s)) return '#e5392f';
  return SIGNAL[si++ % SIGNAL.length];
}
