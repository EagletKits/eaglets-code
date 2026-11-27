// Downloads the official MicroPython firmware for the Raspberry Pi Pico 2
// (the Eaglets V6.2 board) and the original Pico, so the app can install it
// onto robots with no internet (More → Install MicroPython).
//
//   npm run fetch-firmware
//
// Writes public/firmware/<file>.uf2 and public/firmware/micropython.json (shipped
// with the app), and firmware/micropython/LICENSE (for the third-party notices).
// The version is pinned below. The first download records each file's SHA-256
// in micropython.json; later downloads must match it exactly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.29.0';
const DATE = '20260824';
const BUILDS = [
  // RP2350: "absolute" blocks (0xe48bff57) are a boot-ROM erratum workaround the image carries.
  { chip: 'rp2350', board: 'Raspberry Pi Pico 2', id: 'RPI_PICO2', main: 0xe48bff59, allowed: [0xe48bff57, 0xe48bff59, 0xe48bff5a, 0xe48bff5b] },
  { chip: 'rp2040', board: 'Raspberry Pi Pico', id: 'RPI_PICO', main: 0xe48bff56, allowed: [0xe48bff56] },
];
const URL_LICENSE = `https://raw.githubusercontent.com/micropython/micropython/v${VERSION}/LICENSE`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'firmware');
const INFO = path.join(OUT_DIR, 'micropython.json');
const LICENSE_OUT = path.join(ROOT, 'firmware', 'micropython', 'LICENSE');

function checkUf2(buf, build) {
  if (!buf.length || buf.length % 512) throw new Error(`${build.id}: not a UF2 file (size ${buf.length})`);
  let main = 0;
  for (let off = 0; off < buf.length; off += 512) {
    if (buf.readUInt32LE(off) !== 0x0a324655 || buf.readUInt32LE(off + 4) !== 0x9e5d5157 || buf.readUInt32LE(off + 508) !== 0x0ab16f30) throw new Error(`${build.id}: bad UF2 block at ${off}`);
    const family = buf.readUInt32LE(off + 28);
    if (!(buf.readUInt32LE(off + 8) & 0x2000) || !build.allowed.includes(family)) throw new Error(`${build.id}: block at ${off} has the wrong chip family 0x${family.toString(16)}`);
    if (family === build.main) main++;
  }
  if (!main) throw new Error(`${build.id}: no blocks for the ${build.chip} itself`);
  return { blocks: buf.length / 512, main };
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'eaglets-code-build' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const previous = fs.existsSync(INFO) ? JSON.parse(fs.readFileSync(INFO, 'utf8')) : null;
// Older micropython.json files described a single build at the top level.
const known = new Map((previous?.builds ?? (previous?.file ? [previous] : [])).map((b) => [b.file, b.sha256]));

const results = [];
for (const build of BUILDS) {
  const file = `${build.id}-${DATE}-v${VERSION}.uf2`;
  const url = `https://micropython.org/resources/firmware/${file}`;
  const uf2 = await get(url);
  const { blocks, main } = checkUf2(uf2, build);
  const sha256 = crypto.createHash('sha256').update(uf2).digest('hex');
  if (known.has(file) && known.get(file) !== sha256) {
    console.error(`SHA-256 mismatch for ${file}: recorded ${known.get(file)}, downloaded ${sha256}. Not replacing anything.`);
    process.exit(1);
  }
  results.push({ build, file, url, sha256, uf2 });
  console.log(`${build.board}: ${file}, ${uf2.length} bytes, ${blocks} UF2 blocks (${main} for the ${build.chip}), sha256 ${sha256}`);
}

const license = (await get(URL_LICENSE)).toString('utf8');
if (!/The MIT License/.test(license)) throw new Error('MicroPython LICENSE did not look right');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(LICENSE_OUT), { recursive: true });
const keep = new Set(results.map((r) => r.file));
for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith('.uf2') && !keep.has(f)) fs.rmSync(path.join(OUT_DIR, f));
for (const r of results) fs.writeFileSync(path.join(OUT_DIR, r.file), r.uf2);
const info = {
  version: VERSION,
  date: DATE,
  builds: results.map((r) => ({ chip: r.build.chip, board: r.build.board, file: r.file, url: r.url, sha256: r.sha256, bytes: r.uf2.length })),
};
fs.writeFileSync(INFO, JSON.stringify(info, null, 2) + '\n');
fs.writeFileSync(LICENSE_OUT, license);
