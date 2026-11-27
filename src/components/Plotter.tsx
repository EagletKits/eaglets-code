import { useMemo, useState } from 'react';
import { MAX_SERIES, niceTicks, parsePlot } from '../lib/plotData';

/** Validated categorical slots (dataviz palette, light surface). Fixed order, never cycled. */
const SERIES_COLORS = ['#257de0', '#f47230', '#00b894', '#f2a600'];
const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 10 ? 2 : 1));

/** A small live line chart of numbers the program prints. */
export function Plotter({ text }: { text: string }) {
  const data = useMemo(() => parsePlot(text), [text]);
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const L = 34; // room for y labels
  const R = 46; // room for end labels
  const T = 8;
  const B = 10;

  const all = data.rows.flat().filter((v): v is number => v !== null);
  if (data.rows.length < 2 || !all.length) {
    return <p className="plot-empty">Print numbers in a loop, like print(robot.distance()), and they'll be drawn here.</p>;
  }
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = Math.min(ticks[0], ...all);
  const hi = Math.max(ticks[ticks.length - 1], ...all);
  const n = data.rows.length;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const paths = data.names.map((_, s) => {
    let d = '';
    let pen = false;
    data.rows.forEach((r, i) => {
      const v = r[s];
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });
  const last = data.rows[n - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <figure className="plot" aria-label={`Plot of ${data.names.join(', ')}`}>
      {data.names.length > 1 && (
        <figcaption className="plot-legend">
          {data.names.map((name, s) => (
            <span key={name}>
              <i style={{ background: SERIES_COLORS[s] }} />
              {name}
            </span>
          ))}
        </figcaption>
      )}
      <div className="plot-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="plot-grid" />
              <text x={L - 5} y={y(t)} className="plot-axis" textAnchor="end" dominantBaseline="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {paths.map((d, s) => (
            <path key={s} d={d} fill="none" stroke={SERIES_COLORS[s]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {last.map(
            (v, s) =>
              v !== null && (
                <g key={s}>
                  <circle cx={x(n - 1)} cy={y(v)} r={4} fill={SERIES_COLORS[s]} stroke="#fff" strokeWidth={2} />
                  <text x={x(n - 1) + 8} y={y(v)} className="plot-end" dominantBaseline="middle">
                    {fmt(v)}
                  </text>
                </g>
              ),
          )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="plot-cross" />
              {data.rows[hover].map((v, s) => v !== null && <circle key={s} cx={x(hover)} cy={y(v)} r={4} fill={SERIES_COLORS[s]} stroke="#fff" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="plot-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
            {data.names.map((name, s) => {
              const v = data.rows[hover][s];
              return (
                v !== null && (
                  <div key={name}>
                    <i style={{ background: SERIES_COLORS[s] }} />
                    {data.names.length > 1 && <span>{name} </span>}
                    <b>{fmt(v)}</b>
                  </div>
                )
              );
            })}
          </div>
        )}
      </div>
      {data.truncated && <p className="plot-note">Showing the first {MAX_SERIES} numbers on each line.</p>}
    </figure>
  );
}
