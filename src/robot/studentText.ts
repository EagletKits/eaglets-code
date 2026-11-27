/**
 * Kid-facing wording for robot messages. The connection layer reports exactly
 * what it is doing (file names and so on). That detail goes to the teacher
 * debug log, and students see a calmer version.
 */

/** Rewrite a robot notice for students. Unknown text passes through unchanged. */
export function studentNotice(text: string, opts: { autoReconnect: boolean }): string {
  if (/^Installing .+ on the robot/.test(text)) return 'Getting your robot ready…';
  if (text === 'Your robot was disconnected.') {
    return opts.autoReconnect ? 'Your robot was unplugged. Plug it back in and it will reconnect by itself.' : 'Your robot was unplugged. Plug it back in, then click Connect Robot.';
  }
  return text;
}

/** Lines the practice (mock) robot prints on its own, which aren't the student's output. */
const SYSTEM_LINE = /^(Program running on practice robot|Program finished)$/;

/** True if the program printed something worth showing a student. */
export function programPrinted(consoleText: string): boolean {
  return consoleText.split(/\r?\n/).some((line) => line.trim() !== '' && !SYSTEM_LINE.test(line.trim()));
}
