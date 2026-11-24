import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { registerFieldColour } from '@blockly/field-colour';

export const COLORS = {
  start: '#F2A900',
  movement: '#2F7BF5',
  lights: '#8B5CF6',
  sensors: '#0EA5A4',
  sound: '#E9478F',
  logic: '#22A55B',
  loops: '#FF8A00',
  math: '#5B67D8',
  variables: '#EF4444',
  functions: '#C026D3',
};

/** Colours offered in the LED colour picker. */
export const LED_PALETTE: Array<[string, string]> = [
  ['#ff0000', 'red'],
  ['#ff7f00', 'orange'],
  ['#ffff00', 'yellow'],
  ['#00ff00', 'green'],
  ['#00ffff', 'cyan'],
  ['#0000ff', 'blue'],
  ['#8000ff', 'purple'],
  ['#ff00ff', 'pink'],
  ['#ffffff', 'white'],
  ['#ff4040', 'coral'],
  ['#80ff00', 'lime'],
  ['#000000', 'off'],
];

const DIR_MOVE = [['forward ⬆', 'forward'], ['backward ⬇', 'backward']];
const DIR_TURN = [['left ↺', 'left'], ['right ↻', 'right']];

const percent = (name: string) => ({ type: 'input_value', name, check: 'Number' });
const num = (name: string) => ({ type: 'input_value', name, check: 'Number' });
const colorIn = (name: string) => ({ type: 'input_value', name, check: 'Colour' });

const stmt = (style: keyof typeof COLORS, tooltip: string) => ({
  previousStatement: null,
  nextStatement: null,
  colour: COLORS[style],
  tooltip,
});
const reporter = (style: keyof typeof COLORS, output: string, tooltip: string) => ({
  output,
  colour: COLORS[style],
  tooltip,
});

export const BLOCK_DEFINITIONS = [
  // ---------------------------------------------------------------- start
  {
    type: 'eaglets_when_start',
    message0: '🦅 when program starts',
    nextStatement: null,
    colour: COLORS.start,
    tooltip: 'Your program begins here. Snap blocks underneath.',
    hat: 'cap',
  },
  {
    type: 'eaglets_wait',
    message0: 'wait %1 seconds',
    args0: [num('SECONDS')],
    inputsInline: true,
    ...stmt('loops', 'Pause before doing the next block.'),
  },
  {
    type: 'eaglets_forever',
    message0: 'forever',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    colour: COLORS.loops,
    tooltip: 'Repeat the blocks inside again and again until you press Stop.',
  },

  // ---------------------------------------------------------------- movement
  {
    type: 'eaglets_move',
    message0: 'move %1',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_MOVE }],
    ...stmt('movement', 'Start driving and keep going. Uses the speed you set (50% to start).'),
  },
  {
    type: 'eaglets_move_speed',
    message0: 'move %1 at %2 % speed',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_MOVE }, percent('SPEED')],
    inputsInline: true,
    ...stmt('movement', 'Start driving at a speed from 0 to 100%.'),
  },
  {
    type: 'eaglets_move_for',
    message0: 'move %1 for %2 seconds',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_MOVE }, num('SECONDS')],
    inputsInline: true,
    ...stmt('movement', 'Drive, wait, then stop.'),
  },
  {
    type: 'eaglets_turn',
    message0: 'turn %1',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_TURN }],
    ...stmt('movement', 'Spin on the spot and keep spinning.'),
  },
  {
    type: 'eaglets_turn_for',
    message0: 'turn %1 for %2 seconds',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_TURN }, num('SECONDS')],
    inputsInline: true,
    ...stmt('movement', 'Spin for a while, then stop.'),
  },
  {
    type: 'eaglets_turn_degrees',
    message0: 'turn %1 %2 degrees',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: DIR_TURN }, num('DEGREES')],
    inputsInline: true,
    ...stmt('movement', 'Spin by an angle, measured with the motion sensor (IMU). 90 is a quarter turn.'),
  },
  {
    type: 'eaglets_stop',
    message0: '🛑 stop motors',
    ...stmt('movement', 'Stop both wheels.'),
  },
  {
    type: 'eaglets_set_speed',
    message0: 'set speed to %1 %',
    args0: [percent('SPEED')],
    inputsInline: true,
    ...stmt('movement', 'Choose how fast the move and turn blocks go, 0 to 100%.'),
  },
  {
    type: 'eaglets_speed_from_dial',
    message0: 'set speed from dial 🎛',
    ...stmt('movement', 'Use the dial to choose the speed.'),
  },
  {
    type: 'eaglets_set_motors',
    message0: 'set wheels left %1 % right %2 %',
    args0: [num('LEFT'), num('RIGHT')],
    inputsInline: true,
    ...stmt('movement', 'Control each wheel: -100 is full backward, 100 is full forward.'),
  },

  // ---------------------------------------------------------------- lights
  {
    type: 'eaglets_color',
    message0: '%1',
    args0: [
      {
        type: 'field_colour',
        name: 'COLOR',
        colour: '#ff0000',
        colourOptions: LED_PALETTE.map((c) => c[0]),
        colourTitles: LED_PALETTE.map((c) => c[1]),
        columns: 4,
      },
    ],
    ...reporter('lights', 'Colour', 'Pick a colour.'),
  },
  {
    type: 'eaglets_rgb',
    message0: 'color red %1 green %2 blue %3',
    args0: [num('R'), num('G'), num('B')],
    inputsInline: true,
    ...reporter('lights', 'Colour', 'Mix a colour. Each amount goes from 0 to 100.'),
  },
  {
    type: 'eaglets_random_color',
    message0: 'random color 🎲',
    ...reporter('lights', 'Colour', 'A surprise colour.'),
  },
  {
    type: 'eaglets_leds_all',
    message0: 'set all LEDs to %1',
    args0: [colorIn('COLOR')],
    inputsInline: true,
    ...stmt('lights', 'Light up all 8 LEDs in one colour.'),
  },
  {
    type: 'eaglets_led_one',
    message0: 'set LED %1 to %2',
    args0: [num('NUMBER'), colorIn('COLOR')],
    inputsInline: true,
    ...stmt('lights', 'Light up one LED. They are numbered 1 to 8.'),
  },
  {
    type: 'eaglets_leds_off',
    message0: 'turn LEDs off',
    ...stmt('lights', 'Switch all the LEDs off.'),
  },
  {
    type: 'eaglets_brightness',
    message0: 'set brightness to %1 %',
    args0: [percent('PERCENT')],
    inputsInline: true,
    ...stmt('lights', 'How bright the LEDs are, 0 to 100%.'),
  },
  {
    type: 'eaglets_brightness_dial',
    message0: 'set brightness from dial 🎛',
    ...stmt('lights', 'Turn the dial to make the LEDs brighter or dimmer.'),
  },
  {
    type: 'eaglets_flash',
    message0: 'flash LEDs %1 %2 times',
    args0: [colorIn('COLOR'), num('TIMES')],
    inputsInline: true,
    ...stmt('lights', 'Blink all the LEDs on and off.'),
  },
  {
    type: 'eaglets_rainbow',
    message0: '🌈 rainbow for %1 seconds',
    args0: [num('SECONDS')],
    inputsInline: true,
    ...stmt('lights', 'Show a moving rainbow.'),
  },

  // ---------------------------------------------------------------- sensors
  {
    type: 'eaglets_dial',
    message0: 'dial value 🎛',
    ...reporter('sensors', 'Number', 'Where the dial is turned: 0 to 100.'),
  },
  {
    type: 'eaglets_distance',
    message0: 'distance (cm) 📏',
    ...reporter('sensors', 'Number', 'How far away the closest thing in front is, in centimeters. 400 means nothing is in range.'),
  },
  {
    type: 'eaglets_distance_lt',
    message0: 'distance less than %1 cm?',
    args0: [num('CM')],
    inputsInline: true,
    ...reporter('sensors', 'Boolean', 'True when something is closer than this.'),
  },
  {
    type: 'eaglets_wait_object',
    message0: 'wait until object closer than %1 cm',
    args0: [num('CM')],
    inputsInline: true,
    ...stmt('sensors', 'Wait here until something comes close to the distance sensor.'),
  },
  {
    type: 'eaglets_tilted',
    message0: 'robot is tilted?',
    ...reporter('sensors', 'Boolean', 'True when the robot is tipped in any direction.'),
  },
  {
    type: 'eaglets_tilted_dir',
    message0: 'robot tilted %1 ?',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIR',
        options: [['left', 'left'], ['right', 'right'], ['forward', 'forward'], ['backward', 'backward']],
      },
    ],
    ...reporter('sensors', 'Boolean', 'True when the robot is tipped this way.'),
  },
  {
    type: 'eaglets_shaken',
    message0: 'robot is shaken? 🫨',
    ...reporter('sensors', 'Boolean', 'True once each time you shake the robot.'),
  },
  {
    type: 'eaglets_moving',
    message0: 'robot is moving?',
    ...reporter('sensors', 'Boolean', 'True when the robot is being turned, bumped or carried.'),
  },
  {
    type: 'eaglets_tilt_angle',
    message0: 'tilt angle %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'AXIS',
        options: [['left ↔ right', 'left-right'], ['forward ↕ back', 'forward-back']],
      },
    ],
    ...reporter('sensors', 'Number', 'How far the robot is tipped, in degrees. Right side down or nose down is positive.'),
  },
  {
    type: 'eaglets_accel',
    message0: 'acceleration %1 (g)',
    args0: [{ type: 'field_dropdown', name: 'AXIS', options: [['X (forward)', 'x'], ['Y (left)', 'y'], ['Z (up)', 'z']] }],
    ...reporter('sensors', 'Number', 'Acceleration measured by the IMU, in g. Sitting still, Z is about 1.'),
  },
  {
    type: 'eaglets_rotation',
    message0: 'rotation speed %1 (°/s)',
    args0: [{ type: 'field_dropdown', name: 'AXIS', options: [['Z (turning)', 'z'], ['X (rolling)', 'x'], ['Y (pitching)', 'y']] }],
    ...reporter('sensors', 'Number', 'How fast the robot is rotating, in degrees per second. This is speed, not which way it faces.'),
  },
  {
    type: 'eaglets_swiped',
    message0: 'swiped %1 ? 👋',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIR',
        options: [['left ⬅', 'left'], ['right ➡', 'right'], ['up ⬆', 'up'], ['down ⬇', 'down']],
      },
    ],
    ...reporter('sensors', 'Boolean', 'True once when you swipe your hand over the gesture sensor this way.'),
  },
  {
    type: 'eaglets_color_is',
    message0: 'sensor sees %1 ?',
    args0: [
      {
        type: 'field_dropdown',
        name: 'COLOR',
        options: [['red', 'red'], ['yellow', 'yellow'], ['green', 'green'], ['blue', 'blue'], ['purple', 'purple'], ['white', 'white'], ['black', 'black']],
      },
    ],
    ...reporter('sensors', 'Boolean', 'True when the colour sensor sees this colour.'),
  },
  {
    type: 'eaglets_color_name',
    message0: 'detected color',
    ...reporter('sensors', 'String', 'The name of the colour the sensor sees.'),
  },
  {
    type: 'eaglets_object_near',
    message0: 'object nearby? ✋',
    ...reporter('sensors', 'Boolean', 'True when something is very close to the gesture sensor.'),
  },
  {
    type: 'eaglets_light',
    message0: 'light level ☀',
    ...reporter('sensors', 'Number', 'How bright it is around the sensor: 0 to 100.'),
  },
  {
    type: 'eaglets_line',
    message0: 'line sensor %1 sees dark?',
    args0: [{ type: 'field_dropdown', name: 'SIDE', options: [['left', 'left'], ['right', 'right']] }],
    ...reporter('sensors', 'Boolean', 'True when this line sensor is over a dark line.'),
  },
  {
    type: 'eaglets_heard',
    message0: 'heard a loud sound? 👏',
    ...reporter('sensors', 'Boolean', 'True if the sound sensor heard a clap since the last check.'),
  },

  // ---------------------------------------------------------------- sound (optional buzzer)
  {
    type: 'eaglets_tone',
    message0: 'play tone %1 Hz for %2 seconds',
    args0: [num('FREQ'), num('SECONDS')],
    inputsInline: true,
    ...stmt('sound', 'Play a pitch on the buzzer. 440 Hz is the note A.'),
  },
  {
    type: 'eaglets_note',
    message0: 'play note %1 for %2 seconds',
    args0: [
      {
        type: 'field_dropdown',
        name: 'NOTE',
        options: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'].map((n) => [n, n]),
      },
      num('SECONDS'),
    ],
    inputsInline: true,
    ...stmt('sound', 'Play a musical note on the buzzer.'),
  },
  {
    type: 'eaglets_beep',
    message0: 'beep 🔔',
    ...stmt('sound', 'A short beep.'),
  },
  {
    type: 'eaglets_alarm',
    message0: 'sound alarm for %1 seconds 🚨',
    args0: [num('SECONDS')],
    inputsInline: true,
    ...stmt('sound', 'A two-tone alarm.'),
  },
  {
    type: 'eaglets_sound_off',
    message0: 'stop sound 🔇',
    ...stmt('sound', 'Silence the buzzer.'),
  },

  // ---------------------------------------------------------------- output
  {
    type: 'eaglets_print',
    message0: 'show %1 in console',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    inputsInline: true,
    ...stmt('math', 'Print a value in the console under the Run button. Great for checking sensors.'),
  },
];

export const SOUND_BLOCKS = new Set(['eaglets_tone', 'eaglets_note', 'eaglets_beep', 'eaglets_alarm', 'eaglets_sound_off']);

let registered = false;

/** Register every Eaglets block. Safe to call more than once. */
export function registerBlocks() {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as { [key: string]: string });
  registerFieldColour();
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS);
}
