/**
 * Opening and saving files on the computer. Chrome, Edge and the desktop app
 * have the File System Access API, so Save can write back to the same file,
 * like Thonny. Anywhere else, Save falls back to a download.
 */
import { downloadText } from './projectFile';

export interface PickedFile {
  name: string;
  text: string;
  /** Present when the file can be saved back in place. */
  handle?: FileSystemFileHandle;
}

export const PY_TYPE = { description: 'Python program', accept: { 'text/x-python': ['.py'] } };
export const PROJECT_TYPE = { description: 'Eaglets Code project', accept: { 'application/json': ['.eaglets'] } };
/** One filter for Open, so both kinds show up together. */
export const PROJECT_OR_PY_TYPE = { description: 'Eaglets project or Python file', accept: { 'application/json': ['.eaglets'], 'text/x-python': ['.py'] } };

export const canSaveInPlace = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

const cancelled = (e: unknown) => (e as Error)?.name === 'AbortError';

/** Ask for a file. Returns null if the person cancelled. Only used where canSaveInPlace(). */
export async function pickFile(types: FilePickerAcceptType[]): Promise<PickedFile | null> {
  try {
    const [handle] = await window.showOpenFilePicker!({ types, multiple: false });
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle };
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

export async function writeHandle(handle: FileSystemFileHandle, text: string) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/**
 * "Save as…". Returns the new handle, or null if cancelled. Without the API,
 * downloads the file and returns undefined (saved, but not re-savable in place).
 */
export async function saveAs(suggestedName: string, text: string, type: FilePickerAcceptType, mime: string): Promise<FileSystemFileHandle | null | undefined> {
  if (!canSaveInPlace()) {
    downloadText(suggestedName, text, mime);
    return undefined;
  }
  try {
    const handle = await window.showSaveFilePicker!({ suggestedName, types: [type] });
    await writeHandle(handle, text);
    return handle;
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}
