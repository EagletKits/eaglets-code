import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Blockly from 'blockly/core';
import { registerBlocks } from '../blocks/definitions';
import { buildToolbox, type ToolboxOptions } from '../blocks/toolbox';
import { eagletsTheme } from '../blocks/theme';

export interface WorkspaceHandle {
  workspace: () => Blockly.WorkspaceSvg | null;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  cleanUp: () => void;
  highlight: (id: string | null) => void;
  showProblem: (blockId: string | undefined, message: string) => void;
  clearProblems: () => void;
}

interface Props extends ToolboxOptions {
  onChange: () => void;
}

export const BlocklyWorkspace = forwardRef<WorkspaceHandle, Props>(function BlocklyWorkspace(
  { beginner, buzzerEnabled, onChange },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const warned = useRef<Set<string>>(new Set());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    registerBlocks();
    const workspace = Blockly.inject(host.current!, {
      toolbox: buildToolbox({ beginner, buzzerEnabled }),
      theme: eagletsTheme(),
      renderer: 'zelos',
      // Local copy (see vite.config.ts); the default is Blockly's CDN.
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      trashcan: true,
      sounds: false,
      move: { scrollbars: true, drag: true, wheel: false },
      zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15, pinch: true },
      grid: { spacing: 28, length: 3, colour: '#dbe5f2', snap: true },
    });
    ws.current = workspace;
    workspace.addChangeListener(Blockly.Events.disableOrphans);
    workspace.addChangeListener((e) => {
      if (e.isUiEvent) return;
      onChangeRef.current();
    });
    const resize = new ResizeObserver(() => Blockly.svgResize(workspace));
    resize.observe(host.current!);
    return () => {
      resize.disconnect();
      workspace.dispose();
      ws.current = null;
    };
    // The workspace is created once; toolbox changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ws.current?.updateToolbox(buildToolbox({ beginner, buzzerEnabled }));
  }, [beginner, buzzerEnabled]);

  useImperativeHandle(ref, () => ({
    workspace: () => ws.current,
    undo: () => ws.current?.undo(false),
    redo: () => ws.current?.undo(true),
    clear: () => ws.current?.clear(),
    cleanUp: () => ws.current?.cleanUp(),
    highlight: (id) => ws.current?.highlightBlock(id),
    showProblem: (blockId, message) => {
      const w = ws.current;
      if (!w || !blockId) return;
      const block = w.getBlockById(blockId);
      if (!block) return;
      block.setWarningText(message);
      warned.current.add(blockId);
      w.centerOnBlock(blockId);
      block.select();
    },
    clearProblems: () => {
      const w = ws.current;
      if (!w) return;
      for (const id of warned.current) w.getBlockById(id)?.setWarningText(null);
      warned.current.clear();
    },
  }));

  return <div ref={host} className="blockly-host" data-testid="blockly" />;
});
