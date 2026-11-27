/**
 * Installing MicroPython onto a Pico, Thonny-style, using the official
 * firmware shipped inside the app (public/firmware/, fetched by
 * scripts/fetch-micropython.mjs). Nothing is downloaded at install time.
 *
 * The Eaglets V6.2 board uses a Pico 2 (RP2350); the original Pico (RP2040)
 * is supported too. A Pico in "BOOTSEL" mode shows up as a USB drive
 * (RP2350 or RPI-RP2). Copying a .uf2 file onto it flashes it, and the Pico
 * restarts by itself.
 */

export type Chip = 'rp2040' | 'rp2350';

export interface FirmwareBuild {
  chip: Chip;
  board: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface FirmwareManifest {
  version: string;
  date: string;
  builds: FirmwareBuild[];
}

export const BOARD_NAME: Record<Chip, string> = { rp2350: 'Pico 2', rp2040: 'Pico' };

// UF2 format: https://github.com/microsoft/uf2
const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const UF2_FLAG_FAMILY = 0x2000;
export const RP2040 = 0xe48bff56;
export const RP2350_ARM_S = 0xe48bff59;
/** Per chip: the family its code blocks use, and every family its images may contain. */
const FAMILIES: Record<Chip, { main: number; allowed: Set<number> }> = {
  rp2040: { main: RP2040, allowed: new Set([RP2040]) },
  // "Absolute" blocks (0xe48bff57) are a boot-ROM erratum workaround RP2350 images carry.
  rp2350: { main: RP2350_ARM_S, allowed: new Set([0xe48bff57, RP2350_ARM_S, 0xe48bff5a, 0xe48bff5b]) },
};

/** Throws unless every block is a valid UF2 block for this chip, with its code in it. */
export function checkUf2(data: Uint8Array, chip: Chip): void {
  if (data.length === 0 || data.length % 512 !== 0) throw new Error('The firmware file is damaged (wrong size).');
  if (data.length > 8 * 1024 * 1024) throw new Error('The firmware file is too big for a Pico.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fam = FAMILIES[chip];
  const label = chip === 'rp2350' ? 'the Pico 2 (RP2350)' : 'the Pico (RP2040)';
  let main = false;
  for (let off = 0; off < data.length; off += 512) {
    if (view.getUint32(off, true) !== UF2_MAGIC_START0 || view.getUint32(off + 4, true) !== UF2_MAGIC_START1 || view.getUint32(off + 508, true) !== UF2_MAGIC_END) {
      throw new Error('The firmware file is damaged (not a UF2 file).');
    }
    const flags = view.getUint32(off + 8, true);
    const family = view.getUint32(off + 28, true);
    if (!(flags & UF2_FLAG_FAMILY) || !fam.allowed.has(family)) throw new Error(`This firmware is not for ${label}.`);
    if (family === fam.main) main = true;
  }
  if (!main) throw new Error(chip === 'rp2350' ? 'This firmware is not the Arm build for the Pico 2.' : `This firmware is not for ${label}.`);
}

/** Which chip a running board is, from MicroPython's os.uname().machine. */
export function chipFromMachine(machine: string | null | undefined): Chip | null {
  if (!machine) return null;
  if (/RP2350/i.test(machine)) return 'rp2350';
  if (/RP2040/i.test(machine)) return 'rp2040';
  return null;
}

/** Which chip a BOOTSEL drive belongs to, from its INFO_UF2.TXT. */
export function chipFromInfoUf2(text: string): Chip | null {
  if (/RP2350/.test(text)) return 'rp2350';
  if (/RPI-RP2|RP2040/.test(text)) return 'rp2040';
  return null;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What firmware this copy of the app carries, or null if it was built without any. */
export async function loadFirmwareManifest(): Promise<FirmwareManifest | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}firmware/micropython.json`).catch(() => null);
  if (!res?.ok) return null;
  // Web servers that fall back to index.html answer 200 with HTML for a missing file.
  try {
    const m = (await res.json()) as FirmwareManifest;
    return Array.isArray(m?.builds) && m.builds.every((b) => typeof b.file === 'string' && typeof b.sha256 === 'string') ? m : null;
  } catch {
    return null;
  }
}

/** Load one build and check it hasn't been damaged and really is for that chip. */
export async function loadFirmwareData(build: FirmwareBuild): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}firmware/${build.file}`);
  if (!res.ok) throw new Error('The MicroPython firmware is missing from this copy of Eaglets Code.');
  const data = new Uint8Array(await res.arrayBuffer());
  if ((await sha256Hex(data)) !== build.sha256) throw new Error('The MicroPython firmware in this copy of Eaglets Code is damaged. Reinstall the app.');
  checkUf2(data, build.chip);
  return data;
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
 * Browser: the teacher picks the Pico's drive in a folder dialog, then we
 * copy the right firmware onto it. Returns the chip, or null if they cancelled.
 */
export async function flashWithFolderPicker(dataFor: (chip: Chip) => Promise<Uint8Array>): Promise<Chip | null> {
  if (!window.showDirectoryPicker) throw new Error('This browser can\'t copy files to the Pico. Use the Eaglets Code desktop app, or Chrome or Edge.');
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pico-drive' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
  let info = '';
  try {
    info = await (await (await dir.getFileHandle('INFO_UF2.TXT')).getFile()).text();
  } catch {
    /* not a Pico drive */
  }
  const chip = chipFromInfoUf2(info);
  if (!chip) throw new Error(`"${dir.name}" isn't a Pico waiting for MicroPython. Pick the drive called RP2350 (Pico 2) or RPI-RP2 (Pico).`);
  const data = await dataFor(chip);
  const file = await dir.getFileHandle('firmware.uf2', { create: true });
  const w = await file.createWritable();
  await w.write(data as BufferSource);
  try {
    await w.close();
  } catch {
    // The Pico restarts the moment the copy completes, which can make the last step report an error.
  }
  return chip;
}
