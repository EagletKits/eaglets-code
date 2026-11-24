import eagletsPy from '../../firmware/eaglets.py?raw';
import apdsPy from '../../firmware/apds9960.py?raw';
import imuPy from '../../firmware/lsm6ds3.py?raw';
import { renderConfigPy, type HardwareConfig } from '../hardware/config';

export interface DeviceFile {
  name: string;
  content: string;
}

/** FNV-1a, enough to notice a changed file. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const fileHeader = (content: string) => `# eaglets-file ${hashText(content)}`;

/** Files the robot needs, with a first-line header carrying a content hash. */
export function robotLibraryFiles(config: HardwareConfig): DeviceFile[] {
  const raw: DeviceFile[] = [
    { name: 'eaglets.py', content: eagletsPy },
    { name: 'eaglets_config.py', content: renderConfigPy(config) },
    { name: 'apds9960.py', content: apdsPy },
    { name: 'lsm6ds3.py', content: imuPy },
  ];
  return raw.map((f) => ({ name: f.name, content: `${fileHeader(f.content)}\n${f.content}` }));
}

/** Raw library files without headers, for people using Thonny. */
export function plainLibraryFiles(config: HardwareConfig): DeviceFile[] {
  return [
    { name: 'eaglets.py', content: eagletsPy },
    { name: 'eaglets_config.py', content: renderConfigPy(config) },
    { name: 'apds9960.py', content: apdsPy },
    { name: 'lsm6ds3.py', content: imuPy },
  ];
}

export function checkFilesScript(names: string[]): string {
  return `# eaglets-cmd: check-files
for n in ${JSON.stringify(names)}:
    try:
        f = open(n)
        l = f.readline()
        f.close()
    except OSError:
        l = ''
    print(n + '|' + l.strip())
`;
}

export function parseCheckFiles(stdout: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf('|');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  return m;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** A script that writes a file safely: to a temp name first, then renamed. */
export function writeFileScript(name: string, content: string): string {
  if (!/^[\w.]+$/.test(name)) throw new Error(`Bad file name ${name}`);
  const b64 = toBase64(content);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 1024) lines.push(`w(a2b('${b64.slice(i, i + 1024)}'))`);
  return `# eaglets-cmd: write-file ${name}
import os
from binascii import a2b_base64 as a2b
f = open('${name}.tmp', 'wb')
w = f.write
${lines.join('\n')}
f.close()
try:
    os.remove('${name}')
except OSError:
    pass
os.rename('${name}.tmp', '${name}')
print('saved')
`;
}

export function removeFileScript(name: string): string {
  return `# eaglets-cmd: remove-file ${name}
import os
try:
    os.remove('${name}')
    print('removed')
except OSError:
    print('missing')
`;
}

export const BOARD_INFO_SCRIPT = `# eaglets-cmd: board-info
import sys, os
print('EAGLETS-INFO|' + sys.implementation.name + '|' + os.uname().machine + '|' + os.uname().release)
`;

export const WATCHDOG_SCRIPT = `# eaglets-cmd: usb-watchdog
import eaglets
eaglets.usb_watchdog(True)
`;

export const SAFE_STOP_SCRIPT = `# eaglets-cmd: safe-stop
try:
    import eaglets
    eaglets.shutdown()
except Exception:
    pass
`;
