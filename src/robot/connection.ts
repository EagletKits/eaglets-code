import { RawRepl } from './rawRepl';
import { DisconnectedError, type Transport } from './transport';
import {
  BOARD_INFO_SCRIPT,
  BOOTLOADER_SCRIPT,
  LIST_FILES_SCRIPT,
  SAFE_STOP_SCRIPT,
  WATCHDOG_SCRIPT,
  checkFilesScript,
  fileHeader,
  hashText,
  parseCheckFiles,
  parseFileList,
  parseReadFile,
  readFileScript,
  removeFileScript,
  renameFileScript,
  robotLibraryFiles,
  shellScript,
  writeFileScript,
  type RobotStorage,
} from './deviceFiles';
import { connectionErrorMessage, translateTraceback, type FriendlyError } from './friendlyErrors';
import type { HardwareConfig } from '../hardware/config';

export type RobotState = 'disconnected' | 'connecting' | 'ready' | 'installing' | 'working' | 'running' | 'stopping';
/** What a 'running' robot is doing: a whole program, or one Shell entry. */
export type Activity = 'program' | 'shell';

export interface BoardInfo {
  implementation: string;
  machine: string;
  release: string;
  isPico2: boolean;
}

export interface RobotEvents {
  onState?: (state: RobotState) => void;
  onOutput?: (text: string) => void;
  onNotice?: (kind: 'info' | 'warning' | 'error', text: string) => void;
}

export interface RunResult {
  status: 'finished' | 'stopped' | 'error';
  error?: FriendlyError;
}

export interface ShellResult {
  status: 'ok' | 'stopped' | 'error';
  /** The traceback, trimmed to the student's own lines. */
  error?: string;
}

export class RobotBusyError extends Error {
  constructor() {
    super('Another program is already running. Press Stop first.');
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('Your robot is not connected.');
  }
}

export const HEARTBEAT_BYTE = 0x16;
export const HEARTBEAT_MS = 500;
/** If a Stop gets no answer this long, the board is treated as unresponsive. */
export const STOP_GIVE_UP_MS = 4000;

export class RobotConnection {
  state: RobotState = 'disconnected';
  activity: Activity | null = null;
  board: BoardInfo | null = null;
  /** True while the Pico is restarting into firmware-install mode, so its disappearance isn't an "unplug". */
  private leavingForBootloader = false;
  private transport: Transport | null = null;
  private repl: RawRepl | null = null;
  private syncedHash: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopTimers: Array<ReturnType<typeof setTimeout>> = [];
  private stopRequested = false;

  constructor(private events: RobotEvents = {}) {}

  private setState(s: RobotState) {
    this.state = s;
    this.events.onState?.(s);
  }

  get connected() {
    return this.state !== 'disconnected' && this.state !== 'connecting';
  }

  /** Open a transport (already chosen by the user) and check MicroPython answers. */
  async connect(transport: Transport): Promise<BoardInfo> {
    if (this.connected) await this.disconnect();
    this.setState('connecting');
    this.transport = transport;
    const repl = new RawRepl(transport);
    this.repl = repl;
    transport.onData = (c) => repl.receive(c);
    transport.onDisconnect = () => this.handleUnplug();
    try {
      await transport.open();
    } catch (e) {
      this.cleanup();
      throw new Error(connectionErrorMessage(e));
    }
    try {
      await repl.enterRaw();
      const out = await repl.evalOk(BOARD_INFO_SCRIPT, 5000);
      const line = out.split(/\r?\n/).find((l) => l.startsWith('EAGLETS-INFO|')) ?? '';
      const [, implementation = '', machine = '', release = ''] = line.split('|');
      this.board = { implementation, machine, release, isPico2: /RP2350/i.test(machine) };
      // Anything left running from main.py has been interrupted; make sure outputs are safe.
      await repl.exec(SAFE_STOP_SCRIPT, { timeoutMs: 5000 });
    } catch (e) {
      await this.disconnect();
      throw new Error(connectionErrorMessage(e));
    }
    if (this.board.implementation !== 'micropython') {
      await this.disconnect();
      throw new Error('This board is not running MicroPython. Ask an instructor to install it (see the setup guide).');
    }
    this.setState('ready');
    if (!this.board.isPico2) {
      this.events.onNotice?.('warning', `Connected, but this board reports "${this.board.machine}", not a Pico 2. Eaglets PCB V6.2 uses a Pico 2.`);
    }
    return this.board;
  }

  private handleUnplug() {
    if (this.leavingForBootloader) {
      this.leavingForBootloader = false;
      const t = this.transport;
      this.repl?.queue.fail(new DisconnectedError());
      this.cleanup();
      void t?.close().catch(() => {});
      return;
    }
    const wasRunning = this.state === 'running' || this.state === 'stopping';
    const t = this.transport;
    this.repl?.queue.fail(new DisconnectedError());
    this.cleanup();
    // Release the dead port so it can be opened again when the robot comes back.
    void t?.close().catch(() => {});
    // Unplugged mid-run is a safety message; unplugged while idle is routine.
    if (wasRunning) {
      this.events.onNotice?.('error', 'Your robot was unplugged while running. Its motors should stop within 3 seconds. If they don\'t, switch the robot\'s power OFF.');
    } else {
      this.events.onNotice?.('warning', 'Your robot was disconnected.');
    }
  }

  private cleanup() {
    this.activity = null;
    this.stopHeartbeat();
    this.clearStopTimers();
    if (this.transport) {
      this.transport.onData = null;
      this.transport.onDisconnect = null;
    }
    this.transport = null;
    this.repl = null;
    this.syncedHash = null;
    this.board = null;
    this.setState('disconnected');
  }

  async disconnect() {
    const t = this.transport;
    const repl = this.repl;
    if (repl && (this.state === 'running' || this.state === 'stopping')) {
      try {
        await repl.interrupt();
      } catch {
        /* already gone */
      }
    }
    this.cleanup();
    if (t) {
      try {
        await t.close();
      } catch {
        /* ignore */
      }
    }
  }

  private requireReady(): RawRepl {
    if (!this.repl || !this.connected) throw new NotConnectedError();
    if (this.state === 'running' || this.state === 'stopping' || this.state === 'installing' || this.state === 'working') throw new RobotBusyError();
    return this.repl;
  }

  /** Run a short helper job (file work) with the robot marked busy. */
  private async working<T>(job: (repl: RawRepl) => Promise<T>): Promise<T> {
    const repl = this.requireReady();
    this.setState('working');
    try {
      return await job(repl);
    } catch (e) {
      if (e instanceof DisconnectedError || !this.transport) throw new NotConnectedError();
      throw e;
    } finally {
      if (this.state === 'working') this.setState('ready');
    }
  }

  /** Everything stored on the robot, with how much space is left. */
  listFiles(): Promise<RobotStorage> {
    return this.working(async (repl) => parseFileList(await repl.evalOk(LIST_FILES_SCRIPT, 10000)));
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.working(async (repl) => parseReadFile(await repl.evalOk(readFileScript(path), 30000)));
  }

  async writeFile(path: string, content: string | Uint8Array) {
    await this.working(async (repl) => {
      const res = await repl.evalOk(writeFileScript(path, content), 60000);
      if (!res.includes('saved')) throw new Error(`Couldn't save ${path} on the robot.`);
    });
    // The robot library may have been overwritten: check it again before the next Run.
    this.syncedHash = null;
  }

  async removeFile(path: string) {
    await this.working((repl) => repl.evalOk(removeFileScript(path), 5000));
    this.syncedHash = null;
  }

  /** Returns false if a file with the new name already exists. */
  async renameFile(from: string, to: string): Promise<boolean> {
    const out = await this.working((repl) => repl.evalOk(renameFileScript(from, to), 5000));
    this.syncedHash = null;
    return out.includes('renamed');
  }

  /**
   * Run one Shell entry, like typing at MicroPython's >>> prompt. Variables
   * stay between entries. Unlike Run, there's no soft reset first.
   */
  async shell(source: string, config: HardwareConfig, onOutput: (text: string) => void): Promise<ShellResult> {
    this.requireReady();
    this.stopRequested = false;
    await this.syncLibrary(config);
    const repl = this.requireReady();
    this.activity = 'shell';
    this.setState('running');
    try {
      const r = await repl.exec(shellScript(source), { timeoutMs: Infinity, onOutput });
      this.clearStopTimers();
      this.activity = null;
      this.setState('ready');
      const err = r.stderr.trim();
      if (!err) return { status: 'ok' };
      if (/KeyboardInterrupt/.test(err) || this.stopRequested) return { status: 'stopped' };
      return { status: 'error', error: trimShellTraceback(err) };
    } catch (e) {
      this.clearStopTimers();
      this.activity = null;
      if (e instanceof DisconnectedError || !this.transport) throw new NotConnectedError();
      if (this.state !== 'disconnected') this.setState('ready');
      throw e;
    }
  }

  /** Switch motors, lights and sound off when nothing is running (after a Shell command, say). */
  async safeStop() {
    await this.working((repl) => repl.exec(SAFE_STOP_SCRIPT, { timeoutMs: 5000 }));
  }

  /**
   * Restart the Pico into its USB drive mode ("BOOTSEL") so new MicroPython can
   * be copied on. The serial port goes away as it restarts; that's expected.
   */
  async rebootToBootloader() {
    const repl = this.requireReady();
    this.leavingForBootloader = true;
    this.setState('working');
    try {
      await repl.exec(BOOTLOADER_SCRIPT, { timeoutMs: 3000 });
    } catch {
      /* the board vanishes mid-command; that's the point */
    }
    if (this.transport) await this.disconnect();
    this.leavingForBootloader = false;
  }

  /** Copy the robot library to the board if it's missing or out of date. */
  async syncLibrary(config: HardwareConfig, force = false): Promise<boolean> {
    const repl = this.requireReady();
    const files = robotLibraryFiles(config);
    const wanted = hashText(files.map((f) => f.content).join('\0'));
    if (!force && this.syncedHash === wanted) return false;
    this.setState('installing');
    try {
      const out = await repl.evalOk(checkFilesScript(files.map((f) => f.name)), 5000);
      const onBoard = parseCheckFiles(out);
      let changed = false;
      for (const f of files) {
        const header = f.content.split('\n', 1)[0];
        if (!force && onBoard.get(f.name) === header) continue;
        this.events.onNotice?.('info', `Installing ${f.name} on the robot…`);
        const res = await repl.evalOk(writeFileScript(f.name, f.content), 20000);
        if (!res.includes('saved')) throw new Error(`Could not save ${f.name}`);
        changed = true;
      }
      this.syncedHash = wanted;
      return changed;
    } finally {
      if (this.state === 'installing') this.setState('ready');
    }
  }

  /** Run a program from RAM, streaming its output. Resolves when it ends. */
  async run(code: string, config: HardwareConfig, opts: { handWritten?: boolean } = {}): Promise<RunResult> {
    this.requireReady();
    this.stopRequested = false;
    try {
      await this.syncLibrary(config);
      const repl = this.requireReady();
      this.activity = 'program';
      this.setState('running');
      await repl.softReset();
      await repl.evalOk(WATCHDOG_SCRIPT, 5000);
      const result = await repl.exec(code, {
        timeoutMs: Infinity,
        onOutput: (t) => this.events.onOutput?.(t),
        onStarted: () => this.startHeartbeat(),
      });
      this.stopHeartbeat();
      this.clearStopTimers();
      this.activity = null;
      this.setState('ready');
      const err = translateTraceback(result.stderr, opts);
      if (!err) return { status: 'finished' };
      if (err.stoppedByUser || this.stopRequested) return { status: 'stopped' };
      return { status: 'error', error: err };
    } catch (e) {
      this.stopHeartbeat();
      this.clearStopTimers();
      this.activity = null;
      if (e instanceof DisconnectedError || !this.transport) throw new NotConnectedError();
      if (this.state !== 'disconnected') this.setState('ready');
      throw e;
    }
  }

  /** Ask the running program to stop (Ctrl-C). Its `finally` block stops the motors. */
  async stop() {
    if (!this.repl) throw new NotConnectedError();
    if (this.state !== 'running' && this.state !== 'stopping') return;
    this.stopRequested = true;
    this.setState('stopping');
    await this.repl.interrupt();
    this.stopTimers.push(
      setTimeout(() => {
        if (this.state === 'stopping') void this.repl?.interrupt().catch(() => {});
      }, 1500),
      setTimeout(() => {
        if (this.state === 'stopping') {
          this.events.onNotice?.(
            'error',
            'The robot isn\'t answering. Switch the robot\'s power OFF now, then unplug and reconnect the USB cable.',
          );
        }
      }, STOP_GIVE_UP_MS),
    );
  }

  /** Save a program as main.py so it runs whenever the robot is switched on. */
  async saveToRobot(code: string, config: HardwareConfig) {
    await this.syncLibrary(config);
    const repl = this.requireReady();
    this.setState('installing');
    try {
      await repl.evalOk(writeFileScript('main.py', `${fileHeader(code)}\n${code}`), 20000);
    } finally {
      this.setState('ready');
    }
  }

  async removeFromRobot() {
    const repl = this.requireReady();
    await repl.evalOk(removeFileScript('main.py'), 5000);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const beat = new Uint8Array([HEARTBEAT_BYTE]);
    this.heartbeat = setInterval(() => {
      void this.transport?.write(beat).catch(() => {});
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private clearStopTimers() {
    this.stopTimers.forEach(clearTimeout);
    this.stopTimers = [];
  }
}

/**
 * Shell tracebacks mention Eaglets Code's own wrapper ("<stdin>"). Keep only
 * the student's lines, like Thonny does.
 */
export function trimShellTraceback(tb: string): string {
  const lines = tb.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*File "<stdin>"/.test(lines[i])) continue;
    kept.push(lines[i]);
  }
  const out = kept.join('\n').trim();
  return out === 'Traceback (most recent call last):' ? tb.trim() : out;
}
