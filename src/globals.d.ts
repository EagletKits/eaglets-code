/** App version from package.json, injected by Vite (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** File System Access API (Chrome, Edge, Electron). Not in TypeScript's DOM types yet. */
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface FileSystemWritableFileStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}
interface Window {
  showOpenFilePicker?: (opts?: { types?: FilePickerAcceptType[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: { suggestedName?: string; types?: FilePickerAcceptType[] }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
  /** Present only in the desktop app (desktop/preload.cjs). */
  eagletsDesktop?: {
    findBootDrive(): Promise<{ drive: string; chip: 'rp2040' | 'rp2350' } | null>;
    writeFirmware(drive: string, data: Uint8Array): Promise<void>;
  };
}
