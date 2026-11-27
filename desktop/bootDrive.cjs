'use strict';
// Finding a Pico 2 in BOOTSEL mode (a USB drive called RP2350) and copying
// firmware onto it. Kept apart from main.cjs so it can be tested with plain Node.
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

/** True if `dir` is a Pico 2 (RP2350) waiting for firmware. */
function isPico2Drive(dir) {
  try {
    return /RP2350/.test(fs.readFileSync(path.join(dir, 'INFO_UF2.TXT'), 'utf8'));
  } catch {
    return false;
  }
}

function findBootDrive() {
  return candidateDrives().find(isPico2Drive) ?? null;
}

const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;

function looksLikeUf2(buf) {
  if (!buf.length || buf.length % 512 !== 0 || buf.length > 8 * 1024 * 1024) return false;
  for (let off = 0; off < buf.length; off += 512) {
    if (buf.readUInt32LE(off) !== UF2_MAGIC_START0 || buf.readUInt32LE(off + 4) !== UF2_MAGIC_START1 || buf.readUInt32LE(off + 508) !== UF2_MAGIC_END) return false;
  }
  return true;
}

/**
 * Copy firmware onto the drive. The drive must still be a Pico 2 drive (it is
 * checked again here) and the data must be a UF2 file. The Pico restarts as
 * soon as the copy completes, so an error at the very end, with the drive
 * gone, counts as success.
 */
async function writeFirmware(drive, data) {
  if (typeof drive !== 'string' || !isPico2Drive(drive)) throw new Error('The Pico drive is no longer there. Put the Pico into BOOTSEL mode again.');
  const buf = Buffer.from(data);
  if (!looksLikeUf2(buf)) throw new Error('That isn\'t a firmware file for the Pico.');
  try {
    await fs.promises.writeFile(path.join(drive, 'firmware.uf2'), buf);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1500));
    if (fs.existsSync(drive)) throw e;
  }
}

module.exports = { findBootDrive, writeFirmware, isPico2Drive, looksLikeUf2, candidateDrives };
