// The Fire Guard sketch, generated for the chosen build options:
//   leds:  'single' = 17 single LEDs on three 74HC595 shift registers
//          'rgb'    = 5 RGB LEDs on a PCA9685 16-channel PWM board (I2C, shares the LCD's wires)
//   level: 'ultrasonic' = HC-SR04 above the tank
//          'probes'     = DIY copper-wire probes in the tank (4 levels + a common wire)
export function buildSketch({ leds = 'single', level = 'ultrasonic' } = {}) {
  const RGB = leds === 'rgb', PROBES = level === 'probes';
  return String.raw`// Fire Guard: ESP32 fire detection, auto-sprinkler and tank refill
// Board: ESP32 Dev Module. Libraries: DHT sensor library, LiquidCrystal I2C${RGB ? ', Adafruit PWM Servo Driver' : ''}.
// LED indicators: ${RGB ? '5 RGB LEDs driven by a PCA9685 PWM board (I2C address 0x40).' : '17 single 5 mm LEDs driven by three chained 74HC595 shift registers.'}
// Tank level: ${PROBES ? 'DIY copper-wire probes (4 levels) with 470k pull-ups.' : 'HC-SR04 ultrasonic sensor above the tank.'}
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Preferences.h>         // ESP32 flash storage for the calibration
${RGB ? '#include <Adafruit_PWMServoDriver.h>\n' : ''}
// ---- pins (match the wiring guide) ----
#define DHT_PIN       4
#define MQ2_PIN       34   // MQ-2 AO through the 10k/20k divider
#define FLAME_PIN     27   // LOW = flame seen
${PROBES ? `#define PROBE_COM     25   // common wire: driven LOW only while reading (less corrosion)` : `#define TRIG_PIN      25   // HC-SR04 TRIG
#define ECHO_PIN      35   // HC-SR04 ECHO through the 1k/2k divider (5 V -> 3.3 V)`}
#define RELAY_SPR     16   // IN1 -> sprinkler pump
#define RELAY_REF     17   // IN2 -> refill pump
#define BUZZER_PIN    19
${RGB ? '' : `#define SR_DATA       23   // 74HC595 DS (data)
#define SR_CLOCK      18   // 74HC595 SHCP (shift clock)
#define SR_LATCH      13   // 74HC595 STCP (latch)
`}
#define RELAY_ON  LOW      // these relay boards are active-LOW
#define RELAY_OFF HIGH
${RGB ? `
// ---- RGB LEDs: LED n uses PCA9685 channels 3n (red), 3n+1 (green), 3n+2 (blue) ----
#define RGB_SPR   0   // sprinkler pump
#define RGB_REF   1   // refill pump
#define RGB_TANK  2   // tank level
#define RGB_FIRE  3   // fire class
#define RGB_FUME  4   // fume sensor
// colours as {red, green, blue}, 0..255
const int OFF[3]    = {0, 0, 0};
const int GREEN[3]  = {0, 255, 0};
const int BLUE[3]   = {0, 0, 255};
const int YELLOW[3] = {255, 50, 0};   // red + a little green (tested on the team's LEDs)
const int ORANGE[3] = {255, 15, 0};   // red + a touch of green
const int RED[3]    = {255, 0, 0};
` : `
// ---- LED panel: bit n = shift register output Qn = LED Ln ----
#define LED_SPR_ON      0   // green  sprinkler pump activated
#define LED_SPR_STBY    1   // blue   sprinkler pump standby
#define LED_REF_THIRD   2   // red    refilling, up to 1/3 full
#define LED_REF_TWO3    3   // blue   refilling, up to 2/3 full
#define LED_REF_FULL    4   // green  refilling, nearly full
#define LED_TANK_EMPTY  5   // red
#define LED_TANK_LOW    6   // orange almost empty
#define LED_TANK_HALF   7   // blue
#define LED_TANK_FULL   8   // green
#define LED_FIRE_LOW    9   // fire class LEDs 9..13: green, blue, yellow, orange, red
#define LED_FUME_OK     14  // green
#define LED_FUME_GAS    15  // orange
#define LED_FUME_FIRE   16  // red
`}
// ---- tuning ----
const int GAS_ALARM_PPM = 300;
const int REFILL_START  = 30;   // % tank
const int REFILL_STOP   = 95;
const unsigned long MIN_SPRAY_MS = 5000;  // once on, the sprinkler runs at least 5 s (no on/off chatter)
const unsigned long SETTLE_MS    = 5000;  // after spraying, wet sensors get 5 s to settle
${PROBES ? `const int PROBE_PIN[4]   = {32, 33, 26, 14};  // wires at 10%, 33%, 66% and 95% of the tank
const int PROBE_LEVEL[4] = {10, 33, 66, 95};` : `const float TANK_EMPTY_CM = 9.34; // default sensor-to-water distance with the tank empty...
const float TANK_FULL_CM  = 2.0;  // ...and full. Calibrate yours: type empty / full in the Serial Monitor`}

DHT dht(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 20, 4);
${RGB ? 'Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);\n' : ''}
float temperature = 28;
float humidity = 60;
int gasPpm = 0;
int tankPct = 0;
bool flame = false;
bool sprinkler = false;
bool refill = false;
unsigned long lastDht = 0;
unsigned long lastFast = 0;
unsigned long lastLog = 0;
unsigned long sprayStart = 0;
unsigned long sprayEnd = 0;
int heldClass = 0;     // fire class shown while spraying / settling
int dryGas = 0;        // last gas reading taken while everything was dry
Preferences prefs;     // calibration is saved in flash: it survives power-off and new uploads
float tempOffset = 0;  // DHT22 correction, set with: temp 29.5
float rawTemp = 28;    // last DHT22 reading before the correction
float mq2CleanV = 0.3; // MQ-2 output in clean air, set with: clean
${PROBES ? '' : `float tankEmptyCm = TANK_EMPTY_CM;  // set with: empty
float tankFullCm = TANK_FULL_CM;    // set with: full
float lastDistCm = -1;
`}${RGB ? `
// Set one RGB LED. PCA9685 duty is 0..4095, so scale 0..255 by 16.
void setRGB(int led, const int c[]) {
  pwm.setPWM(led * 3,     0, c[0] * 16);
  pwm.setPWM(led * 3 + 1, 0, c[1] * 16);
  pwm.setPWM(led * 3 + 2, 0, c[2] * 16);
}
` : `unsigned long ledBits = 0;

void setLed(int bit) {
  ledBits |= (1UL << bit);
}

// Send all 24 bits to the chain, last chip first, then latch them onto the outputs.
void showLeds() {
  digitalWrite(SR_LATCH, LOW);
  shiftOut(SR_DATA, SR_CLOCK, MSBFIRST, (ledBits >> 16) & 0xFF);  // U3: Q16..Q23
  shiftOut(SR_DATA, SR_CLOCK, MSBFIRST, (ledBits >> 8) & 0xFF);   // U2: Q8..Q15
  shiftOut(SR_DATA, SR_CLOCK, MSBFIRST, ledBits & 0xFF);          // U1: Q0..Q7
  digitalWrite(SR_LATCH, HIGH);
}
`}
void setup() {
  Serial.begin(115200);
  pinMode(FLAME_PIN, INPUT);
${PROBES ? `  pinMode(PROBE_COM, INPUT);          // no current through the water between readings
  for (int i = 0; i < 4; i++) pinMode(PROBE_PIN[i], INPUT);   // external 470k pull-ups` : `  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);`}
  pinMode(RELAY_SPR, OUTPUT);
  pinMode(RELAY_REF, OUTPUT);
  digitalWrite(RELAY_SPR, RELAY_OFF);
  digitalWrite(RELAY_REF, RELAY_OFF);
  pinMode(BUZZER_PIN, OUTPUT);
  analogReadResolution(12);
  prefs.begin("fireguard", false);
  tempOffset = prefs.getFloat("tempOffset", 0);
  mq2CleanV = prefs.getFloat("mq2Clean", 0.3);
${PROBES ? '' : `  tankEmptyCm = prefs.getFloat("tankEmpty", TANK_EMPTY_CM);
  tankFullCm = prefs.getFloat("tankFull", TANK_FULL_CM);
`}
  dht.begin();
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
${RGB ? `  pwm.begin();
  pwm.setPWMFreq(1000);           // 1 kHz: no visible flicker
  for (int i = 0; i < 5; i++) setRGB(i, OFF);` : `  pinMode(SR_DATA, OUTPUT);
  pinMode(SR_CLOCK, OUTPUT);
  pinMode(SR_LATCH, OUTPUT);
  ledBits = 0;
  showLeds();                     // all LEDs off at start-up`}

  lcd.setCursor(0, 0);
  lcd.print("Fire Guard v1.0");
  lcd.setCursor(0, 1);
  lcd.print("Warming up...");
  Serial.println("Fire Guard ready");
  printCalibration();
  delay(1500);
  lcd.clear();
}
${PROBES ? `
// Each probe wire is pulled up to 3.3 V by a 470k resistor. When the water reaches it, the water
// connects it to the common wire (held LOW), so it reads LOW. Highest wet wire = the level.
int readTankPercent() {
  pinMode(PROBE_COM, OUTPUT);
  digitalWrite(PROBE_COM, LOW);
  delay(5);
  int level = 0;
  for (int i = 0; i < 4; i++) {
    if (digitalRead(PROBE_PIN[i]) == LOW) level = PROBE_LEVEL[i];
  }
  pinMode(PROBE_COM, INPUT);          // stop the current again: probes last much longer
  return level;
}
` : `
// Distance from the HC-SR04 down to the water, in cm (-1 if no echo came back).
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);         // a 10 µs pulse starts one measurement
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long echoUs = pulseIn(ECHO_PIN, HIGH, 30000);   // round trip time, 30 ms timeout
  if (echoUs == 0) return -1;
  return echoUs * 0.0343 / 2;           // speed of sound 343 m/s, there and back
}

// Water is high = distance is small. Calibrate the two distances on your real tank.
int readTankPercent() {
  float d = readDistanceCm();
  if (d < 0) return tankPct;            // no echo: keep the last reading
  lastDistCm = d;
  float span = tankEmptyCm - tankFullCm;
  if (span < 1) return tankPct;         // empty/full not calibrated sensibly yet
  float pct = (tankEmptyCm - d) * 100.0 / span;
  return constrain((int)pct, 0, 100);
}
`}
int readGasPpm() {
  int raw = analogRead(MQ2_PIN);
  float pinVolts = raw * 3.3 / 4095.0;
  float sensorVolts = pinVolts * 1.5;            // undo the 2/3 divider
  float ppm = (sensorVolts - mq2CleanV) / 3.9 * 1000.0;  // 0 ppm = the clean-air reading saved by: clean
  return max(0, (int)ppm);
}

// 0 none, 1 low, 2 moderate, 3 high, 4 very high, 5 extreme
int fireClass() {
  if (!flame && temperature < 35) return 0;
  if (temperature >= 75) return 5;
  if (temperature >= 65) return 4;
  if (temperature >= 55) return 3;
  if (temperature >= 45) return 2;
  return 1;
}

// ---- calibration: type these in the Serial Monitor (115200 baud, line ending "Newline") ----
//   clean         MQ-2 in clean air, after a few minutes of warm-up: that reading becomes 0 ppm
//   temp 29.5     what a reference thermometer next to the DHT22 reads: corrects the DHT22
${PROBES ? '' : `//   empty         with the tank empty: the HC-SR04 measures the distance to the bottom
//   full          with the tank filled to your full mark: measures the distance to the water
//   dist          prints the distance to the water right now
`}//   cal           shows the saved values         reset   back to the defaults in this code
void printCalibration() {
  Serial.printf("Calibration: DHT22 offset %.1f C, MQ-2 clean air %.2f V", tempOffset, mq2CleanV);
${PROBES ? '' : `  Serial.printf(", tank empty %.1f cm, full %.1f cm", tankEmptyCm, tankFullCm);
`}  Serial.println();
}
${PROBES ? '' : `
// Average 10 readings so one stray echo can't spoil the calibration.
float measureCm() {
  float sum = 0;
  int n = 0;
  for (int i = 0; i < 10; i++) {
    float d = readDistanceCm();
    if (d > 0) { sum += d; n++; }
    delay(60);
  }
  return n > 0 ? sum / n : -1;
}
`}
void handleSerial() {
  if (Serial.available() == 0) return;
  String cmd = Serial.readStringUntil('\n');
  if (cmd.indexOf("temp") >= 0) {
    int sp = cmd.indexOf(' ');
    float ref = cmd.substring(sp + 1).toFloat();
    if (sp < 0 || ref < -20 || ref > 80) { Serial.println("Type: temp 29.5  (what your reference thermometer reads)"); return; }
    tempOffset = ref - rawTemp;
    temperature = rawTemp + tempOffset;
    prefs.putFloat("tempOffset", tempOffset);
    Serial.printf("Saved: DHT22 read %.1f C, thermometer %.1f C -> offset %.1f C\n", rawTemp, ref, tempOffset);
  } else if (cmd.indexOf("clean") >= 0) {
    float sum = 0;
    for (int i = 0; i < 20; i++) { sum += analogRead(MQ2_PIN) * 3.3 / 4095.0 * 1.5; delay(50); }
    mq2CleanV = sum / 20;
    prefs.putFloat("mq2Clean", mq2CleanV);
    Serial.printf("Saved: MQ-2 clean air = %.2f V (now reads 0 ppm)\n", mq2CleanV);
    if (mq2CleanV > 1.5) Serial.println("That is high for clean air: let it warm up longer, air the room, then type clean again.");
  }${PROBES ? '' : ` else if (cmd.indexOf("empty") >= 0 || cmd.indexOf("full") >= 0) {
    bool empty = cmd.indexOf("empty") >= 0;
    float d = measureCm();
    if (d < 0) { Serial.println("No echo: check the HC-SR04 wiring and that it points straight down at the water."); return; }
    if (empty) { tankEmptyCm = d; prefs.putFloat("tankEmpty", d); }
    else { tankFullCm = d; prefs.putFloat("tankFull", d); }
    Serial.printf("Saved: tank %s = %.1f cm from the sensor", empty ? "empty" : "full", d);
    Serial.println();
    if (!empty && d < 3) Serial.println("Warning: closer than 3 cm. The HC-SR04 can't measure under 2 cm; set your full mark lower.");
    if (tankEmptyCm - tankFullCm < 2) Serial.println("Warning: empty and full are less than 2 cm apart. Do empty with the tank empty and full with it full.");
  } else if (cmd.indexOf("dist") >= 0) {
    Serial.printf("Distance to the water: %.1f cm", readDistanceCm());
    Serial.println();
  }`} else if (cmd.indexOf("reset") >= 0) {
    prefs.clear();
    tempOffset = 0;
    mq2CleanV = 0.3;
${PROBES ? '' : `    tankEmptyCm = TANK_EMPTY_CM;
    tankFullCm = TANK_FULL_CM;
`}    Serial.println("Calibration reset to the defaults in the code.");
    printCalibration();
  } else if (cmd.indexOf("cal") >= 0) {
    printCalibration();
  } else {
    Serial.println("Commands: clean, temp 29.5, ${PROBES ? '' : 'empty, full, dist, '}cal, reset");
  }
}

void lcdLine(int row, String text) {
  while (text.length() < 20) text += " ";
  lcd.setCursor(0, row);
  lcd.print(text);
}

void loop() {
  unsigned long now = millis();
  handleSerial();                       // calibration commands typed in the Serial Monitor

  if (now - lastDht >= 2000) {          // the DHT22 needs 2 s between reads
    lastDht = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) { rawTemp = t; temperature = t + tempOffset; }
    if (!isnan(h)) humidity = h;
  }

  if (now - lastFast < 250) return;
  lastFast = now;

  flame = digitalRead(FLAME_PIN) == LOW;
  gasPpm = readGasPpm();
  tankPct = readTankPercent();

  // ---- decisions ----
  bool fire = flame || temperature >= (sprinkler ? 33 : 35);
  bool wasSpraying = sprinkler;
  if (tankPct <= 2) sprinkler = false;                        // never run the pump dry
  else if (fire) sprinkler = true;
  else if (sprinkler && now - sprayStart >= MIN_SPRAY_MS) sprinkler = false;
  if (sprinkler && !wasSpraying) sprayStart = now;
  if (!sprinkler && wasSpraying) sprayEnd = now;
  // Spray and steam make wet sensors noisy: while spraying and for SETTLE_MS after, keep the last
  // dry gas reading and don't let the fire class drop on a wet reading.
  bool settling = sprinkler || (sprayEnd > 0 && now - sprayEnd < SETTLE_MS);
  if (settling) gasPpm = dryGas;
  else dryGas = gasPpm;
  if (tankPct <= REFILL_START) refill = true;
  if (tankPct >= REFILL_STOP) refill = false;

  digitalWrite(RELAY_SPR, sprinkler ? RELAY_ON : RELAY_OFF);
  digitalWrite(RELAY_REF, refill ? RELAY_ON : RELAY_OFF);

  // ---- LED indicators ----
  int cls = fireClass();
  if (settling) {
    if (cls > heldClass) heldClass = cls;  // it can still go up if the fire grows
    cls = heldClass;
  } else {
    heldClass = cls;
  }
${RGB ? `  setRGB(RGB_SPR, sprinkler ? GREEN : BLUE);
  if (!refill) setRGB(RGB_REF, OFF);
  else setRGB(RGB_REF, tankPct < 33 ? RED : tankPct < 66 ? BLUE : GREEN);
  setRGB(RGB_TANK, tankPct <= 5 ? RED : tankPct < 35 ? ORANGE : tankPct < 80 ? BLUE : GREEN);
  if (cls == 0) setRGB(RGB_FIRE, OFF);
  else if (cls == 1) setRGB(RGB_FIRE, GREEN);
  else if (cls == 2) setRGB(RGB_FIRE, BLUE);
  else if (cls == 3) setRGB(RGB_FIRE, YELLOW);
  else if (cls == 4) setRGB(RGB_FIRE, ORANGE);
  else setRGB(RGB_FIRE, RED);
  setRGB(RGB_FUME, flame ? RED : gasPpm >= GAS_ALARM_PPM ? ORANGE : GREEN);` : `  ledBits = 0;
  setLed(sprinkler ? LED_SPR_ON : LED_SPR_STBY);
  if (refill) setLed(tankPct < 33 ? LED_REF_THIRD : tankPct < 66 ? LED_REF_TWO3 : LED_REF_FULL);
  setLed(tankPct <= 5 ? LED_TANK_EMPTY : tankPct < 35 ? LED_TANK_LOW : tankPct < 80 ? LED_TANK_HALF : LED_TANK_FULL);
  if (cls > 0) setLed(LED_FIRE_LOW + cls - 1);   // no fire = all fire-class LEDs off
  setLed(flame ? LED_FUME_FIRE : gasPpm >= GAS_ALARM_PPM ? LED_FUME_GAS : LED_FUME_OK);
  showLeds();`}

  // ---- buzzer: fast beeps for fire, slow for gas ----
  bool gas = gasPpm >= GAS_ALARM_PPM;
  int period = cls > 0 || flame ? 250 : gas ? 750 : 0;
  digitalWrite(BUZZER_PIN, period > 0 && now % (2 * period) < period ? HIGH : LOW);

  // ---- LCD ----
  String classNames[] = {"NONE", "LOW", "MODERATE", "HIGH", "VERY HIGH", "EXTREME"};
  String tankName = tankPct <= 5 ? "EMPTY" : tankPct < 35 ? "NEAR EMPTY" : tankPct < 80 ? "HALF" : "FULL";
  lcdLine(0, "SPR:" + String(sprinkler ? "ON " : "OFF") + " REF:" + String(refill ? "ON" : "OFF"));
  lcdLine(1, "TANK:" + String(tankPct) + "% " + tankName);
  lcdLine(2, "T:" + String((int)round(temperature)) + "C H:" + String((int)round(humidity)) + "% " + (flame ? "FIRE" : gas ? "GAS" : "OK"));
  lcdLine(3, "FIRE:" + classNames[cls]);

  if (now - lastLog >= 2000) {
    lastLog = now;
    Serial.printf("T=%.1fC H=%.0f%% gas=%dppm tank=%d%%${PROBES ? '' : ' dist=%.1fcm'} flame=%d spr=%d ref=%d\n",
                  temperature, humidity, gasPpm, tankPct${PROBES ? '' : ', lastDistCm'}, flame, sprinkler, refill);
  }
}
`;
}

export const DEFAULT_SKETCH = buildSketch();

// Fingerprints of every earlier default sketch (all build options). A saved copy that matches one was never
// edited, so on load it is upgraded to the current default firmware.
const OLD_DEFAULTS = new Set(['3fcba65d', '89ee4aeb', 'b56b166f', '82efd895', '5259a80c', '7669663a', '4318b447', '42ffbfc5', '2b267f86', '7910d3a0']);
export const sketchHash = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, '0'); };
export const isOldDefault = code => OLD_DEFAULTS.has(sketchHash(code));
