import * as Blockly from 'blockly/core';

export const PROJECT_FORMAT = 'eaglets-code-project';
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  savedAt: string;
  workspace: Record<string, unknown>;
}

export class ProjectError extends Error {}

export function serializeProject(workspace: Blockly.Workspace, name: string): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: name.trim() || 'My robot program',
    savedAt: new Date().toISOString(),
    workspace: Blockly.serialization.workspaces.save(workspace) as Record<string, unknown>,
  };
}

function collectTypes(node: unknown, out: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypes(n, out));
    return;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.type === 'string') out.add(o.type);
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'type') collectTypes(v, out);
  }
}

/** Parse and check a project file's text. Throws ProjectError with a friendly message. */
export function parseProject(text: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectError('This file isn\'t an Eaglets Code project. Projects end in .eaglets.');
  }
  const p = data as Partial<ProjectFile>;
  if (!p || p.format !== PROJECT_FORMAT || typeof p.workspace !== 'object' || p.workspace === null) {
    throw new ProjectError('This file isn\'t an Eaglets Code project. Projects end in .eaglets.');
  }
  if (typeof p.version !== 'number' || p.version > PROJECT_VERSION) {
    throw new ProjectError('This project was made with a newer version of Eaglets Code. Ask an instructor to update.');
  }
  const blocks = (p.workspace as Record<string, unknown>).blocks;
  const types = new Set<string>();
  collectTypes(blocks, types);
  const unknown = [...types].filter((t) => !Blockly.Blocks[t]);
  if (unknown.length) {
    throw new ProjectError(`This project uses blocks this version doesn't have (${unknown.slice(0, 3).join(', ')}).`);
  }
  return { format: PROJECT_FORMAT, version: p.version, name: String(p.name ?? 'My robot program'), savedAt: String(p.savedAt ?? ''), workspace: p.workspace as Record<string, unknown> };
}

/** Replace the workspace contents with a project. Leaves the old contents if loading fails. */
export function loadIntoWorkspace(workspace: Blockly.Workspace, state: Record<string, unknown>) {
  const backup = Blockly.serialization.workspaces.save(workspace);
  try {
    Blockly.Events.setGroup(true);
    Blockly.serialization.workspaces.load(state, workspace);
  } catch (e) {
    Blockly.serialization.workspaces.load(backup, workspace);
    throw new ProjectError('Something in this project couldn\'t be loaded, so your old blocks were kept.');
  } finally {
    Blockly.Events.setGroup(false);
  }
}

export function safeFileName(name: string, ext: string) {
  const base = name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'my-robot-program';
  return `${base}.${ext}`;
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const AUTOSAVE_KEY = 'eaglets-code:autosave';

export function autosave(project: ProjectFile) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    /* storage full or blocked: autosave is a convenience only */
  }
}

export function loadAutosave(): ProjectFile | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
  }
}
