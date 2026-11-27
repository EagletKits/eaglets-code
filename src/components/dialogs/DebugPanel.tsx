import { useEffect, useRef, useState } from 'react';
import { clock, debugReport, type DebugFacts, type LogEntry } from '../../lib/debugLog';
import { downloadText } from '../../projects/projectFile';

/** Teacher-only panel: what the app knows about the robot, and a log of what it did. */
export function DebugPanel({ log, facts, onClear, onTurnOff }: { log: LogEntry[]; facts: DebugFacts; onClear: () => void; onTurnOff: () => void }) {
  const [copied, setCopied] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const copy = async () => {
    const text = debugReport(facts, log);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      downloadText('eaglets-debug-report.txt', text, 'text/plain');
      setCopied('Saved to Downloads');
    }
    setTimeout(() => setCopied(''), 2500);
  };

  return (
    <section className="card debug-panel" aria-label="Teacher debug">
      <div className="debug-head">
        <b>Teacher debug</b>
        <button className="link" onClick={onTurnOff}>
          turn off
        </button>
      </div>
      <dl className="debug-facts">
        <dt>Robot</dt>
        <dd>{facts.robotState}</dd>
        <dt>Board</dt>
        <dd>{facts.board || '—'}</dd>
        <dt>Port</dt>
        <dd>{facts.port || '—'}</dd>
        <dt>App</dt>
        <dd>
          {facts.version} · {facts.shell}
          {facts.mock ? ' · mock' : ''} · USB {facts.webSerial ? 'yes' : 'no'}
        </dd>
      </dl>
      <ol className="debug-log" ref={list}>
        {log.length === 0 && <li className="debug-empty">Nothing logged yet.</li>}
        {log.map((e, i) => (
          <li key={i} className={`log-${e.kind}`}>
            <time>{clock(e.t)}</time> {e.text}
          </li>
        ))}
      </ol>
      <div className="debug-actions">
        <button className="btn btn-sm" onClick={() => void copy()}>
          {copied || 'Copy report'}
        </button>
        <button className="btn btn-sm" onClick={onClear}>
          Clear log
        </button>
      </div>
    </section>
  );
}
