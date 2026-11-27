'use strict';
// Finding a Pico in BOOTSEL mode (a USB drive called RP2350 for a Pico 2, or
// RPI-RP2 for the original Pico) and copying firmware onto it. Kept apart from
// main.cjs so it can be tested with plain Node.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Folders where a USB drive might be mounted on this computer. */
function candidateDrives(platform = process.platform) {
  const out = [];
  const list = (dir) => {
    try {
      return fs.readdirSync(dir).map((n) => path.join(dir, n));
    } catch {
      return [];
    }
  };
  if (platform === 'darwin') out.push(...list('/Volumes'));
  else if (platform === 'win32') for (let c = 68; c <= 90; c++) out.push(`${String.fromCharCode(c)}:\\`);
  else {
    const user = os.userInfo().username;
    out.push(...list(`/media/${user}`), ...list(`/run/media/${user}`), ...list('/media'));
  }
  // Tests point this at a pretend drive.
  if (process.env.EAGLETS_FAKE_BOOT_DRIVE) out.unshift(process.env.EAGLETS_FAKE_BOOT_DRIVE);
  return out;
}

/** 'rp2350' or 'rp2040' if `dir` is a Pico waiting for firmware, otherwise null. */
function driveChip(dir) {
  let info;
  try {
    info = fs.readFileSync(path.join(dir, 'INFO_UF2.TXT'), 'utf8');
  } catch {
    return null;
  }
  if (/RP2350/.test(info)) return 'rp2350';
  if (/RPI-RP2|RP2040/.test(info)) return 'rp2040';
  return null;
}

function findBootDrive() {
  for (const drive of candidateDrives()) {
    const chip = driveChip(drive);
    if (chip) return { drive, chip };
  }
  return null;
}

const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const FAMILIES = {
  rp2040: [0xe48bff56],
  rp2350: [0xe48bff57, 0xe48bff59, 0xe48bff5a, 0xe48bff5b],
};

/** True if `buf` is a UF2 file whose every block is for `chip`. */
function isUf2For(buf, chip) {
  const allowed = FAMILIES[chip];
  if (!allowed || !buf.length || buf.length % 512 !== 0 || buf.length > 8 * 1024 * 1024) return false;
  for (let off = 0; off < buf.length; off += 512) {
    if (buf.readUInt32LE(off) !== UF2_MAGIC_START0 || buf.readUInt32LE(off + 4) !== UF2_MAGIC_START1 || buf.readUInt32LE(off + 508) !== UF2_MAGIC_END) return false;
    if (!allowed.includes(buf.readUInt32LE(off + 28))) return false;
  }
  return true;
}

/**
 * Copy firmware onto the drive. The drive must still be a Pico drive (checked
 * again here) and the data must be a UF2 file for that Pico's chip. The Pico
 * restarts as soon as the copy completes, so an error at the very end, with
 * the drive gone, counts as success.
 */
async function writeFirmware(drive, data) {
  const chip = typeof drive === 'string' ? driveChip(drive) : null;
  if (!chip) throw new Error('The Pico drive is no longer there. Put the Pico into BOOTSEL mode again.');
  const buf = Buffer.from(data);
  if (!isUf2For(buf, chip)) throw new Error(`That isn't a firmware file for this ${chip === 'rp2350' ? 'Pico 2' : 'Pico'}.`);
  try {
    await fs.promises.writeFile(path.join(drive, 'firmware.uf2'), buf);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1500));
    if (fs.existsSync(drive)) throw e;
  }
}

module.exports = { findBootDrive, writeFirmware, driveChip, isUf2For, candidateDrives };
