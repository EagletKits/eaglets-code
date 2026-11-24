import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { registerBlocks } from '../src/blocks/definitions';
import { installPythonGenerators } from '../src/generators/python';

export const ROOT = resolve(__dirname, '..');

export function setupBlockly() {
  registerBlocks();
  installPythonGenerators();
}

export function workspaceFrom(state: object) {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, ws);
  return ws;
}

/** Find mpy-cross (the real MicroPython compiler). Run `npm run setup:python` to install it. */
export function findMpyCross(): string | null {
  const local = join(ROOT, '.venv', 'bin', 'mpy-cross');
  if (existsSync(local)) return local;
  const r = spawnSync('which', ['mpy-cross'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Compile Python with MicroPython's compiler. Returns null on success, or the error text. */
export function mpyCompile(mpyCross: string, code: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'eaglets-mpy-'));
  const file = join(dir, 'program.py');
  writeFileSync(file, code);
  const r = spawnSync(mpyCross, ['-o', join(dir, 'program.mpy'), file], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || r.stdout || 'mpy-cross failed');
}

export interface FakeRunReport {
  ok: boolean;
  error_type: string | null;
  error: string | null;
  stdout: string;
  virtual_seconds: number;
  final: { motor_sleep: number; motor_duty: Record<string, number>; leds: number[][]; timers_running: number };
  max_motor_duty: number;
  led_frames: number[][][];
}

/** Run a program against the fake hardware in firmware/tests (MOCK HARDWARE ONLY). */
export function runOnFakeRobot(code: string, scenario: object = {}): FakeRunReport {
  const dir = mkdtempSync(join(tmpdir(), 'eaglets-run-'));
  const prog = join(dir, 'program.py');
  const sc = join(dir, 'scenario.json');
  writeFileSync(prog, code);
  writeFileSync(sc, JSON.stringify(scenario));
  const out = execFileSync('python3', [join(ROOT, 'firmware', 'tests', 'run_program.py'), prog, sc], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('@@REPORT@@'));
  if (!line) throw new Error(`No report from fake robot:\n${out}`);
  return JSON.parse(line.slice('@@REPORT@@'.length));
}
