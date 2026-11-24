/** A byte pipe to a MicroPython board: Web Serial in the browser, a mock in tests. */
export interface Transport {
  readonly label: string;
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Called with every chunk received from the board. */
  onData: ((chunk: Uint8Array) => void) | null;
  /** Called once if the board goes away (cable pulled, board reset into a new port). */
  onDisconnect: (() => void) | null;
}

export class DisconnectedError extends Error {
  constructor() {
    super('The robot was disconnected.');
  }
}

export class TimeoutError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const bytes = (s: string) => enc.encode(s);
export const text = (b: Uint8Array) => dec.decode(b);

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

interface Waiter {
  check: () => boolean;
  reject: (e: Error) => void;
}

/** Buffers incoming bytes so protocol code can wait for a marker or a byte count. */
export class ByteQueue {
  private buf = new Uint8Array(0);
  private waiters = new Set<Waiter>();
  private failed: Error | null = null;

  push(chunk: Uint8Array) {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    for (const w of [...this.waiters]) w.check();
  }

  fail(err: Error) {
    this.failed = err;
    for (const w of [...this.waiters]) w.reject(err);
    this.waiters.clear();
  }

  reset() {
    this.failed = null;
    this.buf = new Uint8Array(0);
  }

  clear() {
    this.buf = new Uint8Array(0);
  }

  get length() {
    return this.buf.length;
  }

  private take(n: number) {
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  private wait<T>(tryTake: () => T | undefined, timeoutMs: number, onTimeout: () => string, signal?: AbortSignal): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    const now = tryTake();
    if (now !== undefined) return Promise.resolve(now);
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        this.waiters.delete(waiter);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        done();
        reject(new Error('aborted'));
      };
      const waiter: Waiter = {
        check: () => {
          const v = tryTake();
          if (v === undefined) return false;
          done();
          resolve(v);
          return true;
        },
        reject: (e) => {
          done();
          reject(e);
        },
      };
      this.waiters.add(waiter);
      if (Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          done();
          reject(new TimeoutError(onTimeout()));
        }, timeoutMs);
      }
      signal?.addEventListener('abort', onAbort);
    });
  }

  /** Resolve with everything up to and including `marker`. */
  readUntil(marker: string | Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const m = typeof marker === 'string' ? bytes(marker) : marker;
    return this.wait(
      () => {
        const i = indexOf(this.buf, m);
        return i < 0 ? undefined : this.take(i + m.length);
      },
      timeoutMs,
      () => `Timed out waiting for ${JSON.stringify(text(m))}; got ${JSON.stringify(text(this.buf).slice(-120))}`,
    );
  }

  readExactly(n: number, timeoutMs: number): Promise<Uint8Array> {
    return this.wait(
      () => (this.buf.length >= n ? this.take(n) : undefined),
      timeoutMs,
      () => `Timed out waiting for ${n} bytes`,
    );
  }

  /**
   * Read up to (not including) a single terminator byte, handing data to
   * `onChunk` as it arrives. Used to stream program output live.
   */
  streamUntil(terminator: number, onChunk: (s: Uint8Array) => void, timeoutMs = Infinity): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    return this.wait(
      () => {
        const i = this.buf.indexOf(terminator);
        if (i < 0) {
          if (this.buf.length) {
            const chunk = this.take(this.buf.length);
            parts.push(chunk);
            onChunk(chunk);
          }
          return undefined;
        }
        const chunk = this.take(i);
        this.take(1);
        if (chunk.length) {
          parts.push(chunk);
          onChunk(chunk);
        }
        const total = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
        let o = 0;
        for (const p of parts) {
          total.set(p, o);
          o += p.length;
        }
        return total;
      },
      timeoutMs,
      () => 'Timed out waiting for the program to finish',
    );
  }
}
