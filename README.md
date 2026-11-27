# Eaglets Code

Block programming for the Eaglets robot kit (Eaglets PCB V6.2 + Raspberry Pi Pico 2).

Students snap blocks together, press **Run on Robot**, and the robot does it. Behind the scenes every program becomes plain MicroPython, and the 🐍 Python button shows exactly what the robot runs.

There's also a **Simulator** tab: a practice robot on screen with an ultrasonic beam, LEDs, a dial, tilt sliders, swipe buttons and a maze. It's for when there aren't enough robots to go round, or when a program needs testing before it touches a real motor.

> **Hardware status:** none of this has run on a real Eaglets robot yet. No V6.2 board has been built. Everything that talks to hardware has been tested against mock hardware only. Read [docs/HARDWARE-STATUS.md](docs/HARDWARE-STATUS.md) before camp.

## Run it

You need Node.js 20 or newer. A camp laptop needs Chrome or Edge, because those are the browsers that can use USB.

```sh
cd BlockCode
npm install
npm run dev            # open http://localhost:5173
```

To hand the app to camp laptops without Node, build it once and serve the `dist` folder from any static web server:

```sh
npm run build          # output in dist/
npm run preview        # serves dist/ on http://localhost:4173 to check it
```

Web Serial only works on `http://localhost` or `https://`. A copy hosted on GitHub Pages works. Opening `dist/index.html` straight from a file does not.

**No robot handy?** Open `http://localhost:5173/?mock=1`. **Connect Robot** then connects to a pretend board that follows the real USB protocol, so you can click through connect → run → stop.

## Desktop app

The same app also runs as a normal Mac app, so it doesn't depend on Chrome or Edge for USB.

```sh
npm run desktop        # build, then open the app in its own window
npm run desktop:dev    # open it against `npm run dev` (reloads as you edit)
npm run desktop:pack   # build a double-clickable app in release/
```

## Installing on other computers

`npm run dist` builds the installers into `release/installers/`:

| File | For |
|---|---|
| `Eaglets-Code-<version>-mac-arm64.dmg` | Macs with Apple silicon (M1 and later) |
| `Eaglets-Code-<version>-mac-x64.dmg` | Intel Macs |
| `Eaglets-Code-<version>-win-x64.exe` | Windows 10 and 11 |

`npm run dist:mac` and `npm run dist:win` build one platform. The Windows installer builds fine on a Mac.

**The installers are not signed or notarized**, so both systems warn the first time:

- **Mac:** "Apple could not verify Eaglets Code is free of malware". Drag the app into Applications, then either open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, or run this once in Terminal:
  `xattr -dr com.apple.quarantine "/Applications/Eaglets Code.app"`
- **Windows:** "Windows protected your PC". Click **More info**, then **Run anyway**.

Removing the warning for good needs an Apple Developer ID (US$99 a year, with notarization) and a Windows code-signing certificate.

If one Pico is plugged in, **Connect Robot** picks it without asking. With several, a small chooser appears.

`desktop:dev` and `desktop` clear `ELECTRON_RUN_AS_NODE`, which VS Code sets and which stops Electron from starting.

## Writing code directly

The **Blocks | Code** switch in the top bar opens a Python editor. It starts from the Python your blocks make. From there you can type your own MicroPython and press **Run on Robot**, which sends exactly what is in the editor.

- Code you edit does not go back into the blocks. **Reset from blocks** replaces your code with fresh Python from the blocks, after asking.
- Your code is saved with the project (`.eaglets`) and autosaved. Opening a project that has code opens it in Code mode.
- The Simulator runs blocks only, so its tab is off in Code mode.
- Block checks don't run on hand-written code. The robot library still caps motor power. The 20-second motor auto-stop and the USB-unplug stop only run after `robot.start()`, which the code made from blocks always calls; keep it in hand-written programs. Code that talks to the pins directly bypasses all of these.
- If a run fails, the line it failed on is highlighted and the message starts with its line number.

### Everything Thonny did

Eaglets Code replaces Thonny for Eaglets robots:

| Thonny | Eaglets Code |
|---|---|
| Install or update MicroPython | **More → Install MicroPython.** MicroPython 1.29.0 for the Pico 2 ships inside the app, so no internet is needed. A robot that already runs MicroPython restarts into install mode by itself. A brand-new Pico needs BOOTSEL held while plugging it in. The desktop app finds the Pico's drive by itself; in Chrome you pick the `RP2350` drive once. |
| Shell (`>>>`) | The **Shell** under the Code editor. Enter runs a line (a line ending in `:` continues on the next line, an empty line runs the block), ↑/↓ recall history, Ctrl+C or **Stop** interrupts. `robot` is ready to use, and variables stay until the next Run. Each entry arms the motor auto-stop, and **Stop** switches motors and lights off even after a Shell command has finished. |
| Files on the Pico | **Files** (robot card, or More → Files on robot): see what's stored and how much space is left; upload, download, rename, delete; open a file into the editor. The four robot library files are labelled and reinstalled on the next Run if deleted. |
| Open/Save `.py` | **Open** takes `.eaglets` projects and `.py` files. In Code mode: **Save** (Ctrl/Cmd+S) writes back to where the code came from, **Save to computer…** and **Save to robot…** pick a new place. Saving as `main.py` on the robot warns that it runs at power-on. In Chrome, Edge and the desktop app Save overwrites the same file; elsewhere it downloads a copy. |
| Plotter | **plot** on the console header graphs the numbers a program prints (`print(robot.distance())`, or `distance: 23 light: 40` for named lines), up to four lines at once. |

The firmware file isn't in the repository until you fetch it once: `npm run fetch-firmware` downloads the pinned official build from micropython.org, checks it's a Pico 2 Arm image, records its SHA-256 (later downloads must match) and saves MicroPython's licence for the third-party notices. Commit `public/firmware/` and `firmware/micropython/LICENSE` so every build has it.

## Connecting a robot

1. Put MicroPython on the Pico once: **More → Install MicroPython**, and follow the steps (hold BOOTSEL while plugging in a brand-new Pico).
2. Wheels off the table. USB cable from the Pico to the laptop. Battery switch ON if the program uses motors.
3. In Eaglets Code, click **Connect Robot** and pick the Pico's port. (Pressing **▶ Run on Robot** while not connected does this for you.) After that, the laptop remembers the robot: it connects by itself when the app opens, and reconnects when the cable is plugged back in.
4. Press **▶ Run on Robot**. The first run copies the robot library (`eaglets.py`, `eaglets_config.py`, `apds9960.py`, `lsm6ds3.py`) onto the Pico. After that, it only copies files when they change.
5. **■ Stop** sends Ctrl-C. The program's `finally:` block switches the motors and LEDs off.

The robot's power switch is the real emergency stop. See the safety checklist in [docs/INSTRUCTOR-GUIDE.md](docs/INSTRUCTOR-GUIDE.md).

**Teacher debug mode** (⚙ Instructor settings, or `?debug=1`) shows board details, full errors and a copyable log of everything the app did. See the instructor guide.

Thonny isn't needed any more (see *Everything Thonny did* above). If you ever want it anyway, ⚙ Instructor settings → *Download robot library files* gives you the four library files to copy onto the Pico.

## Tests

```sh
npm run setup:python   # once: installs mpy-cross (the real MicroPython compiler) into .venv
npm test               # web app: generation, save/load, validation, USB protocol (mock board)
npm run test:firmware  # robot library against fake hardware (python3)
npm run test:e2e       # real Chrome against the running dev server (start `npm run dev` first)
```

What the tests do and don't prove:

| Suite | Checks | Doesn't prove |
|---|---|---|
| `npm test` | Every block generates code that compiles with MicroPython 1.29's own compiler, using only Pico-safe imports. All 12 starters run start to finish on fake hardware and end with motors off and LEDs off. Save/load round-trips exactly. The raw-REPL protocol, library install, run, Stop, busy port, unplugged cable, unresponsive board and friendly errors are tested against a mock board. | That a real Pico answers the same way. |
| `npm run test:firmware` | Power cap, auto-stop, timed-move cap, Stop mid-move, motor fault, USB heartbeat loss, missing sensors, gesture caching, colour naming and the buzzer gate, all with a virtual clock. | Real pin timing, real sensor values, real motor behaviour. |
| `npm run test:e2e` | The app in Chrome: starters, Python view, simulator, mock connect/run/stop, validation, settings, autosave. | Web Serial with a real port. |

## How it's put together

```
src/                     the app (React + Blockly), same code in the browser and desktop app
  App.tsx                  top-level screen: editor, robot panel, run/stop, wiring
  blocks/                  block definitions, toolbox, theme, program checks
  generators/              Python (robot) and JavaScript (simulator) generators
  hardware/config.ts       hardware settings; renders eaglets_config.py
  robot/                   talking to the Pico
    connection.ts            connect, run, stop, files, Shell, install mode
    rawRepl.ts transport.ts  MicroPython raw REPL protocol over a byte pipe
    webSerial.ts             Web Serial transport (browser and desktop)
    deviceFiles.ts           Python helper scripts sent to the robot, robot library files
    firmware.ts              bundled MicroPython checks and installing it
    friendlyErrors.ts        tracebacks and USB errors in words a student can act on
    studentText.ts           kid-friendly wording for robot messages
    mockDevice.ts            pretend board for ?mock=1 and the tests
  sim/                     simulated robot
  projects/                .eaglets save/load, starter projects, opening/saving files
  components/              the main screen: workspace, code editor, Shell, simulator, plotter
    dialogs/                 starters, settings, help, about, files, MicroPython install, debug panel
  lib/                     small pure helpers: debug log, plot data, Shell input
firmware/                MicroPython library that runs on the robot
  eaglets.py               robot library: motors, LEDs, sensors, safety
  eaglets_config.py        V6.2 pin map + tunable settings (the app regenerates it from Instructor settings)
  apds9960.py              gesture / colour / proximity driver
  lsm6ds3.py               IMU driver (LSM6DS3TR-C)
  tests/                   fake machine/neopixel modules + library tests
  micropython/LICENSE      MicroPython's licence (after npm run fetch-firmware)
desktop/                 Electron app: window, USB port picker, BOOTSEL drive + firmware copy
public/                  static files shipped as-is, incl. firmware/ (MicroPython .uf2) and notices
scripts/                 build helpers: third-party notices, MicroPython download, Python setup
tests/                   Vitest suites (one file per area)
e2e/                     Chrome end-to-end test
docs/                    instructor guide, camp lessons, hardware status, release checklist
```

A few decisions worth knowing about:

- **Why Blockly.** It's the only maintained block library with a built-in Python generator. It moved to the Raspberry Pi Foundation in 2025, and its "Zelos" renderer looks like Scratch. scratch-blocks has no code generators, and MakeCode doesn't produce MicroPython or support the Pico 2.
- **Why the raw REPL over Web Serial.** It's the same protocol `mpremote` and Thonny use, so there's no firmware to maintain and no helper app to install. Programs run from RAM after a soft reset, so every run starts clean, and nothing autostarts unless an instructor chooses **Save to robot**.
- **Hardware logic lives in one place.** Generated programs call `robot.forward()`, `robot.distance()` and so on. Pins and limits live only in `eaglets_config.py`.
- **Pins come from the board, not from guesses.** They're taken from `EagletsPCB-V6.2/bringup/pins.py`, which matches `verification/design.net`. They're fixed in the app on purpose.

## Licence, privacy and publishing

Eaglets Code is MIT-licensed ([LICENSE](LICENSE)). The licences of the open-source packages bundled into the app are collected in `public/THIRD_PARTY_NOTICES.txt` by `npm run notices`, which runs on every build. A test fails if the app imports a package the notices don't cover. In the app, **More → About & privacy** shows the version, licence, privacy summary, safety note and full notices. The installers also carry `LICENSE.txt`, `THIRD_PARTY_NOTICES.txt` and `PRIVACY.md`.

The app collects nothing and contacts no server but the one it's loaded from ([PRIVACY.md](PRIVACY.md)). Keep it that way: Blockly's media is served locally (see `vite.config.ts`), the desktop app has spellcheck off so Chromium doesn't fetch dictionaries, and `npm run test:e2e` fails if the page requests anything from another origin.

Before releasing to the public, go through [docs/RELEASE-LEGAL-CHECKLIST.md](docs/RELEASE-LEGAL-CHECKLIST.md).
