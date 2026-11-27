// Turning printed numbers into plot lines.
import { describe, expect, it } from 'vitest';
import { parsePlot, niceTicks, MAX_SERIES } from '../src/lib/plotData';

describe('plotter', () => {
  it('plots bare numbers by position', () => {
    const p = parsePlot('12\n15\nhello\n9\n');
    expect(p.names).toEqual(['value 1']);
    expect(p.rows).toEqual([[12], [15], [9]]);
  });
  it('names series from "label: value"', () => {
    const p = parsePlot('distance: 30 light=12\ndistance: 25 light=14.5\n');
    expect(p.names).toEqual(['distance', 'light']);
    expect(p.rows).toEqual([
      [30, 12],
      [25, 14.5],
    ]);
  });
  it('keeps negative and decimal numbers', () => {
    expect(parsePlot('-3.5, 2\n').rows).toEqual([[-3.5, 2]]);
  });
  it(`draws at most ${MAX_SERIES} series and says so`, () => {
    const p = parsePlot('1 2 3 4 5 6\n');
    expect(p.names).toHaveLength(MAX_SERIES);
    expect(p.truncated).toBe(true);
  });
  it('keeps only the newest points', () => {
    const p = parsePlot(Array.from({ length: 500 }, (_, i) => String(i)).join('\n'));
    expect(p.rows.length).toBe(120);
    expect(p.rows.at(-1)).toEqual([499]);
  });
});

describe('plot axis', () => {
  it('uses round tick values', () => {
    expect(niceTicks(10, 30)).toEqual([10, 20, 30]);
    expect(niceTicks(0.12, 0.9)).toEqual([0, 0.5, 1]);
    expect(niceTicks(5, 5)).toEqual([4, 5, 6]);
  });
});
