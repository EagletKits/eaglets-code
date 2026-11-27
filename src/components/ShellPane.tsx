import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ShellResult } from '../robot/connection';
import { needsMore } from '../lib/shellInput';

interface Line {
  kind: 'in' | 'out' | 'err' | 'info';
  text: string;
}

/** Thonny's Shell: type Python, see what the robot says. */
export function ShellPane({
  exec,
  onStop,
  disabled,
  running,
}: {
  /** Runs one entry. Output arrives through `onOutput`. Returns null if it never started. */
  exec: (source: string, onOutput: (text: string) => void) => Promise<ShellResult | null>;
  onStop: () => void;
  disabled: string | null;
  running: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([{ kind: 'info', text: 'Type Python and press Enter to run it on the robot. `robot` is ready to use, and variables stay until the next Run.' }]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const add = (kind: Line['kind'], text: string) =>
    setLines((old) => {
      // Stream output into the last output line instead of one line per chunk.
      const last = old[old.length - 1];
      if (kind === 'out' && last?.kind === 'out') return [...old.slice(0, -1), { kind, text: last.text + text }].slice(-500);
      return [...old, { kind, text }].slice(-500);
    });

  const submit = async (src: string) => {
    if (!src.trim()) return;
    setHistory((h) => (h[h.length - 1] === src ? h : [...h, src].slice(-100)));
    setHistoryAt(null);
    setInput('');
    add('in', src);
    setMine(true);
    try {
      const r = await exec(src, (t) => add('out', t.replace(/\r\n/g, '\n')));
      if (r?.status === 'error') add('err', r.error ?? 'Error');
      if (r?.status === 'stopped') add('info', 'Stopped.');
    } catch (e) {
      add('err', e instanceof Error ? e.message : String(e));
    } finally {
      setMine(false);
      box.current?.focus();
    }
  };

  const busy = running || mine;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'c' && e.ctrlKey && running) {
      e.preventDefault();
      onStop();
      return;
    }
    if (busy) {
      // Read-only while running, but Ctrl+C above still works.
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const value = el.value;
      if (needsMore(value)) {
        e.preventDefault();
        const last = value.split('\n').pop()!;
        const indent = last.match(/^\s*/)![0] + (/:\s*(#.*)?$/.test(last) ? '    ' : '');
        setInput(`${value}\n${indent}`);
        return;
      }
      e.preventDefault();
      void submit(value.replace(/\s+$/, ''));
      return;
    }
    const atTop = !el.value.slice(0, el.selectionStart).includes('\n');
    const atEnd = !el.value.slice(el.selectionEnd).includes('\n');
    if (e.key === 'ArrowUp' && atTop && history.length) {
      e.preventDefault();
      const i = historyAt === null ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(i);
      setInput(history[i]);
    } else if (e.key === 'ArrowDown' && atEnd && historyAt !== null) {
      e.preventDefault();
      const i = historyAt + 1;
      if (i >= history.length) {
        setHistoryAt(null);
        setInput('');
      } else {
        setHistoryAt(i);
        setInput(history[i]);
      }
    }
  };

  return (
    <section className="shell" aria-label="Shell">
      <div className="shell-head">
        <span>Shell</span>
        <button className="link" onClick={() => setLines([])}>
          clear
        </button>
      </div>
      <div className="shell-log" ref={log} aria-live="polite">
        {lines.map((l, i) => (
          <pre key={i} className={`shell-${l.kind}`}>
            {l.kind === 'in' ? l.text.split('\n').map((t, j) => `${j === 0 ? '>>> ' : '... '}${t}`).join('\n') : l.text.replace(/\n$/, '')}
          </pre>
        ))}
      </div>
      <div className="shell-input">
        <span aria-hidden="true">&gt;&gt;&gt;</span>
        <textarea
          ref={box}
          value={input}
          rows={Math.min(6, input.split('\n').length)}
          onChange={(e) => {
            setInput(e.target.value);
            setHistoryAt(null);
          }}
          onKeyDown={onKey}
          disabled={!!disabled}
          readOnly={busy}
          placeholder={disabled ?? (busy ? 'Running… press Stop (or Ctrl+C) to stop it' : 'robot.distance()')}
          aria-label="Shell input"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
      </div>
    </section>
  );
}
