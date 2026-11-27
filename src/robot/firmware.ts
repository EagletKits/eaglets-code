/**
 * Installing MicroPython onto a Pico 2, Thonny-style, using the official
 * firmware shipped inside the app (public/firmware/, fetched by
 * scripts/fetch-micropython.mjs). Nothing is downloaded at install time.
 *
 * A Pico in "BOOTSEL" mode shows up as a USB drive called RP2350. Copying a
 * .uf2 file onto that drive flashes it, and the Pico restarts by itself.
 */

export interface BundledFirmware {
  version: string;
  date: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

// UF2 format: https://github.com/microsoft/uf2
const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const UF2_FLAG_FAMILY = 0x2000;
/** RP2350 family IDs. "Absolute" blocks are a boot-ROM erratum workaround that RP2350 images carry. */
export const RP2350_ARM_S = 0xe48bff59;
const RP2350_FAMILIES = new Set([0xe48bff57 /* absolute */, RP2350_ARM_S, 0xe48bff5a /* RISC-V */, 0xe48bff5b /* ARM non-secure */]);

/** Throws unless every block is a valid UF2 block for the RP2350, with Arm code in it. */
export function checkUf2(data: Uint8Array): void {
  if (data.length === 0 || data.length % 512 !== 0) throw new Error('The firmware file is damaged (wrong size).');
  if (data.length > 8 * 1024 * 1024) throw new Error('The firmware file is too big for a Pico 2.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let arm = false;
  for (let off = 0; off < data.length; off += 512) {
    if (view.getUint32(off, true) !== UF2_MAGIC_START0 || view.getUint32(off + 4, true) !== UF2_MAGIC_START1 || view.getUint32(off + 508, true) !== UF2_MAGIC_END) {
      throw new Error('The firmware file is damaged (not a UF2 file).');
    }
    const flags = view.getUint32(off + 8, true);
    const family = view.getUint32(off + 28, true);
    if (!(flags & UF2_FLAG_FAMILY) || !RP2350_FAMILIES.has(family)) throw new Error('This firmware is not for the Pico 2 (RP2350).');
    if (family === RP2350_ARM_S) arm = true;
  }
  if (!arm) throw new Error('This firmware is not the Arm build for the Pico 2.');
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Load the firmware that ships with the app, and check it hasn't been damaged. */
export async function loadBundledFirmware(): Promise<{ info: BundledFirmware; data: Uint8Array } | null> {
  const base = import.meta.env.BASE_URL;
  const infoRes = await fetch(`${base}firmware/micropython.json`).catch(() => null);
  if (!infoRes?.ok) return null;
  // Web servers that fall back to index.html answer 200 with HTML for a missing file.
  let info: BundledFirmware;
  try {
    info = (await infoRes.json()) as BundledFirmware;
  } catch {
    return null;
  }
  if (typeof info?.file !== 'string' || typeof info.sha256 !== 'string') return null;
  const res = await fetch(`${base}firmware/${info.file}`);
  if (!res.ok) throw new Error('The MicroPython firmware is missing from this copy of Eaglets Code.');
  const data = new Uint8Array(await res.arrayBuffer());
  if ((await sha256Hex(data)) !== info.sha256) throw new Error('The MicroPython firmware in this copy of Eaglets Code is damaged. Reinstall the app.');
  checkUf2(data);
  return { info, data };
}

/** "1.29.0" style versions. Negative if a < b. Unknown or preview versions sort as older. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (v.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/)?.slice(1, 4) ?? []).map((n) => Number(n ?? 0));
  const [x, y] = [parse(a), parse(b)];
  if (!x.length) return -1;
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Desktop app: the main process finds the drive and copies the file (desktop/main.cjs). */
export const desktopFlashing = () => typeof window !== 'undefined' && !!window.eagletsDesktop;

/**
 * Browser: the teacher picks the RP2350 drive in a folder dialog, then we
 * copy the firmware onto it. Returns false if they cancelled.
 */
export async function flashWithFolderPicker(data: Uint8Array): Promise<boolean> {
  if (!window.showDirectoryPicker) throw new Error('This browser can\'t copy files to the Pico. Use the Eaglets Code desktop app, or Chrome or Edge.');
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pico-drive' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    throw e;
  }
  let info = '';
  try {
    info = await (await (await dir.getFileHandle('INFO_UF2.TXT')).getFile()).text();
  } catch {
    /* not a Pico drive */
  }
  if (!/RP2350/.test(info)) throw new Error(`"${dir.name}" isn't a Pico 2 waiting for MicroPython. Pick the drive called RP2350.`);
  const file = await dir.getFileHandle('firmware.uf2', { create: true });
  const w = await file.createWritable();
  await w.write(data as BufferSource);
  try {
    await w.close();
  } catch {
    // The Pico restarts the moment the copy completes, which can make the last step report an error.
  }
  return true;
}
