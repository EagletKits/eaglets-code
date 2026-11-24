import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Blockly from 'blockly/core';
import { generatePython } from '../src/generators/python';
import { STARTER_PROJECTS } from '../src/projects/starters';
import { loadIntoWorkspace, parseProject, ProjectError, serializeProject, safeFileName } from '../src/projects/projectFile';
import { checkProgram } from '../src/blocks/validate';
import { buildToolbox } from '../src/blocks/toolbox';
import { DEFAULT_CONFIG, normalizeConfig, renderConfigPy } from '../src/hardware/config';
import { ROOT, findMpyCross, mpyCompile, setupBlockly, workspaceFrom } from './helpers';

beforeAll(() => setupBlockly());

describe('save and load', () => {
  for (const s of STARTER_PROJECTS) {
    it(`round-trips "${s.title}" without changing the program`, () => {
      const ws = workspaceFrom(s.workspace);
      const before = generatePython(ws, s.title);
      const text = JSON.stringify(serializeProject(ws, s.title));
      const parsed = parseProject(text);
      expect(parsed.name).toBe(s.title);
      const ws2 = new Blockly.Workspace();
      loadIntoWorkspace(ws2, parsed.workspace);
      expect(generatePython(ws2, parsed.name)).toBe(before);
      expect(ws2.getAllBlocks(false).length).toBe(ws.getAllBlocks(false).length);
      expect(ws2.getVariableMap().getAllVariables().map((v) => v.getName())).toEqual(ws.getVariableMap().getAllVariables().map((v) => v.getName()));
    });
  }

  it('rejects files that are not projects', () => {
    expect(() => parseProject('not json')).toThrow(ProjectError);
    expect(() => parseProject('{"hello":1}')).toThrow(/isn't an Eaglets Code project/);
  });

  it('rejects projects from a newer version', () => {
    expect(() => parseProject(JSON.stringify({ format: 'eaglets-code-project', version: 99, workspace: {} }))).toThrow(/newer version/);
  });

  it('rejects projects with unknown blocks and keeps the old workspace', () => {
    const bad = { format: 'eaglets-code-project', version: 1, name: 'x', workspace: { blocks: { languageVersion: 0, blocks: [{ type: 'alien_block' }] } } };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/doesn't have \(alien_block\)/);
  });

  it('restores the previous blocks if loading fails part-way', () => {
    const ws = workspaceFrom(STARTER_PROJECTS[0].workspace);
    const count = ws.getAllBlocks(false).length;
    expect(() => loadIntoWorkspace(ws, { blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_leds_all', inputs: { NOPE: {} } }] } })).toThrow(ProjectError);
    expect(ws.getAllBlocks(false).length).toBe(count);
  });

  it('makes safe file names', () => {
    expect(safeFileName('My Cool Robot!!', 'eaglets')).toBe('my-cool-robot.eaglets');
    expect(safeFileName('   ', 'py')).toBe('my-robot-program.py');
  });
});

describe('program checks', () => {
  const opts = { buzzerEnabled: false };

  it('requires a start block', () => {
    const ws = workspaceFrom({ blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_stop' }] } });
    expect(checkProgram(ws, opts)[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/when program starts/) });
  });

  it('allows only one start block', () => {
    const ws = workspaceFrom({
      blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_when_start', next: { block: { type: 'eaglets_stop' } } }, { type: 'eaglets_when_start', x: 300 }] },
    });
    expect(checkProgram(ws, opts).some((p) => /more than one/.test(p.message))).toBe(true);
  });

  it('flags a block with an empty value slot', () => {
    const ws = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'eaglets_when_start', next: { block: { type: 'controls_if', inputs: { DO0: { block: { type: 'eaglets_stop' } } } } } }],
      },
    });
    const p = checkProgram(ws, opts);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ severity: 'error', message: 'This block needs a value. Drag one into the empty slot.' });
    expect(ws.getBlockById(p[0].blockId!)!.type).toBe('controls_if');
  });

  it('flags comparisons with a missing side', () => {
    const ws = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'eaglets_when_start',
            next: { block: { type: 'controls_if', inputs: { IF0: { block: { type: 'logic_compare', inputs: { A: { block: { type: 'eaglets_dial' } } } } } } } },
          },
        ],
      },
    });
    expect(checkProgram(ws, opts).some((p) => p.message.startsWith('This block needs a value'))).toBe(true);
  });

  it('blocks sound when no buzzer is configured', () => {
    const ws = workspaceFrom({ blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_when_start', next: { block: { type: 'eaglets_beep' } } }] } });
    expect(checkProgram(ws, { buzzerEnabled: false })[0].message).toMatch(/no buzzer/);
    expect(checkProgram(ws, { buzzerEnabled: true })).toHaveLength(0);
  });

  it('warns (but allows running) when blocks are not connected', () => {
    const ws = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'eaglets_when_start', next: { block: { type: 'eaglets_forever' } } },
          { type: 'eaglets_leds_off', x: 400, y: 0 },
        ],
      },
    });
    const p = checkProgram(ws, opts);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ severity: 'warning', message: expect.stringMatching(/won't run/) });
  });

  it('accepts every starter project', () => {
    for (const s of STARTER_PROJECTS) {
      const errors = checkProgram(workspaceFrom(s.workspace), opts).filter((p) => p.severity === 'error');
      expect(errors, s.title).toEqual([]);
    }
  });
});

describe('toolbox', () => {
  const types = (t: ReturnType<typeof buildToolbox>) => JSON.stringify(t);
  it('hides sound blocks until a buzzer is configured', () => {
    expect(types(buildToolbox({ beginner: false, buzzerEnabled: false }))).not.toContain('eaglets_beep');
    expect(types(buildToolbox({ beginner: false, buzzerEnabled: true }))).toContain('eaglets_beep');
  });
  it('beginner mode hides technical blocks', () => {
    const beginner = types(buildToolbox({ beginner: true, buzzerEnabled: false }));
    expect(beginner).not.toContain('eaglets_accel');
    expect(beginner).not.toContain('eaglets_set_motors');
    expect(beginner).toContain('eaglets_move_for');
    expect(types(buildToolbox({ beginner: false, buzzerEnabled: false }))).toContain('eaglets_accel');
  });
});

describe('hardware config', () => {
  it('renders exactly the checked-in firmware/eaglets_config.py', () => {
    expect(renderConfigPy(DEFAULT_CONFIG)).toBe(readFileSync(join(ROOT, 'firmware', 'eaglets_config.py'), 'utf8'));
  });

  it('keeps pins fixed to the V6.2 board', () => {
    const py = renderConfigPy({ ...DEFAULT_CONFIG, maxMotorPower: 60 });
    expect(py).toContain('LEFT_MOTOR_PINS = (3, 4)');
    expect(py).toContain('NEOPIXEL_PIN = 5');
    expect(py).toContain('MAX_MOTOR_POWER = 60');
  });

  it('clamps unsafe or bogus saved settings', () => {
    const c = normalizeConfig({ maxMotorPower: 500, buzzerPin: 18, maxLedBrightness: -3, imuUpAxis: 'q' as never });
    expect(c.maxMotorPower).toBe(100);
    expect(c.buzzerPin).toBeNull(); // GP18 shares a PWM slice with the left motor
    expect(c.maxLedBrightness).toBe(1);
    expect(c.imuUpAxis).toBe('+z');
  });

  it('every config variant compiles as MicroPython', () => {
    const mpy = findMpyCross();
    if (!mpy) return;
    expect(mpyCompile(mpy, renderConfigPy({ ...DEFAULT_CONFIG, buzzerPin: 27, colorGains: [1.2, 0.9, 1.5], leftMotorReversed: true }))).toBeNull();
  });

  it('the compile check really rejects bad code (sanity check of the test tool)', () => {
    const mpy = findMpyCross();
    if (!mpy) return;
    expect(mpyCompile(mpy, 'def broken(:\n')).not.toBeNull();
  });
});
