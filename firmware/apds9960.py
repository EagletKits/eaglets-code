# Minimal APDS-9960 driver for Eaglets Code (MicroPython).
# The Eaglets V6.2 kit uses the Adafruit APDS-9960 board (#3595) on the
# STEMMA QT socket J5, I2C address 0x39.
#
# Gives proximity (0-255), raw colour counts (clear, red, green, blue) and
# swipe gestures. The gesture decoding follows the approach used by the
# Adafruit and SparkFun libraries: compare the up/down and left/right
# photodiodes over the gesture FIFO and report which pair changed first.
import time

_ENABLE = 0x80
_ATIME = 0x81
_CONFIG1 = 0x8D
_PPULSE = 0x8E
_CONTROL = 0x8F
_CONFIG2 = 0x90
_ID = 0x92
_STATUS = 0x93
_CDATAL = 0x94
_PDATA = 0x9C
_GPENTH = 0xA0
_GEXTH = 0xA1
_GCONF1 = 0xA2
_GCONF2 = 0xA3
_GPULSE = 0xA6
_GCONF3 = 0xAA
_GCONF4 = 0xAB
_GFLVL = 0xAE
_GSTATUS = 0xAF
_GFIFO_U = 0xFC

_PON = 0x01
_AEN = 0x02
_PEN = 0x04
_GEN = 0x40

# 0xAB is the documented ID; some clone modules report 0x9C or 0xA8.
_KNOWN_IDS = (0xAB, 0x9C, 0xA8)

UP = "up"
DOWN = "down"
LEFT = "left"
RIGHT = "right"

# A pair of photodiodes must differ by more than this to count.
_DIFF_THRESHOLD = 13


class APDS9960:
    def __init__(self, i2c, address=0x39):
        self.i2c = i2c
        self.address = address
        dev_id = self._read(_ID)
        if dev_id not in _KNOWN_IDS:
            raise OSError("APDS-9960 not found (id 0x%02x)" % dev_id)
        self._write(_ENABLE, 0x00)
        time.sleep_ms(10)
        self._write(_ATIME, 0xDB)  # 37 cycles, about 103 ms per colour reading
        self._write(_CONFIG1, 0x60)  # no long wait
        self._write(_PPULSE, 0x87)  # 16 us, 8 proximity pulses
        self._write(_CONTROL, 0x09)  # LED 100 mA, proximity gain 4x, colour gain 4x
        self._write(_CONFIG2, 0x01)
        self._write(_GPENTH, 40)  # gesture starts above this proximity
        self._write(_GEXTH, 30)  # gesture ends below this
        self._write(_GCONF1, 0x40)  # interrupt after 4 datasets
        self._write(_GCONF2, 0x41)  # gesture gain 4x, LED 100 mA, 2.8 ms wait
        self._write(_GPULSE, 0xC9)  # 32 us, 10 gesture pulses
        self._write(_GCONF3, 0x00)  # all four photodiodes
        self._write(_GCONF4, 0x00)
        self._write(_ENABLE, _PON)
        time.sleep_ms(10)
        self._write(_ENABLE, _PON | _AEN | _PEN | _GEN)
        self._last_color = None

    def _read(self, reg):
        return self.i2c.readfrom_mem(self.address, reg, 1)[0]

    def _write(self, reg, value):
        self.i2c.writeto_mem(self.address, reg, bytes((value,)))

    def proximity(self):
        """0 (nothing) to 255 (very close)."""
        return self._read(_PDATA)

    def color_raw(self):
        """Return (clear, red, green, blue) counts, or the last reading if a new one isn't ready."""
        if self._read(_STATUS) & 0x01 or self._last_color is None:
            d = self.i2c.readfrom_mem(self.address, _CDATAL, 8)
            self._last_color = (
                d[0] | (d[1] << 8),
                d[2] | (d[3] << 8),
                d[4] | (d[5] << 8),
                d[6] | (d[7] << 8),
            )
        return self._last_color

    def gesture(self, max_ms=400):
        """Return "up", "down", "left", "right" or None.

        Returns immediately when no gesture is in progress, and never waits
        longer than max_ms, so a forever loop keeps running.
        """
        if not (self._read(_GSTATUS) & 0x01):
            return None
        ud = du = lr = rl = 0
        result = None
        start = time.ticks_ms()
        last_change = start
        while time.ticks_diff(time.ticks_ms(), start) < max_ms:
            level = self._read(_GFLVL)
            if level == 0:
                if time.ticks_diff(time.ticks_ms(), last_change) > 300:
                    break
                time.sleep_ms(10)
                continue
            data = self.i2c.readfrom_mem(self.address, _GFIFO_U, min(level, 32) * 4)
            for i in range(0, len(data) - 3, 4):
                u, d, l, r = data[i], data[i + 1], data[i + 2], data[i + 3]
                ud_diff = u - d if abs(u - d) > _DIFF_THRESHOLD else 0
                lr_diff = l - r if abs(l - r) > _DIFF_THRESHOLD else 0
                if ud_diff < 0:
                    if du > 0:
                        result = UP
                    else:
                        ud += 1
                elif ud_diff > 0:
                    if ud > 0:
                        result = DOWN
                    else:
                        du += 1
                if lr_diff < 0:
                    if rl > 0:
                        result = LEFT
                    else:
                        lr += 1
                elif lr_diff > 0:
                    if lr > 0:
                        result = RIGHT
                    else:
                        rl += 1
                if ud_diff or lr_diff:
                    last_change = time.ticks_ms()
                if result:
                    break
            if result:
                break
        # Drain anything left so the next gesture starts clean.
        try:
            level = self._read(_GFLVL)
            if level:
                self.i2c.readfrom_mem(self.address, _GFIFO_U, min(level, 32) * 4)
        except OSError:
            pass
        return result
