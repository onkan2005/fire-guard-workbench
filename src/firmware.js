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
const int BLUE[3]   = {0, 60, 255};
const int YELLOW[3] = {255, 170, 0};
const int ORANGE[3] = {255, 60, 0};
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
${PROBES ? `const int PROBE_PIN[4]   = {32, 33, 26, 14};  // wires at 10%, 33%, 66% and 95% of the tank
const int PROBE_LEVEL[4] = {10, 33, 66, 95};` : `const float TANK_EMPTY_CM = 9.34; // sensor-to-water distance when the tank is empty
const float TANK_FULL_CM  = 2.0;  // ...and when it is full (the HC-SR04 can't measure under 2 cm)`}

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
${RGB ? `
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
  float pct = (TANK_EMPTY_CM - d) * 100.0 / (TANK_EMPTY_CM - TANK_FULL_CM);
  return constrain((int)pct, 0, 100);
}
`}
int readGasPpm() {
  int raw = analogRead(MQ2_PIN);
  float pinVolts = raw * 3.3 / 4095.0;
  float sensorVolts = pinVolts * 1.5;            // undo the 2/3 divider
  float ppm = (sensorVolts - 0.3) / 3.9 * 1000.0;  // rough calibration
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

void lcdLine(int row, String text) {
  while (text.length() < 20) text += " ";
  lcd.setCursor(0, row);
  lcd.print(text);
}

void loop() {
  unsigned long now = millis();

  if (now - lastDht >= 2000) {          // the DHT22 needs 2 s between reads
    lastDht = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) temperature = t;
    if (!isnan(h)) humidity = h;
  }

  if (now - lastFast < 250) return;
  lastFast = now;

  flame = digitalRead(FLAME_PIN) == LOW;
  gasPpm = readGasPpm();
  tankPct = readTankPercent();

  // ---- decisions ----
  bool fire = flame || temperature >= (sprinkler ? 33 : 35);
  sprinkler = fire && tankPct > 2;
  if (tankPct <= REFILL_START) refill = true;
  if (tankPct >= REFILL_STOP) refill = false;

  digitalWrite(RELAY_SPR, sprinkler ? RELAY_ON : RELAY_OFF);
  digitalWrite(RELAY_REF, refill ? RELAY_ON : RELAY_OFF);

  // ---- LED indicators ----
  int cls = fireClass();
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
    Serial.printf("T=%.1fC H=%.0f%% gas=%dppm tank=%d%% flame=%d spr=%d ref=%d\n",
                  temperature, humidity, gasPpm, tankPct, flame, sprinkler, refill);
  }
}
`;
}

export const DEFAULT_SKETCH = buildSketch();
