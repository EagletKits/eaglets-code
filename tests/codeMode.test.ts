// Code mode: Shell line continuation and pointing at the line a program failed on.
import { describe, expect, it } from 'vitest';
import { needsMore } from '../src/lib/shellInput';
import { errorLine, translateTraceback } from '../src/robot/friendlyErrors';

describe('shell entry', () => {
  it('asks for more after a colon, like the >>> prompt', () => {
    expect(needsMore('for i in range(3):')).toBe(true);
    expect(needsMore('if x:  # comment')).toBe(true);
    expect(needsMore('for i in range(3):\n    print(i)')).toBe(true);
    expect(needsMore('for i in range(3):\n    print(i)\n')).toBe(false);
    expect(needsMore('print(1)')).toBe(false);
  });
});

describe('errors in hand-written code', () => {
  const tb = 'Traceback (most recent call last):\n  File "<stdin>", line 7, in <module>\n  File "eaglets.py", line 300, in forward\nValueError: bad speed';
  it('finds the line in the student\'s program, not in the library', () => {
    expect(errorLine(tb)).toBe(7);
    expect(errorLine('Traceback:\n  File "<stdin>", line 2\n  File "<stdin>", line 9, in f\nNameError')).toBe(9);
    expect(errorLine('no traceback')).toBe(null);
  });
  it('blames a typo on the code, not on Eaglets Code', () => {
    const syntax = 'Traceback (most recent call last):\n  File "<stdin>", line 3\nSyntaxError: invalid syntax';
    expect(translateTraceback(syntax, { handWritten: true })!.message).toMatch(/can't read this line \(invalid syntax\)/);
    expect(translateTraceback(syntax)!.message).toMatch(/tell an instructor/);
  });
});
