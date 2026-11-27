/// <reference types="w3c-web-serial" />
import type { Transport } from './transport';

/** Raspberry Pi's USB vendor ID, used by MicroPython on the Pico and Pico 2. */
export const RPI_USB_VENDOR_ID = 0x2e8a;

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

export class WebSerialTransport implements Transport {
  onData: ((chunk: Uint8Array) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private closing = false;
  private loop: Promise<void> | null = null;
  private disconnected = false;

  constructor(readonly port: SerialPort) {
    port.addEventListener('disconnect', () => this.handleDisconnect());
  }

  get label() {
    const info = this.port.getInfo();
    return info.usbProductId ? `USB ${info.usbVendorId?.toString(16)}:${info.usbProductId.toString(16)}` : 'USB serial';
  }

  async open() {
    this.closing = false;
    this.disconnected = false;
    try {
      await this.port.open({ baudRate: 115200 });
    } catch (e) {
      // A port that was unplugged mid-use can be handed back still marked open.
      // We're its only user, so close it and try once more.
      if ((e as Error)?.name !== 'InvalidStateError') throw e;
      await this.port.close().catch(() => {});
      await this.port.open({ baudRate: 115200 });
    }
    try {
      await this.port.setSignals({ dataTerminalReady: true });
    } catch {
      /* not all platforms allow it; MicroPython works without */
    }
    this.loop = this.readLoop();
  }

  private async readLoop() {
    while (this.port.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && this.onData) this.onData(value);
        }
      } catch {
        break;
      } finally {
        try {
          this.reader.releaseLock();
        } catch {
          /* already released */
        }
        this.reader = null;
      }
    }
    if (!this.closing) this.handleDisconnect();
  }

  private handleDisconnect() {
    if (this.disconnected || this.closing) return;
    this.disconnected = true;
    this.onDisconnect?.();
  }

  async write(data: Uint8Array) {
    if (!this.port.writable) throw new Error('Port is not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async close() {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this.loop;
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* already closed or unplugged */
    }
  }
}

export async function requestRobotPort(showAll = false): Promise<SerialPort> {
  return navigator.serial.requestPort(showAll ? {} : { filters: [{ usbVendorId: RPI_USB_VENDOR_ID }] });
}

/** Ports this site was given permission for earlier (for one-click reconnect). */
export async function knownRobotPorts(): Promise<SerialPort[]> {
  if (!webSerialSupported()) return [];
  const ports = await navigator.serial.getPorts();
  return ports.filter((p) => p.getInfo().usbVendorId === RPI_USB_VENDOR_ID);
}
