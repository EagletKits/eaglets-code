import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Dialogs';
import { checkRobotPath, robotFileName, type RobotStorage } from '../../robot/deviceFiles';

/** The four files Eaglets Code installs and keeps up to date by itself. */
export const LIBRARY_FILES = new Set(['eaglets.py', 'eaglets_config.py', 'apds9960.py', 'lsm6ds3.py']);
const TEXT_FILE = /\.(py|txt|json|csv|md|cfg|ini)$/i;

export interface RobotFileOps {
  list(): Promise<RobotStorage>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<boolean>;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

/** Thonny's "Raspberry Pi Pico" file pane, as a dialog. */
export function FilesDialog({
  connected,
  busy,
  ops,
  onConnect,
  onOpen,
  onClose,
}: {
  connected: boolean;
  busy: boolean;
  ops: RobotFileOps;
  onConnect: () => void;
  onOpen: (path: string, text: string) => void;
  onClose: () => void;
}) {
  const [storage, setStorage] = useState<RobotStorage | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [renaming, setRenaming] = useState<{ path: string; to: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const task = useCallback(async (job: () => Promise<void>) => {
    setError('');
    setMessage('');
    setWorking(true);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }, []);

  const refresh = useCallback(() => task(async () => setStorage(await ops.list())), [task, ops]);

  useEffect(() => {
    if (connected && !busy) void refresh();
    // Load once when the dialog opens or the robot becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const download = (path: string) =>
    task(async () => {
      const data = await ops.read(path);
      const url = URL.createObjectURL(new Blob([data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = path.split('/').pop()!;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Downloaded ${path}.`);
    });

  const open = (path: string) =>
    task(async () => {
      const text = new TextDecoder().decode(await ops.read(path));
      onOpen(path, text);
      onClose();
    });

  const doUpload = (files: FileList) =>
    task(async () => {
      const names: string[] = [];
      for (const f of Array.from(files)) {
        const name = robotFileName(f.name);
        await ops.write(name, new Uint8Array(await f.arrayBuffer()));
        names.push(name);
      }
      setStorage(await ops.list());
      setMessage(`Uploaded ${names.join(', ')}.`);
    });

  const doRename = (from: string, to: string) =>
    task(async () => {
      if (to === from) return setRenaming(null);
      checkRobotPath(to);
      if (!(await ops.rename(from, to))) throw new Error(`There's already a file called ${to}.`);
      setRenaming(null);
      setStorage(await ops.list());
    });

  const doDelete = (path: string) =>
    task(async () => {
      await ops.remove(path);
      setDeleting(null);
      setStorage(await ops.list());
      setMessage(LIBRARY_FILES.has(path) ? `Deleted ${path}. Eaglets Code puts it back the next time you press Run.` : `Deleted ${path}.`);
    });

  const disabled = working || busy;
  const used = storage ? storage.totalBytes - storage.freeBytes : 0;

  return (
    <Modal
      title="Files on the robot"
      onClose={onClose}
      wide
      footer={
        connected && (
          <>
            <button className="btn" onClick={() => void refresh()} disabled={disabled}>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={() => upload.current?.click()} disabled={disabled}>
              Upload files…
            </button>
            <input
              ref={upload}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void doUpload(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )
      }
    >
      {!connected ? (
        <div className="files-empty">
          <p>Connect your robot to see the files stored on it.</p>
          <button className="btn btn-primary" onClick={onConnect}>
            Connect Robot
          </button>
        </div>
      ) : (
        <>
          {busy && <p className="callout callout-warn">The robot is busy. Press Stop to work with its files.</p>}
          {storage && storage.totalBytes > 0 && (
            <div className="files-space" aria-label="Storage used">
              <div className="files-space-bar">
                <span style={{ width: `${Math.min(100, (used / storage.totalBytes) * 100)}%` }} />
              </div>
              <small>
                {kb(used)} used · {kb(storage.freeBytes)} free
              </small>
            </div>
          )}
          {error && <p className="notice notice-error files-msg">{error}</p>}
          {message && <p className="notice notice-success files-msg">{message}</p>}
          <table className="files-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {storage?.files.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No files yet.
                  </td>
                </tr>
              )}
              {!storage && working && (
                <tr>
                  <td colSpan={3} className="muted">
                    Reading the robot…
                  </td>
                </tr>
              )}
              {storage?.files.map((f) => (
                <tr key={f.path}>
                  <td>
                    {renaming?.path === f.path ? (
                      <form
                        className="files-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void doRename(f.path, renaming.to.trim());
                        }}
                      >
                        <input value={renaming.to} onChange={(e) => setRenaming({ path: f.path, to: e.target.value })} aria-label={`New name for ${f.path}`} autoFocus />
                        <button className="btn btn-sm btn-primary" disabled={disabled}>
                          Rename
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setRenaming(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="files-name">{f.dir ? `${f.path}/` : f.path}</span>
                        {LIBRARY_FILES.has(f.path) && <span className="tag">robot library</span>}
                        {f.path === 'main.py' && <span className="tag tag-warn">runs at power-on</span>}
                      </>
                    )}
                  </td>
                  <td className="num">{f.dir ? '' : kb(f.size)}</td>
                  <td className="files-actions">
                    {deleting === f.path ? (
                      <>
                        <span>Delete {f.path}?</span>
                        <button className="btn btn-sm btn-danger" onClick={() => void doDelete(f.path)} disabled={disabled}>
                          Delete
                        </button>
                        <button className="btn btn-sm" onClick={() => setDeleting(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      !f.dir && (
                        <>
                          {TEXT_FILE.test(f.path) && (
                            <button className="btn btn-sm" onClick={() => void open(f.path)} disabled={disabled}>
                              Open
                            </button>
                          )}
                          <button className="btn btn-sm" onClick={() => void download(f.path)} disabled={disabled}>
                            Download
                          </button>
                          <button className="btn btn-sm" onClick={() => setRenaming({ path: f.path, to: f.path })} disabled={disabled}>
                            Rename
                          </button>
                          <button className="btn btn-sm" onClick={() => setDeleting(f.path)} disabled={disabled}>
                            Delete
                          </button>
                        </>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted files-note">
            The robot library files are installed and updated by Eaglets Code. <b>main.py</b> runs by itself every time the robot is switched on.
          </p>
        </>
      )}
    </Modal>
  );
}

/** Name a program before saving it onto the robot. */
export function SaveToRobotDialog({ initial, onSave, onClose }: { initial: string; onSave: (path: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  let problem = '';
  try {
    checkRobotPath(name.trim());
    if (!/\.py$/.test(name.trim())) problem = 'Python files on the robot should end in .py.';
  } catch (e) {
    problem = (e as Error).message;
  }
  const isMain = name.trim() === 'main.py';
  const isLibrary = LIBRARY_FILES.has(name.trim());
  return (
    <Modal
      title="Save to the robot"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!!problem || isLibrary}
            onClick={() => {
              onSave(name.trim());
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>File name on the robot</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} />
      </label>
      {problem && <p className="notice notice-hint files-msg">{problem}</p>}
      {isLibrary && <p className="notice notice-error files-msg">That's a robot library file. Pick another name.</p>}
      {isMain && (
        <p className="callout callout-warn">
          <b>main.py runs by itself every time the robot is switched on</b>, even with no computer attached. Keep the wheels off the table the first time.
        </p>
      )}
    </Modal>
  );
}
