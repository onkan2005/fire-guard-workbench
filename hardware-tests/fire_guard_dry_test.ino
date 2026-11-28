// Fire Guard: DRY TEST version, for testing everything before the water container is ready.
// Same as the normal sketch, plus:
//   - The tank level is pretended (no container yet), so the refill pump no longer starts on its own.
//     The pretend water moves (by the clock, so a slow loop can't upset it): every fire sprays 3 s and the
//     tank drops to 30 %, then the refill pump runs 3 s and the tank climbs back to 96 %.
//   - A real flame flickers, so a flame seen in the last 1.5 s still counts (no red/green flashing, no restarts).
//   - At start-up the LCD and Serial Monitor say why the ESP32 (re)started: a BROWNOUT means the pumps
//     pulled the power down. Every pump step is printed in the Serial Monitor.
//   - A pump may run at most 3 s at a time (pumps must not run dry for long), then it is locked out.
//   - Serial Monitor commands (115200 baud, line ending "Newline"):
//       tank 60     pretend the tank is 60 % full (20 starts the refill, 100 ends it, 0 = empty)
//       real        use the HC-SR04 for the tank level again
//       heat 30     add 30 C to the temperature reading to test the fire classes (heat 0 = off)
//       pump1       run the sprinkler pump for 2 s        pump2   run the refill pump for 2 s
//       status      print the readings now
//   - Relay OFF releases the pin instead of driving it to 3.3 V, so 5 V relay boards really switch off.
//   - If the DHT22 doesn't answer for 6 s, the LCD shows T:?? DHT22 ERR and the Serial Monitor says what to check.
//     (A single failed read while a pump runs is normal: motor noise. The last good value is kept.)
//   - The LCD recovers by itself from electrical noise (pump motor, relay clicks): slower I2C, it only
//     rewrites text that changed, and it re-syncs after every relay click and every 10 s.
//   - Plus the normal calibration commands: clean, temp 29.5, empty, full, dist, cal, reset.
// When the container is ready, go back to the normal sketch.

// Board: ESP32 Dev Module. Libraries: DHT sensor library, LiquidCrystal I2C, Adafruit PWM Servo Driver.
// LED indicators: 5 RGB LEDs driven by a PCA9685 PWM board (I2C address 0x40).
// Tank level: HC-SR04 ultrasonic sensor above the tank.
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Preferences.h>         // ESP32 flash storage for the calibration
#include <Adafruit_PWMServoDriver.h>
#include <esp_system.h>           // esp_reset_reason(): why the ESP32 (re)started

// ---- pins (match the wiring guide) ----
#define DHT_PIN       4
#define MQ2_PIN       34   // MQ-2 AO through the 10k/20k divider
#define FLAME_PIN     27   // LOW = flame seen
#define TRIG_PIN      25   // HC-SR04 TRIG
#define ECHO_PIN      35   // HC-SR04 ECHO through the 1k/2k divider (5 V -> 3.3 V)
#define RELAY_SPR     16   // IN1 -> sprinkler pump
#define RELAY_REF     17   // IN2 -> refill pump
#define BUZZER_PIN    19

#define RELAY_ON  LOW      // these relay boards are active-LOW
#define RELAY_OFF HIGH

// 5 V relay boards often stay ON when the ESP32 says "off", because its HIGH is only 3.3 V.
// So for OFF the pin is released (INPUT): the relay board's own pull-up resistor takes IN to its 5 V.
// For ON the pin is driven LOW. Keep the relay board's trigger jumper (if it has one) on L.
void relayWrite(int pin, bool on) {
  if (on) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  } else {
    pinMode(pin, INPUT);
  }
}

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

// ---- tuning ----
const int GAS_ALARM_PPM = 300;
const int REFILL_START  = 30;   // % tank
const int REFILL_STOP   = 95;
const unsigned long MIN_SPRAY_MS = 5000;  // once on, the sprinkler runs at least 5 s (no on/off chatter)
const unsigned long SETTLE_MS    = 5000;  // after spraying, wet sensors get 5 s to settle
const float TANK_EMPTY_CM = 9.34; // default sensor-to-water distance with the tank empty...
const float TANK_FULL_CM  = 2.0;  // ...and full. Calibrate yours: type empty / full in the Serial Monitor

// ---- DRY TEST settings ----
bool fakeTank = true;          // true: pretend the tank level below. Type "real" to use the HC-SR04
int fakeTankPct = 60;          // 60 % = no refill, and the sprinkler is allowed. Change with: tank 20
float fakeTankF = 60;          // the pretended level with decimals: it drains while spraying and fills while refilling
float sprayFrom = 60;          // pretend level when the current spray started (it drains to REFILL_START in 3 s)
float fillFrom = 30;           // pretend level when the current refill started (it fills to REFILL_STOP + 1 in 3 s)
bool wasSpraying2 = false;     // the sprinkler pump was running on the last loop
bool wasRefilling = false;     // the refill pump was running on the last loop
const unsigned long FLAME_HOLD_MS = 1500;  // a flame seen in the last 1.5 s still counts (real flames flicker)
unsigned long lastFlameSeen = 0;
int relayState[2] = {-1, -1};  // what each relay pin was last set to, so it is only changed when needed
float testHeat = 0;            // added to the temperature, for testing fire classes. Change with: heat 30
const unsigned long MAX_PUMP_MS = 3000;  // longest a pump may run without water
unsigned long sprPumpStart = 0;
unsigned long refPumpStart = 0;
bool sprLocked = false;        // true: the 3 s ran out, the pump stays off until the reason to run is gone
bool refLocked = false;
String lcdShown[4];            // what each LCD row shows now, so only changed text is sent
unsigned long lastLcdSync = 0; // when the LCD was last re-synced
int lastRelays = -1;           // relay outputs last time, to re-sync the LCD after a click
int dhtFails = 0;              // DHT22 reads in a row that gave no answer (NaN)
const int DHT_ERR_AFTER = 3;   // pump noise spoils the odd read: keep the last good value, only show an error after 3 in a row (6 s)


// Set relay 0 (sprinkler) or 1 (refill), but only touch the pin when its state really changes.
void setRelay(int idx, bool on) {
  if (relayState[idx] == (on ? 1 : 0)) return;
  relayState[idx] = on ? 1 : 0;
  relayWrite(idx == 0 ? RELAY_SPR : RELAY_REF, on);
}

DHT dht(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 20, 4);
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

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
float tankEmptyCm = TANK_EMPTY_CM;  // set with: empty
float tankFullCm = TANK_FULL_CM;    // set with: full
float lastDistCm = -1;

// Set one RGB LED. PCA9685 duty is 0..4095, so scale 0..255 by 16.
void setRGB(int led, const int c[]) {
  pwm.setPWM(led * 3,     0, c[0] * 16);
  pwm.setPWM(led * 3 + 1, 0, c[1] * 16);
  pwm.setPWM(led * 3 + 2, 0, c[2] * 16);
}

void setup() {
  Serial.begin(115200);
  pinMode(FLAME_PIN, INPUT);
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  setRelay(0, false);             // released = OFF (see relayWrite)
  setRelay(1, false);
  pinMode(BUZZER_PIN, OUTPUT);
  analogReadResolution(12);
  prefs.begin("fireguard", false);
  tempOffset = prefs.getFloat("tempOffset", 0);
  mq2CleanV = prefs.getFloat("mq2Clean", 0.3);
  tankEmptyCm = prefs.getFloat("tankEmpty", TANK_EMPTY_CM);
  tankFullCm = prefs.getFloat("tankFull", TANK_FULL_CM);

  dht.begin();
  Wire.begin(21, 22);
  Wire.setClock(50000);           // 50 kHz: slower but much less upset by noise from the pumps
  lcd.init();
  lcd.backlight();
  pwm.begin();
  pwm.setPWMFreq(1000);           // 1 kHz: no visible flicker
  for (int i = 0; i < 5; i++) setRGB(i, OFF);

  // why did the ESP32 (re)start? A BROWNOUT right when a pump starts means the pumps pull the 5 V down.
  int rr = esp_reset_reason();
  String why = rr == ESP_RST_POWERON ? "power on" : rr == ESP_RST_EXT ? "EN button" : rr == ESP_RST_SW ? "upload/restart" :
               rr == ESP_RST_BROWNOUT ? "BROWNOUT" : rr == ESP_RST_PANIC ? "CRASH" :
               (rr == ESP_RST_INT_WDT || rr == ESP_RST_TASK_WDT || rr == ESP_RST_WDT) ? "WATCHDOG" : "other";
  lcd.setCursor(0, 0);
  lcd.print("Fire Guard DRY TEST");
  lcd.setCursor(0, 1);
  lcd.print("Warming up...");
  lcd.setCursor(0, 2);
  lcd.print("Start: " + why);
  Serial.println("Fire Guard ready");
  Serial.println("TEST: started because of: " + why);
  if (rr == ESP_RST_BROWNOUT) Serial.println("TEST: BROWNOUT = the 5 V dropped too low. The pumps/relays are pulling it down: use a 5 V 2 A charger, and fit the diodes.");
  printCalibration();
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
  if (d >= 0) lastDistCm = d;
  if (fakeTank) return fakeTankPct;     // DRY TEST: pretended level
  if (d < 0) return tankPct;            // no echo: keep the last reading
  float span = tankEmptyCm - tankFullCm;
  if (span < 1) return tankPct;         // empty/full not calibrated sensibly yet
  float pct = (tankEmptyCm - d) * 100.0 / span;
  return constrain((int)pct, 0, 100);
}

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
//   empty         with the tank empty: the HC-SR04 measures the distance to the bottom
//   full          with the tank filled to your full mark: measures the distance to the water
//   dist          prints the distance to the water right now
//   cal           shows the saved values         reset   back to the defaults in this code
void printCalibration() {
  Serial.printf("Calibration: DHT22 offset %.1f C, MQ-2 clean air %.2f V", tempOffset, mq2CleanV);
  Serial.printf(", tank empty %.1f cm, full %.1f cm", tankEmptyCm, tankFullCm);
  Serial.println();
}

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

void handleSerial() {
  if (Serial.available() == 0) return;
  String cmd = Serial.readStringUntil('\n');
  // ---- DRY TEST commands ----
  if (cmd.indexOf("tank") >= 0) {
    fakeTank = true;
    fakeTankPct = constrain(cmd.substring(cmd.indexOf(' ') + 1).toInt(), 0, 100);
    fakeTankF = fakeTankPct;
    sprayFrom = fakeTankF;
    Serial.printf("TEST: pretending the tank is %d%% full\n", fakeTankPct);
    return;
  }
  if (cmd.indexOf("real") >= 0) {
    fakeTank = false;
    Serial.println("TEST: tank level from the HC-SR04 again");
    return;
  }
  if (cmd.indexOf("heat") >= 0) {
    testHeat = cmd.substring(cmd.indexOf(' ') + 1).toFloat();
    temperature = rawTemp + tempOffset + testHeat;
    Serial.printf("TEST: adding %.0f C, temperature now %.1f C\n", testHeat, temperature);
    return;
  }
  if (cmd.indexOf("pump1") >= 0 || cmd.indexOf("pump2") >= 0) {
    bool spr = cmd.indexOf("pump1") >= 0;
    Serial.println(spr ? "TEST: sprinkler pump ON for 2 s" : "TEST: refill pump ON for 2 s");
    relayWrite(spr ? RELAY_SPR : RELAY_REF, true);
    delay(2000);
    relayWrite(spr ? RELAY_SPR : RELAY_REF, false);
    Serial.println("TEST: pump OFF");
    return;
  }
  if (cmd.indexOf("status") >= 0) {
    Serial.printf("T=%.1fC (heat +%.0f) H=%.0f%% gas=%dppm tank=%d%%%s dist=%.1fcm flame=%d spr=%d ref=%d\n",
                  temperature, testHeat, humidity, gasPpm, tankPct, fakeTank ? " (pretend)" : "", lastDistCm, flame, sprinkler, refill);
    return;
  }
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
  } else if (cmd.indexOf("empty") >= 0 || cmd.indexOf("full") >= 0) {
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
  } else if (cmd.indexOf("reset") >= 0) {
    prefs.clear();
    tempOffset = 0;
    mq2CleanV = 0.3;
    tankEmptyCm = TANK_EMPTY_CM;
    tankFullCm = TANK_FULL_CM;
    Serial.println("Calibration reset to the defaults in the code.");
    printCalibration();
  } else if (cmd.indexOf("cal") >= 0) {
    printCalibration();
  } else {
    Serial.println("Commands: tank 60, real, heat 30, pump1, pump2, status, clean, temp 29.5, empty, full, dist, cal, reset");
  }
}

void lcdLine(int row, String text) {
  while (text.length() < 20) text += " ";
  if (text == lcdShown[row]) return;    // unchanged: don't resend (fewer chances for noise to garble it)
  lcd.setCursor(0, row);
  lcd.print(text);
  lcdShown[row] = text;
}

// Noise can knock the LCD out of step, and then every character after it is garbage until it is
// reset. Re-initialise it and redraw everything: done after each relay click and every 10 s.
void lcdResync() {
  lcd.init();
  lcd.backlight();
  for (int i = 0; i < 4; i++) lcdShown[i] = "";
  lastLcdSync = millis();
}

void loop() {
  unsigned long now = millis();
  handleSerial();                       // calibration commands typed in the Serial Monitor

  if (now - lastDht >= 2000) {          // the DHT22 needs 2 s between reads
    lastDht = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) { rawTemp = t; temperature = t + tempOffset + testHeat; }
    if (!isnan(h)) humidity = h;
    if (isnan(t) || isnan(h)) {         // DRY TEST: say so, instead of quietly keeping 28 C / 60 %
      dhtFails++;
      if (dhtFails == DHT_ERR_AFTER || (dhtFails > DHT_ERR_AFTER && dhtFails % 5 == 0))
        Serial.println("TEST: DHT22 gives no reading. Check: GND -> GND rail, VCC -> 3V3 rail, DAT -> GPIO4, and that the pins are not swapped.");
    } else {
      if (dhtFails >= DHT_ERR_AFTER) Serial.println("TEST: DHT22 is answering again.");
      dhtFails = 0;
    }
  }

  if (now - lastFast < 250) return;
  lastFast = now;

  bool flameNow = digitalRead(FLAME_PIN) == LOW;
  if (flameNow) lastFlameSeen = now;
  flame = flameNow || (lastFlameSeen > 0 && now - lastFlameSeen < FLAME_HOLD_MS);  // a real flame flickers: hold it
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

  // ---- DRY TEST: a pump may run at most MAX_PUMP_MS, then it stays off until its reason to run is gone ----
  if (!sprinkler) { sprLocked = false; sprPumpStart = 0; }
  else if (sprPumpStart == 0) sprPumpStart = now;
  if (sprinkler && !sprLocked && now - sprPumpStart >= MAX_PUMP_MS) {
    sprLocked = true;
    if (fakeTank && fakeTankF > REFILL_START) fakeTankF = REFILL_START;  // 3 s of spraying ends at the refill level
    Serial.println(fakeTank ? "TEST: sprinkler ran 3 s, pretend tank now 30 % -> refill starts" : "TEST: sprinkler pump stopped after 3 s (no water). It stays off until the fire is gone.");
  }
  if (!refill) { refLocked = false; refPumpStart = 0; }
  else if (refPumpStart == 0) refPumpStart = now;
  if (refill && !refLocked && now - refPumpStart >= MAX_PUMP_MS) {
    refLocked = true;
    if (fakeTank) fakeTankF = REFILL_STOP + 1;  // 3 s of refilling ends full, so the refill switches off
    Serial.println(fakeTank ? "TEST: refill ran 3 s, pretend tank full again" : "TEST: refill pump stopped after 3 s (no water). Type tank 100 to end the refill (it stops at 95 %).");
  }
  setRelay(0, sprinkler && !sprLocked);
  setRelay(1, refill && !refLocked);
  // DRY TEST: pretend the water moves, so one fire runs the whole cycle with the real logic. It goes by
  // the clock (not by loop passes), so a slow loop can't stop it: spraying takes the tank to 30 % in 3 s,
  // the refill then starts (tank <= 30 %) and takes it to 96 % in 3 s, and the refill stops (tank >= 95 %).
  if (fakeTank) {
    bool sprOn = sprinkler && !sprLocked, refOn = refill && !refLocked;
    if (sprOn && !wasSpraying2) { sprayFrom = fakeTankF; Serial.println("TEST: sprinkler pump ON"); }
    if (refOn && !wasRefilling) { fillFrom = fakeTankF; Serial.println("TEST: refill pump ON"); }
    if (!refOn && wasRefilling) Serial.println("TEST: refill pump OFF");
    wasSpraying2 = sprOn;
    wasRefilling = refOn;
    if (sprOn && sprayFrom > REFILL_START) {
      float f = constrain((now - sprPumpStart) / (float)MAX_PUMP_MS, 0, 1);
      fakeTankF = sprayFrom - (sprayFrom - REFILL_START) * f;
    }
    if (refOn) {
      float f = constrain((now - refPumpStart) / (float)MAX_PUMP_MS, 0, 1);
      fakeTankF = fillFrom + (REFILL_STOP + 1 - fillFrom) * f;
    }
    fakeTankPct = (int)(fakeTankF + 0.5);
  }
  int relays = (sprinkler && !sprLocked ? 1 : 0) + (refill && !refLocked ? 2 : 0);
  if (relays != lastRelays) {           // a relay just clicked: give the spike a moment, then re-sync the LCD
    lastRelays = relays;
    delay(50);
    lcdResync();
  } else if (now - lastLcdSync >= 10000) {
    lcdResync();
  }

  // ---- LED indicators ----
  int cls = fireClass();
  if (settling) {
    if (cls > heldClass) heldClass = cls;  // it can still go up if the fire grows
    cls = heldClass;
  } else {
    heldClass = cls;
  }
  setRGB(RGB_SPR, sprinkler ? GREEN : BLUE);
  if (!refill) setRGB(RGB_REF, OFF);
  else setRGB(RGB_REF, tankPct < 33 ? RED : tankPct < 66 ? BLUE : GREEN);
  setRGB(RGB_TANK, tankPct <= 5 ? RED : tankPct < 35 ? ORANGE : tankPct < 80 ? BLUE : GREEN);
  if (cls == 0) setRGB(RGB_FIRE, OFF);
  else if (cls == 1) setRGB(RGB_FIRE, GREEN);
  else if (cls == 2) setRGB(RGB_FIRE, BLUE);
  else if (cls == 3) setRGB(RGB_FIRE, YELLOW);
  else if (cls == 4) setRGB(RGB_FIRE, ORANGE);
  else setRGB(RGB_FIRE, RED);
  setRGB(RGB_FUME, flame ? RED : gasPpm >= GAS_ALARM_PPM ? ORANGE : GREEN);

  // ---- buzzer: fast beeps for fire, slow for gas ----
  bool gas = gasPpm >= GAS_ALARM_PPM;
  int period = cls > 0 || flame ? 250 : gas ? 750 : 0;
  digitalWrite(BUZZER_PIN, period > 0 && now % (2 * period) < period ? HIGH : LOW);

  // ---- LCD ----
  String classNames[] = {"NONE", "LOW", "MODERATE", "HIGH", "VERY HIGH", "EXTREME"};
  String tankName = tankPct <= 5 ? "EMPTY" : tankPct < 35 ? "NEAR EMPTY" : tankPct < 80 ? "HALF" : "FULL";
  lcdLine(0, "SPR:" + String(sprinkler ? (sprLocked ? "3s!" : "ON ") : "OFF") + " REF:" + String(refill ? (refLocked ? "3s!" : "ON ") : "OFF") + " TEST");
  lcdLine(1, "TANK:" + String(tankPct) + "% " + tankName + (fakeTank ? "*" : ""));
  String th = dhtFails >= DHT_ERR_AFTER ? "T:?? DHT22 ERR" : "T:" + String((int)round(temperature)) + "C H:" + String((int)round(humidity)) + "%";
  lcdLine(2, th + " " + (flame ? "FIRE" : gas ? "GAS" : "OK"));
  lcdLine(3, "FIRE:" + classNames[cls]);

  if (now - lastLog >= 2000) {
    lastLog = now;
    Serial.printf("T=%.1fC H=%.0f%% gas=%dppm tank=%d%% dist=%.1fcm flame=%d spr=%d ref=%d\n",
                  temperature, humidity, gasPpm, tankPct, lastDistCm, flame, sprinkler, refill);
  }
}
