# Eaglets Code robot library for the Eaglets PCB V6.2 (Raspberry Pi Pico 2, MicroPython).
#
# Programs made with Eaglets Code start with `import eaglets as robot` and call
# the functions below. Everything hardware-specific (pins, limits, sensor
# tuning) lives in eaglets_config.py.
#
# Safety rules this library enforces:
#   * Importing it puts every output in a safe state: motor driver asleep, PWM 0, LEDs off.
#   * Motor power is capped at MAX_MOTOR_POWER percent of full.
#   * A "move" with no time limit stops by itself after MOTOR_AUTO_STOP_SECONDS
#     unless the program repeats the command (as a forever loop does).
#   * A timed move can't run longer than MAX_MOVE_SECONDS.
#   * If the motor driver reports a fault, motors stop and the program ends with a message.
#   * When run from Eaglets Code over USB, motors stop within ~2.5 s if the
#     browser stops sending its heartbeat (cable pulled, tab closed).
#   * shutdown() stops everything; generated programs call it in a `finally:` block,
#     so it runs on normal finish, on errors and when Stop is pressed.
# None of this replaces the physical power switch.

VERSION = "1.0.0"

import time
import math
import random
import sys
from machine import Pin, PWM, ADC, I2C, Timer, time_pulse_us

try:
    import eaglets_config as _cfg
except ImportError:
    _cfg = None


def _c(name, default):
    if _cfg is None:
        return default
    return getattr(_cfg, name, default)


LEFT_MOTOR_PINS = _c("LEFT_MOTOR_PINS", (3, 4))
RIGHT_MOTOR_PINS = _c("RIGHT_MOTOR_PINS", (6, 7))
MOTOR_SLEEP_PIN = _c("MOTOR_SLEEP_PIN", 9)
MOTOR_FAULT_PIN = _c("MOTOR_FAULT_PIN", 8)
LEFT_MOTOR_REVERSED = _c("LEFT_MOTOR_REVERSED", False)
RIGHT_MOTOR_REVERSED = _c("RIGHT_MOTOR_REVERSED", False)
MAX_MOTOR_POWER = _c("MAX_MOTOR_POWER", 80)
MAX_MOVE_SECONDS = _c("MAX_MOVE_SECONDS", 10)
MOTOR_AUTO_STOP_SECONDS = _c("MOTOR_AUTO_STOP_SECONDS", 20)
NEOPIXEL_PIN = _c("NEOPIXEL_PIN", 5)
NUM_LEDS = _c("NUM_LEDS", 8)
MAX_LED_BRIGHTNESS = _c("MAX_LED_BRIGHTNESS", 25)
I2C_ID = _c("I2C_ID", 1)
I2C_SDA_PIN = _c("I2C_SDA_PIN", 10)
I2C_SCL_PIN = _c("I2C_SCL_PIN", 11)
I2C_FREQ = _c("I2C_FREQ", 100000)
APDS9960_ADDRESS = _c("APDS9960_ADDRESS", 0x39)
IMU_ADDRESSES = _c("IMU_ADDRESSES", (0x6A, 0x6B))
US_TRIG_PIN = _c("US_TRIG_PIN", 14)
US_ECHO_PIN = _c("US_ECHO_PIN", 13)
DIAL_PIN = _c("DIAL_PIN", 26)
DIAL_REVERSED = _c("DIAL_REVERSED", False)
LINE_LEFT_PIN = _c("LINE_LEFT_PIN", 16)
LINE_RIGHT_PIN = _c("LINE_RIGHT_PIN", 15)
LINE_DARK_VALUE = _c("LINE_DARK_VALUE", 1)
SOUND_SENSOR_PIN = _c("SOUND_SENSOR_PIN", 12)
BUZZER_PIN = _c("BUZZER_PIN", None)
IMU_FORWARD_AXIS = _c("IMU_FORWARD_AXIS", "+x")
IMU_LEFT_AXIS = _c("IMU_LEFT_AXIS", "+y")
IMU_UP_AXIS = _c("IMU_UP_AXIS", "+z")
TILT_DEGREES = _c("TILT_DEGREES", 30)
SHAKE_G = _c("SHAKE_G", 0.8)
MOVING_DPS = _c("MOVING_DPS", 40)
GESTURE_ROTATION = _c("GESTURE_ROTATION", 0)
PROXIMITY_NEAR = _c("PROXIMITY_NEAR", 60)
LIGHT_FULL_SCALE = _c("LIGHT_FULL_SCALE", 3000)
COLOR_MIN_CLEAR = _c("COLOR_MIN_CLEAR", 20)
COLOR_MIN_SATURATION = _c("COLOR_MIN_SATURATION", 0.2)
COLOR_GAINS = _c("COLOR_GAINS", (1.0, 1.0, 1.0))

HOST_TIMEOUT_MS = 2500
_SAFETY_PERIOD_MS = 40
_PING_INTERVAL_MS = 60
_ECHO_TIMEOUT_US = 30000
_OUT_OF_RANGE_CM = 400


def _deg(radians):
    return radians * 57.29577951308232


class RobotError(Exception):
    """A problem explained in kid-friendly words. Eaglets Code shows only the message."""


def _clamp(value, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise RobotError("A block needs a number, but got %r." % (value,))
    if value < low:
        return low
    if value > high:
        return high
    return value


# ---------------------------------------------------------------- state
_problem = None  # message of a problem that must end the program
_usb_watchdog = False
_last_heartbeat = 0
_poller = None
_timer = None
_started = False


def _set_problem(msg):
    global _problem
    if _problem is None:
        _problem = msg


def _check():
    if _problem is not None:
        raise RobotError(_problem)


# ---------------------------------------------------------------- motors
class _Motors:
    def __init__(self):
        # Driver asleep and every input low before anything else happens.
        self.sleep_pin = Pin(MOTOR_SLEEP_PIN, Pin.OUT, value=0)
        self.fault_pin = Pin(MOTOR_FAULT_PIN, Pin.IN, Pin.PULL_UP)
        self.pwm = []
        for p in LEFT_MOTOR_PINS + RIGHT_MOTOR_PINS:
            self.pwm.append(PWM(Pin(p), freq=10000, duty_u16=0))
        self.awake = False
        self.left = 0
        self.right = 0
        self.deadline = None

    def _wake(self):
        if not self.awake:
            self.sleep_pin.value(1)
            time.sleep_ms(2)
            self.awake = True

    def _write(self, index, power, reversed_):
        if reversed_:
            power = -power
        duty = int(abs(power) * MAX_MOTOR_POWER * 65535 / 10000)
        a = self.pwm[index * 2]
        b = self.pwm[index * 2 + 1]
        if power > 0:
            b.duty_u16(0)
            a.duty_u16(duty)
        elif power < 0:
            a.duty_u16(0)
            b.duty_u16(duty)
        else:
            a.duty_u16(0)
            b.duty_u16(0)

    def drive(self, left, right, deadline_s):
        _check()
        left = _clamp(left, -100, 100)
        right = _clamp(right, -100, 100)
        if left == 0 and right == 0:
            self.stop()
            return
        self._wake()
        # Short ramp when speeding up a lot, to soften the current spike.
        if abs(left - self.left) > 30 or abs(right - self.right) > 30:
            for step in (1, 2, 3):
                self._write(0, self.left + (left - self.left) * step / 4, LEFT_MOTOR_REVERSED)
                self._write(1, self.right + (right - self.right) * step / 4, RIGHT_MOTOR_REVERSED)
                time.sleep_ms(15)
        self._write(0, left, LEFT_MOTOR_REVERSED)
        self._write(1, right, RIGHT_MOTOR_REVERSED)
        self.left = left
        self.right = right
        self.deadline = time.ticks_add(time.ticks_ms(), int(deadline_s * 1000))

    def stop(self):
        # Brake (both inputs high) stops the wheels quickly and precisely.
        for p in self.pwm:
            p.duty_u16(65535 if self.awake else 0)
        self.left = 0
        self.right = 0
        self.deadline = None

    def off(self):
        for p in self.pwm:
            p.duty_u16(0)
        self.sleep_pin.value(0)
        self.awake = False
        self.left = 0
        self.right = 0
        self.deadline = None

    @property
    def moving(self):
        return self.left != 0 or self.right != 0


# ---------------------------------------------------------------- LEDs
class _Leds:
    def __init__(self):
        import neopixel

        self.np = neopixel.NeoPixel(Pin(NEOPIXEL_PIN), NUM_LEDS)
        self.colors = [(0, 0, 0)] * NUM_LEDS
        self.brightness = 100
        self.show()

    def show(self):
        scale = self.brightness * MAX_LED_BRIGHTNESS / 10000
        for i in range(NUM_LEDS):
            r, g, b = self.colors[i]
            self.np[i] = (int(r * scale), int(g * scale), int(b * scale))
        self.np.write()


def _parse_color(color):
    if isinstance(color, str):
        s = color.strip().lstrip("#")
        if len(s) == 6:
            try:
                return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
            except ValueError:
                pass
        raise RobotError("I don't know the color %r." % (color,))
    if isinstance(color, (tuple, list)) and len(color) == 3:
        return tuple(int(_clamp(c, 0, 255)) for c in color)
    raise RobotError("I don't know the color %r." % (color,))


# ---------------------------------------------------------------- set up outputs safely on import
_motors = _Motors()
_leds = _Leds()
_buzzer = None
_i2c = None
_imu = None
_imu_bias = (0.0, 0.0, 0.0)
_apds = None
_trig = None
_echo = None
_dial_adc = None
_speed = 50


def _bus():
    global _i2c
    if _i2c is None:
        _i2c = I2C(I2C_ID, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=I2C_FREQ)
    return _i2c


# ---------------------------------------------------------------- safety timer
def _safety_tick(_t):
    global _last_heartbeat
    try:
        now = time.ticks_ms()
        if _usb_watchdog and _poller is not None:
            while _poller.poll(0):
                sys.stdin.read(1)
                _last_heartbeat = now
            if time.ticks_diff(now, _last_heartbeat) > HOST_TIMEOUT_MS:
                if _motors.moving or _motors.awake:
                    _motors.off()
                _set_problem("Lost the USB connection, so the motors were stopped for safety.")
        if _motors.awake and _motors.fault_pin.value() == 0:
            _motors.off()
            _set_problem("The motor driver reported a problem. Check that the wheels can turn freely and the batteries are good.")
        if _motors.moving and _motors.deadline is not None:
            if time.ticks_diff(now, _motors.deadline) > 0:
                _motors.stop()
                print("Motors stopped by themselves after %d seconds (safety limit)." % MOTOR_AUTO_STOP_SECONDS)
        if _shake_on and _imu is not None:
            _sample_shake(now)
    except Exception:
        pass


def usb_watchdog(enabled=True):
    """Called by Eaglets Code before a USB run. Not for student programs."""
    global _usb_watchdog, _poller, _last_heartbeat
    if enabled:
        import select

        _poller = select.poll()
        _poller.register(sys.stdin, select.POLLIN)
        _last_heartbeat = time.ticks_ms()
    _usb_watchdog = enabled


def start():
    """Start a program: outputs safe, safety checks running."""
    global _timer, _started, _problem
    _problem = None
    _motors.off()
    if _timer is None:
        _timer = Timer(period=_SAFETY_PERIOD_MS, mode=Timer.PERIODIC, callback=_safety_tick)
    _started = True


def shutdown():
    """Stop motors, lights and sound. Safe to call more than once."""
    global _timer, _started
    _motors.off()
    try:
        _leds.colors = [(0, 0, 0)] * NUM_LEDS
        _leds.show()
    except Exception:
        pass
    if _buzzer is not None:
        _buzzer.duty_u16(0)
    if _timer is not None:
        _timer.deinit()
        _timer = None
    _started = False


# ---------------------------------------------------------------- timing
def wait(seconds):
    """Wait, while still noticing safety problems."""
    end = time.ticks_add(time.ticks_ms(), int(_clamp(seconds, 0, 3600) * 1000))
    while True:
        _check()
        left = time.ticks_diff(end, time.ticks_ms())
        if left <= 0:
            return
        time.sleep_ms(min(left, 20))


# ---------------------------------------------------------------- movement
def set_speed(percent):
    """Speed for forward/backward/turn blocks that don't give their own speed."""
    global _speed
    _speed = _clamp(percent, 0, 100)
    if _motors.moving:
        l = _speed if _motors.left > 0 else (-_speed if _motors.left < 0 else 0)
        r = _speed if _motors.right > 0 else (-_speed if _motors.right < 0 else 0)
        _motors.drive(l, r, MOTOR_AUTO_STOP_SECONDS)


def _move(left_sign, right_sign, speed, seconds):
    s = _speed if speed is None else _clamp(speed, 0, 100)
    if seconds is None:
        _motors.drive(left_sign * s, right_sign * s, MOTOR_AUTO_STOP_SECONDS)
        return
    seconds = _clamp(seconds, 0, MAX_MOVE_SECONDS)
    _motors.drive(left_sign * s, right_sign * s, seconds + 1)
    try:
        wait(seconds)
    finally:
        _motors.stop()


def forward(speed=None, seconds=None):
    _move(1, 1, speed, seconds)


def backward(speed=None, seconds=None):
    _move(-1, -1, speed, seconds)


def turn_left(speed=None, seconds=None):
    _move(-1, 1, speed, seconds)


def turn_right(speed=None, seconds=None):
    _move(1, -1, speed, seconds)


def stop():
    _motors.stop()


def set_motors(left, right):
    """Each wheel from -100 (full backward) to 100 (full forward)."""
    _motors.drive(left, right, MOTOR_AUTO_STOP_SECONDS)


def turn_degrees(direction, degrees, speed=None):
    """Spin on the spot by measuring rotation with the IMU gyroscope.

    The IMU measures how fast the robot turns, not which way it faces, so
    this adds up small turns. Expect a few degrees of error.
    """
    imu = _get_imu()
    target = _clamp(degrees, 0, 720)
    s = 40 if speed is None else _clamp(speed, 10, 100)
    sign = 1 if direction == "left" else -1
    timeout = time.ticks_add(time.ticks_ms(), int((2 + target / 45) * 1000))
    turned = 0.0
    last = time.ticks_us()
    _motors.drive(-sign * s, sign * s, 10)
    try:
        while abs(turned) < target:
            _check()
            if time.ticks_diff(timeout, time.ticks_ms()) < 0:
                print("Turn took too long; stopping. Are the wheels stuck?")
                break
            yaw = _robot_rates(imu)[2]
            now = time.ticks_us()
            turned += yaw * time.ticks_diff(now, last) / 1000000
            last = now
            time.sleep_ms(5)
    finally:
        _motors.stop()


# ---------------------------------------------------------------- LEDs
def rgb(red, green, blue):
    """A color from three amounts, each 0-100."""
    return (
        int(_clamp(red, 0, 100) * 2.55),
        int(_clamp(green, 0, 100) * 2.55),
        int(_clamp(blue, 0, 100) * 2.55),
    )


def random_color():
    return _wheel(random.randint(0, 255))


def set_leds(color):
    c = _parse_color(color)
    _leds.colors = [c] * NUM_LEDS
    _leds.show()


def set_led(number, color):
    n = int(_clamp(number, 1, NUM_LEDS))
    _leds.colors[n - 1] = _parse_color(color)
    _leds.show()


def leds_off():
    set_leds((0, 0, 0))


def set_brightness(percent):
    _leds.brightness = _clamp(percent, 0, 100)
    _leds.show()


def flash_leds(color, times=3):
    c = _parse_color(color)
    for _ in range(int(_clamp(times, 1, 50))):
        _leds.colors = [c] * NUM_LEDS
        _leds.show()
        wait(0.25)
        _leds.colors = [(0, 0, 0)] * NUM_LEDS
        _leds.show()
        wait(0.25)


def _wheel(pos):
    pos = int(pos) % 256
    if pos < 85:
        return (255 - pos * 3, pos * 3, 0)
    if pos < 170:
        pos -= 85
        return (0, 255 - pos * 3, pos * 3)
    pos -= 170
    return (pos * 3, 0, 255 - pos * 3)


def rainbow(seconds=2):
    end = time.ticks_add(time.ticks_ms(), int(_clamp(seconds, 0, 60) * 1000))
    offset = 0
    while time.ticks_diff(end, time.ticks_ms()) > 0:
        for i in range(NUM_LEDS):
            _leds.colors[i] = _wheel(offset + i * 256 // NUM_LEDS)
        _leds.show()
        offset += 8
        wait(0.03)


# ---------------------------------------------------------------- dial
def dial():
    """Dial position, 0-100."""
    global _dial_adc
    if _dial_adc is None:
        _dial_adc = ADC(Pin(DIAL_PIN))
    total = 0
    for _ in range(4):
        total += _dial_adc.read_u16()
    value = round(total * 100 / (4 * 65535))
    return 100 - value if DIAL_REVERSED else value


# ---------------------------------------------------------------- ultrasonic
_last_ping = None
_last_distance = None
_ping_failures = 0


def distance():
    """Distance to the nearest object in front, in cm (400 means nothing in range)."""
    global _trig, _echo, _last_ping, _last_distance, _ping_failures
    if _trig is None:
        _trig = Pin(US_TRIG_PIN, Pin.OUT, value=0)
        _echo = Pin(US_ECHO_PIN, Pin.IN)
    now = time.ticks_ms()
    if _last_ping is not None and time.ticks_diff(now, _last_ping) < _PING_INTERVAL_MS:
        if _last_distance is not None:
            return _last_distance
        time.sleep_ms(_PING_INTERVAL_MS - time.ticks_diff(now, _last_ping))
    _trig.value(0)
    time.sleep_us(5)
    _trig.value(1)
    time.sleep_us(10)
    _trig.value(0)
    t = time_pulse_us(_echo, 1, _ECHO_TIMEOUT_US)
    _last_ping = time.ticks_ms()
    if t == -2:
        # The echo never started: sensor unplugged, wired wrong or broken.
        _ping_failures += 1
        if _ping_failures >= 3:
            _motors.stop()
            raise RobotError("The distance sensor isn't answering. Check its cable (J1).")
        return _last_distance if _last_distance is not None else _OUT_OF_RANGE_CM
    _ping_failures = 0
    if t < 0:
        cm = _OUT_OF_RANGE_CM
    else:
        cm = round(t / 58, 1)
        if cm < 2:
            cm = 2
        if cm > _OUT_OF_RANGE_CM:
            cm = _OUT_OF_RANGE_CM
    _last_distance = cm
    return cm


def wait_for_object(cm=20):
    """Wait until something is closer than cm."""
    limit = _clamp(cm, 2, 400)
    while distance() >= limit:
        wait(0.05)


# ---------------------------------------------------------------- IMU
_AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


def _axis(spec):
    spec = spec.strip().lower()
    sign = -1 if spec.startswith("-") else 1
    return _AXIS_INDEX[spec[-1]], sign


_MAP = (_axis(IMU_FORWARD_AXIS), _axis(IMU_LEFT_AXIS), _axis(IMU_UP_AXIS))


def _to_robot(v):
    return tuple(v[i] * s for i, s in _MAP)


def _get_imu():
    global _imu, _imu_bias
    if _imu is None:
        from lsm6ds3 import LSM6DS3

        try:
            _imu = LSM6DS3(_bus(), IMU_ADDRESSES)
        except OSError:
            raise RobotError("I can't find the motion sensor (IMU). Check its cable (J6).")
        # Measure gyro drift while the robot is still.
        total = [0.0, 0.0, 0.0]
        for _ in range(20):
            g = _imu.read_raw()
            total[0] += g[0]
            total[1] += g[1]
            total[2] += g[2]
            time.sleep_ms(10)
        _imu_bias = (total[0] / 20, total[1] / 20, total[2] / 20)
    return _imu


def _read_imu(imu):
    try:
        return imu.read_raw()
    except OSError:
        raise RobotError("The motion sensor (IMU) stopped answering. Check its cable (J6).")


def _robot_rates(imu):
    v = _read_imu(imu)
    return _to_robot((v[0] - _imu_bias[0], v[1] - _imu_bias[1], v[2] - _imu_bias[2]))


def _robot_accel(imu):
    v = _read_imu(imu)
    return _to_robot((v[3], v[4], v[5]))


def acceleration(axis):
    """Acceleration along the robot's 'x' (forward), 'y' (left) or 'z' (up) axis, in g."""
    a = _robot_accel(_get_imu())
    return round(a[_AXIS_INDEX[axis]], 2)


def rotation(axis):
    """How fast the robot rotates around 'x', 'y' or 'z', in degrees per second."""
    r = _robot_rates(_get_imu())
    return round(r[_AXIS_INDEX[axis]], 1)


def tilt_angle(direction="left-right"):
    """Tilt in degrees. 'left-right': positive = right side down. 'forward-back': positive = nose down."""
    f, l, u = _robot_accel(_get_imu())
    if direction == "forward-back":
        return round(_deg(math.atan2(-f, u)))
    return round(_deg(math.atan2(l, u)))


def is_tilted(direction=None):
    f, l, u = _robot_accel(_get_imu())
    if direction is None:
        size = math.sqrt(f * f + l * l + u * u) or 1
        return _deg(math.acos(min(1, abs(u) / size))) > TILT_DEGREES
    if direction in ("left", "right"):
        angle = _deg(math.atan2(l, u))
        return angle < -TILT_DEGREES if direction == "left" else angle > TILT_DEGREES
    angle = _deg(math.atan2(-f, u))
    return angle > TILT_DEGREES if direction == "forward" else angle < -TILT_DEGREES


_shake_on = False
_shake_seen = False
_shake_quiet_until = 0


def _sample_shake(now):
    global _shake_seen
    a = _imu.read_raw()
    size = math.sqrt(a[3] * a[3] + a[4] * a[4] + a[5] * a[5])
    if abs(size - 1) > SHAKE_G and time.ticks_diff(now, _shake_quiet_until) > 0:
        _shake_seen = True


def is_shaken():
    """True once for each shake."""
    global _shake_on, _shake_seen, _shake_quiet_until
    imu = _get_imu()
    if not _shake_on:
        _shake_on = True
    a = _read_imu(imu)
    size = math.sqrt(a[3] * a[3] + a[4] * a[4] + a[5] * a[5])
    now = time.ticks_ms()
    if abs(size - 1) > SHAKE_G and time.ticks_diff(now, _shake_quiet_until) > 0:
        _shake_seen = True
    if _shake_seen:
        _shake_seen = False
        _shake_quiet_until = time.ticks_add(now, 400)
        return True
    return False


def is_moving():
    """True when the robot is being turned, bumped or carried."""
    imu = _get_imu()
    r = _robot_rates(imu)
    a = _robot_accel(imu)
    spin = math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2])
    size = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    return spin > MOVING_DPS or abs(size - 1) > 0.25


# ---------------------------------------------------------------- gesture / colour sensor
_gesture = None
_gesture_time = 0
_ROTATE = ("up", "right", "down", "left")


def _get_apds():
    global _apds
    if _apds is None:
        from apds9960 import APDS9960

        try:
            _apds = APDS9960(_bus(), APDS9960_ADDRESS)
        except OSError:
            raise RobotError("I can't find the gesture and color sensor. Check its cable (J5).")
    return _apds


def _poll_gesture():
    global _gesture, _gesture_time
    try:
        g = _get_apds().gesture()
    except OSError:
        raise RobotError("The gesture sensor stopped answering. Check its cable (J5).")
    now = time.ticks_ms()
    if g:
        steps = (int(GESTURE_ROTATION) // 90) % 4
        g = _ROTATE[(_ROTATE.index(g) + steps) % 4]
        _gesture = g
        _gesture_time = now
    elif _gesture and time.ticks_diff(now, _gesture_time) > 1500:
        _gesture = None


def swiped(direction):
    """True once when a hand swipes 'left', 'right', 'up' or 'down' over the sensor."""
    global _gesture
    _poll_gesture()
    if _gesture == direction:
        _gesture = None
        return True
    return False


def object_near():
    try:
        return _get_apds().proximity() >= PROXIMITY_NEAR
    except OSError:
        raise RobotError("The gesture sensor stopped answering. Check its cable (J5).")


def light_level():
    """Brightness of the light reaching the sensor, 0-100."""
    try:
        c = _get_apds().color_raw()[0]
    except OSError:
        raise RobotError("The color sensor stopped answering. Check its cable (J5).")
    return int(_clamp(c * 100 / LIGHT_FULL_SCALE, 0, 100))


def color():
    """Name of the color in front of the sensor: red, yellow, green, blue, purple, white or black."""
    try:
        c, r, g, b = _get_apds().color_raw()
    except OSError:
        raise RobotError("The color sensor stopped answering. Check its cable (J5).")
    if c < COLOR_MIN_CLEAR:
        return "black"
    r *= COLOR_GAINS[0]
    g *= COLOR_GAINS[1]
    b *= COLOR_GAINS[2]
    high = max(r, g, b)
    low = min(r, g, b)
    if high <= 0 or (high - low) / high < COLOR_MIN_SATURATION:
        return "white"
    d = high - low
    if high == r:
        hue = 60 * (((g - b) / d) % 6)
    elif high == g:
        hue = 60 * ((b - r) / d + 2)
    else:
        hue = 60 * ((r - g) / d + 4)
    if hue < 20 or hue >= 330:
        return "red"
    if hue < 75:
        return "yellow"
    if hue < 165:
        return "green"
    if hue < 260:
        return "blue"
    return "purple"


def sees_color(name):
    return color() == name


# ---------------------------------------------------------------- line and sound sensors
_line_pins = None
_sound_pin = None
_sound_count = 0


def line_dark(side):
    """True when the 'left' or 'right' line sensor is over a dark line."""
    global _line_pins
    if _line_pins is None:
        _line_pins = {"left": Pin(LINE_LEFT_PIN, Pin.IN), "right": Pin(LINE_RIGHT_PIN, Pin.IN)}
    return _line_pins[side].value() == LINE_DARK_VALUE


def _on_sound(_p):
    global _sound_count
    _sound_count += 1


def heard_sound():
    """True if the sound sensor heard something loud since the last check."""
    global _sound_pin, _sound_count
    if _sound_pin is None:
        _sound_pin = Pin(SOUND_SENSOR_PIN, Pin.IN)
        _sound_pin.irq(trigger=Pin.IRQ_FALLING | Pin.IRQ_RISING, handler=_on_sound)
        _sound_count = 0
        return False
    heard = _sound_count > 0
    _sound_count = 0
    return heard


# ---------------------------------------------------------------- buzzer (optional hardware)
_NOTES = {
    "C4": 262, "D4": 294, "E4": 330, "F4": 349, "G4": 392, "A4": 440, "B4": 494,
    "C5": 523, "D5": 587, "E5": 659, "F5": 698, "G5": 784, "A5": 880, "B5": 988, "C6": 1047,
}


def _get_buzzer():
    global _buzzer
    if BUZZER_PIN is None:
        raise RobotError("This robot has no buzzer set up. Ask an instructor to turn it on in Instructor settings.")
    if _buzzer is None:
        _buzzer = PWM(Pin(BUZZER_PIN), freq=1000, duty_u16=0)
    return _buzzer


def play_tone(frequency, seconds=0.5):
    bz = _get_buzzer()
    bz.freq(int(_clamp(frequency, 50, 8000)))
    bz.duty_u16(32768)
    try:
        wait(_clamp(seconds, 0, 10))
    finally:
        bz.duty_u16(0)


def play_note(note, seconds=0.5):
    play_tone(_NOTES.get(note, 440), seconds)


def beep():
    play_tone(1000, 0.15)


def alarm(seconds=2):
    end = time.ticks_add(time.ticks_ms(), int(_clamp(seconds, 0, 10) * 1000))
    high = True
    while time.ticks_diff(end, time.ticks_ms()) > 0:
        play_tone(880 if high else 660, 0.2)
        high = not high


def sound_off():
    if _buzzer is not None:
        _buzzer.duty_u16(0)
