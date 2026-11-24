import * as Blockly from 'blockly/core';
import { SOUND_BLOCKS } from './definitions';

export interface ProgramProblem {
  blockId?: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Find problems a student can fix before running. Errors block Run; warnings don't. */
export function checkProgram(workspace: Blockly.Workspace, opts: { buzzerEnabled: boolean }): ProgramProblem[] {
  const problems: ProgramProblem[] = [];
  const tops = workspace.getTopBlocks(true);
  const starts = tops.filter((b) => b.type === 'eaglets_when_start');

  if (starts.length === 0) {
    problems.push({
      severity: 'error',
      message: 'Add a "when program starts" block from Start, then snap your blocks under it.',
    });
  } else if (starts.length > 1) {
    problems.push({
      blockId: starts[1].id,
      severity: 'error',
      message: 'Your program has more than one "when program starts" block. Keep just one.',
    });
  } else if (!starts[0].getNextBlock()) {
    problems.push({
      blockId: starts[0].id,
      severity: 'error',
      message: 'Snap some blocks under "when program starts" so the robot has something to do.',
    });
  }

  for (const block of workspace.getAllBlocks(false)) {
    if (!block.isEnabled() || block.isShadow()) continue;
    // Skip loose stacks that aren't part of the program; they are greyed out and never run.
    const root = block.getRootBlock();
    if (root.type !== 'eaglets_when_start' && !root.type.startsWith('procedures_def')) continue;

    for (const input of block.inputList) {
      if (input.type === Blockly.inputs.inputTypes.VALUE && input.isVisible() && !input.connection?.targetBlock()) {
        problems.push({ blockId: block.id, severity: 'error', message: 'This block needs a value. Drag one into the empty slot.' });
        break;
      }
    }
    if (SOUND_BLOCKS.has(block.type) && !opts.buzzerEnabled) {
      problems.push({
        blockId: block.id,
        severity: 'error',
        message: 'This robot has no buzzer set up, so sound blocks can\'t run. Ask an instructor.',
      });
    }
  }

  const loose = tops.filter(
    (b) => b.type !== 'eaglets_when_start' && !b.type.startsWith('procedures_def') && !b.isShadow(),
  );
  if (loose.length > 0 && starts.length > 0) {
    problems.push({
      blockId: loose[0].id,
      severity: 'warning',
      message: 'Some blocks aren\'t connected to "when program starts", so they won\'t run.',
    });
  }
  return problems;
}
