// MicroPython raw REPL protocol, the same one mpremote/pyboard.py use.
//   Ctrl-C (0x03) interrupts a running program
//   Ctrl-A (0x01) enters raw REPL:  "raw REPL; CTRL-B to exit\r\n>"
//   Ctrl-D (0x04) at the raw prompt soft-resets the interpreter
//   Raw paste (Ctrl-E 'A' Ctrl-A) streams code with flow control; older
//   firmware falls back to plain raw mode: code + Ctrl-D, board replies "OK".
//   After running, the board sends: stdout, 0x04, stderr, 0x04, then ">".
import { ByteQueue, bytes, text, type Transport } from './transport';

const RAW_BANNER = 'raw REPL; CTRL-B to exit\r\n';

export class ReplError extends Error {}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RawRepl {
  readonly queue = new ByteQueue();
  private inRaw = false;

  constructor(private transport: Transport) {}

  /** Feed bytes received from the transport. */
  receive(chunk: Uint8Array) {
    this.queue.push(chunk);
  }

  async write(s: string | Uint8Array) {
    await this.transport.write(typeof s === 'string' ? bytes(s) : s);
  }

  /** Stop whatever is running and enter raw REPL. */
  async enterRaw(timeoutMs = 3000) {
    await this.write('\r\x03\x03');
    await sleep(100);
    this.queue.clear();
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.write('\r\x01');
      try {
        await this.queue.readUntil(RAW_BANNER + '>', timeoutMs);
        this.inRaw = true;
        return;
      } catch (e) {
        if (attempt === 1) throw new ReplError(`Could not enter raw REPL: ${(e as Error).message}`);
        await this.write('\r\x03\x03');
        await sleep(200);
        this.queue.clear();
      }
    }
  }

  /** Soft reset: fresh interpreter, same raw REPL. main.py does not run. */
  async softReset(timeoutMs = 5000) {
    if (!this.inRaw) await this.enterRaw();
    await this.write('\x04');
    await this.queue.readUntil('soft reboot\r\n', timeoutMs);
    await this.queue.readUntil(RAW_BANNER + '>', timeoutMs);
  }

  async exitRaw() {
    await this.write('\r\x02');
    this.inRaw = false;
  }

  /** Send code and wait until the board has accepted it (not until it finishes). */
  private async sendCode(code: string, timeoutMs: number) {
    const data = bytes(code);
    // Clear any stray bytes sitting in the board's line buffer.
    await this.write('\x03');
    await this.write('\x05A\x01');
    const reply = await this.queue.readExactly(2, timeoutMs);
    if (reply[0] === 0x52 /* R */ && reply[1] === 0x01) {
      const inc = await this.queue.readExactly(2, timeoutMs);
      const windowInc = inc[0] | (inc[1] << 8);
      let window = windowInc;
      let i = 0;
      while (i < data.length) {
        while (window === 0 || this.queue.length > 0) {
          const b = (await this.queue.readExactly(1, timeoutMs))[0];
          if (b === 0x01) window += windowInc;
          else if (b === 0x04) {
            await this.write('\x04');
            throw new ReplError('The robot stopped accepting the program.');
          } else throw new ReplError(`Unexpected byte ${b} during upload`);
        }
        const n = Math.min(window, data.length - i);
        await this.transport.write(data.subarray(i, i + n));
        i += n;
        window -= n;
      }
      await this.write('\x04');
      await this.queue.readUntil('\x04', timeoutMs);
      return;
    }
    if (!(reply[0] === 0x52 && reply[1] === 0x00)) {
      // Firmware without raw-paste support echoed something else; start over in plain raw mode.
      await sleep(50);
      this.queue.clear();
      await this.enterRaw();
    }
    for (let i = 0; i < data.length; i += 256) {
      await this.transport.write(data.subarray(i, i + 256));
      await sleep(10);
    }
    await this.write('\x04');
    const ok = await this.queue.readExactly(2, timeoutMs);
    if (text(ok) !== 'OK') throw new ReplError(`Board did not accept the program: ${JSON.stringify(text(ok))}`);
  }

  /**
   * Run code to completion and return its output.
   * `onStarted` fires once the board has accepted the code and is running it.
   */
  async exec(
    code: string,
    opts: { timeoutMs?: number; onOutput?: (s: string) => void; onStarted?: () => void } = {},
  ): Promise<ExecResult> {
    if (!this.inRaw) await this.enterRaw();
    const t = opts.timeoutMs ?? 10000;
    await this.sendCode(code, Math.min(t, 10000));
    opts.onStarted?.();
    const decoder = new TextDecoder();
    const out = await this.queue.streamUntil(0x04, (c) => opts.onOutput?.(decoder.decode(c, { stream: true })), t);
    const err = await this.queue.streamUntil(0x04, () => {}, 5000);
    await this.queue.readUntil('>', 5000);
    return { stdout: text(out), stderr: text(err) };
  }

  /** Like exec, but throws if the code raised an error. */
  async evalOk(code: string, timeoutMs = 10000): Promise<string> {
    const r = await this.exec(code, { timeoutMs });
    if (r.stderr.trim()) throw new ReplError(r.stderr.trim());
    return r.stdout;
  }

  async interrupt() {
    await this.write('\x03');
  }
}
