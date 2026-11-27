# Hardware status: what's verified and what isn't

Written 23 November 2026. **Eaglets Code has not been run on a real robot.** No Eaglets PCB V6.2 has been built or powered (see `EagletsPCB-V6.2/README.md`), and no Pico was connected while this was written.

## Verified without hardware

- The pin map in `firmware/eaglets_config.py` matches `EagletsPCB-V6.2/bringup/pins.py` and `verification/design.net`. Checked net by net: AIN1/AIN2 GP3/GP4, BIN1/BIN2 GP6/GP7, nFAULT GP8, nSLEEP GP9, NeoPixel GP5, SDA/SCL GP10/GP11, sound GP12, echo/trig GP13/GP14, line R/L GP15/GP16, dial GP26, J12 GP17/GP18/GP27/GP28.
- All robot code and every generated program compile with **mpy-cross from MicroPython v1.29.0**.
- The library behaves as designed on **fake hardware**: power cap, auto-stop, Stop button, motor fault, USB heartbeat loss, sensor failures.
- The USB protocol code works against a **mock board** that imitates MicroPython's raw REPL and raw-paste mode, byte by byte.
- The app runs in Chrome. The simulator and the mock connect/run/stop flow have been clicked through.

## Must be tested on a real robot before camp

Do these with one robot, wheels off the table, after the board passes `TESTING-GUIDE.md`.

| # | Check | Why it's unverified | If it's wrong |
|---|---|---|---|
| 1 | **Connect** finds the Pico 2 and the first Run installs the library | Real Web Serial and real raw REPL timing never tested | Note the error text. Try *Reinstall robot library* (Advanced mode). |
| 2 | **Stop** halts a `forever` program and the motors stop within a second | Ctrl-C delivery on real USB | Use the power switch. Report it. |
| 3 | **Pulling the USB cable** mid-run stops the motors within ~3 s (battery on) | Heartbeat watchdog reads stdin from a timer callback; only tested on fakes | Treat the power switch as the only stop until fixed. |
| 4 | **Move forward** drives forward and **turn left** turns left | Motor plugs aren't keyed | Tick *Left/Right wheel spins backwards* in ⚙ Instructor settings. |
| 5 | Wheels don't stutter and the Pico doesn't reset when motors start | Current spike vs. linear regulator | Lower *Power at 100% speed*. |
| 6 | **LED stick** colours are right, at the 25% cap | Pad order and colour order of the generic stick | Check the stick wiring. |
| 7 | **Distance** reads within ~2 cm at 10/50/100 cm. Unplugged sensor gives "isn't answering" | RCWL-9610A module mode; timeout behaviour | Confirm GPIO mode on the module. |
| 8 | **Swipe** directions match the block names | Mounting orientation of the APDS-9960 | Change *Sensor rotation* (0/90/180/270). |
| 9 | **Colour** names are right for your colour cards | Thresholds are first guesses | Tune *colour* settings; see below. |
| 10 | **Tilt left/right/forward/back** and **tilt angle** signs are right | IMU is mounted under the lid; the axis mapping is a guess | Set the *IMU axis* settings (see below). |
| 11 | **Turn 90 degrees** turns roughly 90° | Needs the yaw axis and sign right | Fix row 10 first. |
| 12 | **Shake** triggers once per shake, not when driving | `SHAKE_G = 0.8` is a guess | Raise or lower *Shake strength*. |
| 13 | **Dial** goes 0 → 100 clockwise | Pot wiring direction | Tick *Dial reads backwards*. |
| 14 | **Line sensors** and **sound sensor** (Advanced mode) | Module output polarity | Line: flip `LINE_DARK_VALUE` (0/1). |
| 15 | **Desktop app** connects to the Pico with no picker (one robot) and shows a chooser (two robots) | Electron's serial handling was only run against the mock board and unit-tested port logic | Use Chrome or Edge with `npm run dev` instead, and report it. |
| 16 | **Code mode**: run hand-written code, press **Stop** mid-loop | Same raw REPL path as blocks, but never run on a real board | Same as row 2. |

### Setting the IMU axes (row 10)

1. Connect, switch Beginner mode off, and build: `forever → show (acceleration X) in console`, plus the same for Y and Z, then `wait 0.5`.
2. With the robot flat, the axis reading about **+1** is "up". If it reads **−1**, that axis is up with a minus sign (for example `-z`).
3. Tip the nose down. The axis that goes **negative** is "forward".
4. Tip the left side down. The axis that goes **negative** is "left".
5. Enter these in ⚙ Instructor settings → Motion sensor.

## Optional buzzer

The V6.2 board has **no buzzer**. Sound blocks stay hidden until an instructor picks a buzzer pin. A piezo can be wired to expansion header J12 on **GP17, GP27 or GP28**. **GP18 is deliberately not offered**: it shares PWM slice 1 with GP3 (left motor), and a tone there would change the motor's PWM frequency. A passive piezo needs a series resistor (about 100 Ω). Check its current against the Pico's GPIO limits before fitting it to 600 kits.

## Kit modules (from the V6.2 active kit BOM, 20 Oct 2026)

The drivers match the modules in the BOM:

| Module | BOM line | Eaglets Code uses it as |
|---|---|---|
| Adafruit APDS-9960 #3595 | Modules | `apds9960.py`, I2C 0x39 on J5 |
| Adafruit LSM6DS3TR-C #4503 | Modules | `lsm6ds3.py`, I2C 0x6A on J6 (50 mm STEMMA QT #4399) |
| Generic HC-SR04P 3–5.5 V (Yuuhseel) | Modules | trigger/echo on GP14/GP13; module must ship in GPIO mode |
| Generic WS2812B 8-LED stick (DIYmall) | Modules | MicroPython `neopixel`, GRB order, 25% cap |
| TCRT5000 line sensors ×2 | Modules | digital input; `LINE_DARK_VALUE = 1` (typical LM393 boards output HIGH over black) |
| LM393 sound sensor, digital out | Modules | edge counter, so output polarity doesn't matter |
| Adafruit 10k potentiometer #562 | Remote | ADC0, 0–100% |
| DRV8833 #3297 + generic TT motors | Modules / Drive | PWM on GP3/4 and GP6/7, nSLEEP GP9, nFAULT GP8 |

There is **no buzzer in the BOM**, so sound blocks stay off by default.

**USB cables aren't in the kit.** The BOM excludes "a USB cable per kit". Eaglets Code needs a **micro-USB data cable** (not charge-only) for every robot at camp, so add them to the camp equipment list.

## Information still needed

- **How the IMU board is mounted** (which way up, which way round). That settles row 10.
- **Whether the LED stick's first LED is at the cable end.** LED numbering in the blocks assumes 1 = nearest the cable.
- **Battery cutoff voltage** from bench step 7. The library doesn't monitor battery voltage yet, because VSYS includes USB power and can't tell you the battery level on its own.
