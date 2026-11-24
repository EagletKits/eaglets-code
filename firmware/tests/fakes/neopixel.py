# Fake `neopixel` module (MOCK HARDWARE ONLY).
import fakehw as hw


class NeoPixel:
    def __init__(self, pin, n):
        self.pin = pin.id
        self.n = n
        self.buf = [(0, 0, 0)] * n

    def __setitem__(self, i, color):
        self.buf[i] = tuple(int(c) for c in color)

    def __getitem__(self, i):
        return self.buf[i]

    def __len__(self):
        return self.n

    def fill(self, color):
        self.buf = [tuple(color)] * self.n

    def write(self):
        hw.tick_us(30 * self.n + 50)  # WS2812 takes ~30 us per LED
        for r, g, b in self.buf:
            for c in (r, g, b):
                if not 0 <= c <= 255:
                    raise ValueError("LED value out of range: %r" % (c,))
        hw.STATE.leds = list(self.buf)
        hw.log("leds", None, list(self.buf))
