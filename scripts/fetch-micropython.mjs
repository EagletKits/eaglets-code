// Downloads the official MicroPython firmware for the Raspberry Pi Pico 2 so
// the app can install it onto robots with no internet (More → Install MicroPython).
//
//   npm run fetch-firmware
//
// Writes public/firmware/<file>.uf2 and public/firmware/micropython.json (shipped
// with the app), and firmware/micropython/LICENSE (for the third-party notices).
// The version is pinned below. The first download records its SHA-256 in
// micropython.json; later downloads must match it exactly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.29.0';
const DATE = '20260824';
const FILE = `RPI_PICO2-${DATE}-v${VERSION}.uf2`;
const URL_UF2 = `https://micropython.org/resources/firmware/${FILE}`;
const URL_LICENSE = `https://raw.githubusercontent.com/micropython/micropython/v${VERSION}/LICENSE`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'firmware');
const INFO = path.join(OUT_DIR, 'micropython.json');
const LICENSE_OUT = path.join(ROOT, 'firmware', 'micropython', 'LICENSE');

const RP2350_ARM_S = 0xe48bff59;
const RP2350_FAMILIES = new Set([0xe48bff57, RP2350_ARM_S, 0xe48bff5a, 0xe48bff5b]);

function checkUf2(buf) {
  if (!buf.length || buf.length % 512) throw new Error(`not a UF2 file (size ${buf.length})`);
  let arm = 0;
  for (let off = 0; off < buf.length; off += 512) {
    if (buf.readUInt32LE(off) !== 0x0a324655 || buf.readUInt32LE(off + 4) !== 0x9e5d5157 || buf.readUInt32LE(off + 508) !== 0x0ab16f30) throw new Error(`bad UF2 block at ${off}`);
    const family = buf.readUInt32LE(off + 28);
    if (!(buf.readUInt32LE(off + 8) & 0x2000) || !RP2350_FAMILIES.has(family)) throw new Error(`block at ${off} is not for the RP2350 (family 0x${family.toString(16)})`);
    if (family === RP2350_ARM_S) arm++;
  }
  if (!arm) throw new Error('no Arm (RP2350_ARM_S) blocks: is this the RISC-V build?');
  return { blocks: buf.length / 512, arm };
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'eaglets-code-build' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const uf2 = await get(URL_UF2);
const { blocks, arm } = checkUf2(uf2);
const sha256 = crypto.createHash('sha256').update(uf2).digest('hex');
const previous = fs.existsSync(INFO) ? JSON.parse(fs.readFileSync(INFO, 'utf8')) : null;
if (previous?.file === FILE && previous.sha256 !== sha256) {
  console.error(`SHA-256 mismatch for ${FILE}: recorded ${previous.sha256}, downloaded ${sha256}. Not replacing it.`);
  process.exit(1);
}
const license = (await get(URL_LICENSE)).toString('utf8');
if (!/The MIT License/.test(license)) throw new Error('MicroPython LICENSE did not look right');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(LICENSE_OUT), { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith('.uf2') && f !== FILE) fs.rmSync(path.join(OUT_DIR, f));
fs.writeFileSync(path.join(OUT_DIR, FILE), uf2);
fs.writeFileSync(INFO, JSON.stringify({ version: VERSION, date: DATE, file: FILE, url: URL_UF2, sha256, bytes: uf2.length }, null, 2) + '\n');
fs.writeFileSync(LICENSE_OUT, license);
console.log(`MicroPython ${VERSION}: ${FILE}, ${uf2.length} bytes, ${blocks} UF2 blocks (${arm} Arm), sha256 ${sha256}`);
