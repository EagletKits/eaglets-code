# Eaglets Code hardware settings: Eaglets PCB V6.2 + Raspberry Pi Pico 2.
# Pin numbers come from EagletsPCB-V6.2/bringup/pins.py, checked against
# verification/design.net. Eaglets Code regenerates this file from its
# Instructor settings; edit it there rather than by hand.
BOARD = "Eaglets PCB V6.2"

# Motors: DRV8833 (U1). Left = M1 (AIN1/AIN2), right = M2 (BIN1/BIN2).
LEFT_MOTOR_PINS = (3, 4)
RIGHT_MOTOR_PINS = (6, 7)
MOTOR_SLEEP_PIN = 9
MOTOR_FAULT_PIN = 8
LEFT_MOTOR_REVERSED = False
RIGHT_MOTOR_REVERSED = False
MAX_MOTOR_POWER = 80
MAX_MOVE_SECONDS = 10
MOTOR_AUTO_STOP_SECONDS = 20

# NeoPixel stick on J10 through U3.
NEOPIXEL_PIN = 5
NUM_LEDS = 8
MAX_LED_BRIGHTNESS = 25

# I2C1: J5 gesture/colour (APDS-9960), J6 IMU (LSM6DS3TR-C).
I2C_ID = 1
I2C_SDA_PIN = 10
I2C_SCL_PIN = 11
I2C_FREQ = 100000
APDS9960_ADDRESS = 0x39
IMU_ADDRESSES = (0x6A, 0x6B)

# Ultrasonic (J1) and dial (J11).
US_TRIG_PIN = 14
US_ECHO_PIN = 13
DIAL_PIN = 26
DIAL_REVERSED = False

# Line sensors (J7, J8) and sound sensor (J9).
LINE_LEFT_PIN = 16
LINE_RIGHT_PIN = 15
LINE_DARK_VALUE = 1
SOUND_SENSOR_PIN = 12

# Piezo buzzer: not on the V6.2 board. None keeps sound blocks switched off.
BUZZER_PIN = None

# IMU mounting: which sensor axis points forward, left and up on the robot.
IMU_FORWARD_AXIS = "+x"
IMU_LEFT_AXIS = "+y"
IMU_UP_AXIS = "+z"
TILT_DEGREES = 30
SHAKE_G = 0.8
MOVING_DPS = 40

# Gesture/colour sensor tuning.
GESTURE_ROTATION = 0
PROXIMITY_NEAR = 60
LIGHT_FULL_SCALE = 3000
COLOR_MIN_CLEAR = 20
COLOR_MIN_SATURATION = 0.2
COLOR_GAINS = (1.0, 1.0, 1.0)
