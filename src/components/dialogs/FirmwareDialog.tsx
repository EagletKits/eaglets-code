import { useEffect, useRef, useState } from 'react';
import { Modal } from './Dialogs';
import { compareVersions, desktopFlashing, flashWithFolderPicker, loadBundledFirmware, type BundledFirmware } from '../../robot/firmware';

type Step =
  | { kind: 'intro' }
  | { kind: 'restarting' }
  | { kind: 'waiting-drive' }
  | { kind: 'choose-drive' }
  | { kind: 'writing' }
  | { kind: 'rebooting' }
  | { kind: 'done'; version: string | null }
  | { kind: 'error'; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thonny's "Install or update MicroPython", using the firmware bundled with the app. */
export function FirmwareDialog({
  connected,
  busy,
  boardRelease,
  onRestartRobot,
  isConnected,
  currentRelease,
  log,
  onClose,
}: {
  connected: boolean;
  busy: boolean;
  /** MicroPython version on the connected robot, if any. */
  boardRelease: string | null;
  /** Put the connected robot into BOOTSEL mode. */
  onRestartRobot: () => Promise<void>;
  /** Live checks, read while waiting for the robot to come back. */
  isConnected: () => boolean;
  currentRelease: () => string | null;
  log: (text: string) => void;
  onClose: () => void;
}) {
  const [firmware, setFirmware] = useState<{ info: BundledFirmware; data: Uint8Array } | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    loadBundledFirmware()
      .then(setFirmware)
      .catch((e: Error) => setLoadError(e.message));
    return () => {
      alive.current = false;
    };
  }, []);

  const desktop = desktopFlashing();
  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    log(`Firmware install failed: ${message}`);
    if (alive.current) setStep({ kind: 'error', message });
  };

  /** After the copy, the Pico restarts with MicroPython and the app reconnects by itself. */
  const waitForRobot = async () => {
    setStep({ kind: 'rebooting' });
    for (let i = 0; i < 40 && alive.current; i++) {
      if (isConnected()) break;
      await sleep(500);
    }
    if (!alive.current) return;
    const version = isConnected() ? currentRelease() : null;
    log(`Firmware install finished; robot ${version ? `reconnected with MicroPython ${version}` : 'not reconnected yet'}`);
    setStep({ kind: 'done', version });
  };

  const writeDesktop = async (drive: string) => {
    setStep({ kind: 'writing' });
    log(`Copying ${firmware!.info.file} to ${drive}`);
    await window.eagletsDesktop!.writeFirmware(drive, firmware!.data);
    await waitForRobot();
  };

  const start = async () => {
    if (!firmware) return;
    try {
      log(`Firmware install started (MicroPython ${firmware.info.version})`);
      if (connected) {
        setStep({ kind: 'restarting' });
        await onRestartRobot();
      }
      if (!desktop) {
        setStep({ kind: 'choose-drive' });
        return;
      }
      setStep(connected ? { kind: 'restarting' } : { kind: 'waiting-drive' });
      // The drive appears a second or two after the Pico restarts, or whenever someone plugs one in holding BOOTSEL.
      for (let i = 0; i < 240 && alive.current; i++) {
        const drive = await window.eagletsDesktop!.findBootDrive();
        if (drive) return await writeDesktop(drive);
        if (i === 10) setStep({ kind: 'waiting-drive' });
        await sleep(500);
      }
      if (alive.current) fail(new Error('No Pico showed up. Hold BOOTSEL while you plug it in, then try again.'));
    } catch (e) {
      fail(e);
    }
  };

  const chooseDrive = async () => {
    try {
      if (!(await flashWithFolderPicker(firmware!.data))) return;
      log(`Copied ${firmware!.info.file} with the folder picker`);
      await waitForRobot();
    } catch (e) {
      fail(e);
    }
  };

  const bundled = firmware?.info.version;
  const status = (() => {
    if (!connected || !boardRelease || !bundled) return null;
    const c = compareVersions(boardRelease, bundled);
    if (c < 0) return { kind: 'warn', text: `This robot has MicroPython ${boardRelease}. Updating to ${bundled} is recommended.` };
    if (c === 0) return { kind: 'ok', text: `This robot already has MicroPython ${boardRelease}, the version Eaglets Code is tested with.` };
    return { kind: 'ok', text: `This robot has MicroPython ${boardRelease}, newer than the bundled ${bundled}. You don't need to install anything.` };
  })();

  const working = step.kind === 'restarting' || step.kind === 'writing' || step.kind === 'rebooting';
  return (
    <Modal title="Install MicroPython" onClose={onClose} wide>
      {firmware === undefined && !loadError && <p className="muted">Loading…</p>}
      {loadError && <p className="notice notice-error">{loadError}</p>}
      {firmware === null && (
        <p className="callout callout-warn">
          This copy of Eaglets Code was built without the MicroPython firmware. Run <code>npm run fetch-firmware</code>, then build again.
        </p>
      )}
      {firmware && (
        <>
          <p>
            Puts <b>MicroPython {firmware.info.version}</b> for the Raspberry Pi Pico 2 onto the robot. It's included with Eaglets Code, so no internet is needed. Files already on the
            robot are normally kept.
          </p>

          {step.kind === 'intro' && (
            <>
              {status && <p className={`callout ${status.kind === 'warn' ? 'callout-warn' : ''}`}>{status.text}</p>}
              {connected ? (
                <p>The robot will restart into install mode by itself. Keep the USB cable plugged in.</p>
              ) : (
                <ol className="steps">
                  <li>Unplug the robot's USB cable.</li>
                  <li>
                    Hold down the white <b>BOOTSEL</b> button on the Pico.
                  </li>
                  <li>Plug the USB cable back in, then let go of the button.</li>
                  <li>{desktop ? 'Press Install below. Eaglets Code finds the Pico by itself.' : 'Press Install below, then choose the drive called RP2350.'}</li>
                </ol>
              )}
              <div className="row">
                <button className="btn btn-primary" onClick={() => void start()} disabled={busy}>
                  Install MicroPython {firmware.info.version}
                </button>
                {busy && <span className="muted">Press Stop first: the robot is busy.</span>}
              </div>
            </>
          )}

          {step.kind === 'restarting' && <p className="fw-progress">Restarting the robot into install mode…</p>}
          {step.kind === 'waiting-drive' && (
            <div className="fw-progress">
              <p>
                <b>Waiting for the Pico…</b>
              </p>
              <p>Hold BOOTSEL on the Pico while you plug in its USB cable. Eaglets Code will spot it and carry on.</p>
            </div>
          )}
          {step.kind === 'choose-drive' && (
            <div className="fw-progress">
              <p>
                A drive called <b>RP2350</b> has appeared (it can take a few seconds). Press the button and choose it. Chrome will ask to let Eaglets Code change files on it: say
                yes.
              </p>
              <button className="btn btn-primary" onClick={() => void chooseDrive()}>
                Choose the RP2350 drive
              </button>
            </div>
          )}
          {step.kind === 'writing' && <p className="fw-progress">Copying MicroPython onto the Pico… don't unplug it.</p>}
          {step.kind === 'rebooting' && <p className="fw-progress">MicroPython is installed. The robot is restarting…</p>}
          {step.kind === 'done' && (
            <p className="notice notice-success">
              {step.version ? `Done. The robot is back with MicroPython ${step.version}.` : 'Done. The robot is restarting with MicroPython: click Connect Robot to use it.'}
            </p>
          )}
          {step.kind === 'error' && (
            <>
              <p className="notice notice-error">{step.message}</p>
              <button className="btn" onClick={() => setStep({ kind: 'intro' })}>
                Try again
              </button>
            </>
          )}
          {!working && step.kind !== 'intro' && step.kind !== 'error' && step.kind !== 'done' && (
            <button className="link" onClick={() => setStep({ kind: 'intro' })}>
              Start over
            </button>
          )}
          <p className="muted fw-small">
            Official build {firmware.info.file} from micropython.org (MIT licence). Your Eaglets robot library is put back automatically the next time you press Run.
          </p>
        </>
      )}
    </Modal>
  );
}
