import { beforeAll, describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import { buildToolbox } from '../src/blocks/toolbox';
import { generateSimulatorJs } from '../src/generators/javascript';
import { STARTER_PROJECTS } from '../src/projects/starters';
import { SimRobot, runOnSimulator } from '../src/sim/simRobot';
import { DEFAULT_CONFIG } from '../src/hardware/config';
import { setupBlockly, workspaceFrom } from './helpers';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
beforeAll(() => setupBlockly());

describe('simulator code generation', () => {
  it('every toolbox block produces valid async JavaScript', () => {
    const items: Array<Record<string, unknown>> = [];
    const walk = (xs: unknown[]) => {
      for (const x of xs as Array<Record<string, unknown>>) {
        if (x.kind === 'block') items.push(x);
        if (Array.isArray(x.contents)) walk(x.contents);
      }
    };
    walk(buildToolbox({ beginner: false, buzzerEnabled: true }).contents as unknown[]);
    for (const item of items) {
      const { kind: _k, ...json } = item;
      const ws = new Blockly.Workspace();
      const block = Blockly.serialization.blocks.append(json as Blockly.serialization.blocks.State, ws);
      if (!block.previousConnection && !block.outputConnection) continue;
      const wrapped = block.outputConnection ? { type: 'eaglets_print', inputs: { VALUE: { block: json } } } : json;
      const js = generateSimulatorJs(workspaceFrom({ blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_when_start', next: { block: wrapped } }] } }));
      expect(() => new AsyncFunction('robot', js), `${item.type}\n${js}`).not.toThrow();
    }
  });

  it('every starter compiles to valid async JavaScript', () => {
    for (const s of STARTER_PROJECTS) {
      const js = generateSimulatorJs(workspaceFrom(s.workspace));
      expect(() => new AsyncFunction('robot', js), s.title).not.toThrow();
      expect(js).toContain('await robot.shutdown()');
    }
  });
});

describe('simulated robot', () => {
  it('drives forward for a set time, then stops and turns LEDs off', async () => {
    const robot = new SimRobot(DEFAULT_CONFIG);
    const ws = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'eaglets_when_start',
            next: {
              block: {
                type: 'eaglets_leds_all',
                inputs: { COLOR: { shadow: { type: 'eaglets_color', fields: { COLOR: '#00ff00' } } } },
                next: { block: { type: 'eaglets_move_for', fields: { DIR: 'forward' }, inputs: { SECONDS: { shadow: { type: 'math_number', fields: { NUM: 0.4 } } } } } },
              },
            },
          },
        ],
      },
    });
    const y0 = robot.y;
    const result = await runOnSimulator(generateSimulatorJs(ws), robot);
    expect(result.status).toBe('finished');
    expect(robot.y).toBeLessThan(y0 - 3); // moved up the arena
    expect(robot.left).toBe(0);
    expect(robot.leds.every((c) => c.every((v) => v === 0))).toBe(true);
  });

  it('Stop ends a forever loop', async () => {
    const robot = new SimRobot(DEFAULT_CONFIG);
    const s = STARTER_PROJECTS.find((p) => p.id === 'traffic-light')!;
    const run = runOnSimulator(generateSimulatorJs(workspaceFrom(s.workspace)), robot);
    await new Promise((r) => setTimeout(r, 200));
    robot.requestStop();
    expect((await run).status).toBe('stopped');
  });

  it('sound without a buzzer gives the friendly error', async () => {
    const robot = new SimRobot(DEFAULT_CONFIG);
    const ws = workspaceFrom({ blocks: { languageVersion: 0, blocks: [{ type: 'eaglets_when_start', next: { block: { type: 'eaglets_beep' } } }] } });
    const r = await runOnSimulator(generateSimulatorJs(ws), robot);
    expect(r).toEqual({ status: 'error', message: expect.stringMatching(/no buzzer/) });
  });
});
