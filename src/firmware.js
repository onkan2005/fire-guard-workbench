export const DEFAULT_SKETCH = String.raw`// Fire Guard: ESP32 fire detection, auto-sprinkler and tank refill
// Board: ESP32 Dev Module. Libraries: DHT sensor library, LiquidCrystal I2C.
// LED indicators: 17 single 5 mm LEDs driven by three chained 74HC595 shift registers.
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

// ---- pins (match the wiring guide) ----
#define DHT_PIN       4
#define MQ2_PIN       34   // MQ-2 AO through the 10k/20k divider
#define FLAME_PIN     27   // LOW = flame seen
#define TRIG_PIN      25   // HC-SR04 TRIG
#define ECHO_PIN      35   // HC-SR04 ECHO through the 1k/2k divider (5 V -> 3.3 V)
#define RELAY_SPR     16   // IN1 -> sprinkler pump
#define RELAY_REF     17   // IN2 -> refill pump
#define BUZZER_PIN    19
#define SR_DATA       23   // 74HC595 DS (data)
#define SR_CLOCK      18   // 74HC595 SHCP (shift clock)
#define SR_LATCH      13   // 74HC595 STCP (latch)

#define RELAY_ON  LOW      // these relay boards are active-LOW
#define RELAY_OFF HIGH

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

// ---- tuning ----
const int GAS_ALARM_PPM = 300;
const int REFILL_START  = 30;   // % tank
const int REFILL_STOP   = 95;
const float TANK_EMPTY_CM = 9.34; // sensor-to-water distance when the tank is empty
const float TANK_FULL_CM  = 2.0;  // ...and when it is full (the HC-SR04 can't measure under 2 cm)

DHT dht(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 20, 4);

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
unsigned long ledBits = 0;

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

void setup() {
  Serial.begin(115200);
  pinMode(FLAME_PIN, INPUT);
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
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
  pinMode(SR_DATA, OUTPUT);
  pinMode(SR_CLOCK, OUTPUT);
  pinMode(SR_LATCH, OUTPUT);
  ledBits = 0;
  showLeds();                     // all LEDs off at start-up

  lcd.setCursor(0, 0);
  lcd.print("Fire Guard v1.0");
  lcd.setCursor(0, 1);
  lcd.print("Warming up...");
  Serial.println("Fire Guard ready");
  delay(1500);
  lcd.clear();
}

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

  // ---- LED indicators: one LED lit per row ----
  int cls = fireClass();
  ledBits = 0;
  setLed(sprinkler ? LED_SPR_ON : LED_SPR_STBY);
  if (refill) setLed(tankPct < 33 ? LED_REF_THIRD : tankPct < 66 ? LED_REF_TWO3 : LED_REF_FULL);
  setLed(tankPct <= 5 ? LED_TANK_EMPTY : tankPct < 35 ? LED_TANK_LOW : tankPct < 80 ? LED_TANK_HALF : LED_TANK_FULL);
  if (cls > 0) setLed(LED_FIRE_LOW + cls - 1);   // no fire = all fire-class LEDs off
  setLed(flame ? LED_FUME_FIRE : gasPpm >= GAS_ALARM_PPM ? LED_FUME_GAS : LED_FUME_OK);
  showLeds();

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
