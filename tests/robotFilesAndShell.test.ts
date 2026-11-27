// Files, Shell and firmware-install mode, against MockMicroPythonDevice (MOCK ONLY: not real hardware).
import { describe, expect, it, vi } from 'vitest';
import { RobotConnection, RobotBusyError, trimShellTraceback } from '../src/robot/connection';
import { MockMicroPythonDevice } from '../src/robot/mockDevice';
import { DEFAULT_CONFIG } from '../src/hardware/config';
import { checkRobotPath, parseFileList, robotFileName, shellScript, writeFileScript } from '../src/robot/deviceFiles';

async function connected() {
  const notices: Array<[string, string]> = [];
  const states: string[] = [];
  const conn = new RobotConnection({ onNotice: (k, t) => notices.push([k, t]), onState: (s) => states.push(s) });
  const dev = new MockMicroPythonDevice();
  await conn.connect(dev);
  return { conn, dev, notices, states };
}

describe('robot file names', () => {
  it('accepts plain names and folders', () => {
    for (const ok of ['main.py', 'lib/helpers.py', 'data-2.csv', 'a_b.txt']) expect(() => checkRobotPath(ok)).not.toThrow();
  });
  it('refuses names that could escape the Python string or the folder', () => {
    for (const bad of ["x'.py", 'a"b', '../main.py', 'lib/../x', '/abs.py', 'a b.py', 'x\\y', '', '.']) expect(() => checkRobotPath(bad)).toThrow();
  });
  it('cleans computer file names for the robot', () => {
    expect(robotFileName('My Game (2).py')).toBe('My_Game_2.py');
    expect(robotFileName('C:\\Users\\kid\\hello.py')).toBe('hello.py');
    expect(robotFileName('...')).toBe('file.py');
  });
  it('writes paths as Python string literals', () => {
    expect(writeFileScript('lib/x.py', 'print(1)')).toContain(`open("lib/x.py.tmp", 'wb')`);
  });
  it('reads the file listing', () => {
    const s = parseFileList('F|main.py|12\r\nD|lib|0\r\nF|lib/a.py|3\r\nS|1000|400\r\n');
    expect(s.files.map((f) => f.path)).toEqual(['lib', 'lib/a.py', 'main.py']);
    expect(s.files[0].dir).toBe(true);
    expect(s.totalBytes).toBe(1000);
    expect(s.freeBytes).toBe(400);
  });
});

describe('files on the robot', () => {
  it('lists, writes, reads back, renames and deletes', async () => {
    const { conn, dev } = await connected();
    await conn.writeFile('hello.py', 'print("hi")\n');
    await conn.writeFile('art.bin', new Uint8Array([0, 255, 1, 2]));
    const list = await conn.listFiles();
    expect(list.files.map((f) => f.path)).toEqual(['art.bin', 'hello.py']);
    expect(list.freeBytes).toBeGreaterThan(0);
    expect(new TextDecoder().decode(await conn.readFile('hello.py'))).toBe('print("hi")\n');
    expect(await conn.renameFile('hello.py', 'main.py')).toBe(true);
    await conn.writeFile('other.py', 'x');
    expect(await conn.renameFile('other.py', 'main.py')).toBe(false);
    await conn.removeFile('main.py');
    expect(dev.files.has('main.py')).toBe(false);
    expect(conn.state).toBe('ready');
  });

  it('reads files bigger than one chunk', async () => {
    const { conn } = await connected();
    const big = 'x = 1\n'.repeat(500);
    await conn.writeFile('big.py', big);
    expect(new TextDecoder().decode(await conn.readFile('big.py'))).toBe(big);
  });

  it('checks the robot library again after files change', async () => {
    const { conn, dev } = await connected();
    await conn.syncLibrary(DEFAULT_CONFIG);
    await conn.removeFile('eaglets.py');
    expect(await conn.syncLibrary(DEFAULT_CONFIG)).toBe(true);
    expect(dev.files.has('eaglets.py')).toBe(true);
  });
});

describe('shell', () => {
  it('shows results like the >>> prompt and keeps the robot ready', async () => {
    const { conn, dev } = await connected();
    let out = '';
    expect(await conn.shell('2 + 2', DEFAULT_CONFIG, (t) => (out += t))).toEqual({ status: 'ok' });
    expect(out.trim()).toBe('4');
    expect(dev.shellEntries).toEqual(['2 + 2']);
    expect(conn.state).toBe('ready');
    expect(dev.softResets).toBe(0);
  });

  it('installs the robot library first, so import eaglets works', async () => {
    const { conn, dev } = await connected();
    await conn.shell('print("hi")', DEFAULT_CONFIG, () => {});
    expect(dev.files.has('eaglets.py')).toBe(true);
  });

  it('reports errors without the wrapper lines', async () => {
    const { conn } = await connected();
    const r = await conn.shell('banana', DEFAULT_CONFIG, () => {});
    expect(r.status).toBe('error');
    expect(r.error).toContain("NameError: name 'banana' isn't defined");
    expect(r.error).not.toContain('<stdin>');
  });

  it('can be stopped, and blocks other robot work while it runs', async () => {
    const { conn } = await connected();
    const running = conn.shell('while True:\n    pass', DEFAULT_CONFIG, () => {});
    await vi.waitFor(() => expect(conn.activity).toBe('shell'), { timeout: 10000 });
    await expect(conn.listFiles()).rejects.toBeInstanceOf(RobotBusyError);
    await conn.stop();
    expect((await running).status).toBe('stopped');
    expect(conn.activity).toBe(null);
  });

  it('arms the motor safety checks before every entry', () => {
    const s = shellScript('robot.forward()');
    expect(s.indexOf('arm_safety()')).toBeLessThan(s.indexOf('exec(_c)'));
    expect(s).toContain("compile(_s, '<shell>', 'single')");
  });

  it('keeps tracebacks readable', () => {
    expect(trimShellTraceback('Traceback (most recent call last):\n  File "<stdin>", line 13, in <module>\n  File "<shell>", line 1, in <module>\nNameError: x')).toBe(
      'Traceback (most recent call last):\n  File "<shell>", line 1, in <module>\nNameError: x',
    );
  });
});

describe('stop when nothing is running', () => {
  it('switches motors and lights off', async () => {
    const { conn, dev } = await connected();
    await conn.safeStop();
    expect(conn.state).toBe('ready');
    expect(dev.isOpen).toBe(true);
  });
});

describe('firmware install mode', () => {
  it('restarts the Pico into drive mode without an "unplugged" warning', async () => {
    const { conn, notices } = await connected();
    await conn.rebootToBootloader();
    expect(conn.state).toBe('disconnected');
    expect(notices.filter(([, t]) => /unplugged|disconnected/i.test(t))).toEqual([]);
  });
});
