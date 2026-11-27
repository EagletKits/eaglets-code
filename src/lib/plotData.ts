/** Turning printed program output into plot data (used by Plotter.tsx). */

/** At most this many lines are drawn: one per validated series colour. */
export const MAX_SERIES = 4;
const MAX_POINTS = 120;

export interface PlotData {
  names: string[];
  /** rows[i][s] is series s at sample i (null if that line didn't have it). */
  rows: Array<Array<number | null>>;
  /** More numbers per line than we draw. */
  truncated: boolean;
}

const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;
const PAIR = new RegExp(String.raw`([A-Za-z_][\w ]*?)\s*[:=]\s*(${NUM})|(${NUM})`, 'g');

/**
 * Like Thonny's plotter: every printed line with numbers in it is one sample.
 * "distance: 23" makes a series called distance; bare numbers are numbered by position.
 */
export function parsePlot(text: string): PlotData {
  const names: string[] = [];
  const rows: Array<Array<number | null>> = [];
  let truncated = false;
  for (const line of text.split(/\r?\n/)) {
    const values = new Map<string, number>();
    let pos = 0;
    for (const m of line.matchAll(PAIR)) {
      const name = m[1] ? m[1].trim() : `value ${++pos}`;
      const v = Number(m[2] ?? m[3]);
      if (Number.isFinite(v) && !values.has(name)) values.set(name, v);
    }
    if (!values.size) continue;
    for (const name of values.keys()) {
      if (names.includes(name)) continue;
      if (names.length < MAX_SERIES) names.push(name);
      else truncated = true;
    }
    rows.push(names.map((n) => values.get(n) ?? null));
  }
  return { names, rows: rows.slice(-MAX_POINTS).map((r) => names.map((_, i) => r[i] ?? null)), truncated };
}


/** Round tick values (1, 2 or 5 times a power of ten) covering lo..hi, about three of them. */
export function niceTicks(lo: number, hi: number): number[] {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  const end = Math.ceil(hi / step - 1e-9) * step;
  for (let t = Math.floor(lo / step + 1e-9) * step; t <= end + step * 1e-9; t += step) out.push(Number(t.toFixed(10)));
  return out;
}
