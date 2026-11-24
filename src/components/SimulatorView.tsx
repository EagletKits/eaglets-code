import { useEffect, useRef, useState } from 'react';
import { ARENA, MAZE_WALLS, OPEN_OBSTACLES, ROBOT_SIZE, type SimRobot, type Gesture } from '../sim/simRobot';

interface Props {
  robot: SimRobot;
  running: boolean;
  advanced: boolean;
}

const SCALE = 2;

export function SimulatorView({ robot, running, advanced }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  const [layout, setLayout] = useState<'open' | 'maze'>('open');

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const c = canvas.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      g.fillStyle = '#f9fbff';
      g.fillRect(0, 0, ARENA.w, ARENA.h);
      g.strokeStyle = '#e1e9f5';
      g.lineWidth = 0.5;
      for (let x = 20; x < ARENA.w; x += 20) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, ARENA.h);
        g.stroke();
      }
      for (let y = 20; y < ARENA.h; y += 20) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(ARENA.w, y);
        g.stroke();
      }
      g.fillStyle = '#0b1633';
      for (const o of robot.obstacles) {
        g.beginPath();
        g.roundRect(o.x, o.y, o.w, o.h, 2);
        g.fill();
      }
      if (robot.trail.length > 1) {
        g.strokeStyle = 'rgba(47,128,237,0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        robot.trail.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
      // Distance beam.
      const d = Math.min(robot.distance(), 400);
      g.save();
      g.translate(robot.x, robot.y);
      g.rotate(robot.heading);
      g.strokeStyle = d < 15 ? 'rgba(255,107,107,0.8)' : 'rgba(255,200,87,0.7)';
      g.setLineDash([2, 2]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -ROBOT_SIZE.h / 2);
      g.lineTo(0, -ROBOT_SIZE.h / 2 - d);
      g.stroke();
      g.setLineDash([]);
      // Body.
      g.fillStyle = '#2f80ed';
      g.beginPath();
      g.roundRect(-ROBOT_SIZE.w / 2, -ROBOT_SIZE.h / 2, ROBOT_SIZE.w, ROBOT_SIZE.h, 3);
      g.fill();
      g.fillStyle = '#0b1633';
      g.fillRect(-ROBOT_SIZE.w / 2 - 3, -4, 3, 9);
      g.fillRect(ROBOT_SIZE.w / 2, -4, 3, 9);
      // LED stick across the front.
      for (let i = 0; i < 8; i++) {
        g.fillStyle = robot.displayLed(i);
        g.beginPath();
        g.arc(-6.3 + i * 1.8, -ROBOT_SIZE.h / 2 + 2.5, 0.9, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffc857';
      g.beginPath();
      g.moveTo(0, -ROBOT_SIZE.h / 2 - 3);
      g.lineTo(-3, -ROBOT_SIZE.h / 2 + 0.5);
      g.lineTo(3, -ROBOT_SIZE.h / 2 + 0.5);
      g.fill();
      g.restore();
      force((n) => (n + 1) % 1000000);
    };
    robot.onChange = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      robot.onChange = null;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [robot]);

  const update = (patch: Partial<SimRobot['inputs']>) => {
    robot.inputs = { ...robot.inputs, ...patch };
    robot.onChange?.();
  };

  const onArenaClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (running) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * ARENA.w;
    const y = ((e.clientY - rect.top) / rect.height) * ARENA.h;
    const hit = robot.obstacles.findIndex((o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h);
    if (hit >= 0) robot.obstacles.splice(hit, 1);
    else if (Math.hypot(x - robot.x, y - robot.y) > 18) robot.obstacles.push({ x: x - 10, y: y - 10, w: 20, h: 20 });
    robot.onChange?.();
  };

  const setArena = (l: 'open' | 'maze') => {
    setLayout(l);
    robot.obstacles = l === 'maze' ? MAZE_WALLS.map((w) => ({ ...w })) : OPEN_OBSTACLES.map((w) => ({ ...w }));
    robot.reset();
  };

  const swipe = (g: Gesture) => robot.swipe(g);
  const inp = robot.inputs;

  return (
    <div className="sim">
      <div className="sim-arena">
        <canvas
          ref={canvas}
          width={ARENA.w * SCALE}
          height={ARENA.h * SCALE}
          onClick={onArenaClick}
          aria-label="Simulated robot arena. Click to add or remove boxes."
        />
        <div className="sim-arena-bar">
          <span className="sim-readout">📏 {Math.round(robot.distance())} cm</span>
          <span className="sim-hint">{running ? 'Running…' : 'Click the floor to add a box'}</span>
          <div className="seg">
            <button className={layout === 'open' ? 'on' : ''} onClick={() => setArena('open')} disabled={running}>
              Open
            </button>
            <button className={layout === 'maze' ? 'on' : ''} onClick={() => setArena('maze')} disabled={running}>
              Maze
            </button>
            <button onClick={() => robot.reset()} disabled={running} title="Put the robot back at the start">
              ↺
            </button>
          </div>
        </div>
      </div>

      <div className="sim-leds" aria-label="LED stick">
        {robot.leds.map((_, i) => (
          <span key={i} className="sim-led" style={{ background: robot.displayLed(i), boxShadow: `0 0 10px ${robot.displayLed(i)}` }} />
        ))}
      </div>

      <div className="sim-controls">
        <label className="sim-row">
          <span>🎛 Dial</span>
          <input type="range" min={0} max={100} value={inp.dial} onChange={(e) => update({ dial: +e.target.value })} />
          <b>{inp.dial}</b>
        </label>
        <label className="sim-row">
          <span>↔ Tilt L/R</span>
          <input type="range" min={-90} max={90} value={inp.tiltLR} onChange={(e) => update({ tiltLR: +e.target.value })} />
          <b>{inp.tiltLR}°</b>
        </label>
        <label className="sim-row">
          <span>↕ Tilt F/B</span>
          <input type="range" min={-90} max={90} value={inp.tiltFB} onChange={(e) => update({ tiltFB: +e.target.value })} />
          <b>{inp.tiltFB}°</b>
        </label>
        <div className="sim-row">
          <span>👋 Swipe</span>
          <div className="sim-buttons">
            <button onClick={() => swipe('left')} aria-label="Swipe left">⬅</button>
            <button onClick={() => swipe('up')} aria-label="Swipe up">⬆</button>
            <button onClick={() => swipe('down')} aria-label="Swipe down">⬇</button>
            <button onClick={() => swipe('right')} aria-label="Swipe right">➡</button>
          </div>
        </div>
        <div className="sim-row">
          <span>🫨 Motion</span>
          <div className="sim-buttons">
            <button onClick={() => robot.shake()}>Shake!</button>
            <button onClick={() => update({ tiltLR: 0, tiltFB: 0 })}>Level</button>
          </div>
        </div>
        <label className="sim-row">
          <span>🎨 Color</span>
          <select value={inp.color} onChange={(e) => update({ color: e.target.value })}>
            {['red', 'yellow', 'green', 'blue', 'purple', 'white', 'black'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={inp.objectNear} onChange={(e) => update({ objectNear: e.target.checked })} /> ✋ near
          </label>
        </label>
        <label className="sim-row">
          <span>☀ Light</span>
          <input type="range" min={0} max={100} value={inp.light} onChange={(e) => update({ light: +e.target.value })} />
          <b>{inp.light}</b>
        </label>
        {advanced && (
          <div className="sim-row">
            <span>More</span>
            <div className="sim-buttons">
              <label className="check">
                <input type="checkbox" checked={inp.lineLeft} onChange={(e) => update({ lineLeft: e.target.checked })} /> line L
              </label>
              <label className="check">
                <input type="checkbox" checked={inp.lineRight} onChange={(e) => update({ lineRight: e.target.checked })} /> line R
              </label>
              <button onClick={() => robot.clap()}>👏</button>
            </div>
          </div>
        )}
      </div>
      <p className="sim-note">Practice robot. Real motors and sensors behave a little differently, so always test on the real robot too.</p>
    </div>
  );
}
