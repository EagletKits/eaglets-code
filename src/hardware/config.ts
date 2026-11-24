// Hardware settings for the robot. Pins are fixed by the Eaglets PCB V6.2 design
// (EagletsPCB-V6.2/bringup/pins.py, checked against verification/design.net) and
// are not editable here. Instructors can tune limits, motor direction, sensor
// thresholds and the optional buzzer pin; the app writes them to the robot as
// eaglets_config.py.

export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface HardwareConfig {
  leftMotorReversed: boolean;
  rightMotorReversed: boolean;
  maxMotorPower: number;
  maxMoveSeconds: number;
  motorAutoStopSeconds: number;
  maxLedBrightness: number;
  dialReversed: boolean;
  lineDarkValue: 0 | 1;
  /** null = no buzzer fitted (the V6.2 board has none). */
  buzzerPin: number | null;
  imuForwardAxis: Axis;
  imuLeftAxis: Axis;
  imuUpAxis: Axis;
  tiltDegrees: number;
  shakeG: number;
  movingDps: number;
  gestureRotation: 0 | 90 | 180 | 270;
  proximityNear: number;
  lightFullScale: number;
  colorMinClear: number;
  colorMinSaturation: number;
  colorGains: [number, number, number];
}

export const DEFAULT_CONFIG: HardwareConfig = {
  leftMotorReversed: false,
  rightMotorReversed: false,
  maxMotorPower: 80,
  maxMoveSeconds: 10,
  motorAutoStopSeconds: 20,
  maxLedBrightness: 25,
  dialReversed: false,
  lineDarkValue: 1,
  buzzerPin: null,
  imuForwardAxis: '+x',
  imuLeftAxis: '+y',
  imuUpAxis: '+z',
  tiltDegrees: 30,
  shakeG: 0.8,
  movingDps: 40,
  gestureRotation: 0,
  proximityNear: 60,
  lightFullScale: 3000,
  colorMinClear: 20,
  colorMinSaturation: 0.2,
  colorGains: [1.0, 1.0, 1.0],
};

/**
 * Free GPIOs on expansion header J12 that can drive a buzzer.
 * GP18 is left out on purpose: it shares PWM slice 1 with GP3 (left motor),
 * so a buzzer tone there would change the motor's PWM frequency.
 */
export const BUZZER_PIN_CHOICES = [17, 27, 28] as const;

/** Fixed V6.2 pin map, shown read-only in the settings panel. */
export const V62_PINS: Array<[string, string]> = [
  ['Left motor (M1) AIN1 / AIN2', 'GP3 / GP4'],
  ['Right motor (M2) BIN1 / BIN2', 'GP6 / GP7'],
  ['Motor driver nSLEEP / nFAULT', 'GP9 / GP8'],
  ['NeoPixel stick (J10), 8 LEDs', 'GP5'],
  ['I2C1 SDA / SCL (J5 gesture, J6 IMU)', 'GP10 / GP11'],
  ['Ultrasonic (J1) TRIG / ECHO', 'GP14 / GP13'],
  ['Dial (J11)', 'GP26 (ADC0)'],
  ['Line sensors (J7 left / J8 right)', 'GP16 / GP15'],
  ['Sound sensor (J9)', 'GP12'],
  ['Expansion J12', 'GP17, GP18, GP27, GP28'],
];

const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};
const AXES: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

/** Fill in defaults and clamp values to safe ranges (used when loading saved settings). */
export function normalizeConfig(input: Partial<HardwareConfig> | null | undefined): HardwareConfig {
  const c = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  const axis = (a: unknown, d: Axis) => (AXES.includes(a as Axis) ? (a as Axis) : d);
  return {
    leftMotorReversed: !!c.leftMotorReversed,
    rightMotorReversed: !!c.rightMotorReversed,
    maxMotorPower: clampNum(c.maxMotorPower, 10, 100, 80),
    maxMoveSeconds: clampNum(c.maxMoveSeconds, 1, 30, 10),
    motorAutoStopSeconds: clampNum(c.motorAutoStopSeconds, 2, 120, 20),
    maxLedBrightness: clampNum(c.maxLedBrightness, 1, 100, 25),
    dialReversed: !!c.dialReversed,
    lineDarkValue: c.lineDarkValue === 0 ? 0 : 1,
    buzzerPin: (BUZZER_PIN_CHOICES as readonly number[]).includes(c.buzzerPin as number) ? c.buzzerPin : null,
    imuForwardAxis: axis(c.imuForwardAxis, '+x'),
    imuLeftAxis: axis(c.imuLeftAxis, '+y'),
    imuUpAxis: axis(c.imuUpAxis, '+z'),
    tiltDegrees: clampNum(c.tiltDegrees, 5, 80, 30),
    shakeG: clampNum(c.shakeG, 0.2, 3, 0.8),
    movingDps: clampNum(c.movingDps, 5, 500, 40),
    gestureRotation: ([0, 90, 180, 270].includes(c.gestureRotation) ? c.gestureRotation : 0) as HardwareConfig['gestureRotation'],
    proximityNear: clampNum(c.proximityNear, 1, 255, 60),
    lightFullScale: clampNum(c.lightFullScale, 10, 65535, 3000),
    colorMinClear: clampNum(c.colorMinClear, 0, 65535, 20),
    colorMinSaturation: clampNum(c.colorMinSaturation, 0, 1, 0.2),
    colorGains: (Array.isArray(c.colorGains) && c.colorGains.length === 3
      ? c.colorGains.map((g) => clampNum(g, 0.1, 10, 1))
      : [1, 1, 1]) as [number, number, number],
  };
}

const py = (v: boolean) => (v ? 'True' : 'False');
const pyFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** Render eaglets_config.py. With DEFAULT_CONFIG this matches firmware/eaglets_config.py exactly. */
export function renderConfigPy(cfg: HardwareConfig): string {
  return `# Eaglets Code hardware settings: Eaglets PCB V6.2 + Raspberry Pi Pico 2.
# Pin numbers come from EagletsPCB-V6.2/bringup/pins.py, checked against
# verification/design.net. Eaglets Code regenerates this file from its
# Instructor settings; edit it there rather than by hand.
BOARD = "Eaglets PCB V6.2"

# Motors: DRV8833 (U1). Left = M1 (AIN1/AIN2), right = M2 (BIN1/BIN2).
LEFT_MOTOR_PINS = (3, 4)
RIGHT_MOTOR_PINS = (6, 7)
MOTOR_SLEEP_PIN = 9
MOTOR_FAULT_PIN = 8
LEFT_MOTOR_REVERSED = ${py(cfg.leftMotorReversed)}
RIGHT_MOTOR_REVERSED = ${py(cfg.rightMotorReversed)}
MAX_MOTOR_POWER = ${cfg.maxMotorPower}
MAX_MOVE_SECONDS = ${cfg.maxMoveSeconds}
MOTOR_AUTO_STOP_SECONDS = ${cfg.motorAutoStopSeconds}

# NeoPixel stick on J10 through U3.
NEOPIXEL_PIN = 5
NUM_LEDS = 8
MAX_LED_BRIGHTNESS = ${cfg.maxLedBrightness}

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
DIAL_REVERSED = ${py(cfg.dialReversed)}

# Line sensors (J7, J8) and sound sensor (J9).
LINE_LEFT_PIN = 16
LINE_RIGHT_PIN = 15
LINE_DARK_VALUE = ${cfg.lineDarkValue}
SOUND_SENSOR_PIN = 12

# Piezo buzzer: not on the V6.2 board. None keeps sound blocks switched off.
BUZZER_PIN = ${cfg.buzzerPin === null ? 'None' : cfg.buzzerPin}

# IMU mounting: which sensor axis points forward, left and up on the robot.
IMU_FORWARD_AXIS = "${cfg.imuForwardAxis}"
IMU_LEFT_AXIS = "${cfg.imuLeftAxis}"
IMU_UP_AXIS = "${cfg.imuUpAxis}"
TILT_DEGREES = ${cfg.tiltDegrees}
SHAKE_G = ${cfg.shakeG}
MOVING_DPS = ${cfg.movingDps}

# Gesture/colour sensor tuning.
GESTURE_ROTATION = ${cfg.gestureRotation}
PROXIMITY_NEAR = ${cfg.proximityNear}
LIGHT_FULL_SCALE = ${cfg.lightFullScale}
COLOR_MIN_CLEAR = ${cfg.colorMinClear}
COLOR_MIN_SATURATION = ${cfg.colorMinSaturation}
COLOR_GAINS = (${cfg.colorGains.map(pyFloat).join(', ')})
`;
}
