"""Tests for eaglets.py against fake hardware (MOCK HARDWARE ONLY).

Run: python3 -m unittest discover -s firmware/tests -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "run_program.py")

HEADER = "import eaglets as robot\nrobot.start()\ntry:\n"
FOOTER = "finally:\n    robot.shutdown()\n"


def run(body, scenario=None, raw=False):
    src = body if raw else HEADER + "".join("    " + line + "\n" for line in body.strip().splitlines()) + FOOTER
    with tempfile.TemporaryDirectory() as d:
        prog = os.path.join(d, "prog.py")
        with open(prog, "w") as f:
            f.write(src)
        args = [sys.executable, RUNNER, prog]
        if scenario is not None:
            sc = os.path.join(d, "scenario.json")
            with open(sc, "w") as f:
                json.dump(scenario, f)
            args.append(sc)
        out = subprocess.run(args, capture_output=True, text=True, timeout=60)
    for line in out.stdout.splitlines():
        if line.startswith("@@REPORT@@"):
            return json.loads(line[len("@@REPORT@@"):])
    raise AssertionError("no report\nstdout:%s\nstderr:%s" % (out.stdout, out.stderr))


def assert_safe(test, r):
    test.assertEqual(r["final"]["motor_sleep"], 0, "motor driver should be asleep at the end")
    test.assertTrue(all(v == 0 for v in r["final"]["motor_duty"].values()), r["final"])
    test.assertTrue(all(c == [0, 0, 0] for c in r["final"]["leds"]), "LEDs should be off at the end")
    test.assertEqual(r["final"]["timers_running"], 0)


class Movement(unittest.TestCase):
    def test_import_is_safe(self):
        r = run("import eaglets as robot\n", raw=True)
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["final"]["motor_sleep"], 0)
        self.assertEqual(r["max_motor_duty"], 0)

    def test_forward_for_seconds_then_safe(self):
        r = run("robot.forward(50, seconds=2)")
        self.assertTrue(r["ok"], r)
        self.assertGreaterEqual(r["virtual_seconds"], 2)
        # 50% speed with an 80% power cap = 40% duty.
        self.assertEqual(r["max_motor_duty"], int(50 * 80 * 65535 / 10000))
        assert_safe(self, r)

    def test_power_cap_at_100_percent(self):
        r = run("robot.forward(100, seconds=1)")
        self.assertEqual(r["max_motor_duty"], int(100 * 80 * 65535 / 10000))

    def test_out_of_range_speed_is_clamped(self):
        r = run("robot.forward(500, seconds=1)")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["max_motor_duty"], int(100 * 80 * 65535 / 10000))

    def test_timed_move_capped(self):
        r = run("robot.forward(50, seconds=999)")
        self.assertTrue(r["ok"], r)
        self.assertLess(r["virtual_seconds"], 11)

    def test_untimed_move_auto_stops(self):
        r = run("robot.forward(60)\nrobot.wait(30)")
        self.assertTrue(r["ok"], r)
        self.assertIn("stopped by themselves", r["stdout"])
        moving_events = [e for e in r["events"] if e[1] == "duty" and e[2] in (3, 6) and 0 < e[3] < 65535]
        stops = [e for e in r["events"] if e[1] == "duty" and e[3] == 65535]
        self.assertTrue(moving_events and stops)
        self.assertLess(stops[0][0], 21000 + 100)
        assert_safe(self, r)

    def test_turns_drive_wheels_opposite(self):
        r = run("robot.turn_right(50)\nrobot.wait(0.2)\nrobot.stop()")
        duties = {}
        for t, kind, pin, v in r["events"]:
            if kind == "duty" and 0 < v < 65535:
                duties[pin] = v
        # Right turn: left wheel forward (AIN1=GP3), right wheel backward (BIN2=GP7).
        self.assertIn(3, duties)
        self.assertIn(7, duties)
        self.assertNotIn(4, duties)
        self.assertNotIn(6, duties)

    def test_stop_button_mid_move_leaves_robot_safe(self):
        r = run("robot.forward(70)\nwhile True:\n    robot.wait(0.1)", {"stop_at": 3})
        self.assertEqual(r["error_type"], "KeyboardInterrupt")
        self.assertAlmostEqual(r["virtual_seconds"], 3, delta=0.1)
        assert_safe(self, r)

    def test_motor_fault_ends_program(self):
        r = run("while True:\n    robot.forward(50)\n    robot.wait(0.1)", {"fault_at": 1.0})
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("motor driver", r["error"])
        assert_safe(self, r)

    def test_usb_heartbeat_loss_stops_motors(self):
        r = run(
            "while True:\n    robot.forward(50)\n    robot.wait(0.1)",
            {"usb_watchdog": True, "heartbeat_until": 2.0, "max_seconds": 20},
        )
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("USB", r["error"])
        self.assertLess(r["virtual_seconds"], 6)
        assert_safe(self, r)

    def test_usb_heartbeat_present_keeps_running(self):
        r = run(
            "robot.forward(50)\nrobot.wait(5)",
            {"usb_watchdog": True, "heartbeat_until": 100},
        )
        self.assertTrue(r["ok"], r)
        self.assertIsNone(r["error_type"])

    def test_reversed_left_motor_config(self):
        r = run("robot.forward(50, seconds=0.5)", {"config": {"LEFT_MOTOR_REVERSED": True}})
        pins = {e[2] for e in r["events"] if e[1] == "duty" and 0 < e[3] < 65535}
        self.assertIn(4, pins)
        self.assertNotIn(3, pins)

    def test_set_speed_then_move(self):
        r = run("robot.set_speed(25)\nrobot.forward(seconds=1)")
        self.assertEqual(r["max_motor_duty"], int(25 * 80 * 65535 / 10000))

    def test_turn_degrees_uses_gyro(self):
        # 90 deg/s yaw: a 90 degree turn takes about a second.
        r = run("robot.turn_degrees('left', 90)", {"imu": {"gyro": [[0, [0, 0, 0]], [0.5, [0, 0, 90]]]}})
        self.assertTrue(r["ok"], r)
        self.assertGreater(r["virtual_seconds"], 1.0)
        self.assertLess(r["virtual_seconds"], 2.5)
        assert_safe(self, r)

    def test_turn_degrees_times_out_when_stuck(self):
        r = run("robot.turn_degrees('right', 90)", {"imu": {"gyro": [0, 0, 0]}})
        self.assertTrue(r["ok"], r)
        self.assertIn("took too long", r["stdout"])
        assert_safe(self, r)


class Lights(unittest.TestCase):
    def test_brightness_cap(self):
        r = run("robot.set_leds('#ff0000')\nrobot.wait(0.1)\nprint(robot._leds.np[0])")
        self.assertIn("(63, 0, 0)", r["stdout"])  # 25% cap of 255

    def test_individual_led_and_brightness(self):
        r = run("robot.set_brightness(50)\nrobot.set_led(3, '#00ff00')\nprint(robot._leds.np[2], robot._leds.np[0])")
        self.assertIn("(0, 31, 0) (0, 0, 0)", r["stdout"])

    def test_rgb_and_flash_and_rainbow(self):
        r = run("robot.set_leds(robot.rgb(100, 50, 0))\nrobot.flash_leds('#0000ff', 2)\nrobot.rainbow(1)")
        self.assertTrue(r["ok"], r)
        self.assertGreater(len(r["led_frames"]), 10)
        assert_safe(self, r)

    def test_bad_color_is_friendly(self):
        r = run("robot.set_leds('banana')")
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("color", r["error"])


class Sensors(unittest.TestCase):
    def test_dial_percent(self):
        r = run("print(robot.dial())", {"dial": 73})
        self.assertIn("73", r["stdout"])

    def test_distance(self):
        r = run("print(robot.distance())", {"distance_cm": 15})
        self.assertIn("15.0", r["stdout"])

    def test_distance_nothing_in_range(self):
        r = run("print(robot.distance())", {"distance_cm": None})
        self.assertIn("400", r["stdout"])

    def test_distance_sensor_missing_stops_program(self):
        r = run("while True:\n    robot.forward(40)\n    print(robot.distance())", {"distance_cm": "missing"})
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("distance sensor", r["error"])
        assert_safe(self, r)

    def test_obstacle_stop_program(self):
        body = (
            "while True:\n"
            "    if robot.distance() < 15:\n"
            "        robot.stop()\n"
            "        robot.set_leds('#ff0000')\n"
            "    else:\n"
            "        robot.forward(50)\n"
        )
        r = run(body, {"distance_cm": [[0, 100], [2, 10]], "max_seconds": 4})
        self.assertEqual(r["error_type"], "KeyboardInterrupt")
        brakes = [e for e in r["events"] if e[1] == "duty" and e[3] == 65535 and e[0] >= 2000]
        self.assertTrue(brakes, "robot should brake once the obstacle appears")
        assert_safe(self, r)

    def test_wait_for_object(self):
        r = run("robot.wait_for_object(20)\nprint('seen')", {"distance_cm": [[0, 100], [1.5, 12]]})
        self.assertIn("seen", r["stdout"])
        self.assertGreaterEqual(r["virtual_seconds"], 1.5)

    def test_tilt_and_shake(self):
        r = run(
            "print(robot.is_tilted(), robot.tilt_angle('left-right'))\nrobot.wait(1)\nprint(robot.is_tilted('right'))",
            {"imu": {"accel": [[0, [0, 0, 1]], [0.5, [0, 0.7, 0.7]]]}},
        )
        self.assertIn("False 0", r["stdout"])
        self.assertIn("True", r["stdout"].splitlines()[-1])

    def test_shake_detected_once(self):
        r = run(
            "robot.wait(0.5)\nprint(robot.is_shaken())\nrobot.wait(1)\nprint(robot.is_shaken())\nprint(robot.is_shaken())",
            {"imu": {"accel": [[0, [0, 0, 1]], [1.0, [1.5, 1.2, 1]], [1.1, [0, 0, 1]]]}},
        )
        self.assertEqual(r["stdout"].split(), ["False", "True", "False"])

    def test_imu_missing_is_friendly(self):
        r = run("print(robot.is_tilted())", {"imu": "missing"})
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("IMU", r["error"])

    def test_swipes_cached_for_elif_chains(self):
        body = (
            "hits = []\n"
            "for i in range(40):\n"
            "    if robot.swiped('left'):\n"
            "        hits.append('L')\n"
            "    elif robot.swiped('right'):\n"
            "        hits.append('R')\n"
            "    robot.wait(0.05)\n"
            "print(''.join(hits))\n"
        )
        r = run(body, {"gestures": [[0.3, "right"], [1.0, "left"]]})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["stdout"].strip(), "RL")

    def test_color_names(self):
        r = run(
            "print(robot.color())\nrobot.wait(1)\nprint(robot.color())\nrobot.wait(1)\nprint(robot.color())",
            {"apds": {"color": [[0, [800, 600, 100, 80]], [1, [800, 100, 120, 500]], [2, [5, 1, 1, 1]]]}},
        )
        self.assertEqual(r["stdout"].split(), ["red", "blue", "black"])

    def test_apds_missing_is_friendly(self):
        r = run("print(robot.swiped('left'))", {"apds": "missing"})
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("gesture", r["error"])


class Sound(unittest.TestCase):
    def test_buzzer_disabled_by_default(self):
        r = run("robot.beep()")
        self.assertEqual(r["error_type"], "RobotError")
        self.assertIn("no buzzer", r["error"])

    def test_buzzer_when_configured(self):
        r = run("robot.play_note('A4', 0.2)\nrobot.alarm(1)\nrobot.beep()", {"config": {"BUZZER_PIN": 17}})
        self.assertTrue(r["ok"], r)


if __name__ == "__main__":
    unittest.main()
