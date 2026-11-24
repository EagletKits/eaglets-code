// Ready-to-load starter projects, matched to the camp curriculum.
// Built with a tiny helper so each program stays readable here.

type Json = Record<string, unknown>;
interface BlockJson extends Json {
  type: string;
}

let idCounter = 0;
const uid = (p: string) => `${p}_${++idCounter}`;

const b = (type: string, fields?: Json, inputs?: Json, extra?: Json): BlockJson => ({
  type,
  id: uid(type),
  ...(fields ? { fields } : {}),
  ...(inputs ? { inputs } : {}),
  ...(extra ?? {}),
});
const num = (n: number) => ({ shadow: { type: 'math_number', id: uid('num'), fields: { NUM: n } } });
const col = (hex: string) => ({ shadow: { type: 'eaglets_color', id: uid('col'), fields: { COLOR: hex } } });
const val = (block: BlockJson) => ({ block });
/** Chain statement blocks with `next`. */
const seq = (...blocks: BlockJson[]): BlockJson => {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
};
const doo = (...blocks: BlockJson[]) => ({ block: seq(...blocks) });

const start = (...blocks: BlockJson[]) => {
  const hat = b('eaglets_when_start', undefined, undefined, { x: 40, y: 40 });
  if (blocks.length) hat.next = { block: seq(...blocks) };
  return hat;
};
const forever = (...blocks: BlockJson[]) => b('eaglets_forever', undefined, { DO: doo(...blocks) });
const repeat = (times: number, ...blocks: BlockJson[]) =>
  b('controls_repeat_ext', undefined, { TIMES: num(times), DO: doo(...blocks) });
const wait = (s: number) => b('eaglets_wait', undefined, { SECONDS: num(s) });
const leds = (hex: string) => b('eaglets_leds_all', undefined, { COLOR: col(hex) });
const ledsColor = (color: BlockJson) => b('eaglets_leds_all', undefined, { COLOR: val(color) });
const moveFor = (dir: string, s: number) => b('eaglets_move_for', { DIR: dir }, { SECONDS: num(s) });
const turnFor = (dir: string, s: number) => b('eaglets_turn_for', { DIR: dir }, { SECONDS: num(s) });
const stop = () => b('eaglets_stop');

/** if / else-if / else. Pass [condition, body[]] pairs and an optional else body. */
const ifElse = (branches: Array<[BlockJson, BlockJson[]]>, elseBody?: BlockJson[]) => {
  const inputs: Json = {};
  branches.forEach(([cond, body], i) => {
    inputs[`IF${i}`] = val(cond);
    inputs[`DO${i}`] = doo(...body);
  });
  if (elseBody) inputs.ELSE = doo(...elseBody);
  const extra: Json = {};
  if (branches.length > 1 || elseBody) {
    extra.extraState = {
      ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}),
      ...(elseBody ? { hasElse: true } : {}),
    };
  }
  return b('controls_if', undefined, inputs, extra);
};
const compare = (op: 'EQ' | 'LT' | 'GT', a: Json, bb: Json) => b('logic_compare', { OP: op }, { A: a, B: bb });

export interface StarterProject {
  id: string;
  title: string;
  emoji: string;
  day: 'Day 2' | 'Day 3' | 'Day 4' | 'Any day';
  concept: string;
  description: string;
  challenge: string;
  needs: string[];
  workspace: Json;
}

const project = (blocks: BlockJson[], variables: Array<{ name: string; id: string }> = []): Json => ({
  blocks: { languageVersion: 0, blocks },
  variables,
});

function build(): StarterProject[] {
  idCounter = 0;
  const shakesVar = { name: 'shakes', id: 'var_shakes' };
  const commandVar = { name: 'command', id: 'var_command' };

  const danceDef = b(
    'procedures_defnoreturn',
    { NAME: 'dance move' },
    {
      STACK: doo(
        leds('#ff00ff'),
        turnFor('left', 0.4),
        leds('#00ffff'),
        turnFor('right', 0.4),
        moveFor('forward', 0.3),
        moveFor('backward', 0.3),
      ),
    },
    { x: 40, y: 260 },
  );
  const callDance = () => b('procedures_callnoreturn', undefined, undefined, { extraState: { name: 'dance move' } });

  return [
    {
      id: 'flashing-leds',
      title: 'Flashing LEDs',
      emoji: '💡',
      day: 'Day 2',
      concept: 'Sequencing: the robot does each block in order',
      description: 'Blinks red and blue, then finishes with a rainbow.',
      challenge: 'Change the colors. Can you make it blink faster?',
      needs: ['LED stick'],
      workspace: project([
        start(repeat(5, leds('#ff0000'), wait(0.3), leds('#0000ff'), wait(0.3)), b('eaglets_rainbow', undefined, { SECONDS: num(2) })),
      ]),
    },
    {
      id: 'traffic-light',
      title: 'Traffic Light',
      emoji: '🚦',
      day: 'Day 2',
      concept: 'Sequencing and timing with a forever loop',
      description: 'Green, yellow, red, again and again, like a real traffic light.',
      challenge: 'Make a pedestrian light: LED 1 white when it is red.',
      needs: ['LED stick'],
      workspace: project([start(forever(leds('#00ff00'), wait(3), leds('#ffff00'), wait(1), leds('#ff0000'), wait(3)))]),
    },
    {
      id: 'simon-says',
      title: 'Simon Says Robot',
      emoji: '🗣',
      day: 'Day 2',
      concept: 'Logic: comparing with = and choosing with if / else',
      description: 'The robot picks a random command and shows it with a color and a move.',
      challenge: 'Add a fourth command. What color and move will it be?',
      needs: ['LED stick', 'Motors'],
      workspace: project(
        [
          start(
            repeat(
              5,
              b('variables_set', { VAR: { id: commandVar.id } }, { VALUE: val(b('math_random_int', undefined, { FROM: num(1), TO: num(3) })) }),
              ifElse(
                [
                  [compare('EQ', val(b('variables_get', { VAR: { id: commandVar.id } })), num(1)), [leds('#ff0000'), turnFor('left', 0.5)]],
                  [compare('EQ', val(b('variables_get', { VAR: { id: commandVar.id } })), num(2)), [leds('#00ff00'), moveFor('forward', 0.5)]],
                ],
                [leds('#0000ff'), turnFor('right', 0.5)],
              ),
              wait(1),
            ),
            b('eaglets_leds_off'),
          ),
        ],
        [commandVar],
      ),
    },
    {
      id: 'mood-lights',
      title: 'Robot Mood Lights',
      emoji: '🎨',
      day: 'Day 2',
      concept: 'If / else if / else with a sensor',
      description: 'Turn the dial to change the robot’s mood: calm blue, happy green, excited red.',
      challenge: 'Add a fourth mood. Make the brightness follow the dial too.',
      needs: ['LED stick', 'Dial'],
      workspace: project([
        start(
          forever(
            ifElse(
              [
                [compare('LT', val(b('eaglets_dial')), num(33)), [leds('#0000ff')]],
                [compare('LT', val(b('eaglets_dial')), num(66)), [leds('#00ff00')]],
              ],
              [leds('#ff0000')],
            ),
            wait(0.1),
          ),
        ),
      ]),
    },
    {
      id: 'move-and-stop',
      title: 'Move Forward and Stop',
      emoji: '🏁',
      day: 'Day 3',
      concept: 'Movement blocks with a time limit',
      description: 'Drives forward for 2 seconds, stops, and shows green.',
      challenge: 'Race! How far can you get in exactly 3 seconds?',
      needs: ['Motors', 'LED stick'],
      workspace: project([
        start(b('eaglets_set_speed', undefined, { SPEED: num(50) }), leds('#ffff00'), moveFor('forward', 2), stop(), leds('#00ff00')),
      ]),
    },
    {
      id: 'robot-dance',
      title: 'Robot Dance',
      emoji: '🕺',
      day: 'Any day',
      concept: 'Functions: give a group of blocks a name and reuse it',
      description: 'A "dance move" function, repeated three times, then a rainbow finish.',
      challenge: 'Make a second function called "spin" and add it to the dance.',
      needs: ['Motors', 'LED stick'],
      workspace: project([start(repeat(3, callDance()), b('eaglets_rainbow', undefined, { SECONDS: num(2) })), danceDef]),
    },
    {
      id: 'gesture-robot',
      title: 'Gesture-Controlled Robot',
      emoji: '👋',
      day: 'Day 3',
      concept: 'Sensors + if / else if: swipe to steer',
      description: 'Swipe left or right to turn, up to go forward, down to stop.',
      challenge: 'Light the LEDs a different color for each swipe.',
      needs: ['Gesture sensor', 'Motors'],
      workspace: project([
        start(
          forever(
            ifElse([
              [b('eaglets_swiped', { DIR: 'left' }), [turnFor('left', 0.5)]],
              [b('eaglets_swiped', { DIR: 'right' }), [turnFor('right', 0.5)]],
              [b('eaglets_swiped', { DIR: 'up' }), [moveFor('forward', 1)]],
              [b('eaglets_swiped', { DIR: 'down' }), [stop()]],
            ]),
          ),
        ),
      ]),
    },
    {
      id: 'obstacle-detection',
      title: 'Obstacle Detection',
      emoji: '🧱',
      day: 'Day 3',
      concept: 'Ultrasonic sensor + if / else',
      description: 'Drives forward and stops with red lights when something is closer than 15 cm.',
      challenge: 'Instead of just stopping, back up and turn to find a new path.',
      needs: ['Distance sensor', 'Motors', 'LED stick'],
      workspace: project([
        start(
          forever(
            ifElse(
              [[b('eaglets_distance_lt', undefined, { CM: num(15) }), [stop(), leds('#ff0000')]]],
              [b('eaglets_move_speed', { DIR: 'forward' }, { SPEED: num(40) }), leds('#00ff00')],
            ),
          ),
        ),
      ]),
    },
    {
      id: 'tilt-alarm',
      title: 'IMU Tilt Alarm',
      emoji: '🚨',
      day: 'Day 3',
      concept: 'Motion sensor: is the robot tipped over?',
      description: 'A robot security system: flashes red if anyone tilts it.',
      challenge: 'Make a different color for tilting forward and backward.',
      needs: ['IMU', 'LED stick'],
      workspace: project([
        start(
          forever(
            ifElse(
              [[b('eaglets_tilted'), [b('eaglets_flash', undefined, { COLOR: col('#ff0000'), TIMES: num(2) })]]],
              [leds('#00ff00')],
            ),
          ),
        ),
      ]),
    },
    {
      id: 'tilt-colors',
      title: 'Tilt Color Mixer',
      emoji: '🌈',
      day: 'Day 3',
      concept: 'Pair each tilt direction with a color channel',
      description: 'Tip left/right to add red, forward/back to add blue.',
      challenge: 'Which way do you tilt to make purple?',
      needs: ['IMU', 'LED stick'],
      workspace: project([
        start(
          forever(
            ledsColor(
              b('eaglets_rgb', undefined, {
                R: { ...num(0), block: b('math_single', { OP: 'ABS' }, { NUM: val(b('eaglets_tilt_angle', { AXIS: 'left-right' })) }) },
                G: num(20),
                B: { ...num(0), block: b('math_single', { OP: 'ABS' }, { NUM: val(b('eaglets_tilt_angle', { AXIS: 'forward-back' })) }) },
              }),
            ),
            wait(0.05),
          ),
        ),
      ]),
    },
    {
      id: 'shake-color',
      title: 'Shake to Change Color',
      emoji: '🫨',
      day: 'Any day',
      concept: 'Variables: counting shakes',
      description: 'Every shake picks a new random color and counts how many shakes so far.',
      challenge: 'After 10 shakes, play a rainbow.',
      needs: ['IMU', 'LED stick'],
      workspace: project(
        [
          start(
            b('variables_set', { VAR: { id: shakesVar.id } }, { VALUE: num(0) }),
            forever(
              ifElse([
                [
                  b('eaglets_shaken'),
                  [
                    ledsColor(b('eaglets_random_color')),
                    b('math_change', { VAR: { id: shakesVar.id } }, { DELTA: num(1) }),
                    b('eaglets_print', undefined, { VALUE: val(b('variables_get', { VAR: { id: shakesVar.id } })) }),
                  ],
                ],
              ]),
            ),
          ),
        ],
        [shakesVar],
      ),
    },
    {
      id: 'smart-maze',
      title: 'Smart Maze Starter',
      emoji: '🧭',
      day: 'Day 4',
      concept: 'Put it together: distance sensor + IMU turns',
      description: 'Drives until a wall, turns right 90°. If that is blocked too, turns around.',
      challenge: 'Make it smarter: check left before turning around.',
      needs: ['Distance sensor', 'IMU', 'Motors', 'LED stick'],
      workspace: project([
        start(
          b('eaglets_set_speed', undefined, { SPEED: num(40) }),
          forever(
            ifElse(
              [
                [
                  b('eaglets_distance_lt', undefined, { CM: num(20) }),
                  [
                    stop(),
                    leds('#ffff00'),
                    b('eaglets_turn_degrees', { DIR: 'right' }, { DEGREES: num(90) }),
                    ifElse([[b('eaglets_distance_lt', undefined, { CM: num(20) }), [b('eaglets_turn_degrees', { DIR: 'right' }, { DEGREES: num(180) })]]]),
                  ],
                ],
              ],
              [leds('#00ff00'), b('eaglets_move')],
            ),
          ),
        ),
      ]),
    },
  ];
}

export const STARTER_PROJECTS: StarterProject[] = build();
