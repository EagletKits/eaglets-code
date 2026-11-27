// The teacher debug log and the report it copies.
import { describe, expect, it } from 'vitest';
import { appendLog, debugReport, LOG_LIMIT, type LogEntry } from '../src/lib/debugLog';

describe('teacher debug log', () => {
  it('keeps only the newest events', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < LOG_LIMIT + 25; i++) log = appendLog(log, 'info', `event ${i}`, i);
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0].text).toBe('event 25');
    expect(log.at(-1)!.text).toBe(`event ${LOG_LIMIT + 24}`);
  });
  it('writes a report with the robot, settings and every event', () => {
    const log = appendLog(appendLog([], 'action', 'Connect: Run pressed', 0), 'error', 'Connect failed: NetworkError: Failed to open', 1);
    const report = debugReport(
      { version: '1.0.0', shell: 'browser', userAgent: 'UA', webSerial: true, mock: false, robotState: 'disconnected', board: '', port: '', mode: 'blocks', beginner: true, config: { maxMotorPower: 80 } },
      log,
    );
    expect(report).toContain('Eaglets Code 1.0.0');
    expect(report).toContain('"maxMotorPower":80');
    expect(report).toContain('[action] Connect: Run pressed');
    expect(report).toContain('[error] Connect failed: NetworkError: Failed to open');
  });
});
