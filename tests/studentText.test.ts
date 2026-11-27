// Kid-facing wording for robot messages, and when beginners see the console.
import { describe, expect, it } from 'vitest';
import { programPrinted, studentNotice } from '../src/robot/studentText';

describe('student wording', () => {
  it('hides library file names while the robot is set up', () => {
    expect(studentNotice('Installing eaglets_config.py on the robot…', { autoReconnect: true })).toBe('Getting your robot ready…');
  });
  it('tells students an unplugged robot will come back by itself when it can', () => {
    expect(studentNotice('Your robot was disconnected.', { autoReconnect: true })).toMatch(/reconnect by itself/);
    expect(studentNotice('Your robot was disconnected.', { autoReconnect: false })).toMatch(/click Connect Robot/);
  });
  it('leaves safety messages exactly as written', () => {
    const msg = 'Your robot was unplugged while running. Its motors should stop within 3 seconds. If they don\'t, switch the robot\'s power OFF.';
    expect(studentNotice(msg, { autoReconnect: true })).toBe(msg);
  });
});

describe('console for beginners', () => {
  it('stays hidden when only the practice robot talked', () => {
    expect(programPrinted('')).toBe(false);
    expect(programPrinted('Program running on practice robot\r\nProgram finished\r\n')).toBe(false);
  });
  it('shows when the program printed something', () => {
    expect(programPrinted('Program running on practice robot\r\n42\r\n')).toBe(true);
  });
  it('shows safety messages from the robot library', () => {
    expect(programPrinted('Motors stopped by themselves after 20 seconds (safety limit).\n')).toBe(true);
  });
});
