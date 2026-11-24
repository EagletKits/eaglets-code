import * as Blockly from 'blockly/core';
import { COLORS } from './definitions';

let theme: Blockly.Theme | null = null;

export function eagletsTheme(): Blockly.Theme {
  if (theme) return theme;
  theme = Blockly.Theme.defineTheme('eaglets', {
    name: 'eaglets',
    base: Blockly.Themes.Classic,
    blockStyles: {
      logic_blocks: { colourPrimary: COLORS.logic, colourSecondary: '#5cc184', colourTertiary: '#178a49' },
      loop_blocks: { colourPrimary: COLORS.loops, colourSecondary: '#ffad4d', colourTertiary: '#d97400' },
      math_blocks: { colourPrimary: COLORS.math, colourSecondary: '#8790e6', colourTertiary: '#4350bd' },
      text_blocks: { colourPrimary: COLORS.math, colourSecondary: '#8790e6', colourTertiary: '#4350bd' },
      variable_blocks: { colourPrimary: COLORS.variables, colourSecondary: '#f47c7c', colourTertiary: '#c92f2f' },
      variable_dynamic_blocks: { colourPrimary: COLORS.variables, colourSecondary: '#f47c7c', colourTertiary: '#c92f2f' },
      procedure_blocks: { colourPrimary: COLORS.functions, colourSecondary: '#d561e0', colourTertiary: '#9d1cac' },
    },
    categoryStyles: {},
    componentStyles: {
      workspaceBackgroundColour: '#f4f8fd',
      toolboxBackgroundColour: '#ffffff',
      toolboxForegroundColour: '#0b1633',
      flyoutBackgroundColour: '#e8f1fc',
      flyoutForegroundColour: '#0b1633',
      flyoutOpacity: 1,
      scrollbarColour: '#9fb3cf',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#0b1633',
      insertionMarkerOpacity: 0.25,
      cursorColour: '#2f80ed',
    },
    fontStyle: { family: '"Inter Variable", Inter, system-ui, sans-serif', weight: '700', size: 12 },
    startHats: true,
  });
  return theme;
}
