/**
 * Teacher debug log. Events are always recorded (it's cheap), so switching
 * debug mode on after something goes wrong still shows what led up to it.
 */

export type LogKind = 'state' | 'info' | 'warning' | 'error' | 'action';

export interface LogEntry {
  t: number;
  kind: LogKind;
  text: string;
}

export const LOG_LIMIT = 300;

export function appendLog(log: LogEntry[], kind: LogKind, text: string, t = Date.now()): LogEntry[] {
  const next = log.length >= LOG_LIMIT ? log.slice(log.length - LOG_LIMIT + 1) : log.slice();
  next.push({ t, kind, text });
  return next;
}

export const clock = (t: number) => {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

export interface DebugFacts {
  version: string;
  shell: string;
  userAgent: string;
  webSerial: boolean;
  mock: boolean;
  robotState: string;
  board: string;
  port: string;
  mode: string;
  beginner: boolean;
  config: unknown;
}

/** Plain-text report a teacher can paste into a message. */
export function debugReport(facts: DebugFacts, log: LogEntry[]): string {
  const lines = [
    `Eaglets Code ${facts.version} debug report (${new Date().toISOString()})`,
    `App: ${facts.shell}${facts.mock ? ' · practice robot (mock)' : ''}`,
    `Browser: ${facts.userAgent}`,
    `USB (Web Serial): ${facts.webSerial ? 'available' : 'not available'}`,
    `Robot: ${facts.robotState}${facts.board ? ` · ${facts.board}` : ''}${facts.port ? ` · ${facts.port}` : ''}`,
    `Editor: ${facts.mode}, beginner mode ${facts.beginner ? 'on' : 'off'}`,
    `Settings: ${JSON.stringify(facts.config)}`,
    '',
    `Log (${log.length} events):`,
    ...log.map((e) => `${clock(e.t)} [${e.kind}] ${e.text}`),
  ];
  return lines.join('\n');
}
