# Instructor guide

For camp leads and volunteers. Read the safety checklist before the first session with motors.

## Before camp (once per robot)

1. Put **MicroPython** on every Pico: **More → Install MicroPython**. For a brand-new Pico, hold its BOOTSEL button while you plug in the USB cable; the desktop app spots it and installs by itself. A Pico that already runs MicroPython is restarted into install mode for you.
2. Open Eaglets Code, connect the robot, and press Run on the **Flashing LEDs** starter. That installs the robot library.
3. Run **Move Forward and Stop** with the wheels in the air. If a wheel spins backwards, open ⚙ Instructor settings and tick that wheel's "spins backwards" box.
4. Optional, for Day 2's "preinstalled demo": switch Beginner mode off, load Flashing LEDs, and use **Save to robot**. The robot now runs it at power-on. It only uses LEDs, so that's safe. Never save a motor program as the power-on program for camp robots.

Settings live in the browser, so set them once on each camp laptop. Each robot gets them the next time anyone presses Run.

## Robot safety checklist

Go through this at the start of any session that uses motors.

**Before power**
- [ ] Wheels off the table (stand, block, or held) for the first run of every new program.
- [ ] Battery switch OFF while plugging and unplugging anything.
- [ ] Motor and sensor cables checked against their labels. The ultrasonic plug isn't keyed, and plugged in backwards it feeds the sensor reverse voltage.
- [ ] Clear floor space, with no feet or fingers near the wheels.

**Every student knows**
- [ ] Where the **power switch** is. It is the real emergency stop.
- [ ] That **■ Stop** (or the Esc key) stops a program from the laptop.
- [ ] That with USB plugged in, the Pico stays on even when the switch is OFF. The switch only cuts the motors' battery.

**What the software does to help**
- Motors start safe: driver asleep and every output low, every time the library loads.
- Power is capped (80% by default), and timed moves are capped at 10 seconds.
- A "move forward" with no time stops by itself after 20 seconds unless the program keeps repeating it.
- Every program switches motors and LEDs off when it finishes, crashes, or is stopped.
- If the motor driver reports a fault, the motors stop and the program ends with a message.
- If the USB cable is pulled or the laptop tab closes during a run, the motors should stop within about 3 seconds. **This has only been tested on fake hardware.** Until it has been checked on a real robot, treat the power switch as the only reliable stop.
- LED brightness is capped at 25% until the board's LED power test passes.

**What software can't do**
- It can't stop a robot whose Pico has crashed or frozen. Use the power switch.
- It can't stop a robot that is running a program saved with **Save to robot** while no laptop is attached. Use the power switch.

**After the session**
- [ ] Battery switches OFF.
- [ ] Any program saved to a robot is removed (Advanced mode → *Remove saved program*) unless it's the LED demo.
- [ ] Anything that got warm is reported to the hardware officer.

## Beginner mode vs. Advanced

Beginner mode (the default) hides raw wheel control, accelerometer and rotation numbers, extra maths, line and sound sensors, and technical error details. Switch it off for older or faster students, and for yourself when troubleshooting. Advanced mode also shows *Save to robot*, *Remove saved program* and *Reinstall robot library*.

## Teacher debug mode

When a robot is misbehaving and the student-friendly message isn't enough, open **More → Instructor settings** and tick **Teacher debug mode**. It turns on straight away and shows:

- the board, MicroPython version and USB port the app is talking to
- full error messages (the Python traceback) and the console after every run
- *Save to robot*, *Remove saved program* and *Reinstall robot library*, without switching Beginner mode off
- a log of everything the app did: connects, reconnects, library installs, runs, stops and failures

The log records all the time, so you can switch debug mode on *after* something went wrong and still see what led up to it. **Copy report** puts the log, the robot's details and the settings on the clipboard, ready to paste into a message.

Debug mode is per laptop and stays on until you switch it off. While it's on, a dashed **Debug on** badge sits in the top bar. Click it to switch debug mode off before handing the laptop back. Adding `?debug=1` to the address also switches it on.

## When something goes wrong

| Student sees | Do this |
|---|---|
| "Your robot is not connected." | Click Connect Robot. Check the cable (some only charge). |
| "Your robot was unplugged." | Plug it back in. A robot this laptop has used before reconnects by itself within a couple of seconds. |
| "Being used by another program" | Close the other Eaglets Code window (or Thonny, if it's still installed). |
| "MicroPython isn't responding" | Unplug and replug USB, then connect again. If that fails, press **Install MicroPython** on the message. |
| "Line 7: …" in Code mode | Line 7 is highlighted in the editor. That's where the program stopped. |
| Motors still going after a Shell command | Press **Stop**: it switches motors and lights off even when nothing is running. Untimed moves also stop by themselves after 20 seconds. |
| "This block needs a value." | The highlighted block has an empty slot. Drag a number or sensor in. |
| "Another program is already running." | Press Stop first. |
| "The distance sensor isn't answering." | Check J1's cable and orientation. |
| "I can't find the motion sensor (IMU)." | Check the STEMMA QT cable on J6. |
| "The motor driver reported a problem." | A wheel is stalled or the batteries are low. Free the wheels, check the batteries. |
| Robot keeps going after Stop | **Power switch OFF.** Then report it. |

The Simulator tab works without any hardware. It's a good place for students waiting for a robot, and for anyone whose laptop can't use USB (Safari, iPads).

## Saving work

- **Save** downloads a `.eaglets` file. **Open** loads a `.eaglets` project or a `.py` file.
- In Code mode, **Save** (Ctrl/Cmd+S) writes back to the file the code came from; **Save to computer…** and **Save to robot…** pick a new place. **Files** shows everything stored on the robot.
- The browser also autosaves the current project and restores it on reload. That's a convenience only. Have students Save before the end of the day.
