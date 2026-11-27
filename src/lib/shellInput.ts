/** True when the entry so far needs more lines, like `for i in range(3):`. */
export function needsMore(src: string): boolean {
  const lines = src.split('\n');
  const last = lines[lines.length - 1];
  if (/:\s*(#.*)?$/.test(last)) return true;
  // Inside an indented block: keep going until an empty line.
  return lines.length > 1 && last.trim() !== '';
}
