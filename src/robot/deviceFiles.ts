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

function toBase64(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Robot file paths: folders and names made of letters, digits, _ - and .,
 * relative to the robot's root ("main.py", "lib/helpers.py"). Keeping them this
 * plain means they can never break out of the Python string they're put in.
 */
export const ROBOT_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[\w.-]+(\/[\w.-]+)*$/;

export function checkRobotPath(path: string): string {
  if (!ROBOT_PATH.test(path) || path.length > 100) throw new Error(`File names on the robot can use letters, numbers, _ - and . only ("${path}").`);
  return path;
}

/** Make a computer file name safe for the robot: "My Game (2).py" becomes "My_Game_2.py". */
export function robotFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/\s+/g, '_').replace(/[^\w.-]/g, '').replace(/^\.+/, '');
  return cleaned || 'file.py';
}

const py = (s: string) => JSON.stringify(s);

/** A script that writes a file safely: to a temp name first, then renamed. */
export function writeFileScript(name: string, content: string | Uint8Array): string {
  checkRobotPath(name);
  const b64 = toBase64(content);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 1024) lines.push(`w(a2b('${b64.slice(i, i + 1024)}'))`);
  return `# eaglets-cmd: write-file ${name}
import os
from binascii import a2b_base64 as a2b
f = open(${py(name + '.tmp')}, 'wb')
w = f.write
${lines.join('\n')}
f.close()
try:
    os.remove(${py(name)})
except OSError:
    pass
os.rename(${py(name + '.tmp')}, ${py(name)})
print('saved')
`;
}

export function removeFileScript(name: string): string {
  checkRobotPath(name);
  return `# eaglets-cmd: remove-file ${name}
import os
try:
    os.remove(${py(name)})
    print('removed')
except OSError:
    try:
        os.rmdir(${py(name)})
        print('removed')
    except OSError:
        print('missing')
`;
}

export function renameFileScript(from: string, to: string): string {
  checkRobotPath(from);
  checkRobotPath(to);
  return `# eaglets-cmd: rename-file ${from} ${to}
import os
try:
    os.stat(${py(to)})
    print('exists')
except OSError:
    os.rename(${py(from)}, ${py(to)})
    print('renamed')
`;
}

/** Prints "F|path|size" and "D|path|0" for everything on the robot, then "S|total|free". */
export const LIST_FILES_SCRIPT = `# eaglets-cmd: list-files
import os
def _walk(d):
    for e in os.ilistdir(d):
        p = d + e[0]
        if e[1] == 0x4000:
            print('D|' + p + '|0')
            _walk(p + '/')
        else:
            print('F|' + p + '|' + str(e[3] if len(e) > 3 else 0))
_walk('')
del _walk
s = os.statvfs('/')
print('S|' + str(s[0] * s[2]) + '|' + str(s[0] * s[3]))
`;

export interface RobotFile {
  path: string;
  size: number;
  dir: boolean;
}
export interface RobotStorage {
  files: RobotFile[];
  totalBytes: number;
  freeBytes: number;
}

export function parseFileList(stdout: string): RobotStorage {
  const files: RobotFile[] = [];
  let totalBytes = 0;
  let freeBytes = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const [kind, a, b] = line.split('|');
    if (kind === 'F' || kind === 'D') files.push({ path: a, size: Number(b) || 0, dir: kind === 'D' });
    else if (kind === 'S') {
      totalBytes = Number(a) || 0;
      freeBytes = Number(b) || 0;
    }
  }
  files.sort((x, y) => x.path.localeCompare(y.path));
  return { files, totalBytes, freeBytes };
}

/** Prints the file as base64 lines. 510 bytes is a multiple of 3, so lines join cleanly. */
export function readFileScript(name: string): string {
  checkRobotPath(name);
  return `# eaglets-cmd: read-file ${name}
from binascii import b2a_base64 as b2a
f = open(${py(name)}, 'rb')
while True:
    b = f.read(510)
    if not b:
        break
    print(b2a(b).decode().strip())
f.close()
`;
}

export function parseReadFile(stdout: string): Uint8Array {
  const b64 = stdout.replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * One Shell entry. "single" mode is what MicroPython's own >>> prompt uses, so
 * typing 2 + 2 prints 4. Anything longer than one statement runs as a block.
 * Variables live on between entries until the next Run (which soft-resets).
 * The safety checks are armed first so a typed robot.forward() still auto-stops,
 * and `robot` is ready to use without an import.
 */
export function shellScript(source: string): string {
  return `# eaglets-cmd: shell
try:
    import eaglets as _e
    _e.arm_safety()
    try:
        robot
    except NameError:
        robot = _e
    del _e
except Exception:
    pass
_s = ${py(source)}
try:
    _c = compile(_s, '<shell>', 'single')
except SyntaxError:
    _c = compile(_s, '<shell>', 'exec')
del _s
exec(_c)
`;
}

/** Restarts the Pico into its USB drive mode, ready for new MicroPython firmware. */
export const BOOTLOADER_SCRIPT = `# eaglets-cmd: bootloader
import machine
machine.bootloader()
`;

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
