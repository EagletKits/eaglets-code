import type * as Blockly from 'blockly/core';
import { COLORS } from './definitions';

export interface ToolboxOptions {
  beginner: boolean;
  buzzerEnabled: boolean;
}

type Item = Record<string, unknown>;

const n = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
const color = (hex: string) => ({ shadow: { type: 'eaglets_color', fields: { COLOR: hex } } });
const block = (type: string, inputs?: Record<string, unknown>, extra?: Item): Item => ({
  kind: 'block',
  type,
  ...(inputs ? { inputs } : {}),
  ...(extra ?? {}),
});
const label = (text: string): Item => ({ kind: 'label', text });

/** Build the toolbox. Beginner mode hides the more technical blocks. */
export function buildToolbox({ beginner, buzzerEnabled }: ToolboxOptions): Blockly.utils.toolbox.ToolboxInfo {
  const adv = (item: Item) => (beginner ? [] : [item]);

  const categories: Item[] = [
    {
      kind: 'category',
      name: 'Start',
      colour: COLORS.start,
      contents: [block('eaglets_when_start'), block('eaglets_wait', { SECONDS: n(1) })],
    },
    {
      kind: 'category',
      name: 'Movement',
      colour: COLORS.movement,
      contents: [
        block('eaglets_move_for', { SECONDS: n(2) }),
        block('eaglets_turn_for', { SECONDS: n(0.5) }),
        block('eaglets_stop'),
        label('Keep going until stopped'),
        block('eaglets_move'),
        block('eaglets_move_speed', { SPEED: n(50) }),
        block('eaglets_turn'),
        label('Speed'),
        block('eaglets_set_speed', { SPEED: n(50) }),
        block('eaglets_speed_from_dial'),
        label('Turn by an angle (uses the motion sensor)'),
        block('eaglets_turn_degrees', { DEGREES: n(90) }),
        ...adv(block('eaglets_set_motors', { LEFT: n(50), RIGHT: n(50) })),
      ],
    },
    {
      kind: 'category',
      name: 'Lights',
      colour: COLORS.lights,
      contents: [
        block('eaglets_leds_all', { COLOR: color('#ff0000') }),
        block('eaglets_led_one', { NUMBER: n(1), COLOR: color('#00ff00') }),
        block('eaglets_leds_off'),
        block('eaglets_flash', { COLOR: color('#ffff00'), TIMES: n(3) }),
        block('eaglets_rainbow', { SECONDS: n(2) }),
        label('Brightness'),
        block('eaglets_brightness', { PERCENT: n(50) }),
        block('eaglets_brightness_dial'),
        label('Colors'),
        block('eaglets_color'),
        block('eaglets_rgb', { R: n(100), G: n(50), B: n(0) }),
        block('eaglets_random_color'),
      ],
    },
    {
      kind: 'category',
      name: 'Sensors',
      colour: COLORS.sensors,
      contents: [
        label('🎛 Dial'),
        block('eaglets_dial'),
        label('📏 Distance sensor'),
        block('eaglets_distance_lt', { CM: n(15) }),
        block('eaglets_distance'),
        block('eaglets_wait_object', { CM: n(20) }),
        label('🫨 Motion sensor (IMU)'),
        block('eaglets_shaken'),
        block('eaglets_tilted'),
        block('eaglets_tilted_dir'),
        block('eaglets_moving'),
        block('eaglets_tilt_angle'),
        ...adv(block('eaglets_rotation')),
        ...adv(block('eaglets_accel')),
        label('👋 Gesture & color sensor'),
        block('eaglets_swiped'),
        block('eaglets_object_near'),
        block('eaglets_color_is'),
        block('eaglets_light'),
        ...adv(block('eaglets_color_name')),
        ...(beginner ? [] : [label('More sensors'), block('eaglets_line'), block('eaglets_heard')]),
      ],
    },
    ...(buzzerEnabled
      ? [
          {
            kind: 'category',
            name: 'Sound',
            colour: COLORS.sound,
            contents: [
              block('eaglets_beep'),
              block('eaglets_note', { SECONDS: n(0.5) }),
              block('eaglets_tone', { FREQ: n(440), SECONDS: n(0.5) }),
              block('eaglets_alarm', { SECONDS: n(2) }),
              block('eaglets_sound_off'),
            ],
          },
        ]
      : []),
    { kind: 'sep' },
    {
      kind: 'category',
      name: 'Logic',
      colour: COLORS.logic,
      contents: [
        block('controls_if'),
        block('controls_if', undefined, { extraState: { hasElse: true } }),
        block('controls_if', undefined, { extraState: { elseIfCount: 1, hasElse: true } }),
        block('logic_compare', { A: n(0), B: n(0) }, { fields: { OP: 'LT' } }),
        block('logic_compare', { A: n(0), B: n(0) }, { fields: { OP: 'GT' } }),
        block('logic_compare', { A: n(0), B: n(0) }, { fields: { OP: 'EQ' } }),
        block('logic_operation'),
        block('logic_negate'),
        block('logic_boolean'),
      ],
    },
    {
      kind: 'category',
      name: 'Loops',
      colour: COLORS.loops,
      contents: [
        block('eaglets_forever'),
        block('controls_repeat_ext', { TIMES: n(4) }),
        block('controls_whileUntil', undefined, { fields: { MODE: 'UNTIL' } }),
        block('eaglets_wait', { SECONDS: n(1) }),
        ...adv(block('controls_whileUntil', undefined, { fields: { MODE: 'WHILE' } })),
      ],
    },
    {
      kind: 'category',
      name: 'Math',
      colour: COLORS.math,
      contents: [
        block('math_number', undefined, { fields: { NUM: 10 } }),
        block('math_arithmetic', { A: n(1), B: n(1) }),
        block('math_random_int', { FROM: n(1), TO: n(10) }),
        block('eaglets_print', { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } }),
        ...adv(block('math_modulo', { DIVIDEND: n(10), DIVISOR: n(3) })),
        ...adv(block('math_single', { NUM: n(-5) }, { fields: { OP: 'ABS' } })),
        ...adv(block('math_round', { NUM: n(3.5) })),
        ...adv(block('math_constrain', { VALUE: n(50), LOW: n(0), HIGH: n(100) })),
        ...adv(block('text')),
      ],
    },
    { kind: 'category', name: 'Variables', colour: COLORS.variables, custom: 'VARIABLE' },
    { kind: 'category', name: 'Functions', colour: COLORS.functions, custom: 'PROCEDURE' },
  ];

  return { kind: 'categoryToolbox', contents: categories } as unknown as Blockly.utils.toolbox.ToolboxInfo;
}

/** Every block type that can appear in any toolbox (used by tests and import checks). */
export function allToolboxBlockTypes(): string[] {
  const types = new Set<string>();
  const walk = (items: unknown[]) => {
    for (const it of items as Item[]) {
      if (it.kind === 'block') types.add(it.type as string);
      if (Array.isArray(it.contents)) walk(it.contents);
    }
  };
  walk(buildToolbox({ beginner: false, buzzerEnabled: true }).contents as unknown[]);
  // Blocks from the dynamic Variables and Functions categories.
  for (const t of [
    'variables_get',
    'variables_set',
    'math_change',
    'procedures_defnoreturn',
    'procedures_defreturn',
    'procedures_callnoreturn',
    'procedures_callreturn',
    'procedures_ifreturn',
    'controls_ifelse',
  ]) {
    types.add(t);
  }
  return [...types];
}
