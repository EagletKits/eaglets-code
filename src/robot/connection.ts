import { RawRepl } from './rawRepl';
import { DisconnectedError, type Transport } from './transport';
import {
  BOARD_INFO_SCRIPT,
  SAFE_STOP_SCRIPT,
  WATCHDOG_SCRIPT,
  checkFilesScript,
  fileHeader,
  hashText,
  parseCheckFiles,
  removeFileScript,
  robotLibraryFiles,
  writeFileScript,
} from './deviceFiles';
import { connectionErrorMessage, translateTraceback, type FriendlyError } from './friendlyErrors';
import type { HardwareConfig } from '../hardware/config';

export type RobotState = 'disconnected' | 'connecting' | 'ready' | 'installing' | 'running' | 'stopping';

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
  board: BoardInfo | null = null;
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
    const wasRunning = this.state === 'running' || this.state === 'stopping';
    this.repl?.queue.fail(new DisconnectedError());
    this.cleanup();
    this.events.onNotice?.(
      'error',
      wasRunning
        ? 'Your robot was unplugged while running. Its motors should stop within 3 seconds. If they don\'t, switch the robot\'s power OFF.'
        : 'Your robot was disconnected.',
    );
  }

  private cleanup() {
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
    if (this.state === 'running' || this.state === 'stopping' || this.state === 'installing') throw new RobotBusyError();
    return this.repl;
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
  async run(code: string, config: HardwareConfig): Promise<RunResult> {
    this.requireReady();
    this.stopRequested = false;
    try {
      await this.syncLibrary(config);
      const repl = this.requireReady();
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
      this.setState('ready');
      const err = translateTraceback(result.stderr);
      if (!err) return { status: 'finished' };
      if (err.stoppedByUser || this.stopRequested) return { status: 'stopped' };
      return { status: 'error', error: err };
    } catch (e) {
      this.stopHeartbeat();
      this.clearStopTimers();
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
