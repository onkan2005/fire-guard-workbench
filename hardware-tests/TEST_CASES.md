# Fire Guard dry test (no water container yet)

Upload `fire_guard_dry_test.ino`, then open the Serial Monitor at **115200 baud**, line ending **Newline**.
The tank level is pretended (60 %), and any pump stops after **3 s** so it never runs dry for long.
`3s!` on the LCD means the code wanted the pump on but stopped it after 3 s.

## Safety first
- Lighter flame **20–30 cm** from the flame sensor. Never put a flame near the DHT22, the MQ-2, the wires or the breadboard.
- For the gas test use **unlit** lighter gas only. Work in a ventilated room; keep a damp cloth nearby.
- Pumps: a cup of water to dip them in is better than running them dry, even for 2 s.

| # | Do this | You should see |
|---|---|---|
| 1 | Battery's **red lead unplugged** from the 6V+ row (no switch), plug in USB | LCD `Fire Guard DRY TEST`, then `SPR:OFF REF:OFF TEST`, `TANK:60% HALF*`. Relay LEDs off, buzzer quiet. RGB: sprinkler blue, tank blue, fume green |
| 2 | Plug the red lead into 6V+. Type `pump1` | Relay 1 clicks, sprinkler pump runs 2 s, then stops |
| 3 | Type `pump2` | Relay 2 clicks, refill pump runs 2 s, then stops |
| 4 | Lighter flame 20–30 cm in front of the flame sensor | Flame sensor's DO LED on, LCD `FIRE`, `FIRE:LOW`, fume LED red, fast beeps, sprinkler relay on, after 3 s `SPR:3s!` and it clicks off |
| 5 | Take the flame away | About 5 s later `SPR:OFF`, beeping stops, LEDs back to normal |
| 6 | Let the MQ-2 warm up 3 min. Type `clean`. Then press the lighter's gas button **without** sparking, 2–3 cm from the MQ-2 for 2 s | gas ppm rises above 300: LCD `GAS`, fume LED orange, slow beeps, **no** sprinkler. Clears after about 30 s |
| 7 | Type `heat 10`, `heat 20`, `heat 30`, `heat 40`, `heat 50` (wait 3 s between) | Fire class LED: green (LOW), blue (MODERATE), yellow (HIGH), orange (VERY HIGH), red (EXTREME). LCD `FIRE:` follows. Sprinkler runs 3 s each time it starts |
| 8 | Type `heat 0`. Hold your hand on the DHT22 for a minute (or a hair dryer from 30 cm) | `T:` on the LCD goes up a few degrees |
| 9 | Type `tank 50`, then `tank 20`, then `tank 0` | Tank LED blue → orange → red; LCD HALF → NEAR EMPTY → EMPTY. At 20 % refill turns on (refill LED red), relay 2 runs 3 s, then `REF:3s!` |
| 10 | With `tank 0`, flame at the flame sensor again | Alarm and beeps, but sprinkler stays **OFF** (never pumps from an empty tank) |
| 11 | Type `tank 100` | Tank LED green, `FULL`, refill off |
| 12 | Type `dist`, holding your hand flat 10 cm under the HC-SR04 | `Distance to the water: 10.0 cm` (± 1 cm) |
| 13 | Type `real`, move your hand closer and farther | TANK % goes up as your hand gets closer. Type `tank 60` to go back |
| 14 | Type `status` | One line with every reading |

## If a pump runs as soon as the battery is connected
- **ESP32 unplugged and a pump still runs:** that pump's red lead is on the relay's **NC** screw. Move it to **NO**.
- **Only with the normal sketch:** that was the refill pump. With no container the HC-SR04 sees the table far away,
  reads the tank as empty and starts refilling. The dry test sketch pretends the level, so this stops.
- **Both pumps run whenever the ESP32 is on:** check the relay board's trigger jumper is on **L** (low-level trigger), and that relay VCC is on 5V.
