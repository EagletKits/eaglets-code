/** Turn a MicroPython traceback into a message a 9-year-old can act on. */
export interface FriendlyError {
  message: string;
  /** The original traceback, shown only in advanced mode. */
  details: string;
  stoppedByUser: boolean;
}

const RULES: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/RobotError: (.*)$/m, (m) => m[1]],
  [/ImportError: (?:no module named|can't import name) '?eaglets/i, 'The robot library is missing. Disconnect and connect again so Eaglets Code can install it.'],
  [/MemoryError/, 'Your program is too big for the robot\'s memory. Try making it smaller.'],
  [/ZeroDivisionError/, 'Your program tried to divide by zero.'],
  [/unsupported types for .*NoneType|NoneType.* isn't|'NoneType' object/, 'A variable was used before it had a value. Use a "set" block first.'],
  [/NameError: name '(\w+)' isn't defined/, (m) => `The program used "${m[1]}" before it was made.`],
  [/OSError: \[Errno (?:5|110|116)\]|EIO|ETIMEDOUT/, 'A sensor stopped answering. Check that its cable is plugged in.'],
  [/SyntaxError/, 'Eaglets Code made a program the robot couldn\'t read. Please tell an instructor.'],
  [/RecursionError|maximum recursion depth/, 'A function keeps calling itself and never stops.'],
  [/ValueError: (.*)$/m, (m) => `A block got a value it can't use (${m[1]}).`],
  [/TypeError: (.*)$/m, 'A block got the wrong kind of value. Check numbers, colors and true/false blocks.'],
];

/**
 * The line in the student's program where it failed: the last "<stdin>" frame,
 * because a program sent from the editor runs as <stdin>.
 */
export function errorLine(traceback: string): number | null {
  const all = [...traceback.matchAll(/File "<stdin>", line (\d+)/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}

export function translateTraceback(stderr: string, opts: { handWritten?: boolean } = {}): FriendlyError | null {
  const details = stderr.trim();
  if (!details) return null;
  if (/KeyboardInterrupt/.test(details)) {
    return { message: 'Program stopped.', details, stoppedByUser: true };
  }
  // In hand-written code a SyntaxError is the writer's typo, not an Eaglets Code bug.
  const syntax = details.match(/SyntaxError: ?(.*)$/m);
  if (syntax && opts.handWritten) {
    const why = syntax[1].trim();
    return { message: `Python can't read this line${why ? ` (${why})` : ''}. Check for a missing bracket, quote or colon, or wrong indenting.`, details, stoppedByUser: false };
  }
  if (/IndentationError/.test(details) && opts.handWritten) {
    return { message: 'The indenting (spaces at the start of the line) is wrong here.', details, stoppedByUser: false };
  }
  for (const [re, msg] of RULES) {
    const m = details.match(re);
    if (m) return { message: typeof msg === 'string' ? msg : msg(m), details, stoppedByUser: false };
  }
  return { message: 'Something went wrong on the robot.', details, stoppedByUser: false };
}

/** Friendly text for Web Serial / connection failures. */
export function connectionErrorMessage(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const name = e?.name ?? '';
  const msg = e?.message ?? String(err);
  if (name === 'NotFoundError' || /No port selected/i.test(msg)) return 'No robot was picked. Click Connect and choose your robot.';
  if (name === 'NetworkError' || /Failed to open/i.test(msg))
    return 'Your robot is being used by another program, like Thonny or another browser tab. Close it, then click Connect again.';
  if (name === 'InvalidStateError') return 'This robot is already connected in this tab.';
  if (name === 'SecurityError') return 'The browser blocked the USB connection. Use Chrome or Edge, and open Eaglets Code from http://localhost or https.';
  if (/raw REPL/i.test(msg))
    return 'The robot answered, but MicroPython isn\'t responding. Unplug the robot, plug it back in, and connect again. If it keeps happening, MicroPython may need to be installed (see the setup guide).';
  if (/disconnected/i.test(msg)) return 'Your robot is not connected.';
  return `Couldn't talk to the robot: ${msg}`;
}
