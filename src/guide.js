// The reference wiring, as a step-by-step build guide.
// Any hole on the same rail counts, because steps are checked electrically (same net), not by exact hole.
export const GUIDE = [
  { title: 'Power rails', part: 'rail', why: 'Bring 3.3 V, 5 V and GND from the ESP32 to the rail board so every module can share them.',
    wires: [['esp.3V3', 'rail.3V3_0', '#f08a24'], ['esp.5V', 'rail.5V_0', '#e5392f'], ['esp.GND1', 'rail.GND_0', '#222428']] },
  { title: 'DHT22 temperature sensor', part: 'dht', why: 'Powered from 3V3 so its DATA line never goes above 3.3 V. DATA → GPIO4.',
    wires: [['dht.VCC', 'rail.3V3_1', '#f08a24'], ['dht.GND', 'rail.GND_1', '#222428'], ['dht.DATA', 'esp.4', '#2fbf5b']] },
  { title: 'MQ-2 gas sensor + divider', part: 'mq2', why: 'The heater needs 5 V. AO goes through the 10k/20k divider so GPIO34 sees at most ~2.8 V.',
    wires: [['mq2.VCC', 'rail.5V_1', '#e5392f'], ['mq2.GND', 'rail.GND_2', '#222428'], ['mq2.AO', 'div.IN', '#b06ee0'], ['div.OUT', 'esp.34', '#b06ee0'], ['div.GND', 'rail.GND_3', '#222428']] },
  { title: 'IR flame sensor', part: 'flame', why: 'Powered from 3V3. DO goes LOW when a flame is seen. DO → GPIO27.',
    wires: [['flame.VCC', 'rail.3V3_2', '#f08a24'], ['flame.GND', 'rail.GND_4', '#222428'], ['flame.DO', 'esp.27', '#f2c230']] },
  { title: 'Tank level: HC-SR04 ultrasonic', part: 'us', why: 'Looks down at the water from above the tank. Needs 5 V. TRIG → GPIO25. ECHO outputs 5 V, so it goes through the 1k/2k divider to GPIO35.',
    wires: [['us.VCC', 'rail.5V_6', '#e5392f'], ['us.GND', 'rail.GND_5', '#222428'], ['us.TRIG', 'esp.25', '#2fa8a8'], ['us.ECHO', 'div2.IN', '#2b8fd6'], ['div2.OUT', 'esp.35', '#2b8fd6'], ['div2.GND', 'rail.GND_12', '#222428']] },
  { title: '2-channel relay', part: 'relay', why: 'Coil side runs on 5 V. IN1 → GPIO16 (sprinkler), IN2 → GPIO17 (refill). Inputs are active-LOW.',
    wires: [['relay.VCC', 'rail.5V_2', '#e5392f'], ['relay.GND', 'rail.GND_6', '#222428'], ['relay.IN1', 'esp.16', '#e0559a'], ['relay.IN2', 'esp.17', '#8bc34a']] },
  { title: '20×4 I2C LCD', part: 'lcd', why: 'I2C bus: SDA → GPIO21, SCL → GPIO22. 5 V for proper contrast.',
    wires: [['lcd.VCC', 'rail.5V_3', '#e5392f'], ['lcd.GND', 'rail.GND_7', '#222428'], ['lcd.SDA', 'esp.21', '#2b8fd6'], ['lcd.SCL', 'esp.22', '#f2c230']] },
  { title: 'LED driver (3× 74HC595)', part: 'sr', why: 'Three chained shift registers turn 3 ESP32 pins into 24 outputs. DATA → GPIO23, CLOCK → GPIO18, LATCH → GPIO13. Powered from 5 V.',
    wires: [['sr.VCC', 'rail.5V_4', '#e5392f'], ['sr.GND', 'rail.GND_8', '#222428'], ['sr.DATA', 'esp.23', '#00c2a8'], ['sr.CLOCK', 'esp.18', '#f2c230'], ['sr.LATCH', 'esp.13', '#b06ee0']] },
  { title: 'LED indicator panel (17 LEDs)', part: 'panel', why: 'Each driver output Qn goes to LED Ln (each LED has its own 220 Ω resistor). The panel GND bus joins the GND rail.',
    wires: [...Array.from({ length: 17 }, (_, i) => ['sr.Q' + i, 'panel.L' + i, ['#2fbf5b', '#2f7de1', '#e5392f', '#2f7de1', '#2fbf5b', '#e5392f', '#ff7f1e', '#2f7de1', '#2fbf5b', '#2fbf5b', '#2f7de1', '#f2c230', '#ff7f1e', '#e5392f', '#2fbf5b', '#ff7f1e', '#e5392f'][i]]), ['panel.GND', 'rail.GND_11', '#222428']] },
  { title: 'Buzzer', part: 'buzz', why: 'SIG → GPIO19 drives the S8050 transistor, which switches the buzzer from 5 V.',
    wires: [['buzz.VCC', 'rail.5V_5', '#e5392f'], ['buzz.GND', 'rail.GND_9', '#222428'], ['buzz.SIG', 'esp.19', '#b06ee0']] },
  { title: 'Pump power: AAA batteries through the relay', part: 'psu', why: 'Battery + (red lead) goes to both COM terminals; each NO feeds a pump’s red lead; each pump’s black lead returns to battery − (black lead). Battery − also joins the GND rail.',
    wires: [['psu.VCC', 'relay.COM1', '#e5392f'], ['psu.VCC', 'relay.COM2', '#e5392f'], ['relay.NO1', 'pumpS.P', '#e5392f'], ['relay.NO2', 'pumpR.P', '#e5392f'],
      ['pumpS.N', 'psu.GND', '#222428'], ['pumpR.N', 'psu.GND', '#222428'], ['psu.GND', 'rail.GND_10', '#222428']] },
];

const SIGNAL = ['#2fbf5b', '#2b8fd6', '#f2c230', '#b06ee0', '#00c2a8', '#e0559a', '#8bc34a', '#ff8a3d'];
let si = 0;
export function autoColor(a, b) {
  const s = a + ' ' + b;
  if (/3V3/.test(s)) return '#f08a24';
  if (/GND|\.N\b/.test(s)) return '#222428';
  if (/5V|VCC|\.P\b|COM|NO\d/.test(s)) return '#e5392f';
  return SIGNAL[si++ % SIGNAL.length];
}
