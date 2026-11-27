// Installing MicroPython: firmware file checks and the desktop app's BOOTSEL drive handling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { checkUf2, chipFromInfoUf2, chipFromMachine, compareVersions, RP2040, RP2350_ARM_S } from '../src/robot/firmware';

const require = createRequire(import.meta.url);
const bootDrive = require('../desktop/bootDrive.cjs');

/** A UF2 file made of the given family IDs, one block each. */
function uf2(families: number[]): Uint8Array {
  const buf = new Uint8Array(512 * families.length);
  const v = new DataView(buf.buffer);
  families.forEach((fam, i) => {
    const o = i * 512;
    v.setUint32(o, 0x0a324655, true);
    v.setUint32(o + 4, 0x9e5d5157, true);
    v.setUint32(o + 8, 0x2000, true);
    v.setUint32(o + 28, fam, true);
    v.setUint32(o + 508, 0x0ab16f30, true);
  });
  return buf;
}

describe('MicroPython firmware file checks', () => {
  it('accepts a Pico 2 Arm image, including its "absolute" erratum block', () => {
    expect(() => checkUf2(uf2([0xe48bff57, RP2350_ARM_S, RP2350_ARM_S]), 'rp2350')).not.toThrow();
  });
  it('accepts an original Pico image', () => {
    expect(() => checkUf2(uf2([RP2040, RP2040]), 'rp2040')).not.toThrow();
  });
  it('never sends one chip the other chip\'s firmware', () => {
    expect(() => checkUf2(uf2([RP2040]), 'rp2350')).toThrow(/not for the Pico 2/);
    expect(() => checkUf2(uf2([0xe48bff57, RP2350_ARM_S]), 'rp2040')).toThrow(/not for the Pico \(RP2040\)/);
  });
  it('refuses the RISC-V build and broken files', () => {
    expect(() => checkUf2(uf2([0xe48bff5a]), 'rp2350')).toThrow(/Arm build/);
    expect(() => checkUf2(new Uint8Array(100), 'rp2350')).toThrow(/damaged/);
    const bad = uf2([RP2350_ARM_S]);
    bad[0] = 0;
    expect(() => checkUf2(bad, 'rp2350')).toThrow(/damaged/);
  });
  it('tells the chips apart from the running board and from the BOOTSEL drive', () => {
    expect(chipFromMachine('Raspberry Pi Pico 2 with RP2350')).toBe('rp2350');
    expect(chipFromMachine('Raspberry Pi Pico with RP2040')).toBe('rp2040');
    expect(chipFromMachine('ESP32 module')).toBe(null);
    expect(chipFromInfoUf2('UF2 Bootloader v1.0\nModel: Raspberry Pi RP2350\nBoard-ID: RP2350\n')).toBe('rp2350');
    expect(chipFromInfoUf2('UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n')).toBe('rp2040');
    expect(chipFromInfoUf2('Board-ID: SAMD21')).toBe(null);
  });
  it('compares MicroPython versions', () => {
    expect(compareVersions('1.24.1', '1.29.0')).toBeLessThan(0);
    expect(compareVersions('1.29.0', '1.29.0')).toBe(0);
    expect(compareVersions('1.30.0-preview.12', '1.29.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.29', '1.29.0')).toBe(0);
    expect(compareVersions('garbage', '1.29.0')).toBeLessThan(0);
  });
});

describe('desktop: finding and flashing a Pico in BOOTSEL mode', () => {
  const fakeDrive = (info: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pico-drive-'));
    fs.writeFileSync(path.join(dir, 'INFO_UF2.TXT'), info);
    return dir;
  };

  it('recognises Pico 2 and Pico drives, and nothing else', () => {
    expect(bootDrive.driveChip(fakeDrive('Model: Raspberry Pi RP2350\nBoard-ID: RP2350\n'))).toBe('rp2350');
    expect(bootDrive.driveChip(fakeDrive('Model: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n'))).toBe('rp2040');
    expect(bootDrive.driveChip(fakeDrive('Board-ID: SAMD21\n'))).toBe(null);
    expect(bootDrive.driveChip(path.join(os.tmpdir(), 'no-such-drive'))).toBe(null);
  });

  it('copies the firmware onto the drive', async () => {
    const dir = fakeDrive('Board-ID: RP2350\n');
    const data = uf2([RP2350_ARM_S, RP2350_ARM_S]);
    await bootDrive.writeFirmware(dir, data);
    expect(new Uint8Array(fs.readFileSync(path.join(dir, 'firmware.uf2')))).toEqual(data);
  });

  it('refuses a drive that is not a Pico, and firmware for the other chip', async () => {
    await expect(bootDrive.writeFirmware(os.tmpdir(), uf2([RP2350_ARM_S]))).rejects.toThrow(/BOOTSEL/);
    await expect(bootDrive.writeFirmware(fakeDrive('Board-ID: RP2350'), new Uint8Array(512))).rejects.toThrow(/firmware file/);
    await expect(bootDrive.writeFirmware(fakeDrive('Board-ID: RPI-RP2'), uf2([RP2350_ARM_S]))).rejects.toThrow(/firmware file for this Pico/);
  });
});
