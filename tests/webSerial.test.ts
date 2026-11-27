// Web Serial transport details that can be tested without a real port.
import { describe, expect, it } from 'vitest';
import { WebSerialTransport } from '../src/robot/webSerial';

describe('reopening a robot after it was unplugged', () => {
  const fakePort = (failFirstOpenWith?: string) => {
    const calls: string[] = [];
    let opens = 0;
    const port = {
      readable: null,
      writable: null,
      addEventListener: () => {},
      getInfo: () => ({ usbVendorId: 0x2e8a, usbProductId: 5 }),
      setSignals: async () => {},
      open: async () => {
        calls.push('open');
        if (opens++ === 0 && failFirstOpenWith) throw Object.assign(new Error('The port is already open.'), { name: failFirstOpenWith });
      },
      close: async () => {
        calls.push('close');
      },
    };
    return { port: port as unknown as SerialPort, calls };
  };

  it('closes a port left marked open, then opens it again', async () => {
    const { port, calls } = fakePort('InvalidStateError');
    await new WebSerialTransport(port).open();
    expect(calls).toEqual(['open', 'close', 'open']);
  });
  it('does not retry other failures, like a port busy in Thonny', async () => {
    const { port, calls } = fakePort('NetworkError');
    await expect(new WebSerialTransport(port).open()).rejects.toMatchObject({ name: 'NetworkError' });
    expect(calls).toEqual(['open']);
  });
});
