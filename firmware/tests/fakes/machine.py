# Fake `machine` module for running Eaglets programs on a desktop computer.
# MOCK HARDWARE ONLY: passing tests here say nothing about the real robot.
import fakehw as hw


class Pin:
    IN = 0
    OUT = 1
    PULL_UP = 1
    PULL_DOWN = 2
    IRQ_FALLING = 4
    IRQ_RISING = 8

    def __init__(self, pin_id, mode=None, pull=None, value=None):
        self.id = pin_id
        hw.STATE.pin_modes[pin_id] = mode
        if value is not None:
            self.value(value)

    def value(self, v=None):
        hw.tick_us(1)
        if v is None:
            return hw.read_pin(self.id)
        hw.STATE.pins[self.id] = 1 if v else 0
        hw.log("pin", self.id, 1 if v else 0)
        return None

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def irq(self, trigger=None, handler=None):
        hw.STATE.irqs[self.id] = handler


class PWM:
    def __init__(self, pin, freq=1000, duty_u16=0):
        self.pin = pin.id
        self._freq = freq
        hw.STATE.pwm_freq[self.pin] = freq
        self.duty_u16(duty_u16)

    def duty_u16(self, d=None):
        if d is None:
            return hw.STATE.duty.get(self.pin, 0)
        hw.tick_us(2)
        d = int(d)
        if not 0 <= d <= 65535:
            raise ValueError("duty out of range")
        if hw.STATE.duty.get(self.pin) != d:
            hw.STATE.duty[self.pin] = d
            hw.log("duty", self.pin, d)

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = f
        hw.STATE.pwm_freq[self.pin] = f

    def deinit(self):
        self.duty_u16(0)


class ADC:
    def __init__(self, pin):
        self.pin = pin.id if isinstance(pin, Pin) else pin

    def read_u16(self):
        hw.tick_us(10)
        return hw.read_adc(self.pin)


class I2C:
    def __init__(self, bus_id, sda=None, scl=None, freq=400000):
        self.bus_id = bus_id
        hw.STATE.i2c_pins = (sda.id if sda else None, scl.id if scl else None)

    def scan(self):
        return sorted(hw.STATE.i2c_devices)

    def _dev(self, addr):
        hw.tick_us(200)
        dev = hw.STATE.i2c_devices.get(addr)
        if dev is None:
            raise OSError(5)  # EIO, like a missing device
        return dev

    def readfrom_mem(self, addr, reg, n):
        return self._dev(addr).read(reg, n)

    def writeto_mem(self, addr, reg, data):
        self._dev(addr).write(reg, bytes(data))


class Timer:
    PERIODIC = 1
    ONE_SHOT = 0

    def __init__(self, id=-1, period=1000, mode=1, callback=None):
        self.period = period
        self.callback = callback
        self.next = hw.STATE.now_us + period * 1000
        hw.STATE.timers.append(self)

    def deinit(self):
        if self in hw.STATE.timers:
            hw.STATE.timers.remove(self)


def time_pulse_us(pin, level, timeout_us):
    return hw.echo_pulse(pin.id, timeout_us)


def reset():
    raise SystemExit("machine.reset()")
