import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlocklyWorkspace, type WorkspaceHandle } from './components/BlocklyWorkspace';
import { SimulatorView } from './components/SimulatorView';
import { ConfirmDialog, HelpDialog, PythonDialog, SettingsDialog, StartersDialog } from './components/Dialogs';
import { generatePython } from './generators/python';
import { generateSimulatorJs } from './generators/javascript';
import { checkProgram, type ProgramProblem } from './blocks/validate';
import { autosave, downloadText, loadAutosave, loadIntoWorkspace, parseProject, ProjectError, safeFileName, serializeProject } from './projects/projectFile';
import { STARTER_PROJECTS, type StarterProject } from './projects/starters';
import { RobotConnection, RobotBusyError, NotConnectedError, type RobotState } from './robot/connection';
import { MockMicroPythonDevice } from './robot/mockDevice';
import { WebSerialTransport, knownRobotPorts, requestRobotPort, webSerialSupported } from './robot/webSerial';
import { connectionErrorMessage } from './robot/friendlyErrors';
import { plainLibraryFiles } from './robot/deviceFiles';
import { normalizeConfig, type HardwareConfig } from './hardware/config';
import { SimRobot, runOnSimulator } from './sim/simRobot';

type Target = 'robot' | 'sim';
type Dialog = null | 'starters' | 'python' | 'settings' | 'help' | 'clear' | 'saveToRobot';
interface Notice {
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
  details?: string;
}

const MOCK = new URLSearchParams(location.search).has('mock');
const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const store = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const STATE_LABEL: Record<RobotState, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  ready: 'Connected',
  installing: 'Setting up robot…',
  running: 'Running',
  stopping: 'Stopping…',
};

export default function App() {
  const ws = useRef<WorkspaceHandle>(null);
  const [projectName, setProjectName] = useState('My robot program');
  const [beginner, setBeginner] = useState(() => load('eaglets-code:beginner', true));
  const [config, setConfig] = useState<HardwareConfig>(() => normalizeConfig(load('eaglets-code:config', null)));
  const [target, setTarget] = useState<Target>(() => (webSerialSupported() || MOCK ? 'robot' : 'sim'));
  const [robotState, setRobotState] = useState<RobotState>('disconnected');
  const [boardName, setBoardName] = useState('');
  const [simRunning, setSimRunning] = useState(false);
  const [consoleText, setConsoleText] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [problems, setProblems] = useState<ProgramProblem[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [python, setPython] = useState('');
  const [hasKnownPort, setHasKnownPort] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const sim = useMemo(() => new SimRobot(config), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    sim.config = config;
  }, [sim, config]);

  const appendConsole = useCallback((t: string) => setConsoleText((old) => (old + t).slice(-20000)), []);

  const robot = useMemo(
    () =>
      new RobotConnection({
        onState: (s) => {
          setRobotState(s);
          if (s === 'running') setNotice({ kind: 'info', text: 'Your program is running. Press Stop to end it.' });
        },
        onOutput: appendConsole,
        onNotice: (kind, text) => setNotice({ kind, text }),
      }),
    [appendConsole],
  );

  useEffect(() => {
    sim.onOutput = appendConsole;
    sim.onHighlight = (id) => ws.current?.highlight(id);
  }, [sim, appendConsole]);

  useEffect(() => store('eaglets-code:beginner', beginner), [beginner]);
  useEffect(() => store('eaglets-code:config', config), [config]);
  useEffect(() => {
    void knownRobotPorts().then((p) => setHasKnownPort(p.length > 0));
  }, []);

  // Restore the last project, or start with a friendly first program.
  useEffect(() => {
    const w = ws.current?.workspace();
    if (!w || loaded.current) return;
    loaded.current = true;
    const saved = loadAutosave();
    try {
      if (saved) {
        loadIntoWorkspace(w, saved.workspace);
        setProjectName(saved.name);
      } else {
        loadIntoWorkspace(w, STARTER_PROJECTS[0].workspace);
        setProjectName('My first program');
      }
    } catch {
      /* start empty */
    }
  }, []);

  const refreshPython = useCallback(() => {
    const w = ws.current?.workspace();
    if (!w) return '';
    const code = generatePython(w, projectName);
    setPython(code);
    return code;
  }, [projectName]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWorkspaceChange = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const w = ws.current?.workspace();
      if (!w) return;
      autosave(serializeProject(w, projectName));
      if (problems.length) {
        ws.current?.clearProblems();
        setProblems([]);
      }
    }, 400);
  }, [projectName, problems.length]);

  useEffect(() => {
    const w = ws.current?.workspace();
    if (w && loaded.current) autosave(serializeProject(w, projectName));
  }, [projectName]);

  const busy = robotState === 'running' || robotState === 'stopping' || robotState === 'installing' || simRunning;
  const running = (target === 'robot' && (robotState === 'running' || robotState === 'stopping')) || (target === 'sim' && simRunning);

  /** Check the program; show the first problem on its block. Returns true if it can run. */
  const validate = (): boolean => {
    const w = ws.current?.workspace();
    if (!w) return false;
    ws.current?.clearProblems();
    const found = checkProgram(w, { buzzerEnabled: config.buzzerPin !== null });
    setProblems(found);
    const errors = found.filter((p) => p.severity === 'error');
    const first = errors[0] ?? found[0];
    if (first) {
      ws.current?.showProblem(first.blockId, first.message);
      setNotice({ kind: errors.length ? 'error' : 'warning', text: first.message });
    }
    return errors.length === 0;
  };

  const connect = async (usePicker = true) => {
    setNotice(null);
    try {
      if (MOCK) {
        const info = await robot.connect(new MockMicroPythonDevice({ programMs: 3000, latencyMs: 2 }));
        setBoardName(`Practice robot (mock) · ${info.machine}`);
      } else {
        if (!webSerialSupported()) {
          setNotice({ kind: 'error', text: 'This browser can\'t use USB. Use Chrome or Edge on a computer or Chromebook, or try the Simulator.' });
          return;
        }
        const known = await knownRobotPorts();
        const port = !usePicker && known.length ? known[0] : await requestRobotPort();
        const info = await robot.connect(new WebSerialTransport(port));
        setBoardName(info.machine);
        setHasKnownPort(true);
      }
      setNotice({ kind: 'success', text: 'Robot connected! Press Run to send your program.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error && !/^Couldn't|^No robot|^Your robot|^This/.test(e.message) ? connectionErrorMessage(e) : (e as Error).message });
    }
  };

  const run = async () => {
    if (running || busy) {
      setNotice({ kind: 'warning', text: 'Another program is already running. Press Stop first.' });
      return;
    }
    if (!validate()) return;
    const w = ws.current!.workspace()!;
    setConsoleText('');
    if (target === 'sim') {
      setSimRunning(true);
      setNotice({ kind: 'info', text: 'Running on the practice robot.' });
      const result = await runOnSimulator(generateSimulatorJs(w), sim);
      setSimRunning(false);
      ws.current?.highlight(null);
      if (result.status === 'error') setNotice({ kind: 'error', text: result.message });
      else setNotice({ kind: 'success', text: result.status === 'stopped' ? 'Program stopped.' : 'Program finished.' });
      return;
    }
    if (robotState === 'disconnected') {
      setNotice({ kind: 'error', text: 'Your robot is not connected. Click Connect Robot first.' });
      return;
    }
    const code = refreshPython();
    setNotice({ kind: 'info', text: 'Sending your program to the robot…' });
    try {
      const result = await robot.run(code, config);
      if (result.status === 'finished') setNotice({ kind: 'success', text: 'Program finished. Motors and lights are off.' });
      else if (result.status === 'stopped') setNotice({ kind: 'success', text: 'Program stopped. Motors and lights are off.' });
      else setNotice({ kind: 'error', text: result.error!.message, details: result.error!.details });
    } catch (e) {
      if (e instanceof NotConnectedError || e instanceof RobotBusyError) setNotice({ kind: 'error', text: e.message });
      else setNotice({ kind: 'error', text: connectionErrorMessage(e) });
    }
  };

  const stop = async () => {
    if (target === 'sim' || simRunning) {
      sim.requestStop();
      return;
    }
    try {
      await robot.stop();
    } catch {
      setNotice({ kind: 'error', text: 'Your robot is not connected. If it is still moving, switch its power OFF.' });
    }
  };

  // Keyboard: Space or Escape stops a running program.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && running) void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveProject = () => {
    const w = ws.current?.workspace();
    if (!w) return;
    downloadText(safeFileName(projectName, 'eaglets'), JSON.stringify(serializeProject(w, projectName), null, 1), 'application/json');
    setNotice({ kind: 'success', text: `Saved "${projectName}" to your Downloads folder.` });
  };

  const openProject = async (file: File) => {
    const w = ws.current?.workspace();
    if (!w) return;
    try {
      const p = parseProject(await file.text());
      loadIntoWorkspace(w, p.workspace);
      setProjectName(p.name);
      setNotice({ kind: 'success', text: `Opened "${p.name}".` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ProjectError ? e.message : 'That file couldn\'t be opened.' });
    }
  };

  const pickStarter = (s: StarterProject) => {
    const w = ws.current?.workspace();
    if (!w) return;
    loadIntoWorkspace(w, s.workspace);
    setProjectName(s.title);
    setDialog(null);
    setNotice({ kind: 'info', text: `${s.emoji} ${s.title}: ${s.challenge}` });
    w.scrollCenter();
  };

  const downloadPython = () => {
    const code = refreshPython();
    downloadText(safeFileName(projectName, 'py'), code, 'text/x-python');
  };

  const downloadLibrary = () => {
    for (const f of plainLibraryFiles(config)) downloadText(f.name, f.content, 'text/x-python');
    setNotice({ kind: 'info', text: 'Downloaded 4 robot library files. In Thonny, save each one onto the Pico with the same name.' });
  };

  const saveToRobot = async () => {
    const w = ws.current?.workspace();
    if (!w || !validate()) return;
    try {
      await robot.saveToRobot(generatePython(w, projectName), config);
      setNotice({ kind: 'success', text: 'Saved to the robot. It will run this program every time it is switched on.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const connected = robotState !== 'disconnected' && robotState !== 'connecting';
  const usbAvailable = webSerialSupported() || MOCK;

  return (
    <div className={`app ${beginner ? 'is-beginner' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <img src="/eaglets-logo.png" alt="" width={36} height={36} />
          <span className="brand-name">
            Eaglets <b>Code</b>
          </span>
        </div>
        <input className="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" maxLength={60} />
        <nav className="top-actions">
          <button className="btn btn-spark" onClick={() => setDialog('starters')}>
            ✨ Starters
          </button>
          <button className="btn" onClick={saveProject} title="Download this project as a .eaglets file">
            💾 Save
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()} title="Open a .eaglets project file">
            📂 Open
          </button>
          <button
            className="btn"
            onClick={() => {
              refreshPython();
              setDialog('python');
            }}
          >
            🐍 Python
          </button>
          <label className="toggle" title="Beginner mode hides the more technical blocks">
            <input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} />
            <span className="toggle-track" />
            <span>Beginner</span>
          </label>
          <button className="icon-btn" onClick={() => setDialog('help')} title="How to connect" aria-label="Help">
            ?
          </button>
          <button className="icon-btn" onClick={() => setDialog('settings')} title="Instructor settings" aria-label="Instructor settings">
            ⚙
          </button>
        </nav>
        <input
          ref={fileInput}
          type="file"
          accept=".eaglets,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProject(f);
            e.target.value = '';
          }}
        />
      </header>

      <main className="main">
        <section className="editor">
          <BlocklyWorkspace ref={ws} beginner={beginner} buzzerEnabled={config.buzzerPin !== null} onChange={onWorkspaceChange} />
          <div className="editor-tools">
            <button className="tool" onClick={() => ws.current?.undo()} title="Undo" aria-label="Undo">
              ↶
            </button>
            <button className="tool" onClick={() => ws.current?.redo()} title="Redo" aria-label="Redo">
              ↷
            </button>
            <button className="tool" onClick={() => ws.current?.cleanUp()} title="Tidy up blocks" aria-label="Tidy up">
              ⇅
            </button>
            <button className="tool tool-danger" onClick={() => setDialog('clear')} title="Clear workspace" aria-label="Clear workspace">
              🗑
            </button>
          </div>
        </section>

        <aside className="panel">
          <div className="seg seg-lg panel-tabs" role="tablist">
            <button className={target === 'robot' ? 'on' : ''} onClick={() => !busy && setTarget('robot')} role="tab" aria-selected={target === 'robot'}>
              🤖 My Robot
            </button>
            <button className={target === 'sim' ? 'on' : ''} onClick={() => !busy && setTarget('sim')} role="tab" aria-selected={target === 'sim'}>
              🎮 Simulator
            </button>
          </div>

          {target === 'robot' && (
            <div className="card robot-card">
              <div className={`status status-${robotState}`}>
                <span className="dot" />
                <div>
                  <b>{STATE_LABEL[robotState]}</b>
                  {connected && boardName && <small>{boardName}</small>}
                </div>
              </div>
              {!usbAvailable ? (
                <p className="callout callout-warn">
                  USB needs Chrome or Edge on a computer or Chromebook. You can still use the Simulator, or download the Python for Thonny.
                </p>
              ) : connected ? (
                <button className="btn btn-block" onClick={() => void robot.disconnect()} disabled={busy}>
                  Disconnect
                </button>
              ) : (
                <div className="row">
                  <button className="btn btn-primary btn-block" onClick={() => void connect(true)} disabled={robotState === 'connecting'}>
                    🔌 Connect Robot
                  </button>
                  {hasKnownPort && !MOCK && (
                    <button className="btn" onClick={() => void connect(false)} title="Reconnect to the robot used last time" disabled={robotState === 'connecting'}>
                      ↻
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {target === 'sim' && <SimulatorView robot={sim} running={simRunning} advanced={!beginner} />}

          <div className="run-row">
            <button className="btn-run" onClick={() => void run()} disabled={running || (target === 'robot' && (!connected || busy))}>
              ▶ Run{target === 'robot' ? ' on Robot' : ''}
            </button>
            <button className="btn-stop" onClick={() => void stop()} disabled={!running}>
              ■ Stop
            </button>
          </div>
          {target === 'robot' && <p className="power-note">⚡ The power switch is the real emergency stop. Motors need the battery switched ON.</p>}

          {notice && (
            <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              {notice.details && !beginner && (
                <details>
                  <summary>Technical details</summary>
                  <pre>{notice.details}</pre>
                </details>
              )}
              <button className="notice-x" onClick={() => setNotice(null)} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}
          {problems.length > 1 && (
            <ul className="problems">
              {problems.slice(1, 4).map((p, i) => (
                <li key={i} className={p.severity}>
                  <button onClick={() => ws.current?.showProblem(p.blockId, p.message)}>{p.message}</button>
                </li>
              ))}
            </ul>
          )}

          <div className="console">
            <div className="console-head">
              <span>Console</span>
              <button className="link" onClick={() => setConsoleText('')}>
                clear
              </button>
            </div>
            <pre aria-live="polite">{consoleText || 'Messages from your program show up here. Try the "show … in console" block.'}</pre>
          </div>

          {!beginner && target === 'robot' && connected && (
            <div className="advanced-actions">
              <button className="btn btn-sm" onClick={() => setDialog('saveToRobot')} disabled={busy}>
                Save to robot (runs at power-on)
              </button>
              <button className="btn btn-sm" onClick={() => void robot.removeFromRobot().then(() => setNotice({ kind: 'success', text: 'Removed the saved program from the robot.' }))} disabled={busy}>
                Remove saved program
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  void robot
                    .syncLibrary(config, true)
                    .then(() => setNotice({ kind: 'success', text: 'Robot library reinstalled.' }))
                    .catch((e) => setNotice({ kind: 'error', text: (e as Error).message }))
                }
                disabled={busy}
              >
                Reinstall robot library
              </button>
            </div>
          )}
        </aside>
      </main>

      {dialog === 'starters' && <StartersDialog onPick={pickStarter} onClose={() => setDialog(null)} />}
      {dialog === 'python' && <PythonDialog code={python} onDownload={downloadPython} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <SettingsDialog
          config={config}
          onSave={(c) => {
            setConfig(c);
            setNotice({ kind: 'success', text: 'Settings saved. They go to the robot the next time you press Run.' });
          }}
          onDownloadLibrary={downloadLibrary}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'clear' && (
        <ConfirmDialog
          title="Clear all blocks?"
          message="This removes every block from your workspace. You can press Undo right after if you change your mind."
          confirm="Clear blocks"
          danger
          onConfirm={() => ws.current?.clear()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'saveToRobot' && (
        <ConfirmDialog
          title="Save to the robot?"
          message="The robot will run this program by itself every time it is switched on, even without a computer. Only do this for a finished program, and keep the wheels off the table when you switch it on."
          confirm="Save to robot"
          onConfirm={() => void saveToRobot()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
