// JavaScript for the on-screen simulator. Mirrors the Python generator, but
// every robot action is `await`ed so the simulator can animate and stop it.
import * as Blockly from 'blockly/core';
import { javascriptGenerator, Order } from 'blockly/javascript';
import type { JavascriptGenerator } from 'blockly/javascript';

type Gen = JavascriptGenerator;
type B = Blockly.Block;
const v = (b: B, g: Gen, name: string, fallback: string, order = Order.NONE) => g.valueToCode(b, name, order) || fallback;
const q = (s: string) => JSON.stringify(s);
const DIR_FN: Record<string, string> = { forward: 'forward', backward: 'backward', left: 'turn_left', right: 'turn_right' };

let installed = false;

export function installJsGenerators() {
  if (installed) return;
  installed = true;
  const f = javascriptGenerator.forBlock;
  javascriptGenerator.addReservedWords('robot');
  const call = (fn: string, ...args: string[]) => `await robot.${fn}(${args.join(', ')});\n`;
  const rep = (expr: string): [string, Order] => [expr, Order.FUNCTION_CALL];

  f['eaglets_when_start'] = () => '';
  f['eaglets_wait'] = (b, g) => call('wait', v(b, g as Gen, 'SECONDS', '1'));
  f['eaglets_forever'] = (b, g) => {
    const body = (g as Gen).addLoopTrap(g.statementToCode(b, 'DO'), b);
    return `while (true) {\n${body}}\n`;
  };
  f['eaglets_move'] = (b) => call(DIR_FN[b.getFieldValue('DIR')]);
  f['eaglets_move_speed'] = (b, g) => call(DIR_FN[b.getFieldValue('DIR')], v(b, g as Gen, 'SPEED', '50'));
  f['eaglets_move_for'] = (b, g) => call(DIR_FN[b.getFieldValue('DIR')], 'null', v(b, g as Gen, 'SECONDS', '1'));
  f['eaglets_turn'] = (b) => call(DIR_FN[b.getFieldValue('DIR')]);
  f['eaglets_turn_for'] = (b, g) => call(DIR_FN[b.getFieldValue('DIR')], 'null', v(b, g as Gen, 'SECONDS', '1'));
  f['eaglets_turn_degrees'] = (b, g) => call('turn_degrees', q(b.getFieldValue('DIR')), v(b, g as Gen, 'DEGREES', '90'));
  f['eaglets_stop'] = () => call('stop');
  f['eaglets_set_speed'] = (b, g) => call('set_speed', v(b, g as Gen, 'SPEED', '50'));
  f['eaglets_speed_from_dial'] = () => call('set_speed', 'robot.dial()');
  f['eaglets_set_motors'] = (b, g) => call('set_motors', v(b, g as Gen, 'LEFT', '0'), v(b, g as Gen, 'RIGHT', '0'));

  f['eaglets_color'] = (b) => [q(b.getFieldValue('COLOR')), Order.ATOMIC];
  f['eaglets_rgb'] = (b, g) => rep(`robot.rgb(${v(b, g as Gen, 'R', '0')}, ${v(b, g as Gen, 'G', '0')}, ${v(b, g as Gen, 'B', '0')})`);
  f['eaglets_random_color'] = () => rep('robot.random_color()');
  f['eaglets_leds_all'] = (b, g) => call('set_leds', v(b, g as Gen, 'COLOR', '"#ff0000"'));
  f['eaglets_led_one'] = (b, g) => call('set_led', v(b, g as Gen, 'NUMBER', '1'), v(b, g as Gen, 'COLOR', '"#ff0000"'));
  f['eaglets_leds_off'] = () => call('leds_off');
  f['eaglets_brightness'] = (b, g) => call('set_brightness', v(b, g as Gen, 'PERCENT', '50'));
  f['eaglets_brightness_dial'] = () => call('set_brightness', 'robot.dial()');
  f['eaglets_flash'] = (b, g) => call('flash_leds', v(b, g as Gen, 'COLOR', '"#ff0000"'), v(b, g as Gen, 'TIMES', '3'));
  f['eaglets_rainbow'] = (b, g) => call('rainbow', v(b, g as Gen, 'SECONDS', '2'));

  f['eaglets_dial'] = () => rep('robot.dial()');
  f['eaglets_distance'] = () => rep('robot.distance()');
  f['eaglets_distance_lt'] = (b, g) => [`robot.distance() < ${v(b, g as Gen, 'CM', '15', Order.RELATIONAL)}`, Order.RELATIONAL];
  f['eaglets_wait_object'] = (b, g) => call('wait_for_object', v(b, g as Gen, 'CM', '20'));
  f['eaglets_tilted'] = () => rep('robot.is_tilted()');
  f['eaglets_tilted_dir'] = (b) => rep(`robot.is_tilted(${q(b.getFieldValue('DIR'))})`);
  f['eaglets_shaken'] = () => rep('robot.is_shaken()');
  f['eaglets_moving'] = () => rep('robot.is_moving()');
  f['eaglets_tilt_angle'] = (b) => rep(`robot.tilt_angle(${q(b.getFieldValue('AXIS'))})`);
  f['eaglets_accel'] = (b) => rep(`robot.acceleration(${q(b.getFieldValue('AXIS'))})`);
  f['eaglets_rotation'] = (b) => rep(`robot.rotation(${q(b.getFieldValue('AXIS'))})`);
  f['eaglets_swiped'] = (b) => rep(`robot.swiped(${q(b.getFieldValue('DIR'))})`);
  f['eaglets_color_is'] = (b) => rep(`robot.sees_color(${q(b.getFieldValue('COLOR'))})`);
  f['eaglets_color_name'] = () => rep('robot.color()');
  f['eaglets_object_near'] = () => rep('robot.object_near()');
  f['eaglets_light'] = () => rep('robot.light_level()');
  f['eaglets_line'] = (b) => rep(`robot.line_dark(${q(b.getFieldValue('SIDE'))})`);
  f['eaglets_heard'] = () => rep('robot.heard_sound()');

  f['eaglets_tone'] = (b, g) => call('play_tone', v(b, g as Gen, 'FREQ', '440'), v(b, g as Gen, 'SECONDS', '0.5'));
  f['eaglets_note'] = (b, g) => call('play_note', q(b.getFieldValue('NOTE')), v(b, g as Gen, 'SECONDS', '0.5'));
  f['eaglets_beep'] = () => call('beep');
  f['eaglets_alarm'] = (b, g) => call('alarm', v(b, g as Gen, 'SECONDS', '2'));
  f['eaglets_sound_off'] = () => call('sound_off');
  f['eaglets_print'] = (b, g) => call('print', v(b, g as Gen, 'VALUE', '""'));

  // Functions must be async so the robot can wait inside them.
  type GenFn = (block: B, generator: Gen) => string | [string, number] | null;
  const makeAsyncDef = (orig: GenFn): GenFn =>
    function (this: unknown, b: B, g: Gen) {
      const r = orig.call(this, b, g);
      const defs = (g as unknown as { definitions_: Record<string, string> }).definitions_;
      const key = '%' + g.getProcedureName(b.getFieldValue('NAME'));
      if (defs[key]) defs[key] = defs[key].replace(/(^|\n)function /, '$1async function ');
      return r;
    };
  f['procedures_defreturn'] = makeAsyncDef(f['procedures_defreturn']);
  f['procedures_defnoreturn'] = makeAsyncDef(f['procedures_defnoreturn']);
  const callReturn = f['procedures_callreturn'];
  f['procedures_callreturn'] = function (b, g) {
    const [code] = callReturn.call(this, b, g) as [string, Order];
    return [`(await ${code})`, Order.ATOMIC];
  };
}

/** Async JS body for the simulator. Calls `robot.highlight(id)` before each block. */
export function generateSimulatorJs(workspace: Blockly.Workspace): string {
  installJsGenerators();
  const g = javascriptGenerator;
  const savedPrefix = g.STATEMENT_PREFIX;
  const savedTrap = g.INFINITE_LOOP_TRAP;
  g.STATEMENT_PREFIX = 'await robot.highlight(%1);\n';
  g.INFINITE_LOOP_TRAP = 'await robot.tick();\n';
  try {
    g.init(workspace);
    const tops = workspace.getTopBlocks(true).filter((b) => b.isEnabled());
    for (const b of tops) if (b.type.startsWith('procedures_def')) g.blockToCode(b);
    const hat = tops.find((b) => b.type === 'eaglets_when_start');
    const next = hat?.getNextBlock();
    const body = next ? ((g.blockToCode(next) as string) ?? '') : '';
    const main = `await robot.start();\ntry {\n${g.prefixLines(body, g.INDENT)}} finally {\n  await robot.shutdown();\n}\n`;
    return g.finish(main);
  } finally {
    g.STATEMENT_PREFIX = savedPrefix;
    g.INFINITE_LOOP_TRAP = savedTrap;
  }
}
