import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { STARTER_PROJECTS, type StarterProject } from '../../projects/starters';
import { BUZZER_PIN_CHOICES, DEFAULT_CONFIG, V62_PINS, normalizeConfig, type Axis, type HardwareConfig } from '../../hardware/config';

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal-inner">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({ title, message, confirm, danger, onConfirm, onClose }: { title: string; message: string; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function StartersDialog({ onPick, onClose }: { onPick: (s: StarterProject) => void; onClose: () => void }) {
  const [day, setDay] = useState<string>('All');
  const days = ['All', 'Day 2', 'Day 3', 'Day 4', 'Any day'];
  const list = STARTER_PROJECTS.filter((s) => day === 'All' || s.day === day);
  return (
    <Modal title="Starter projects" onClose={onClose} wide>
      <div className="seg seg-lg" role="tablist">
        {days.map((d) => (
          <button key={d} className={d === day ? 'on' : ''} onClick={() => setDay(d)} role="tab" aria-selected={d === day}>
            {d}
          </button>
        ))}
      </div>
      <div className="starter-grid">
        {list.map((s) => (
          <button key={s.id} className="starter-card" data-day={s.day.replace(/\s+/g, '').toLowerCase()} onClick={() => onPick(s)}>
            <span className="starter-day">{s.day}</span>
            <strong>{s.title}</strong>
            <span className="starter-desc">{s.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function highlightPython(code: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return code.split('\n').map((line, i) => {
    let html = esc(line);
    const comment = html.indexOf('#');
    let tail = '';
    if (comment >= 0 && !/'[^']*#/.test(html.slice(0, comment + 1))) {
      tail = `<span class="py-c">${html.slice(comment)}</span>`;
      html = html.slice(0, comment);
    }
    html = html
      .replace(/('[^']*')/g, '<span class="py-s">$1</span>')
      .replace(/\b(import|from|def|return|if|elif|else|while|for|in|range|try|finally|global|not|and|or|True|False|None|pass|break)\b/g, '<span class="py-k">$1</span>')
      .replace(/\b(robot)\./g, '<span class="py-r">$1</span>.')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="py-n">$1</span>');
    return <div key={i} className="py-line" dangerouslySetInnerHTML={{ __html: html + tail || ' ' }} />;
  });
}

export function PythonDialog({ code, onDownload, onClose }: { code: string; onDownload: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title="Your program in Python"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted">This is the exact MicroPython the robot runs. It needs eaglets.py on the robot.</span>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn btn-primary" onClick={onDownload}>
            Download .py
          </button>
        </>
      }
    >
      <pre className="python-view" aria-label="Generated Python">
        {highlightPython(code)}
      </pre>
    </Modal>
  );
}

export function SettingsDialog({
  config,
  debug,
  onDebugChange,
  onSave,
  onDownloadLibrary,
  onClose,
}: {
  config: HardwareConfig;
  debug: boolean;
  onDebugChange: (on: boolean) => void;
  onSave: (c: HardwareConfig) => void;
  onDownloadLibrary: () => void;
  onClose: () => void;
}) {
  const [c, setC] = useState<HardwareConfig>(config);
  const set = <K extends keyof HardwareConfig>(k: K, v: HardwareConfig[K]) => setC((old) => ({ ...old, [k]: v }));
  const num = (k: keyof HardwareConfig, label: string, min: number, max: number, step = 1, help?: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={c[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />
      {help && <small>{help}</small>}
    </label>
  );
  const axes: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
  const axis = (k: 'imuForwardAxis' | 'imuLeftAxis' | 'imuUpAxis', label: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={c[k]} onChange={(e) => set(k, e.target.value as Axis)}>
        {axes.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal
      title="Instructor settings"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => setC(DEFAULT_CONFIG)}>
            Reset to defaults
          </button>
          <button className="btn" onClick={onDownloadLibrary}>
            Download robot library files
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(normalizeConfig(c));
              onClose();
            }}
          >
            Save settings
          </button>
        </>
      }
    >
      <p className="callout">
        These settings are saved in this browser and copied to the robot the next time you press Run. Pins are fixed by the Eaglets PCB V6.2 design and can't be changed here.
      </p>
      <label className="check debug-toggle">
        <input type="checkbox" checked={debug} onChange={(e) => onDebugChange(e.target.checked)} />
        <span>
          <b>Teacher debug mode</b> (turns on right away). Shows the robot's technical details, full error messages, the console after every run and a log of everything the app did,
          with a report you can copy and send. Switch it off before handing the laptop back to a student.
        </span>
      </label>
      <div className="settings-grid">
        <section>
          <h3>Motors</h3>
          <label className="check">
            <input type="checkbox" checked={c.leftMotorReversed} onChange={(e) => set('leftMotorReversed', e.target.checked)} /> Left wheel spins backwards (flip it)
          </label>
          <label className="check">
            <input type="checkbox" checked={c.rightMotorReversed} onChange={(e) => set('rightMotorReversed', e.target.checked)} /> Right wheel spins backwards (flip it)
          </label>
          {num('maxMotorPower', 'Power at 100% speed (%)', 10, 100, 5, 'Bring-up tests used 80%.')}
          {num('maxMoveSeconds', 'Longest timed move (s)', 1, 30)}
          {num('motorAutoStopSeconds', 'Auto-stop after (s)', 2, 120, 1, 'Untimed moves stop unless repeated.')}
        </section>
        <section>
          <h3>Lights and dial</h3>
          {num('maxLedBrightness', 'LED brightness cap (%)', 1, 100, 1, 'Keep at 25% until LED power tests pass.')}
          <label className="check">
            <input type="checkbox" checked={c.dialReversed} onChange={(e) => set('dialReversed', e.target.checked)} /> Dial reads backwards
          </label>
          <h3>Buzzer (optional)</h3>
          <label className="field">
            <span>Buzzer pin</span>
            <select value={c.buzzerPin ?? ''} onChange={(e) => set('buzzerPin', e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">No buzzer fitted</option>
              {BUZZER_PIN_CHOICES.map((p) => (
                <option key={p} value={p}>
                  GP{p} on J12
                </option>
              ))}
            </select>
            <small>The V6.2 board has no buzzer. Pick a pin only after one is wired to J12. GP18 isn't offered because it shares a PWM slice with the left motor.</small>
          </label>
        </section>
        <section>
          <h3>Motion sensor (IMU)</h3>
          {axis('imuForwardAxis', 'Sensor axis pointing forward')}
          {axis('imuLeftAxis', 'Sensor axis pointing left')}
          {axis('imuUpAxis', 'Sensor axis pointing up')}
          {num('tiltDegrees', 'Counts as tilted at (°)', 5, 80)}
          {num('shakeG', 'Shake strength (g)', 0.2, 3, 0.1)}
          {num('movingDps', 'Counts as moving at (°/s)', 5, 500, 5)}
        </section>
        <section>
          <h3>Gesture and color sensor</h3>
          <label className="field">
            <span>Sensor rotation</span>
            <select value={c.gestureRotation} onChange={(e) => set('gestureRotation', Number(e.target.value) as HardwareConfig['gestureRotation'])}>
              {[0, 90, 180, 270].map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
            <small>Change this if swipe directions come out wrong.</small>
          </label>
          {num('proximityNear', '"Object nearby" at (0–255)', 1, 255)}
          {num('lightFullScale', 'Light level 100% at (raw)', 10, 65535, 10)}
          {num('colorMinClear', 'Too dark to see color below (raw)', 0, 65535)}
          {num('colorMinSaturation', 'White if color strength below', 0, 1, 0.05)}
        </section>
      </div>
      <details className="pinmap">
        <summary>Eaglets PCB V6.2 pin map (read only)</summary>
        <table>
          <tbody>
            {V62_PINS.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [notices, setNotices] = useState<string | null>(null);
  const [noticesFailed, setNoticesFailed] = useState(false);
  const loadNotices = () => {
    if (notices !== null) return;
    fetch(`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setNotices)
      .catch(() => setNoticesFailed(true));
  };
  return (
    <Modal title="About Eaglets Code" onClose={onClose} wide>
      <p>
        <b>Eaglets Code {__APP_VERSION__}</b>. Block and Python programming for the Eaglets robot kit.
        <br />
        Copyright © 2026 Eaglets. Free and open-source under the MIT License.
      </p>

      <h3>Your privacy</h3>
      <p>
        Eaglets Code has no accounts, ads, analytics or tracking, and doesn't send anything to Eaglets or anyone else. Your programs and settings are saved only on this computer, and copied onto
        the robot when you press Run. To remove them, clear this app's site data or uninstall it. Please don't put full names, addresses or other personal details into project names. Questions: <a href="mailto:eaglets.kits@gmail.com">eaglets.kits@gmail.com</a>
      </p>

      <h3>Safety</h3>
      <div className="callout callout-warn">
        Robots have moving parts and batteries. Children should use them with an adult nearby. <b>The robot's power switch is the real emergency stop</b>, because software can't stop a robot
        whose controller has frozen. Keep fingers, hair and loose clothing away from the wheels.
      </div>

      <h3>No warranty</h3>
      <p className="legal-small">
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
        NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
        OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
      </p>

      <details className="notices" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadNotices()}>
        <summary>Open-source software used in Eaglets Code</summary>
        <p className="legal-small">
          Built with Blockly (Raspberry Pi Foundation, Apache-2.0), React (MIT), CodeMirror (MIT) and the Fredoka font (SIL Open Font License 1.1). The desktop app also uses Electron and Chromium.
          Full licence texts:
        </p>
        {noticesFailed ? (
          <p className="muted">Couldn't load the notices file. It's also included as THIRD_PARTY_NOTICES.txt with the app.</p>
        ) : (
          <pre className="notices-text" aria-label="Third-party licences">
            {notices ?? 'Loading…'}
          </pre>
        )}
      </details>
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Connecting your robot" onClose={onClose} wide>
      <ol className="steps">
        <li>
          <b>Wheels up.</b> Put the robot on a stand or hold it so the wheels can't touch the table the first time.
        </li>
        <li>
          <b>Plug in the USB cable</b> from the robot's Pico to the computer.
        </li>
        <li>
          <b>Switch the battery ON</b> if your program uses motors. USB alone runs the lights and sensors, but the motors need batteries.
        </li>
        <li>
          Click <b>Connect Robot</b>, choose the port that says <i>Board in FS mode</i>, <i>Pico</i> or <i>USB Serial</i>, then click <b>Connect</b>.
        </li>
        <li>
          Press <b>Run</b>. The first time, Eaglets Code copies its robot library onto the Pico. That takes a few seconds.
        </li>
        <li>
          Press <b>Stop</b> to stop the program. The motors and lights switch off.
        </li>
      </ol>
      <div className="callout callout-warn">
        <b>The power switch is the real emergency stop.</b> If the robot doesn't stop when you press Stop, or the cable comes out while it's driving, switch the robot's power OFF. With USB plugged in, the Pico stays on even with the switch off, but the motors lose power.
      </div>
      <h3>Trouble?</h3>
      <ul>
        <li>
          <b>"Being used by another program":</b> close any other program using the robot (another Eaglets Code window, or an old copy of Thonny), then connect again.
        </li>
        <li>
          <b>No robot in the list:</b> try another cable. Some USB cables only charge and can't carry data.
        </li>
        <li>
          <b>Connect doesn't appear to work:</b> use the Eaglets Code desktop app, or Chrome or Edge on a computer or Chromebook. Safari, Firefox, iPads and phones can't use USB. The Simulator tab works anywhere.
        </li>
        <li>
          <b>"MicroPython isn't responding" or a brand-new Pico?</b> Use <b>More → Install MicroPython</b>.
        </li>
      </ul>
    </Modal>
  );
}
