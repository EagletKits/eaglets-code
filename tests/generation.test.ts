import { beforeAll, describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import { BLOCK_DEFINITIONS } from '../src/blocks/definitions';
import { allToolboxBlockTypes, buildToolbox } from '../src/blocks/toolbox';
import { generatePython } from '../src/generators/python';
import { STARTER_PROJECTS } from '../src/projects/starters';
import { findMpyCross, mpyCompile, runOnFakeRobot, setupBlockly, workspaceFrom } from './helpers';

const ALLOWED_IMPORTS = new Set(['eaglets', 'random', 'math', 'time']);
const mpyCross = findMpyCross();

beforeAll(() => setupBlockly());

function program(...stack: object[]) {
  let next: object | undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    next = { ...stack[i], ...(next ? { next: { block: next } } : {}) };
  }
  return { blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_when_start', x: 0, y: 0, ...(next ? { next: { block: next } } : {}) }] } };
}
const num = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

function importsOf(code: string): string[] {
  return [...code.matchAll(/^\s*(?:import (\w+)|from (\w+) import)/gm)].map((m) => m[1] ?? m[2]);
}

describe('every toolbox block', () => {
  it('has a Python generator', async () => {
    const { pythonGenerator } = await import('blockly/python');
    for (const t of allToolboxBlockTypes()) {
      expect(pythonGenerator.forBlock[t], t).toBeTypeOf('function');
    }
  });

  it('generates MicroPython that compiles and imports only Pico-safe modules', () => {
    // Put each toolbox block (with its default shadows) into a program, one at a time.
    const toolbox = buildToolbox({ beginner: false, buzzerEnabled: true });
    const items: Array<Record<string, unknown>> = [];
    const walk = (xs: unknown[]) => {
      for (const x of xs as Array<Record<string, unknown>>) {
        if (x.kind === 'block') items.push(x);
        if (Array.isArray(x.contents)) walk(x.contents);
      }
    };
    walk(toolbox.contents);
    expect(items.length).toBeGreaterThan(40);

    for (const item of items) {
      const { kind: _k, ...blockJson } = item;
      const ws = new Blockly.Workspace();
      const block = Blockly.serialization.blocks.append(blockJson as Blockly.serialization.blocks.State, ws);
      let state: object;
      if (block.outputConnection) {
        // Wrap reporters in a print block so they appear in a statement.
        state = program({ type: 'eaglets_print', inputs: { VALUE: { block: blockJson } } });
      } else if (!block.previousConnection) {
        continue; // the hat block itself
      } else {
        state = program(blockJson);
      }
      const code = generatePython(workspaceFrom(state));
      for (const mod of importsOf(code)) expect(ALLOWED_IMPORTS, `${item.type}: import ${mod}`).toContain(mod);
      expect(code, String(item.type)).not.toMatch(/\bnumbers\b|statistics|typing/);
      if (mpyCross) expect(mpyCompile(mpyCross, code), `${item.type}\n${code}`).toBeNull();
    }
  });

  it('has definitions with tooltips', () => {
    for (const def of BLOCK_DEFINITIONS) expect((def as { tooltip?: string }).tooltip, def.type).toBeTruthy();
  });
});

describe('code generation details', () => {
  it('wraps the program so the robot always shuts down', () => {
    const code = generatePython(workspaceFrom(program({ type: 'eaglets_move_for', fields: { DIR: 'forward' }, inputs: { SECONDS: num(2) } })));
    expect(code).toContain('import eaglets as robot');
    expect(code).toMatch(/robot\.start\(\)\ntry:\n {4}robot\.forward\(seconds=2\)\nfinally:\n {4}robot\.shutdown\(\)/);
  });

  it('generates motor and LED commands', () => {
    const code = generatePython(
      workspaceFrom(
        program(
          { type: 'eaglets_move_speed', fields: { DIR: 'backward' }, inputs: { SPEED: num(30) } },
          { type: 'eaglets_turn_for', fields: { DIR: 'right' }, inputs: { SECONDS: num(0.5) } },
          { type: 'eaglets_turn_degrees', fields: { DIR: 'left' }, inputs: { DEGREES: num(90) } },
          { type: 'eaglets_stop' },
          { type: 'eaglets_leds_all', inputs: { COLOR: { shadow: { type: 'eaglets_color', fields: { COLOR: '#00ff00' } } } } },
          { type: 'eaglets_led_one', inputs: { NUMBER: num(3), COLOR: { shadow: { type: 'eaglets_color', fields: { COLOR: '#0000ff' } } } } },
          { type: 'eaglets_brightness_dial' },
          { type: 'eaglets_speed_from_dial' },
        ),
      ),
    );
    expect(code).toContain('robot.backward(30)');
    expect(code).toContain('robot.turn_right(seconds=0.5)');
    expect(code).toContain("robot.turn_degrees('left', 90)");
    expect(code).toContain('robot.stop()');
    expect(code).toContain("robot.set_leds('#00ff00')");
    expect(code).toContain("robot.set_led(3, '#0000ff')");
    expect(code).toContain('robot.set_brightness(robot.dial())');
    expect(code).toContain('robot.set_speed(robot.dial())');
  });

  it('generates sensor conditions', () => {
    const ifBlock = (cond: object) => ({ type: 'controls_if', inputs: { IF0: { block: cond }, DO0: { block: { type: 'eaglets_stop' } } } });
    const code = generatePython(
      workspaceFrom(
        program(
          ifBlock({ type: 'eaglets_distance_lt', inputs: { CM: num(15) } }),
          ifBlock({ type: 'eaglets_swiped', fields: { DIR: 'left' } }),
          ifBlock({ type: 'eaglets_shaken' }),
          ifBlock({ type: 'eaglets_tilted_dir', fields: { DIR: 'forward' } }),
          ifBlock({ type: 'eaglets_color_is', fields: { COLOR: 'green' } }),
          ifBlock({ type: 'eaglets_object_near' }),
          ifBlock({ type: 'logic_compare', fields: { OP: 'GT' }, inputs: { A: { block: { type: 'eaglets_light' } }, B: num(50) } }),
        ),
      ),
    );
    for (const s of [
      'if robot.distance() < 15:',
      "if robot.swiped('left'):",
      'if robot.is_shaken():',
      "if robot.is_tilted('forward'):",
      "if robot.sees_color('green'):",
      'if robot.object_near():',
      'if robot.light_level() > 50:',
    ]) {
      expect(code).toContain(s);
    }
  });

  it('handles variables, change-by and functions', () => {
    const state = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'eaglets_when_start',
            next: {
              block: {
                type: 'variables_set',
                fields: { VAR: { id: 'v1' } },
                inputs: { VALUE: num(0) },
                next: {
                  block: {
                    type: 'controls_repeat_ext',
                    inputs: {
                      TIMES: num(3),
                      DO: {
                        block: {
                          type: 'math_change',
                          fields: { VAR: { id: 'v1' } },
                          inputs: { DELTA: num(2) },
                          next: { block: { type: 'procedures_callnoreturn', extraState: { name: 'blink' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            type: 'procedures_defnoreturn',
            x: 300,
            fields: { NAME: 'blink' },
            inputs: {
              STACK: {
                block: { type: 'eaglets_flash', inputs: { COLOR: { shadow: { type: 'eaglets_color', fields: { COLOR: '#ffffff' } } }, TIMES: { block: { type: 'variables_get', fields: { VAR: { id: 'v1' } } } } } },
              },
            },
          },
        ],
      },
      variables: [{ name: 'score', id: 'v1' }],
    };
    const code = generatePython(workspaceFrom(state));
    expect(code).toContain('score = None');
    expect(code).toContain('score = 0');
    expect(code).toContain('score = (score or 0) + 2');
    expect(code).toMatch(/def blink\(\):\n {4}global score\n {4}robot\.flash_leds\('#ffffff', score\)/);
    expect(code).toContain('for count in range(3):');
    const r = runOnFakeRobot(code);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // 2 + 4 + 6 = 12 flashes in total, each 0.5 s.
    expect(r.virtual_seconds).toBeGreaterThanOrEqual(6);
  });

  it('generates loops: forever, repeat until', () => {
    const code = generatePython(
      workspaceFrom(
        program(
          {
            type: 'controls_whileUntil',
            fields: { MODE: 'UNTIL' },
            inputs: { BOOL: { block: { type: 'eaglets_distance_lt', inputs: { CM: num(10) } } }, DO: { block: { type: 'eaglets_move' } } },
          },
          { type: 'eaglets_forever', inputs: { DO: { block: { type: 'eaglets_wait', inputs: { SECONDS: num(1) } } } } },
        ),
      ),
    );
    expect(code).toMatch(/while not robot\.distance\(\) < 10:\n {8}robot\.forward\(\)/);
    expect(code).toMatch(/while True:\n {8}robot\.wait\(1\)/);
  });

  it('empty forever loop still compiles', () => {
    const code = generatePython(workspaceFrom(program({ type: 'eaglets_forever' })));
    expect(code).toMatch(/while True:\n {8}pass/);
    if (mpyCross) expect(mpyCompile(mpyCross, code)).toBeNull();
  });

  it('ignores blocks not attached to the start block', () => {
    const state = program({ type: 'eaglets_stop' });
    (state.blocks.blocks as object[]).push({ type: 'eaglets_rainbow', x: 400, y: 400, inputs: { SECONDS: num(2) } });
    const code = generatePython(workspaceFrom(state));
    expect(code).not.toContain('rainbow');
  });

  it('escapes project names into a safe comment', () => {
    const code = generatePython(workspaceFrom(program()), 'Evil\nimport os');
    expect(code.split('\n')[0]).toBe('# Evil import os');
  });
});

describe('starter projects', () => {
  it('has the ten required starters plus curriculum extras', () => {
    const titles = STARTER_PROJECTS.map((s) => s.title);
    for (const t of [
      'Flashing LEDs',
      'Traffic Light',
      'Robot Mood Lights',
      'Move Forward and Stop',
      'Robot Dance',
      'Gesture-Controlled Robot',
      'Obstacle Detection',
      'IMU Tilt Alarm',
      'Shake to Change Color',
      'Smart Maze Starter',
    ]) {
      expect(titles).toContain(t);
    }
  });

  // Sensor scripts so each starter has something to react to on the fake robot.
  const scenarios: Record<string, object> = {
    'gesture-robot': { gestures: [[0.5, 'left'], [1.5, 'up'], [3, 'down']], max_seconds: 5 },
    'obstacle-detection': { distance_cm: [[0, 100], [2, 10]], max_seconds: 4 },
    'tilt-alarm': { imu: { accel: [[0, [0, 0, 1]], [1, [0, 0.8, 0.5]]] }, max_seconds: 4 },
    'tilt-colors': { imu: { accel: [[0, [0, 0, 1]], [1, [0.5, 0.5, 0.7]]] }, max_seconds: 3 },
    'shake-color': { imu: { accel: [[0, [0, 0, 1]], [1, [2, 1, 1]], [1.1, [0, 0, 1]]] }, max_seconds: 3 },
    'smart-maze': {
      distance_cm: [[0, 100], [1, 12], [3, 100]],
      imu: { gyro: [[0, [0, 0, 0]], [0.5, [0, 0, -120]]] },
      max_seconds: 8,
    },
    'mood-lights': { dial: [[0, 10], [1, 50], [2, 90]], max_seconds: 3 },
    'traffic-light': { max_seconds: 10 },
  };

  for (const s of STARTER_PROJECTS) {
    it(`${s.title}: loads, compiles and runs on the fake robot`, () => {
      const ws = workspaceFrom(s.workspace);
      const code = generatePython(ws, s.title);
      if (mpyCross) expect(mpyCompile(mpyCross, code), code).toBeNull();
      const r = runOnFakeRobot(code, scenarios[s.id] ?? { max_seconds: 30 });
      expect(r.ok, `${code}\n${JSON.stringify(r, null, 1)}`).toBe(true);
      expect(r.error_type === null || r.error_type === 'KeyboardInterrupt').toBe(true);
      // Every run ends with the motor driver asleep, motors off, LEDs off.
      expect(r.final.motor_sleep).toBe(0);
      expect(Object.values(r.final.motor_duty).every((d) => d === 0)).toBe(true);
      expect(r.final.leds.every((c) => c.every((v) => v === 0))).toBe(true);
    });
  }

  it('obstacle starter brakes when something appears', () => {
    const s = STARTER_PROJECTS.find((p) => p.id === 'obstacle-detection')!;
    const r = runOnFakeRobot(generatePython(workspaceFrom(s.workspace)), { distance_cm: [[0, 100], [2, 10]], max_seconds: 4 });
    // While driving, 40% speed with an 80% cap.
    expect(r.max_motor_duty).toBe(Math.floor((40 * 80 * 65535) / 10000));
  });
});

describe('MicroPython compiler', () => {
  it(mpyCross ? 'is available for these tests' : 'is MISSING: run `npm run setup:python` (compile checks were skipped)', () => {
    if (!mpyCross) console.warn('mpy-cross not found; MicroPython compile checks skipped. Run: npm run setup:python');
    expect(true).toBe(true);
  });
});
