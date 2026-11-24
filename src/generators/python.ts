import * as Blockly from 'blockly/core';
import { pythonGenerator, Order } from 'blockly/python';
import type { PythonGenerator } from 'blockly/python';

type Gen = PythonGenerator;
type B = Blockly.Block;

const v = (b: B, g: Gen, name: string, fallback: string, order = Order.NONE) =>
  g.valueToCode(b, name, order) || fallback;
/** Blockly marks definitions_ protected, but custom generators are meant to use it. */
const defs = (g: Gen) => (g as unknown as { definitions_: Record<string, string> }).definitions_;
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const DIR_FN: Record<string, string> = {
  forward: 'robot.forward',
  backward: 'robot.backward',
  left: 'robot.turn_left',
  right: 'robot.turn_right',
};

let installed = false;

/** Attach the Eaglets block generators to Blockly's Python generator. */
export function installPythonGenerators() {
  if (installed) return;
  installed = true;
  const f = pythonGenerator.forBlock;
  pythonGenerator.INDENT = '    ';
  pythonGenerator.addReservedWords('robot,eaglets,time,math,random');

  f['eaglets_when_start'] = () => '';
  f['eaglets_wait'] = (b, g) => `robot.wait(${v(b, g as Gen, 'SECONDS', '1')})\n`;
  f['eaglets_forever'] = (b, g) => {
    const body = g.statementToCode(b, 'DO') || g.INDENT + 'pass\n';
    return `while True:\n${body}`;
  };

  f['eaglets_move'] = (b) => `${DIR_FN[b.getFieldValue('DIR')]}()\n`;
  f['eaglets_move_speed'] = (b, g) => `${DIR_FN[b.getFieldValue('DIR')]}(${v(b, g as Gen, 'SPEED', '50')})\n`;
  f['eaglets_move_for'] = (b, g) => `${DIR_FN[b.getFieldValue('DIR')]}(seconds=${v(b, g as Gen, 'SECONDS', '1')})\n`;
  f['eaglets_turn'] = (b) => `${DIR_FN[b.getFieldValue('DIR')]}()\n`;
  f['eaglets_turn_for'] = (b, g) => `${DIR_FN[b.getFieldValue('DIR')]}(seconds=${v(b, g as Gen, 'SECONDS', '1')})\n`;
  f['eaglets_turn_degrees'] = (b, g) => `robot.turn_degrees(${q(b.getFieldValue('DIR'))}, ${v(b, g as Gen, 'DEGREES', '90')})\n`;
  f['eaglets_stop'] = () => 'robot.stop()\n';
  f['eaglets_set_speed'] = (b, g) => `robot.set_speed(${v(b, g as Gen, 'SPEED', '50')})\n`;
  f['eaglets_speed_from_dial'] = () => 'robot.set_speed(robot.dial())\n';
  f['eaglets_set_motors'] = (b, g) =>
    `robot.set_motors(${v(b, g as Gen, 'LEFT', '0')}, ${v(b, g as Gen, 'RIGHT', '0')})\n`;

  f['eaglets_color'] = (b) => [q(b.getFieldValue('COLOR')), Order.ATOMIC];
  f['eaglets_rgb'] = (b, g) => [
    `robot.rgb(${v(b, g as Gen, 'R', '0')}, ${v(b, g as Gen, 'G', '0')}, ${v(b, g as Gen, 'B', '0')})`,
    Order.FUNCTION_CALL,
  ];
  f['eaglets_random_color'] = () => ['robot.random_color()', Order.FUNCTION_CALL];
  f['eaglets_leds_all'] = (b, g) => `robot.set_leds(${v(b, g as Gen, 'COLOR', "'#ff0000'")})\n`;
  f['eaglets_led_one'] = (b, g) =>
    `robot.set_led(${v(b, g as Gen, 'NUMBER', '1')}, ${v(b, g as Gen, 'COLOR', "'#ff0000'")})\n`;
  f['eaglets_leds_off'] = () => 'robot.leds_off()\n';
  f['eaglets_brightness'] = (b, g) => `robot.set_brightness(${v(b, g as Gen, 'PERCENT', '50')})\n`;
  f['eaglets_brightness_dial'] = () => 'robot.set_brightness(robot.dial())\n';
  f['eaglets_flash'] = (b, g) =>
    `robot.flash_leds(${v(b, g as Gen, 'COLOR', "'#ff0000'")}, ${v(b, g as Gen, 'TIMES', '3')})\n`;
  f['eaglets_rainbow'] = (b, g) => `robot.rainbow(${v(b, g as Gen, 'SECONDS', '2')})\n`;

  f['eaglets_dial'] = () => ['robot.dial()', Order.FUNCTION_CALL];
  f['eaglets_distance'] = () => ['robot.distance()', Order.FUNCTION_CALL];
  f['eaglets_distance_lt'] = (b, g) => [
    `robot.distance() < ${v(b, g as Gen, 'CM', '15', Order.RELATIONAL)}`,
    Order.RELATIONAL,
  ];
  f['eaglets_wait_object'] = (b, g) => `robot.wait_for_object(${v(b, g as Gen, 'CM', '20')})\n`;
  f['eaglets_tilted'] = () => ['robot.is_tilted()', Order.FUNCTION_CALL];
  f['eaglets_tilted_dir'] = (b) => [`robot.is_tilted(${q(b.getFieldValue('DIR'))})`, Order.FUNCTION_CALL];
  f['eaglets_shaken'] = () => ['robot.is_shaken()', Order.FUNCTION_CALL];
  f['eaglets_moving'] = () => ['robot.is_moving()', Order.FUNCTION_CALL];
  f['eaglets_tilt_angle'] = (b) => [`robot.tilt_angle(${q(b.getFieldValue('AXIS'))})`, Order.FUNCTION_CALL];
  f['eaglets_accel'] = (b) => [`robot.acceleration(${q(b.getFieldValue('AXIS'))})`, Order.FUNCTION_CALL];
  f['eaglets_rotation'] = (b) => [`robot.rotation(${q(b.getFieldValue('AXIS'))})`, Order.FUNCTION_CALL];
  f['eaglets_swiped'] = (b) => [`robot.swiped(${q(b.getFieldValue('DIR'))})`, Order.FUNCTION_CALL];
  f['eaglets_color_is'] = (b) => [`robot.sees_color(${q(b.getFieldValue('COLOR'))})`, Order.FUNCTION_CALL];
  f['eaglets_color_name'] = () => ['robot.color()', Order.FUNCTION_CALL];
  f['eaglets_object_near'] = () => ['robot.object_near()', Order.FUNCTION_CALL];
  f['eaglets_light'] = () => ['robot.light_level()', Order.FUNCTION_CALL];
  f['eaglets_line'] = (b) => [`robot.line_dark(${q(b.getFieldValue('SIDE'))})`, Order.FUNCTION_CALL];
  f['eaglets_heard'] = () => ['robot.heard_sound()', Order.FUNCTION_CALL];

  f['eaglets_tone'] = (b, g) => `robot.play_tone(${v(b, g as Gen, 'FREQ', '440')}, ${v(b, g as Gen, 'SECONDS', '0.5')})\n`;
  f['eaglets_note'] = (b, g) => `robot.play_note(${q(b.getFieldValue('NOTE'))}, ${v(b, g as Gen, 'SECONDS', '0.5')})\n`;
  f['eaglets_beep'] = () => 'robot.beep()\n';
  f['eaglets_alarm'] = (b, g) => `robot.alarm(${v(b, g as Gen, 'SECONDS', '2')})\n`;
  f['eaglets_sound_off'] = () => 'robot.sound_off()\n';

  f['eaglets_print'] = (b, g) => `print(${v(b, g as Gen, 'VALUE', "''")})\n`;

  // Blockly's version imports `numbers`, which MicroPython doesn't have.
  f['math_change'] = (b, g) => {
    const name = (g as Gen).getVariableName(b.getFieldValue('VAR'));
    const delta = v(b, g as Gen, 'DELTA', '1', Order.ADDITIVE);
    return `${name} = (${name} or 0) + ${delta}\n`;
  };
  // Plain abs() reads better than math.fabs() for students.
  const mathSingle = f['math_single'];
  f['math_single'] = function (b, g) {
    if (b.getFieldValue('OP') === 'ABS') return [`abs(${v(b, g as Gen, 'NUM', '0')})`, Order.FUNCTION_CALL];
    return mathSingle.call(this, b, g);
  };
  // Simpler, MicroPython-safe versions of a few maths blocks.
  f['math_random_int'] = (b, g) => {
    defs(g as Gen)['import_random'] = 'import random';
    return [`random.randint(${v(b, g as Gen, 'FROM', '0')}, ${v(b, g as Gen, 'TO', '0')})`, Order.FUNCTION_CALL];
  };
}

export interface GeneratedProgram {
  code: string;
}

/**
 * Turn the workspace into a complete MicroPython program.
 * Only blocks under the first enabled "when program starts" block run;
 * functions are included wherever they sit.
 */
export function generatePython(workspace: Blockly.Workspace, projectName = 'My robot program'): string {
  installPythonGenerators();
  const g = pythonGenerator;
  g.init(workspace);
  defs(g)['import_robot'] = 'import eaglets as robot';
  const tops = workspace.getTopBlocks(true).filter((b) => b.isEnabled());
  for (const b of tops) {
    if (b.type.startsWith('procedures_def')) g.blockToCode(b);
  }
  const hat = tops.find((b) => b.type === 'eaglets_when_start');
  let body = '';
  if (hat) {
    const next = hat.getNextBlock();
    if (next) body = (g.blockToCode(next) as string) || '';
  }
  if (!body.trim()) body = 'pass\n';
  const main =
    'robot.start()\n' + 'try:\n' + g.prefixLines(body, g.INDENT) + 'finally:\n' + g.INDENT + 'robot.shutdown()\n';
  const program = g.finish(main);
  const safeName = projectName.replace(/[\r\n]/g, ' ').slice(0, 80);
  return `# ${safeName}\n# Made with Eaglets Code. Needs eaglets.py on the robot.\n${program.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
