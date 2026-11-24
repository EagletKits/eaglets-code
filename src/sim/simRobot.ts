// The on-screen practice robot. Same commands as eaglets.py, simulated.
// SIMULATION ONLY: real motors, sensors and timing will differ.
import type { HardwareConfig } from '../hardware/config';

export class SimStopped extends Error {
  constructor() {
    super('stopped');
  }
}
export class SimRobotError extends Error {}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ARENA = { w: 240, h: 160 };
export const ROBOT_SIZE = { w: 16, h: 20 };
const WHEEL_BASE = 13;
const TOP_SPEED_CM_S = 55;
const NUM_LEDS = 8;

export type Gesture = 'left' | 'right' | 'up' | 'down';

export interface SimInputs {
  dial: number;
  tiltLR: number;
  tiltFB: number;
  color: string;
  light: number;
  objectNear: boolean;
  lineLeft: boolean;
  lineRight: boolean;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
};
const clamp = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new SimRobotError(`A block needs a number, but got ${JSON.stringify(v)}.`);
  return Math.min(hi, Math.max(lo, n));
};
const wheel = (pos: number): [number, number, number] => {
  pos = ((Math.round(pos) % 256) + 256) % 256;
  if (pos < 85) return [255 - pos * 3, pos * 3, 0];
  if (pos < 170) {
    pos -= 85;
    return [0, 255 - pos * 3, pos * 3];
  }
  pos -= 170;
  return [pos * 3, 0, 255 - pos * 3];
};

export const MAZE_WALLS: Rect[] = [
  { x: 60, y: 0, w: 6, h: 100 },
  { x: 120, y: 60, w: 6, h: 100 },
  { x: 180, y: 0, w: 6, h: 100 },
];
export const OPEN_OBSTACLES: Rect[] = [{ x: 150, y: 30, w: 24, h: 24 }];

export class SimRobot {
  x = 30;
  y = 130;
  heading = 0; // radians, 0 = up, clockwise positive
  left = 0;
  right = 0;
  leds: Array<[number, number, number]> = Array.from({ length: NUM_LEDS }, () => [0, 0, 0] as [number, number, number]);
  brightness = 100;
  speed = 50;
  running = false;
  obstacles: Rect[] = [...OPEN_OBSTACLES];
  inputs: SimInputs = { dial: 50, tiltLR: 0, tiltFB: 0, color: 'white', light: 60, objectNear: false, lineLeft: false, lineRight: false };
  trail: Array<[number, number]> = [];

  onChange: (() => void) | null = null;
  onOutput: ((text: string) => void) | null = null;
  onHighlight: ((blockId: string | null) => void) | null = null;
  onNotice: ((text: string) => void) | null = null;

  private stopped = false;
  private physics: ReturnType<typeof setInterval> | null = null;
  private lastPhysics = 0;
  private deadline: number | null = null;
  private lastYield = 0;
  private turnedRad = 0;
  private shakePending = false;
  private gesture: { dir: Gesture; at: number } | null = null;
  private heard = false;
  private audio: AudioContext | null = null;
  private osc: OscillatorNode | null = null;

  constructor(public config: HardwareConfig) {}

  // ------------------------------------------------------------ lifecycle
  reset() {
    this.x = 30;
    this.y = 130;
    this.heading = 0;
    this.left = this.right = 0;
    this.trail = [];
    this.leds = this.leds.map(() => [0, 0, 0]);
    this.onChange?.();
  }

  requestStop() {
    this.stopped = true;
  }

  async start() {
    this.stopped = false;
    this.running = true;
    this.speed = 50;
    this.brightness = 100;
    this.deadline = null;
    this.lastPhysics = performance.now();
    this.physics ??= setInterval(() => this.step(), 16);
  }

  async shutdown() {
    this.left = this.right = 0;
    this.leds = this.leds.map(() => [0, 0, 0]);
    this.sound_off();
    this.running = false;
    if (this.physics) clearInterval(this.physics);
    this.physics = null;
    this.onHighlight?.(null);
    this.onChange?.();
  }

  private step() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastPhysics) / 1000);
    this.lastPhysics = now;
    if (this.deadline !== null && now > this.deadline && (this.left || this.right)) {
      this.left = this.right = 0;
      this.deadline = null;
      this.onOutput?.(`Motors stopped by themselves after ${this.config.motorAutoStopSeconds} seconds (safety limit).\n`);
    }
    if (this.left || this.right) {
      const scale = (TOP_SPEED_CM_S * this.config.maxMotorPower) / 10000;
      const vl = this.left * scale;
      const vr = this.right * scale;
      const v = (vl + vr) / 2;
      const dh = ((vl - vr) / WHEEL_BASE) * dt;
      this.heading += dh;
      this.turnedRad += dh;
      const nx = this.x + Math.sin(this.heading) * v * dt;
      const ny = this.y - Math.cos(this.heading) * v * dt;
      if (!this.collides(nx, ny)) {
        this.x = nx;
        this.y = ny;
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(last[0] - nx, last[1] - ny) > 2) this.trail.push([nx, ny]);
        if (this.trail.length > 600) this.trail.shift();
      }
    }
    this.onChange?.();
  }

  private collides(x: number, y: number) {
    const r = ROBOT_SIZE.h / 2 - 2;
    if (x < r || y < r || x > ARENA.w - r || y > ARENA.h - r) return true;
    return this.obstacles.some((o) => x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r);
  }

  // ------------------------------------------------------------ timing
  private check() {
    if (this.stopped) throw new SimStopped();
  }

  private sleep(ms: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const end = performance.now() + ms;
      const poll = () => {
        if (this.stopped) return reject(new SimStopped());
        const left = end - performance.now();
        if (left <= 0) return resolve();
        setTimeout(poll, Math.min(left, 20));
      };
      poll();
    });
  }

  /** Inserted into every loop so tight loops still let the page update and Stop work. */
  async tick() {
    this.check();
    const now = performance.now();
    if (now - this.lastYield > 15) {
      this.lastYield = now;
      await new Promise((r) => setTimeout(r, 0));
      this.check();
    }
  }

  async highlight(id: string) {
    this.onHighlight?.(id);
    await this.tick();
  }

  async wait(s: unknown) {
    await this.sleep(clamp(s, 0, 3600) * 1000);
  }

  async print(v: unknown) {
    this.onOutput?.(`${typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v)}\n`);
  }

  // ------------------------------------------------------------ movement
  private drive(l: number, r: number, leaseS: number) {
    this.check();
    this.left = clamp(l, -100, 100);
    this.right = clamp(r, -100, 100);
    this.deadline = performance.now() + leaseS * 1000;
    this.onChange?.();
  }

  private async move(ls: number, rs: number, speed: unknown, seconds: unknown) {
    const s = speed === null || speed === undefined ? this.speed : clamp(speed, 0, 100);
    if (seconds === null || seconds === undefined) {
      this.drive(ls * s, rs * s, this.config.motorAutoStopSeconds);
      return;
    }
    const secs = clamp(seconds, 0, this.config.maxMoveSeconds);
    this.drive(ls * s, rs * s, secs + 1);
    try {
      await this.sleep(secs * 1000);
    } finally {
      this.left = this.right = 0;
    }
  }

  forward(speed?: unknown, seconds?: unknown) {
    return this.move(1, 1, speed, seconds);
  }
  backward(speed?: unknown, seconds?: unknown) {
    return this.move(-1, -1, speed, seconds);
  }
  turn_left(speed?: unknown, seconds?: unknown) {
    return this.move(-1, 1, speed, seconds);
  }
  turn_right(speed?: unknown, seconds?: unknown) {
    return this.move(1, -1, speed, seconds);
  }
  async stop() {
    this.left = this.right = 0;
    this.onChange?.();
  }
  async set_speed(p: unknown) {
    this.speed = clamp(p, 0, 100);
    if (this.left || this.right) this.drive(Math.sign(this.left) * this.speed, Math.sign(this.right) * this.speed, this.config.motorAutoStopSeconds);
  }
  async set_motors(l: unknown, r: unknown) {
    this.drive(clamp(l, -100, 100), clamp(r, -100, 100), this.config.motorAutoStopSeconds);
  }
  async turn_degrees(dir: string, degrees: unknown) {
    const target = (clamp(degrees, 0, 720) * Math.PI) / 180;
    const sign = dir === 'left' ? -1 : 1;
    this.turnedRad = 0;
    this.drive(sign * 40, -sign * 40, 10);
    const timeout = performance.now() + (2 + clamp(degrees, 0, 720) / 45) * 1000;
    try {
      while (Math.abs(this.turnedRad) < target) {
        if (performance.now() > timeout) {
          this.onOutput?.('Turn took too long; stopping. Are the wheels stuck?\n');
          break;
        }
        await this.sleep(5);
      }
    } finally {
      this.left = this.right = 0;
    }
  }

  // ------------------------------------------------------------ lights
  rgb(r: unknown, g: unknown, b: unknown): [number, number, number] {
    return [Math.round(clamp(r, 0, 100) * 2.55), Math.round(clamp(g, 0, 100) * 2.55), Math.round(clamp(b, 0, 100) * 2.55)];
  }
  random_color() {
    return wheel(Math.random() * 256);
  }
  private parse(c: unknown): [number, number, number] {
    if (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)) return hexToRgb(c);
    if (Array.isArray(c) && c.length === 3) return c.map((x) => clamp(x, 0, 255)) as [number, number, number];
    throw new SimRobotError(`I don't know the color ${JSON.stringify(c)}.`);
  }
  async set_leds(c: unknown) {
    const col = this.parse(c);
    this.leds = this.leds.map(() => col);
    this.onChange?.();
  }
  async set_led(n: unknown, c: unknown) {
    const i = Math.round(clamp(n, 1, NUM_LEDS)) - 1;
    this.leds[i] = this.parse(c);
    this.onChange?.();
  }
  async leds_off() {
    await this.set_leds('#000000');
  }
  async set_brightness(p: unknown) {
    this.brightness = clamp(p, 0, 100);
    this.onChange?.();
  }
  async flash_leds(c: unknown, times: unknown) {
    const n = Math.round(clamp(times, 1, 50));
    for (let i = 0; i < n; i++) {
      await this.set_leds(c);
      await this.sleep(250);
      await this.leds_off();
      await this.sleep(250);
    }
  }
  async rainbow(s: unknown) {
    const end = performance.now() + clamp(s, 0, 60) * 1000;
    let off = 0;
    while (performance.now() < end) {
      this.leds = this.leds.map((_, i) => wheel(off + (i * 256) / NUM_LEDS));
      this.onChange?.();
      off += 8;
      await this.sleep(30);
    }
  }

  // ------------------------------------------------------------ sensors
  dial() {
    return Math.round(this.config.dialReversed ? 100 - this.inputs.dial : this.inputs.dial);
  }

  distance() {
    const fx = this.x + Math.sin(this.heading) * (ROBOT_SIZE.h / 2);
    const fy = this.y - Math.cos(this.heading) * (ROBOT_SIZE.h / 2);
    for (let d = 2; d <= 400; d += 0.5) {
      const px = fx + Math.sin(this.heading) * d;
      const py = fy - Math.cos(this.heading) * d;
      const hit = px < 0 || py < 0 || px > ARENA.w || py > ARENA.h || this.obstacles.some((o) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h);
      if (hit) return Math.round(d * 10) / 10;
    }
    return 400;
  }

  async wait_for_object(cm: unknown) {
    const limit = clamp(cm, 2, 400);
    while (this.distance() >= limit) await this.sleep(50);
  }

  private tiltAngles() {
    return { lr: this.inputs.tiltLR, fb: this.inputs.tiltFB };
  }
  is_tilted(dir?: string) {
    const { lr, fb } = this.tiltAngles();
    const t = this.config.tiltDegrees;
    if (!dir) {
      const a = (Math.acos(Math.cos((lr * Math.PI) / 180) * Math.cos((fb * Math.PI) / 180)) * 180) / Math.PI;
      return a > t;
    }
    if (dir === 'left') return lr < -t;
    if (dir === 'right') return lr > t;
    if (dir === 'forward') return fb > t;
    return fb < -t;
  }
  tilt_angle(axis: string) {
    const { lr, fb } = this.tiltAngles();
    return Math.round(axis === 'forward-back' ? fb : lr);
  }
  acceleration(axis: string) {
    const { lr, fb } = this.tiltAngles();
    const r = (d: number) => (d * Math.PI) / 180;
    if (axis === 'x') return Math.round(-Math.sin(r(fb)) * 100) / 100;
    if (axis === 'y') return Math.round(Math.sin(r(lr)) * 100) / 100;
    return Math.round(Math.cos(r(lr)) * Math.cos(r(fb)) * 100) / 100;
  }
  rotation(axis: string) {
    if (axis !== 'z') return 0;
    const scale = (TOP_SPEED_CM_S * this.config.maxMotorPower) / 10000;
    return Math.round((((this.right - this.left) * scale) / WHEEL_BASE) * (180 / Math.PI) * 10) / 10;
  }
  shake() {
    this.shakePending = true;
  }
  is_shaken() {
    const s = this.shakePending;
    this.shakePending = false;
    return s;
  }
  is_moving() {
    return this.left !== 0 || this.right !== 0 || this.shakePending;
  }
  swipe(dir: Gesture) {
    this.gesture = { dir, at: performance.now() };
  }
  swiped(dir: string) {
    if (this.gesture && performance.now() - this.gesture.at > 1500) this.gesture = null;
    if (this.gesture?.dir === dir) {
      this.gesture = null;
      return true;
    }
    return false;
  }
  object_near() {
    return this.inputs.objectNear;
  }
  light_level() {
    return Math.round(this.inputs.light);
  }
  color() {
    return this.inputs.color;
  }
  sees_color(name: string) {
    return this.inputs.color === name;
  }
  line_dark(side: string) {
    return side === 'left' ? this.inputs.lineLeft : this.inputs.lineRight;
  }
  clap() {
    this.heard = true;
  }
  heard_sound() {
    const h = this.heard;
    this.heard = false;
    return h;
  }

  // ------------------------------------------------------------ sound
  private needBuzzer() {
    if (this.config.buzzerPin === null) throw new SimRobotError('This robot has no buzzer set up. Ask an instructor to turn it on in Instructor settings.');
  }
  private toneOn(freq: number) {
    try {
      this.audio ??= new AudioContext();
      this.osc?.stop();
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      gain.gain.value = 0.05;
      osc.type = 'square';
      osc.frequency.value = freq;
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      this.osc = osc;
    } catch {
      /* no audio available */
    }
  }
  async play_tone(freq: unknown, s: unknown) {
    this.needBuzzer();
    this.toneOn(clamp(freq, 50, 8000));
    try {
      await this.sleep(clamp(s, 0, 10) * 1000);
    } finally {
      this.sound_off();
    }
  }
  async play_note(note: string, s: unknown) {
    const notes: Record<string, number> = { C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, B5: 988, C6: 1047 };
    await this.play_tone(notes[note] ?? 440, s);
  }
  async beep() {
    await this.play_tone(1000, 0.15);
  }
  async alarm(s: unknown) {
    const end = performance.now() + clamp(s, 0, 10) * 1000;
    let high = true;
    while (performance.now() < end) {
      await this.play_tone(high ? 880 : 660, 0.2);
      high = !high;
    }
  }
  sound_off() {
    try {
      this.osc?.stop();
    } catch {
      /* already stopped */
    }
    this.osc = null;
  }

  /** LED colour as shown on screen, with brightness applied (no hardware cap, so kids can see it). */
  displayLed(i: number) {
    const [r, g, b] = this.leds[i];
    const k = this.brightness / 100;
    return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
  }
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (robot: SimRobot) => Promise<void>;

export type SimResult = { status: 'finished' } | { status: 'stopped' } | { status: 'error'; message: string };

/** Run simulator JS on a SimRobot. Resolves when the program ends or is stopped. */
export async function runOnSimulator(js: string, robot: SimRobot): Promise<SimResult> {
  let fn: (robot: SimRobot) => Promise<void>;
  try {
    fn = new AsyncFunction('robot', js);
  } catch (e) {
    return { status: 'error', message: `Eaglets Code made a program it couldn't read: ${(e as Error).message}` };
  }
  try {
    await fn(robot);
    return { status: 'finished' };
  } catch (e) {
    if (e instanceof SimStopped) return { status: 'stopped' };
    if (e instanceof SimRobotError) return { status: 'error', message: e.message };
    return { status: 'error', message: `Something went wrong: ${(e as Error).message}` };
  } finally {
    await robot.shutdown();
  }
}
