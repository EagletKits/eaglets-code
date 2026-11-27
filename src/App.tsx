import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BlocklyWorkspace, type WorkspaceHandle } from './components/BlocklyWorkspace';
import { SimulatorView } from './components/SimulatorView';
import { Icon } from './components/Icon';
import { RobotFace } from './components/RobotFace';
import { CodeEditor } from './components/CodeEditor';
import { FilesDialog, LIBRARY_FILES, SaveToRobotDialog, type RobotFileOps } from './components/dialogs/FilesDialog';
import { FirmwareDialog } from './components/dialogs/FirmwareDialog';
import { ShellPane } from './components/ShellPane';
import { Plotter } from './components/Plotter';
import { AboutDialog, ConfirmDialog, HelpDialog, PythonDialog, SettingsDialog, StartersDialog } from './components/dialogs/Dialogs';
import { generatePython } from './generators/python';
import { generateSimulatorJs } from './generators/javascript';
import { checkProgram, type ProgramProblem } from './blocks/validate';
import { autosave, downloadText, loadAutosave, loadIntoWorkspace, parseProject, ProjectError, safeFileName, serializeProject } from './projects/projectFile';
import { STARTER_PROJECTS, type StarterProject } from './projects/starters';
import { RobotConnection, RobotBusyError, NotConnectedError, type RobotState, type ShellResult } from './robot/connection';
import { MockMicroPythonDevice } from './robot/mockDevice';
import { RPI_USB_VENDOR_ID, WebSerialTransport, knownRobotPorts, requestRobotPort, webSerialSupported } from './robot/webSerial';
import { connectionErrorMessage, errorLine as tracebackLine } from './robot/friendlyErrors';
import { programPrinted, studentNotice } from './robot/studentText';
import { appendLog, type LogEntry, type LogKind } from './lib/debugLog';
import { DebugPanel } from './components/dialogs/DebugPanel';
import { plainLibraryFiles } from './robot/deviceFiles';
import { PROJECT_OR_PY_TYPE, PY_TYPE, canSaveInPlace, pickFile, saveAs, writeHandle, type PickedFile } from './projects/localFiles';
import { normalizeConfig, type HardwareConfig } from './hardware/config';
import { SimRobot, runOnSimulator } from './sim/simRobot';

type Target = 'robot' | 'sim';
type Dialog = null | 'starters' | 'python' | 'settings' | 'help' | 'about' | 'clear' | 'saveToRobot' | 'resetCode' | 'files' | 'firmware' | 'saveRobotFile';
/** Where the code in the Code editor lives, so Save can write it back there. */
type CodeFile = { kind: 'robot'; path: string } | { kind: 'local'; name: string; handle?: FileSystemFileHandle };
type Mode = 'blocks' | 'code';
interface Notice {
  /** 'hint' is for the student's own block mistakes: gentle, not alarming. */
  kind: 'info' | 'success' | 'hint' | 'warning' | 'error';
  text: string;
  details?: string;
  /** One button that fixes the problem, e.g. "Install MicroPython". */
  action?: { label: string; run: () => void };
}
/** Where a connection gets its port: always ask, only a robot used before, or used-before then ask. */
type PortChoice = 'pick' | 'known' | 'known-or-pick';

const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');
const DEBUG_URL = params.has('debug');
/** Real USB robots reconnect by themselves when plugged back in. */
const AUTO_RECONNECT = webSerialSupported() && !MOCK;
const SUCCESS_FADE_MS = 8000;
/** Delays before each automatic connect attempt after a robot is plugged in. */
const PLUG_RETRY_MS = [700, 1500, 3000];
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
  working: 'Working…',
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
  const [mode, setMode] = useState<Mode>('blocks');
  const [code, setCode] = useState('');
  const [codeDirty, setCodeDirty] = useState(false);
  const codeRef = useRef<string | undefined>(undefined);
  codeRef.current = codeDirty ? code : undefined;
  const [hasKnownPort, setHasKnownPort] = useState(false);
  const [debug, setDebug] = useState(() => DEBUG_URL || load('eaglets-code:debug', false));
  const debugRef = useRef(debug);
  useLayoutEffect(() => {
    debugRef.current = debug;
  }, [debug]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const addLog = useCallback((kind: LogKind, text: string) => setLog((l) => appendLog(l, kind, text)), []);
  const [portLabel, setPortLabel] = useState('');
  const [codeFile, setCodeFile] = useState<CodeFile | null>(null);
  /** The code as last opened or saved, to show unsaved changes. */
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  /** A Shell command may have left motors or lights on, so Stop stays available. */
  const [motorsMaybeOn, setMotorsMaybeOn] = useState(false);
  const [showPlot, setShowPlot] = useState(false);
  const shellBusy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLDetailsElement>(null);
  const closeMore = () => {
    if (more.current) more.current.open = false;
  };
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (more.current?.open && !more.current.contains(e.target as Node)) more.current.open = false;
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);
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
          addLog('state', `Robot: ${s}`);
          if (s === 'running' && !shellBusy.current) setNotice({ kind: 'info', text: 'Your program is running. Press Stop to end it.' });
        },
        onOutput: appendConsole,
        onNotice: (kind, text) => {
          addLog(kind, text);
          setNotice({ kind, text: debugRef.current ? text : studentNotice(text, { autoReconnect: AUTO_RECONNECT }) });
        },
      }),
    [appendConsole, addLog],
  );

  useEffect(() => {
    sim.onOutput = appendConsole;
    sim.onHighlight = (id) => ws.current?.highlight(id);
  }, [sim, appendConsole]);

  useEffect(() => store('eaglets-code:beginner', beginner), [beginner]);
  useEffect(() => store('eaglets-code:config', config), [config]);
  useEffect(() => store('eaglets-code:debug', debug), [debug]);

  // A green "done" message fades on its own so the panel settles back down.
  // Teachers in debug mode keep everything on screen.
  useEffect(() => {
    if (notice?.kind !== 'success' || debug) return;
    const t = setTimeout(() => setNotice((n) => (n === notice ? null : n)), SUCCESS_FADE_MS);
    return () => clearTimeout(t);
  }, [notice, debug]);

  // Restore the last project, or open the first starter.
  useEffect(() => {
    const w = ws.current?.workspace();
    if (!w || loaded.current) return;
    loaded.current = true;
    const saved = loadAutosave();
    try {
      if (saved) {
        loadIntoWorkspace(w, saved.workspace);
        setProjectName(saved.name);
        if (saved.code !== undefined) {
          setCode(saved.code);
          setCodeDirty(true);
        }
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
      autosave(serializeProject(w, projectName, codeRef.current));
      if (problems.length) {
        ws.current?.clearProblems();
        setProblems([]);
      }
    }, 400);
  }, [projectName, problems.length]);

  useEffect(() => {
    const w = ws.current?.workspace();
    if (w && loaded.current) autosave(serializeProject(w, projectName, codeRef.current));
  }, [projectName, code, codeDirty]);

  const busy = robotState === 'running' || robotState === 'stopping' || robotState === 'installing' || robotState === 'working' || simRunning;
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
      // A missing value in a block is a normal part of learning, so it gets a gentle hint, not a red alarm.
      setNotice({ kind: 'hint', text: first.message });
      addLog('info', `Program check: ${found.map((p) => `${p.severity}: ${p.message}`).join(' | ')}`);
    }
    return errors.length === 0;
  };

  const connecting = useRef(false);
  /**
   * Connect to a robot. Returns true when connected. `quiet` connections
   * (automatic ones) only write failures to the debug log, never to the student.
   */
  const connect = async (choice: PortChoice, opts: { why: string; quiet?: boolean; port?: SerialPort }): Promise<boolean> => {
    if (robot.connected) return true;
    if (connecting.current) return false;
    connecting.current = true;
    addLog('action', `Connect: ${opts.why}`);
    if (!opts.quiet) setNotice(null);
    try {
      if (MOCK) {
        const info = await robot.connect(
          new MockMicroPythonDevice({
            programMs: 3000,
            latencyMs: 2,
            // ?mock=error: programs fail on line 3, for testing error highlighting.
            programError: params.get('mock') === 'error' ? 'Traceback (most recent call last):\r\n  File "<stdin>", line 3, in <module>\r\nNameError: name \'speed\' isn\'t defined\r\n' : '',
          }),
        );
        setBoardName(`Practice robot (mock) · ${info.machine}`);
        setPortLabel('practice robot (mock)');
      } else {
        if (!webSerialSupported()) {
          setNotice({ kind: 'error', text: 'This browser can\'t use USB. Use Chrome or Edge on a computer or Chromebook, or try the Simulator.' });
          return false;
        }
        let port = opts.port;
        if (!port) {
          const known = choice === 'pick' ? [] : await knownRobotPorts();
          if (known.length) port = known[0];
          else if (choice !== 'known') port = await requestRobotPort();
        }
        if (!port) {
          addLog('info', 'No robot this computer has used before is plugged in.');
          return false;
        }
        const transport = new WebSerialTransport(port);
        setPortLabel(transport.label);
        const info = await robot.connect(transport);
        setBoardName(info.machine);
        setHasKnownPort(true);
      }
      const b = robot.board;
      addLog('info', `Connected to ${b?.machine ?? 'board'} (${b?.implementation} ${b?.release})`);
      setNotice({ kind: 'success', text: 'Robot connected. Press Run to send your program.' });
      return true;
    } catch (e) {
      const err = e as Error;
      addLog('error', `Connect failed (${opts.why}): ${err?.name ? `${err.name}: ` : ''}${err?.message ?? String(e)}`);
      if (!opts.quiet) {
        const text = e instanceof Error && !/^Couldn't|^No robot|^Your robot|^This/.test(e.message) ? connectionErrorMessage(e) : err.message;
        // A Pico without MicroPython (or with it broken) is fixed by installing it.
        const action = /MicroPython/.test(text) ? { label: 'Install MicroPython', run: () => setDialog('firmware') } : undefined;
        setNotice({ kind: 'error', text, action });
      }
      return false;
    } finally {
      connecting.current = false;
    }
  };
  const connectRef = useRef(connect);
  useLayoutEffect(() => {
    connectRef.current = connect;
  });

  // Connect by ourselves: once when the app opens (to a robot this computer has
  // used before), and whenever such a robot is plugged in, e.g. after a cable
  // gets bumped. Failures here stay quiet; the student can still press Connect.
  useEffect(() => {
    if (!AUTO_RECONNECT) return;
    let cancelled = false;
    void knownRobotPorts().then((known) => {
      setHasKnownPort(known.length > 0);
      if (!cancelled && known.length) void connectRef.current('known', { why: 'app opened', quiet: true });
    });
    const onPlug = (e: Event) => {
      const port = e.target as SerialPort;
      if (port.getInfo().usbVendorId !== RPI_USB_VENDOR_ID) return;
      addLog('info', 'A robot was plugged in.');
      setHasKnownPort(true);
      // Give MicroPython's USB a moment to settle after it appears. Windows can
      // take a few seconds to make the COM port usable, so keep trying a little.
      const attempt = (n: number) => {
        if (robot.connected) return;
        void connectRef.current('known', { why: n === 0 ? 'robot plugged in' : `retry ${n} after plug-in`, quiet: true, port }).then((ok) => {
          if (!ok && !robot.connected && n < PLUG_RETRY_MS.length - 1) setTimeout(() => attempt(n + 1), PLUG_RETRY_MS[n + 1]);
        });
      };
      setTimeout(() => attempt(0), PLUG_RETRY_MS[0]);
    };
    navigator.serial.addEventListener('connect', onPlug);
    return () => {
      cancelled = true;
      navigator.serial.removeEventListener('connect', onPlug);
    };
  }, [robot, addLog]);

  const run = async () => {
    if (running || busy) {
      setNotice({ kind: 'warning', text: 'Another program is already running. Press Stop first.' });
      return;
    }
    if (mode === 'blocks' && !validate()) return;
    const w = ws.current!.workspace()!;
    setConsoleText('');
    setErrorLine(null);
    if (target === 'sim' && mode === 'blocks') {
      addLog('action', 'Run on simulator');
      setSimRunning(true);
      setNotice({ kind: 'info', text: 'Running on the practice robot.' });
      const result = await runOnSimulator(generateSimulatorJs(w), sim);
      setSimRunning(false);
      ws.current?.highlight(null);
      addLog(result.status === 'error' ? 'error' : 'info', `Simulator: ${result.status}${result.status === 'error' ? ` — ${result.message}` : ''}`);
      if (result.status === 'error') setNotice({ kind: 'error', text: result.message });
      else setNotice({ kind: 'success', text: result.status === 'stopped' ? 'Program stopped.' : 'Program finished.' });
      return;
    }
    // One button: if the robot isn't connected yet, Run connects it first.
    if (!robot.connected) {
      if (!usbAvailable) {
        setNotice({ kind: 'error', text: 'This browser can\'t use USB. Use Chrome or Edge on a computer or Chromebook, or try the Simulator.' });
        return;
      }
      if (!(await connect('known-or-pick', { why: 'Run pressed while not connected' }))) return;
    }
    const program = mode === 'code' ? code : refreshPython();
    addLog('action', `Run on robot (${mode === 'code' ? 'hand-written code' : 'blocks'}, ${program.split('\n').length} lines)`);
    setNotice({ kind: 'info', text: 'Sending your program to the robot…' });
    try {
      const result = await robot.run(program, config, { handWritten: mode === 'code' });
      setMotorsMaybeOn(false);
      addLog(result.status === 'error' ? 'error' : 'info', `Run ${result.status}${result.error ? `: ${result.error.message}\n${result.error.details}` : ''}`);
      if (result.status === 'finished') setNotice({ kind: 'success', text: 'Program finished. Motors and lights are off.' });
      else if (result.status === 'stopped') setNotice({ kind: 'success', text: 'Program stopped. Motors and lights are off.' });
      else {
        // In Code mode the program is exactly the editor text, so point at the line.
        const line = mode === 'code' ? tracebackLine(result.error!.details) : null;
        setErrorLine(line);
        setNotice({ kind: 'error', text: line ? `Line ${line}: ${result.error!.message}` : result.error!.message, details: result.error!.details });
      }
    } catch (e) {
      addLog('error', `Run failed: ${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`);
      if (e instanceof NotConnectedError || e instanceof RobotBusyError) setNotice({ kind: 'error', text: e.message });
      else setNotice({ kind: 'error', text: connectionErrorMessage(e) });
    }
  };

  const stop = async () => {
    addLog('action', 'Stop pressed');
    if ((target === 'sim' && mode === 'blocks') || simRunning) {
      sim.requestStop();
      return;
    }
    try {
      if (robot.state === 'ready') {
        // Nothing running, but a Shell command may have left the motors or lights on.
        await robot.safeStop();
        setMotorsMaybeOn(false);
        setNotice({ kind: 'success', text: 'Motors and lights are off.' });
        return;
      }
      await robot.stop();
    } catch {
      addLog('error', 'Stop: robot not connected');
      setNotice({ kind: 'error', text: 'Your robot is not connected. If it is still moving, switch its power OFF.' });
    }
  };

  // Keyboard: Escape stops a running program; Ctrl/Cmd+S saves, like Thonny.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && running) void stop();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (mode === 'code') void saveCode();
        else saveProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveProject = () => {
    const w = ws.current?.workspace();
    if (!w) return;
    downloadText(safeFileName(projectName, 'eaglets'), JSON.stringify(serializeProject(w, projectName, codeRef.current), null, 1), 'application/json');
    setNotice({ kind: 'success', text: `Saved "${projectName}" to your Downloads folder.` });
  };

  /** Code-mode document state in one place, so opening and saving stay consistent. */
  const showCode = (text: string, file: CodeFile | null) => {
    setCode(text);
    setCodeDirty(true);
    setCodeFile(file);
    setSavedCode(file ? text : null);
    setErrorLine(null);
    setTarget('robot');
    setMode('code');
  };

  const openPicked = async (f: PickedFile) => {
    if (/\.py$/i.test(f.name)) {
      showCode(f.text, { kind: 'local', name: f.name, handle: f.handle });
      setProjectName(f.name.replace(/\.py$/i, ''));
      addLog('action', `Opened ${f.name} from the computer`);
      setNotice({ kind: 'success', text: `Opened ${f.name}.` });
      return;
    }
    await openProjectText(f.text);
  };

  /** Open: an .eaglets project or a .py file. Real files where the browser allows, so Save writes back. */
  const openAny = async () => {
    if (!canSaveInPlace()) {
      fileInput.current?.click();
      return;
    }
    try {
      const f = await pickFile([PROJECT_OR_PY_TYPE]);
      if (f) await openPicked(f);
    } catch (e) {
      setNotice({ kind: 'error', text: `That file couldn't be opened (${(e as Error).message}).` });
    }
  };

  const openProjectText = async (text: string) => {
    const w = ws.current?.workspace();
    if (!w) return;
    try {
      const p = parseProject(text);
      setCodeFile(null);
      setSavedCode(null);
      setErrorLine(null);
      loadIntoWorkspace(w, p.workspace);
      setProjectName(p.name);
      setCode(p.code ?? '');
      setCodeDirty(p.code !== undefined);
      setMode(p.code !== undefined ? 'code' : 'blocks');
      if (p.code !== undefined) setTarget('robot');
      setNotice({ kind: 'success', text: `Opened "${p.name}".` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ProjectError ? e.message : 'That file couldn\'t be opened.' });
    }
  };

  const saveCodeToComputer = async () => {
    const name = codeFile?.kind === 'local' ? codeFile.name : codeFile?.kind === 'robot' ? codeFile.path.split('/').pop()! : safeFileName(projectName, 'py');
    try {
      const handle = await saveAs(name, code, PY_TYPE, 'text/x-python');
      if (handle === null) return;
      if (handle) {
        setCodeFile({ kind: 'local', name: handle.name, handle });
        setSavedCode(code);
        setNotice({ kind: 'success', text: `Saved ${handle.name}.` });
      } else setNotice({ kind: 'success', text: `Saved ${name} to your Downloads folder.` });
      addLog('action', `Saved code to the computer as ${handle ? handle.name : name}`);
    } catch (e) {
      setNotice({ kind: 'error', text: `Couldn't save: ${(e as Error).message}` });
    }
  };

  const saveCodeToRobot = async (path: string) => {
    if (!robot.connected && !(await connect('known-or-pick', { why: 'Save to robot' }))) return;
    try {
      await robot.writeFile(path, code);
      setCodeFile({ kind: 'robot', path });
      setSavedCode(code);
      addLog('action', `Saved code to the robot as ${path}`);
      setNotice({ kind: 'success', text: path === 'main.py' ? 'Saved main.py on the robot. It runs by itself every time the robot is switched on.' : `Saved ${path} on the robot.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Save back to where the code came from; first time, ask where. */
  const saveCode = async () => {
    if (!codeFile) return saveCodeToComputer();
    if (codeFile.kind === 'robot') {
      // Never overwrite the robot library by accident: ask for a new name.
      if (LIBRARY_FILES.has(codeFile.path)) return setDialog('saveRobotFile');
      return saveCodeToRobot(codeFile.path);
    }
    if (!codeFile.handle) return saveCodeToComputer();
    try {
      await writeHandle(codeFile.handle, code);
      setSavedCode(code);
      setNotice({ kind: 'success', text: `Saved ${codeFile.name}.` });
    } catch (e) {
      setNotice({ kind: 'error', text: `Couldn't save ${codeFile.name}: ${(e as Error).message}` });
    }
  };

  const runShell = async (source: string, onOutput: (t: string) => void): Promise<ShellResult | null> => {
    if (!robot.connected) {
      if (!usbAvailable) throw new Error('The Shell needs USB: use Chrome, Edge or the desktop app.');
      if (!(await connect('known-or-pick', { why: 'Shell used while not connected' }))) return null;
    }
    addLog('action', `Shell: ${source.split('\n')[0].slice(0, 80)}${source.includes('\n') ? ' …' : ''}`);
    shellBusy.current = true;
    try {
      const r = await robot.shell(source, config, onOutput);
      setMotorsMaybeOn(true);
      if (r.status === 'error') addLog('error', `Shell error: ${r.error}`);
      if (r.status === 'stopped') {
        await robot.safeStop();
        setMotorsMaybeOn(false);
      }
      return r;
    } finally {
      shellBusy.current = false;
    }
  };

  const fileOps: RobotFileOps = {
    list: () => robot.listFiles(),
    read: (p) => robot.readFile(p),
    write: (p, d) => robot.writeFile(p, d),
    remove: (p) => robot.removeFile(p),
    rename: (a, b) => robot.renameFile(a, b),
  };

  const pickStarter = (s: StarterProject) => {
    const w = ws.current?.workspace();
    if (!w) return;
    loadIntoWorkspace(w, s.workspace);
    setProjectName(s.title);
    setCodeDirty(false);
    setCodeFile(null);
    setSavedCode(null);
    setMode('blocks');
    setDialog(null);
    setNotice({ kind: 'info', text: `${s.title}: ${s.challenge}` });
    w.scrollCenter();
  };

  const downloadPython = () => {
    const code = refreshPython();
    downloadText(safeFileName(projectName, 'py'), code, 'text/x-python');
  };

  const downloadLibrary = () => {
    for (const f of plainLibraryFiles(config)) downloadText(f.name, f.content, 'text/x-python');
    setNotice({ kind: 'info', text: 'Downloaded the 4 robot library files.' });
  };

  const saveToRobot = async () => {
    const w = ws.current?.workspace();
    if (!w || (mode === 'blocks' && !validate())) return;
    try {
      await robot.saveToRobot(mode === 'code' ? code : generatePython(w, projectName), config);
      setNotice({ kind: 'success', text: 'Saved to the robot. It will run this program every time it is switched on.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const goCode = () => {
    if (!codeDirty) setCode(refreshPython());
    setTarget('robot');
    setMode('code');
  };
  const goBlocks = () => setMode('blocks');
  const resetCode = () => {
    setCode(refreshPython());
    setCodeDirty(false);
    setCodeFile(null);
    setSavedCode(null);
    setErrorLine(null);
  };

  const connected = robotState !== 'disconnected' && robotState !== 'connecting';
  const usbAvailable = webSerialSupported() || MOCK;
  /** Technical detail is for teachers: Advanced mode or debug mode. */
  const showTech = !beginner || debug;
  // Beginners only see the console when their program printed something.
  const showConsole = showTech ? Boolean(consoleText || running) : programPrinted(consoleText);
  const stopEnabled = running || (target === 'robot' && robotState === 'ready' && motorsMaybeOn);
  const unsaved = codeFile !== null && savedCode !== code;
  const codeLabel = codeFile
    ? codeFile.kind === 'robot'
      ? `${codeFile.path} on the robot`
      : `${codeFile.name} on this computer`
    : codeDirty
      ? 'Your Python, not saved to a file yet'
      : 'Python from your blocks';

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
        <div className="seg seg-lg mode-switch" role="tablist" aria-label="Editor">
          <button className={mode === 'blocks' ? 'on' : ''} onClick={goBlocks} disabled={busy} role="tab" aria-selected={mode === 'blocks'}>
            Blocks
          </button>
          <button className={mode === 'code' ? 'on' : ''} onClick={goCode} disabled={busy} role="tab" aria-selected={mode === 'code'}>
            Code
          </button>
        </div>
        <nav className="top-actions">
          {debug && (
            <button className="debug-badge" onClick={() => setDebug(false)} title="Teacher debug mode is on. Click to switch it off.">
              Debug on <Icon name="close" size={12} />
            </button>
          )}
          <button className="btn btn-spark" onClick={() => setDialog('starters')}>
            Starters
          </button>
          <button className="btn" onClick={saveProject} title="Download this project as a .eaglets file">
            Save
          </button>
          <button className="btn" onClick={() => void openAny()} title="Open a .eaglets project or a .py file">
            Open
          </button>
          <details className="more" ref={more}>
            <summary className="btn">More</summary>
            <div className="more-menu">
              <button
                onClick={() => {
                  closeMore();
                  setDialog('help');
                }}
              >
                How to connect
              </button>
              <button
                onClick={() => {
                  closeMore();
                  setDialog('files');
                }}
              >
                Files on robot
              </button>
              <button
                onClick={() => {
                  closeMore();
                  setDialog('firmware');
                }}
              >
                Install MicroPython
              </button>
              <button
                onClick={() => {
                  closeMore();
                  if (mode === 'code') setPython(code);
                  else refreshPython();
                  setDialog('python');
                }}
              >
                Show Python
              </button>
              <button
                onClick={() => {
                  closeMore();
                  setDialog('settings');
                }}
              >
                Instructor settings
              </button>
              <label className="more-toggle" title="Beginner mode hides the more technical blocks">
                <input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} />
                Beginner mode
              </label>
              <button
                onClick={() => {
                  closeMore();
                  setDialog('about');
                }}
              >
                About &amp; privacy
              </button>
            </div>
          </details>
        </nav>
        <input
          ref={fileInput}
          type="file"
          accept=".eaglets,.json,application/json,.py"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((text) => openPicked({ name: f.name, text }));
            e.target.value = '';
          }}
        />
      </header>

      <main className="main">
        <section className={`editor ${mode === 'code' ? 'is-code' : ''}`}>
          <BlocklyWorkspace ref={ws} beginner={beginner} buzzerEnabled={config.buzzerPin !== null} onChange={onWorkspaceChange} />
          {mode === 'code' && (
            <div className="code-pane">
              <div className="code-bar">
                <span className="code-file" title="Changes here don't go back into the blocks.">
                  {codeLabel}
                  {unsaved && <b className="unsaved"> · not saved</b>}
                </span>
                <div className="code-actions">
                  {codeFile && (
                    <button className="btn btn-sm btn-primary" onClick={() => void saveCode()} title="Save (Ctrl+S)">
                      Save
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => void saveCodeToComputer()}>
                    Save to computer…
                  </button>
                  <button className="btn btn-sm" onClick={() => setDialog('saveRobotFile')} disabled={busy || !usbAvailable}>
                    Save to robot…
                  </button>
                  <button className="btn btn-sm" onClick={() => (codeDirty ? setDialog('resetCode') : resetCode())}>
                    Reset from blocks
                  </button>
                </div>
              </div>
              <CodeEditor
                value={code}
                errorLine={errorLine}
                onChange={(t) => {
                  setCode(t);
                  setCodeDirty(true);
                  setErrorLine(null);
                }}
              />
              <ShellPane exec={runShell} onStop={() => void stop()} running={robotState === 'running' || robotState === 'stopping'} disabled={usbAvailable ? null : 'The Shell needs USB: use Chrome, Edge or the desktop app.'} />
            </div>
          )}
          <div className="editor-tools">
            <button className="tool" onClick={() => ws.current?.undo()} title="Undo" aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button className="tool" onClick={() => ws.current?.redo()} title="Redo" aria-label="Redo">
              <Icon name="redo" />
            </button>
            <button className="tool" onClick={() => ws.current?.cleanUp()} title="Tidy up blocks" aria-label="Tidy up">
              <Icon name="tidy" />
            </button>
            <button className="tool tool-danger" onClick={() => setDialog('clear')} title="Clear workspace" aria-label="Clear workspace">
              <Icon name="trash" />
            </button>
          </div>
        </section>

        <aside className="panel">
          <div className="seg seg-lg panel-tabs" role="tablist">
            <button className={target === 'robot' ? 'on' : ''} onClick={() => !busy && setTarget('robot')} role="tab" aria-selected={target === 'robot'}>
              My Robot
            </button>
            <button
              className={target === 'sim' ? 'on' : ''}
              onClick={() => !busy && mode === 'blocks' && setTarget('sim')}
              disabled={mode === 'code'}
              title={mode === 'code' ? 'The simulator runs blocks. Switch to Blocks to use it.' : undefined}
              role="tab"
              aria-selected={target === 'sim'}
            >
              Simulator
            </button>
          </div>

          {target === 'robot' && (
            <div className="card robot-card">
              <div className={`status status-${robotState}`}>
                <RobotFace state={robotState} />
                <div>
                  <b>{STATE_LABEL[robotState]}</b>
                  {connected && boardName && showTech && <small>{boardName}</small>}
                </div>
              </div>
              {!usbAvailable ? (
                <p className="callout callout-warn">
                  USB needs Chrome or Edge on a computer or Chromebook, or the Eaglets Code desktop app. You can still use the Simulator.
                </p>
              ) : connected ? (
                <div className="row">
                  <button className="btn btn-block" onClick={() => setDialog('files')} disabled={busy}>
                    Files
                  </button>
                  <button className="btn btn-block" onClick={() => void robot.disconnect()} disabled={busy}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="row">
                  <button className="btn btn-primary btn-block" onClick={() => void connect('pick', { why: 'Connect Robot clicked' })} disabled={robotState === 'connecting'}>
                    Connect Robot
                  </button>
                  {hasKnownPort && !MOCK && (
                    <button className="btn" onClick={() => void connect('known', { why: 'Reconnect clicked' })} title="Reconnect to the robot used last time" disabled={robotState === 'connecting'}>
                      Reconnect
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {target === 'sim' && mode === 'blocks' && <SimulatorView robot={sim} running={simRunning} advanced={!beginner} />}

          <div className="run-row">
            <button className="btn-run" onClick={() => void run()} disabled={running || busy || (target === 'robot' && (!usbAvailable || robotState === 'connecting'))}>
              <Icon name="play" /> Run{target === 'robot' ? ' on Robot' : ''}
            </button>
            <button className="btn-stop" onClick={() => void stop()} disabled={!stopEnabled} title={running ? undefined : 'Switch the motors and lights off'}>
              <Icon name="stop" /> Stop
            </button>
          </div>
          {target === 'robot' && <p className="power-note">The power switch is the real emergency stop. Motors need the battery switched on.</p>}

          {notice && (
            <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              {notice.action && (
                <button
                  className="btn btn-sm notice-action"
                  onClick={() => {
                    notice.action!.run();
                    setNotice(null);
                  }}
                >
                  {notice.action.label}
                </button>
              )}
              {notice.details && showTech && (
                <details>
                  <summary>Technical details</summary>
                  <pre>{notice.details}</pre>
                </details>
              )}
              <button className="notice-x" onClick={() => setNotice(null)} aria-label="Dismiss">
                <Icon name="close" size={14} />
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

          {showConsole && (
            <div className="console">
              <div className="console-head">
                <span>Console</span>
                <span>
                  <button className="link" onClick={() => setShowPlot((p) => !p)} aria-pressed={showPlot}>
                    {showPlot ? 'hide plot' : 'plot'}
                  </button>
                  <button className="link" onClick={() => setConsoleText('')}>
                    clear
                  </button>
                </span>
              </div>
              {showPlot && <Plotter text={consoleText} />}
              <pre aria-live="polite">{consoleText || 'Running…'}</pre>
            </div>
          )}

          {showTech && target === 'robot' && connected && (
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

          {debug && (
            <DebugPanel
              log={log}
              facts={{
                version: __APP_VERSION__,
                shell: /Electron\//.test(navigator.userAgent) ? 'desktop app' : 'browser',
                userAgent: navigator.userAgent,
                webSerial: webSerialSupported(),
                mock: MOCK,
                robotState,
                board: robot.board ? `${robot.board.machine} · ${robot.board.implementation} ${robot.board.release}` : '',
                port: connected ? portLabel : '',
                mode,
                beginner,
                config,
              }}
              onClear={() => setLog([])}
              onTurnOff={() => setDebug(false)}
            />
          )}
        </aside>
      </main>

      {dialog === 'starters' && <StartersDialog onPick={pickStarter} onClose={() => setDialog(null)} />}
      {dialog === 'python' && <PythonDialog code={python} onDownload={downloadPython} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <SettingsDialog
          config={config}
          debug={debug}
          onDebugChange={(on) => {
            setDebug(on);
            addLog('action', `Teacher debug mode ${on ? 'on' : 'off'}`);
          }}
          onSave={(c) => {
            setConfig(c);
            setNotice({ kind: 'success', text: 'Settings saved. They go to the robot the next time you press Run.' });
          }}
          onDownloadLibrary={downloadLibrary}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'files' && (
        <FilesDialog
          connected={connected}
          busy={busy}
          ops={fileOps}
          onConnect={() => void connect('known-or-pick', { why: 'Files dialog' })}
          onOpen={(path, text) => {
            showCode(text, { kind: 'robot', path });
            addLog('action', `Opened ${path} from the robot`);
            setNotice({ kind: 'success', text: `Opened ${path} from the robot.` });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'saveRobotFile' && (
        <SaveToRobotDialog
          initial={codeFile?.kind === 'robot' ? codeFile.path : codeFile?.kind === 'local' ? codeFile.name.replace(/[^\w.-]/g, '_') : safeFileName(projectName, 'py').replace(/-/g, '_')}
          onSave={(path) => void saveCodeToRobot(path)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'firmware' && (
        <FirmwareDialog
          connected={connected}
          busy={busy}
          boardRelease={robot.board?.release ?? null}
          onRestartRobot={() => robot.rebootToBootloader()}
          isConnected={() => robot.connected}
          currentRelease={() => robot.board?.release ?? null}
          log={(t) => addLog('action', t)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === 'resetCode' && (
        <ConfirmDialog
          title="Start over from the blocks?"
          message="This replaces the code you wrote with Python made from your blocks. Your code will be lost."
          confirm="Replace my code"
          danger
          onConfirm={resetCode}
          onClose={() => setDialog(null)}
        />
      )}
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
