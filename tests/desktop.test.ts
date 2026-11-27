import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { choosePort } = createRequire(import.meta.url)('../desktop/ports.cjs') as {
  choosePort: (ports: Array<Record<string, string>>) => { action: string; portId?: string; choices?: Array<{ portId: string; label: string }> };
};
const pico = (id: string, extra = {}) => ({ portId: id, portName: `usbmodem${id}`, displayName: 'Board in FS mode', vendorId: '11914', ...extra });
const other = (id: string) => ({ portId: id, portName: `tty${id}`, displayName: 'USB Serial', vendorId: '1027' });

describe('desktop robot port choice', () => {
  it('uses a single Pico without asking', () => {
    expect(choosePort([other('a'), pico('b')])).toEqual({ action: 'pick', portId: 'b' });
  });
  it('asks when more than one Pico is plugged in, and offers only the Picos', () => {
    const r = choosePort([pico('a'), other('x'), pico('b')]);
    expect(r.action).toBe('ask');
    expect(r.choices?.map((c) => c.portId)).toEqual(['a', 'b']);
  });
  it('still lets the user pick when no port looks like a Pico', () => {
    const r = choosePort([other('x'), other('y')]);
    expect(r.action).toBe('ask');
    expect(r.choices).toHaveLength(2);
  });
  it('says so when nothing is plugged in', () => {
    expect(choosePort([])).toEqual({ action: 'none' });
  });
});
