# Shared state for the fake Eaglets hardware (MOCK HARDWARE ONLY).
# A virtual clock replaces real time, so a 10-second program runs instantly.
import struct
import time as _time


class _State:
    def __init__(self):
        self.now_us = 0
        self.pins = {}
        self.pin_modes = {}
        self.irqs = {}
        self.duty = {}
        self.pwm_freq = {}
        self.leds = []
        self.timers = []
        self.events = []
        self.i2c_devices = {}
        self.i2c_pins = None
        self.scenario = {}
        self.interrupted = False
        self.in_timer = False
        self.stdin_pending = 0
        self.next_heartbeat_us = 0


STATE = _State()


def log(kind, pin, value):
    STATE.events.append((round(STATE.now_us / 1000.0, 1), kind, pin, value))


def _timeline(value):
    """A scenario value can be a constant or [[seconds, value], ...]."""
    if isinstance(value, list) and value and isinstance(value[0], list):
        t = STATE.now_us / 1e6
        current = value[0][1]
        for at, v in value:
            if t >= at:
                current = v
        return current
    return value


def tick_us(n):
    STATE.now_us += int(n)
    sc = STATE.scenario
    t = STATE.now_us / 1e6
    # Host heartbeats for the USB watchdog test.
    until = sc.get("heartbeat_until")
    if until is not None:
        while STATE.next_heartbeat_us <= STATE.now_us and STATE.next_heartbeat_us / 1e6 < until:
            STATE.stdin_pending += 1
            STATE.next_heartbeat_us += 500000
    if not STATE.in_timer:
        for timer in list(STATE.timers):
            while timer in STATE.timers and timer.next <= STATE.now_us:
                timer.next += timer.period * 1000
                STATE.in_timer = True
                try:
                    timer.callback(timer)
                finally:
                    STATE.in_timer = False
    if not STATE.interrupted:
        stop_at = sc.get("stop_at")
        if (stop_at is not None and t >= stop_at) or t >= sc.get("max_seconds", 60):
            STATE.interrupted = True
            log("interrupt", None, None)
            raise KeyboardInterrupt


def read_pin(pin_id):
    sc = STATE.scenario
    if pin_id == sc.get("fault_pin", 8):
        fault_at = sc.get("fault_at")
        if fault_at is not None and STATE.now_us / 1e6 >= fault_at:
            return 0
        return 1
    if pin_id in sc.get("pin_values", {}):
        return _timeline(sc["pin_values"][pin_id])
    return STATE.pins.get(pin_id, 0)


def read_adc(pin_id):
    dial = _timeline(STATE.scenario.get("dial", 50))
    return int(dial * 65535 / 100)


def echo_pulse(pin_id, timeout_us):
    d = _timeline(STATE.scenario.get("distance_cm", 100))
    if d == "missing":
        tick_us(timeout_us)
        return -2
    if d is None or d > 500:
        tick_us(timeout_us)
        return -1
    t = int(d * 58)
    tick_us(t)
    return t


class FakeIMU:
    def read(self, reg, n):
        if reg == 0x0F:
            return bytes([0x6A])
        if reg == 0x22 and n == 12:
            imu = STATE.scenario.get("imu", {})
            gx, gy, gz = _timeline(imu.get("gyro", [0, 0, 0]))
            ax, ay, az = _timeline(imu.get("accel", [0, 0, 1]))
            vals = [int(gx / 0.00875), int(gy / 0.00875), int(gz / 0.00875),
                    int(ax / 0.000061), int(ay / 0.000061), int(az / 0.000061)]
            vals = [max(-32768, min(32767, v)) for v in vals]
            return struct.pack("<hhhhhh", *vals)
        return bytes(n)

    def write(self, reg, data):
        pass


_GESTURE_DATA = {
    "left": [(50, 50, 90, 30), (50, 50, 30, 90)],
    "right": [(50, 50, 30, 90), (50, 50, 90, 30)],
    "up": [(90, 30, 50, 50), (30, 90, 50, 50)],
    "down": [(30, 90, 50, 50), (90, 30, 50, 50)],
}


class FakeAPDS:
    def __init__(self):
        self.used = set()
        self.fifo = []

    def _pending(self):
        t = STATE.now_us / 1e6
        for i, (at, name) in enumerate(STATE.scenario.get("gestures", [])):
            if i not in self.used and t >= at:
                self.used.add(i)
                self.fifo.extend(_GESTURE_DATA[name])

    def read(self, reg, n):
        apds = STATE.scenario.get("apds", {})
        if reg == 0x92:
            return bytes([0xAB])
        if reg == 0x93:
            return bytes([0x01])
        if reg == 0x94:
            c, r, g, b = _timeline(apds.get("color", [500, 100, 100, 100]))
            return struct.pack("<HHHH", c, r, g, b)
        if reg == 0x9C:
            return bytes([_timeline(apds.get("proximity", 0))])
        if reg == 0xAF:
            self._pending()
            return bytes([1 if self.fifo else 0])
        if reg == 0xAE:
            self._pending()
            return bytes([len(self.fifo)])
        if reg == 0xFC:
            out = []
            for _ in range(n // 4):
                if self.fifo:
                    out.extend(self.fifo.pop(0))
            return bytes(out)
        return bytes(n)

    def write(self, reg, data):
        pass


def setup(scenario):
    STATE.__init__()
    STATE.scenario = scenario
    if scenario.get("imu") != "missing":
        STATE.i2c_devices[0x6A] = FakeIMU()
    else:
        STATE.scenario = dict(scenario, imu={})
    if scenario.get("apds") != "missing":
        STATE.i2c_devices[0x39] = FakeAPDS()
    else:
        STATE.scenario = dict(STATE.scenario, apds={})
    _patch_time()


def _patch_time():
    def ticks_ms():
        return STATE.now_us // 1000

    def ticks_us():
        return STATE.now_us

    def ticks_add(a, b):
        return a + b

    def ticks_diff(a, b):
        return a - b

    def sleep_ms(ms):
        _sleep_us(int(ms * 1000))

    def sleep_us(us):
        _sleep_us(int(us))

    def sleep(s):
        _sleep_us(int(s * 1e6))

    def _sleep_us(us):
        # Advance in small steps so timers and interrupts fire on time.
        end = STATE.now_us + us
        while STATE.now_us < end:
            tick_us(min(5000, end - STATE.now_us))

    _time.ticks_ms = ticks_ms
    _time.ticks_us = ticks_us
    _time.ticks_add = ticks_add
    _time.ticks_diff = ticks_diff
    _time.sleep_ms = sleep_ms
    _time.sleep_us = sleep_us
    _time.sleep = sleep


class FakeStdin:
    def read(self, n=1):
        if STATE.stdin_pending:
            STATE.stdin_pending -= 1
            return "\x16"
        return ""


class FakePoll:
    def register(self, obj, mask=None):
        pass

    def poll(self, timeout=-1):
        return [(None, 1)] if STATE.stdin_pending else []


class FakeSelect:
    POLLIN = 1

    @staticmethod
    def poll():
        return FakePoll()
