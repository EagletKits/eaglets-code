"""Run an Eaglets Code program against fake hardware and print a JSON report.

MOCK HARDWARE ONLY. This checks that generated programs run without Python
errors and that the library drives pins the way we intend. It cannot tell you
that the real robot behaves correctly.

Usage: python3 run_program.py program.py [scenario.json]
"""
import json
import os
import signal
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
FIRMWARE = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "fakes"))
sys.path.insert(1, FIRMWARE)

import fakehw  # noqa: E402

# Modules MicroPython on the Pico 2 provides that programs may import.
ALLOWED_IMPORTS = {"eaglets", "time", "math", "random"}


def main():
    program_path = sys.argv[1]
    scenario = {}
    if len(sys.argv) > 2:
        with open(sys.argv[2]) as f:
            scenario = json.load(f)
    fakehw.setup(scenario)

    overrides = scenario.get("config")
    if overrides:
        import eaglets_config

        for k, v in overrides.items():
            setattr(eaglets_config, k, tuple(v) if isinstance(v, list) else v)

    import io

    captured = io.StringIO()
    real_stdout = sys.stdout
    report = {"ok": True, "error_type": None, "error": None}

    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("wall-clock timeout")))
    signal.alarm(20)
    try:
        sys.stdout = captured
        if scenario.get("usb_watchdog"):
            sys.modules["select"] = fakehw.FakeSelect
            sys.stdin = fakehw.FakeStdin()
        import eaglets

        if scenario.get("usb_watchdog"):
            eaglets.usb_watchdog(True)
        with open(program_path) as f:
            source = f.read()
        code = compile(source, program_path, "exec")
        exec(code, {"__name__": "__main__"})
    except KeyboardInterrupt:
        report["ok"] = True
        report["error_type"] = "KeyboardInterrupt"
    except BaseException as e:  # noqa: BLE001 - report everything
        report["ok"] = False
        report["error_type"] = type(e).__name__
        report["error"] = str(e)
    finally:
        signal.alarm(0)
        sys.stdout = real_stdout

    st = fakehw.STATE
    motor_pins = [3, 4, 6, 7]
    report.update(
        {
            "stdout": captured.getvalue(),
            "virtual_seconds": round(st.now_us / 1e6, 3),
            "final": {
                "motor_sleep": st.pins.get(9, 0),
                "motor_duty": {str(p): st.duty.get(p, 0) for p in motor_pins},
                "leds": st.leds,
                "timers_running": len(st.timers),
            },
            "max_motor_duty": max(
                [v for (_, kind, pin, v) in st.events if kind == "duty" and pin in motor_pins and v < 65535] or [0]
            ),
            "events": [e for e in st.events if e[1] in ("duty", "pin", "interrupt")][-400:],
            "led_frames": [e[3] for e in st.events if e[1] == "leds"][-50:],
        }
    )
    print("@@REPORT@@" + json.dumps(report))


if __name__ == "__main__":
    main()
