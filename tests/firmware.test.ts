// Installing MicroPython: firmware file checks and the desktop app's BOOTSEL drive handling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { checkUf2, compareVersions, RP2350_ARM_S } from '../src/robot/firmware';

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
    expect(() => checkUf2(uf2([0xe48bff57, RP2350_ARM_S, RP2350_ARM_S]))).not.toThrow();
  });
  it('refuses the RISC-V build, Pico 1 firmware and broken files', () => {
    expect(() => checkUf2(uf2([0xe48bff5a]))).toThrow(/Arm build/);
    expect(() => checkUf2(uf2([0xe48bff56 /* RP2040 */]))).toThrow(/not for the Pico 2/);
    expect(() => checkUf2(new Uint8Array(100))).toThrow(/damaged/);
    const bad = uf2([RP2350_ARM_S]);
    bad[0] = 0;
    expect(() => checkUf2(bad)).toThrow(/damaged/);
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp2350-'));
    fs.writeFileSync(path.join(dir, 'INFO_UF2.TXT'), info);
    return dir;
  };

  it('recognises only RP2350 drives', () => {
    expect(bootDrive.isPico2Drive(fakeDrive('UF2 Bootloader v1.0\nModel: Raspberry Pi RP2350\nBoard-ID: RP2350\n'))).toBe(true);
    expect(bootDrive.isPico2Drive(fakeDrive('Board-ID: RPI-RP2\n'))).toBe(false);
    expect(bootDrive.isPico2Drive(path.join(os.tmpdir(), 'no-such-drive'))).toBe(false);
  });

  it('copies the firmware onto the drive', async () => {
    const dir = fakeDrive('Board-ID: RP2350\n');
    const data = uf2([RP2350_ARM_S, RP2350_ARM_S]);
    await bootDrive.writeFirmware(dir, data);
    expect(new Uint8Array(fs.readFileSync(path.join(dir, 'firmware.uf2')))).toEqual(data);
  });

  it('refuses a drive that is not a Pico, and data that is not firmware', async () => {
    await expect(bootDrive.writeFirmware(os.tmpdir(), uf2([RP2350_ARM_S]))).rejects.toThrow(/BOOTSEL/);
    await expect(bootDrive.writeFirmware(fakeDrive('Board-ID: RP2350'), new Uint8Array(512))).rejects.toThrow(/firmware file/);
  });
});
