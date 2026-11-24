// USB/raw REPL tests against MockMicroPythonDevice (MOCK ONLY: not real hardware).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RobotConnection, RobotBusyError, NotConnectedError, STOP_GIVE_UP_MS } from '../src/robot/connection';
import { MockMicroPythonDevice } from '../src/robot/mockDevice';
import { DEFAULT_CONFIG } from '../src/hardware/config';
import { robotLibraryFiles } from '../src/robot/deviceFiles';
import { translateTraceback, connectionErrorMessage } from '../src/robot/friendlyErrors';

const PROGRAM = "import eaglets as robot\nrobot.start()\ntry:\n    robot.forward(seconds=1)\nfinally:\n    robot.shutdown()\n";
const FOREVER = "import eaglets as robot\nrobot.start()\ntry:\n    while True:\n        robot.forward()\nfinally:\n    robot.shutdown()\n";

function setup(opts = {}) {
  const notices: Array<[string, string]> = [];
  const states: string[] = [];
  let output = '';
  const conn = new RobotConnection({
    onNotice: (k, t) => notices.push([k, t]),
    onState: (s) => states.push(s),
    onOutput: (t) => (output += t),
  });
  const dev = new MockMicroPythonDevice(opts);
  return { conn, dev, notices, states, output: () => output };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('connecting', () => {
  it('connects and identifies a Pico 2 running MicroPython', async () => {
    const { conn, dev } = setup();
    const info = await conn.connect(dev);
    expect(info.isPico2).toBe(true);
    expect(conn.state).toBe('ready');
  });

  it('explains a busy port (e.g. Thonny is open)', async () => {
    const { conn, dev } = setup({ busy: true });
    await expect(conn.connect(dev)).rejects.toThrow(/being used by another program/);
    expect(conn.state).toBe('disconnected');
  });

  it('explains a board that never answers', async () => {
    const { conn, dev } = setup({ silent: true });
    await expect(conn.connect(dev)).rejects.toThrow(/MicroPython isn't responding/);
    expect(conn.state).toBe('disconnected');
  }, 20000);

  it('warns when the board is not a Pico 2', async () => {
    const { conn, dev, notices } = setup({ machine: 'Raspberry Pi Pico with RP2040' });
    await conn.connect(dev);
    expect(notices.some(([k, t]) => k === 'warning' && /not a Pico 2/.test(t))).toBe(true);
  });

  it('refuses to run when not connected', async () => {
    const { conn } = setup();
    await expect(conn.run(PROGRAM, DEFAULT_CONFIG)).rejects.toBeInstanceOf(NotConnectedError);
    await expect(conn.run(PROGRAM, DEFAULT_CONFIG)).rejects.toThrow('Your robot is not connected.');
  });
});

describe('library install', () => {
  it('installs the library once and skips it when unchanged', async () => {
    const { conn, dev } = setup();
    await conn.connect(dev);
    expect(await conn.syncLibrary(DEFAULT_CONFIG)).toBe(true);
    const expected = robotLibraryFiles(DEFAULT_CONFIG);
    for (const f of expected) expect(dev.files.get(f.name)).toBe(f.content);
    expect(await conn.syncLibrary(DEFAULT_CONFIG)).toBe(false);
  });

  it('only rewrites the config file when settings change', async () => {
    const { conn, dev, notices } = setup();
    await conn.connect(dev);
    await conn.syncLibrary(DEFAULT_CONFIG);
    notices.length = 0;
    await conn.syncLibrary({ ...DEFAULT_CONFIG, buzzerPin: 17 });
    const installed = notices.filter(([, t]) => t.startsWith('Installing')).map(([, t]) => t);
    expect(installed).toEqual(['Installing eaglets_config.py on the robot…']);
    expect(dev.files.get('eaglets_config.py')).toContain('BUZZER_PIN = 17');
  });

  it('works on firmware without raw-paste mode', async () => {
    const { conn, dev } = setup({ rawPaste: false });
    await conn.connect(dev);
    await conn.syncLibrary(DEFAULT_CONFIG);
    expect(dev.files.get('eaglets.py')).toContain('def forward(');
  });
});

describe('running programs', () => {
  it('runs a program to the end with a fresh interpreter and the USB watchdog', async () => {
    const { conn, dev, output } = setup();
    await conn.connect(dev);
    const resets = dev.softResets;
    const r = await conn.run(PROGRAM, DEFAULT_CONFIG);
    expect(r.status).toBe('finished');
    expect(dev.programsRun).toContain(PROGRAM);
    expect(dev.softResets).toBe(resets + 1);
    expect(output()).toContain('Program finished');
    expect(conn.state).toBe('ready');
  });

  it('can reprogram repeatedly', async () => {
    const { conn, dev } = setup();
    await conn.connect(dev);
    for (let i = 0; i < 3; i++) expect((await conn.run(PROGRAM, DEFAULT_CONFIG)).status).toBe('finished');
    expect(dev.programsRun.filter((p) => p === PROGRAM)).toHaveLength(3);
  });

  it('refuses a second run while one is running', async () => {
    const { conn, dev } = setup();
    await conn.connect(dev);
    const running = conn.run(FOREVER, DEFAULT_CONFIG);
    await vi.waitFor(() => expect(conn.state).toBe('running'));
    await expect(conn.run(PROGRAM, DEFAULT_CONFIG)).rejects.toBeInstanceOf(RobotBusyError);
    await expect(conn.run(PROGRAM, DEFAULT_CONFIG)).rejects.toThrow('Another program is already running');
    await conn.stop();
    expect((await running).status).toBe('stopped');
  });

  it('Stop interrupts a forever loop and sends heartbeats while running', async () => {
    const { conn, dev } = setup();
    await conn.connect(dev);
    const running = conn.run(FOREVER, DEFAULT_CONFIG);
    await vi.waitFor(() => expect(dev.heartbeats).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await conn.stop();
    const r = await running;
    expect(r.status).toBe('stopped');
    expect(dev.interrupts).toBeGreaterThanOrEqual(1);
    expect(conn.state).toBe('ready');
    // Heartbeats stop once the program has ended.
    const beats = dev.heartbeats;
    await new Promise((res) => setTimeout(res, 700));
    expect(dev.heartbeats).toBe(beats);
  });

  it('tells the user to use the power switch if the board ignores Stop', async () => {
    const { conn, dev, notices } = setup({ ignoreInterrupt: true });
    await conn.connect(dev);
    void conn.run(FOREVER, DEFAULT_CONFIG).catch(() => {});
    await vi.waitFor(() => expect(conn.state).toBe('running'));
    await conn.stop();
    await vi.waitFor(() => expect(notices.some(([, t]) => /power OFF/.test(t))).toBe(true), { timeout: STOP_GIVE_UP_MS + 2000 });
    expect(dev.interrupts).toBe(0);
    await conn.disconnect();
  }, 10000);

  it('reports program errors in friendly words', async () => {
    const { conn, dev } = setup({
      programError: 'Traceback (most recent call last):\r\n  File "<stdin>", line 4, in <module>\r\nRobotError: The distance sensor isn\'t answering. Check its cable (J1).\r\n',
    });
    await conn.connect(dev);
    const r = await conn.run(PROGRAM, DEFAULT_CONFIG);
    expect(r.status).toBe('error');
    expect(r.error?.message).toBe("The distance sensor isn't answering. Check its cable (J1).");
    expect(r.error?.details).toContain('Traceback');
  });

  it('handles the cable being pulled mid-run and can reconnect afterwards', async () => {
    const { conn, dev, notices } = setup();
    await conn.connect(dev);
    const running = conn.run(FOREVER, DEFAULT_CONFIG);
    await vi.waitFor(() => expect(conn.state).toBe('running'));
    dev.unplug();
    await expect(running).rejects.toBeInstanceOf(NotConnectedError);
    expect(conn.state).toBe('disconnected');
    expect(notices.some(([k, t]) => k === 'error' && /unplugged while running/.test(t) && /power OFF/.test(t))).toBe(true);

    const fresh = new MockMicroPythonDevice();
    await conn.connect(fresh);
    expect((await conn.run(PROGRAM, DEFAULT_CONFIG)).status).toBe('finished');
  });

  it('saves to main.py and removes it', async () => {
    const { conn, dev } = setup();
    await conn.connect(dev);
    await conn.saveToRobot(PROGRAM, DEFAULT_CONFIG);
    expect(dev.files.get('main.py')).toContain(PROGRAM);
    await conn.removeFromRobot();
    expect(dev.files.has('main.py')).toBe(false);
  });
});

describe('friendly errors', () => {
  it('translates common tracebacks', () => {
    expect(translateTraceback('Traceback...\r\nKeyboardInterrupt: \r\n')?.stoppedByUser).toBe(true);
    expect(translateTraceback("ImportError: no module named 'eaglets'")?.message).toMatch(/library is missing/);
    expect(translateTraceback("TypeError: unsupported types for __add__: 'NoneType', 'int'")?.message).toMatch(/before it had a value/);
    expect(translateTraceback('ZeroDivisionError: divide by zero')?.message).toMatch(/divide by zero/);
    expect(translateTraceback('')).toBeNull();
    expect(translateTraceback('WeirdError: ???')?.message).toBe('Something went wrong on the robot.');
  });

  it('translates connection errors', () => {
    expect(connectionErrorMessage(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toMatch(/No robot was picked/);
    expect(connectionErrorMessage(Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' }))).toMatch(/Thonny/);
  });
});
