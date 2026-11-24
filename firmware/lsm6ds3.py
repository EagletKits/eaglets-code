# Minimal LSM6DS3 / LSM6DS3TR-C driver for Eaglets Code (MicroPython).
# The Eaglets V6.2 kit uses the Adafruit LSM6DS3TR-C board (#4503) on the
# STEMMA QT socket J6, I2C address 0x6A (0x6B if its address jumper is cut).
#
# Datasheet registers used:
#   WHO_AM_I 0x0F, CTRL1_XL 0x10, CTRL2_G 0x11, CTRL3_C 0x12, OUTX_L_G 0x22
# Accelerometer: +-2 g full scale, 0.061 mg per bit.
# Gyroscope:     +-250 dps full scale, 8.75 mdps per bit.
import time
import struct

_WHO_AM_I = 0x0F
_CTRL1_XL = 0x10
_CTRL2_G = 0x11
_CTRL3_C = 0x12
_OUTX_L_G = 0x22

# 0x69 = LSM6DS3, 0x6A = LSM6DS3TR-C, 0x6C = LSM6DSOX (same basic registers).
_KNOWN_IDS = (0x69, 0x6A, 0x6C)

ACCEL_G_PER_BIT = 0.000061
GYRO_DPS_PER_BIT = 0.00875


class LSM6DS3:
    def __init__(self, i2c, addresses=(0x6A, 0x6B)):
        self.i2c = i2c
        self.address = None
        for addr in addresses:
            try:
                who = i2c.readfrom_mem(addr, _WHO_AM_I, 1)[0]
            except OSError:
                continue
            if who in _KNOWN_IDS:
                self.address = addr
                break
        if self.address is None:
            raise OSError("IMU not found")
        self._write(_CTRL3_C, 0x01)  # software reset
        time.sleep_ms(20)
        self._write(_CTRL1_XL, 0x40)  # 104 Hz, +-2 g
        self._write(_CTRL2_G, 0x40)  # 104 Hz, 250 dps
        self._write(_CTRL3_C, 0x44)  # block data update + register auto-increment
        time.sleep_ms(30)

    def _write(self, reg, value):
        self.i2c.writeto_mem(self.address, reg, bytes((value,)))

    def read_raw(self):
        """Return (gx, gy, gz, ax, ay, az) in sensor axes: dps and g."""
        data = self.i2c.readfrom_mem(self.address, _OUTX_L_G, 12)
        gx, gy, gz, ax, ay, az = struct.unpack("<hhhhhh", data)
        return (
            gx * GYRO_DPS_PER_BIT,
            gy * GYRO_DPS_PER_BIT,
            gz * GYRO_DPS_PER_BIT,
            ax * ACCEL_G_PER_BIT,
            ay * ACCEL_G_PER_BIT,
            az * ACCEL_G_PER_BIT,
        )
