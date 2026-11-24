// A pretend MicroPython board that speaks the raw REPL protocol byte by byte.
// MOCK ONLY: it can't run Python. It understands Eaglets Code's helper scripts
// (marked "# eaglets-cmd:") and pretends to run programs, so the connection
// code and the UI can be tested without a robot.
import type { Transport } from './transport';

const enc = new TextEncoder();
const dec = new TextDecoder();
const RAW_BANNER = 'raw REPL; CTRL-B to exit\r\n>';
const WINDOW = 128;

export interface MockOptions {
  /** open() fails as if another program (Thonny) holds the port. */
  busy?: boolean;
  /** The board never answers (no MicroPython). */
  silent?: boolean;
  machine?: string;
  /** How long a finite program "runs". */
  programMs?: number;
  /** Make programs fail with this traceback. */
  programError?: string;
  /** Ignore Ctrl-C while a program runs (a hung board). */
  ignoreInterrupt?: boolean;
  /** Support raw-paste mode (newer MicroPython). */
  rawPaste?: boolean;
  /** Milliseconds between output chunks. */
  latencyMs?: number;
}

type Mode = 'friendly' | 'raw' | 'paste' | 'running';

export class MockMicroPythonDevice implements Transport {
  readonly label = 'Practice robot (mock)';
  onData: ((chunk: Uint8Array) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  files = new Map<string, string>();
  heartbeats = 0;
  programsRun: string[] = [];
  interrupts = 0;
  softResets = 0;
  isOpen = false;
  private mode: Mode = 'friendly';
  private line: number[] = [];
  private pasteRemaining = 0;
  private finishRun: ((interrupted: boolean) => void) | null = null;
  private unplugged = false;
  private opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = {
      busy: false,
      silent: false,
      machine: 'Raspberry Pi Pico 2 with RP2350',
      programMs: 200,
      programError: '',
      ignoreInterrupt: false,
      rawPaste: true,
      latencyMs: 1,
      ...opts,
    };
  }

  private emit(s: string | Uint8Array) {
    if (this.unplugged || !this.isOpen) return;
    const data = typeof s === 'string' ? enc.encode(s) : s;
    setTimeout(() => this.onData?.(data), this.opts.latencyMs);
  }

  async open() {
    if (this.unplugged) throw Object.assign(new Error('The device has been lost.'), { name: 'NetworkError' });
    if (this.opts.busy) throw Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' });
    this.isOpen = true;
  }

  async close() {
    this.isOpen = false;
  }

  /** Simulate pulling the USB cable. */
  unplug() {
    this.unplugged = true;
    this.isOpen = false;
    this.finishRun = null;
    this.onDisconnect?.();
  }

  async write(data: Uint8Array) {
    if (this.unplugged) throw Object.assign(new Error('The device has been lost.'), { name: 'NetworkError' });
    if (this.opts.silent) return;
    for (const byte of data) this.feed(byte);
  }

  private feed(c: number) {
    switch (this.mode) {
      case 'running':
        if (c === 0x03 && !this.opts.ignoreInterrupt) {
          this.interrupts++;
          this.finishRun?.(true);
        } else if (c === 0x16) this.heartbeats++;
        return;
      case 'paste':
        if (c === 0x04) {
          this.emit('\x04');
          this.execute(dec.decode(new Uint8Array(this.line)));
          this.line = [];
          return;
        }
        this.line.push(c);
        if (--this.pasteRemaining === 0) {
          this.pasteRemaining = WINDOW;
          this.emit('\x01');
        }
        return;
      case 'friendly':
        if (c === 0x01) {
          this.mode = 'raw';
          this.line = [];
          this.emit(RAW_BANNER);
        } else if (c === 0x03) {
          this.emit('\r\n>>> ');
        }
        return;
      case 'raw':
        if (c === 0x01) {
          if (this.line.length === 2 && this.line[0] === 0x05 && this.line[1] === 0x41) {
            this.line = [];
            if (this.opts.rawPaste) {
              this.mode = 'paste';
              this.pasteRemaining = WINDOW;
              this.emit(new Uint8Array([0x52, 0x01, WINDOW & 0xff, WINDOW >> 8]));
            } else {
              this.emit('R\x00');
            }
            return;
          }
          this.line = [];
          this.emit(RAW_BANNER);
        } else if (c === 0x02) {
          this.mode = 'friendly';
          this.emit('\r\n>>> ');
        } else if (c === 0x03) {
          this.line = [];
        } else if (c === 0x04) {
          if (this.line.length === 0) {
            this.softResets++;
            this.emit('MPY: soft reboot\r\n' + RAW_BANNER);
          } else {
            this.emit('OK');
            this.execute(dec.decode(new Uint8Array(this.line)));
            this.line = [];
          }
        } else {
          this.line.push(c);
        }
        return;
    }
  }

  private finish(stdout: string, stderr: string) {
    this.mode = 'raw';
    this.emit(stdout + '\x04' + stderr + '\x04>');
  }

  private execute(code: string) {
    const cmd = code.match(/^# eaglets-cmd: ([\w-]+) ?(\S*)/);
    if (cmd) {
      const [, name, arg] = cmd;
      if (name === 'board-info') return this.finish(`EAGLETS-INFO|micropython|${this.opts.machine}|1.29.0\r\n`, '');
      if (name === 'check-files') {
        const names = JSON.parse(code.match(/for n in (\[.*\]):/)![1]) as string[];
        const lines = names.map((n) => `${n}|${(this.files.get(n) ?? '').split('\n', 1)[0]}`);
        return this.finish(lines.join('\r\n') + '\r\n', '');
      }
      if (name === 'write-file') {
        const chunks = [...code.matchAll(/w\(a2b\('([^']*)'\)\)/g)].map((m) => m[1]).join('');
        const bin = atob(chunks);
        const bytesArr = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        this.files.set(arg, dec.decode(bytesArr));
        return this.finish('saved\r\n', '');
      }
      if (name === 'remove-file') {
        const had = this.files.delete(arg);
        return this.finish(had ? 'removed\r\n' : 'missing\r\n', '');
      }
      return this.finish('', '');
    }
    // A student program.
    this.programsRun.push(code);
    this.mode = 'running';
    const forever = /while True:/.test(code);
    this.emit('Program running on practice robot\r\n');
    const done = (interrupted: boolean) => {
      if (this.finishRun !== done) return;
      this.finishRun = null;
      if (interrupted) this.finish('', 'Traceback (most recent call last):\r\n  File "<stdin>", line 5, in <module>\r\nKeyboardInterrupt: \r\n');
      else if (this.opts.programError) this.finish('', this.opts.programError);
      else this.finish('Program finished\r\n', '');
    };
    this.finishRun = done;
    if (!forever) setTimeout(() => done(false), this.opts.programMs);
  }
}
