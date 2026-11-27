import { useEffect, useRef, useState } from 'react';
import { Modal } from './Dialogs';
import {
  BOARD_NAME,
  chipFromMachine,
  compareVersions,
  desktopFlashing,
  flashWithFolderPicker,
  loadFirmwareData,
  loadFirmwareManifest,
  type Chip,
  type FirmwareManifest,
} from '../../robot/firmware';

type Step =
  | { kind: 'intro' }
  | { kind: 'restarting' }
  | { kind: 'waiting-drive' }
  | { kind: 'choose-drive' }
  | { kind: 'writing'; chip: Chip }
  | { kind: 'rebooting' }
  | { kind: 'done'; version: string | null }
  | { kind: 'error'; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thonny's "Install or update MicroPython", using the firmware bundled with the app. */
export function FirmwareDialog({
  connected,
  busy,
  boardMachine,
  boardRelease,
  onRestartRobot,
  isConnected,
  currentRelease,
  log,
  onClose,
}: {
  connected: boolean;
  busy: boolean;
  /** os.uname().machine of the connected robot, if any. */
  boardMachine: string | null;
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
  const [manifest, setManifest] = useState<FirmwareManifest | null | undefined>(undefined);
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void loadFirmwareManifest().then(setManifest);
    return () => {
      alive.current = false;
    };
  }, []);

  const desktop = desktopFlashing();
  const connectedChip = connected ? chipFromMachine(boardMachine) : null;

  const buildFor = (chip: Chip) => {
    const b = manifest?.builds.find((x) => x.chip === chip);
    if (!b) throw new Error(`This copy of Eaglets Code has no MicroPython for the ${BOARD_NAME[chip]}.`);
    return b;
  };
  /** Load and check the firmware for a chip, and say so in the debug log. */
  const dataFor = async (chip: Chip) => {
    const b = buildFor(chip);
    const data = await loadFirmwareData(b);
    log(`Firmware ${b.file} checked (${data.length} bytes)`);
    return data;
  };

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

  const start = async () => {
    if (!manifest) return;
    try {
      log(`Firmware install started (MicroPython ${manifest.version})`);
      if (connected) {
        if (!connectedChip) throw new Error(`This board (${boardMachine ?? 'unknown'}) isn't a Raspberry Pi Pico, so Eaglets Code can't install MicroPython on it.`);
        // Check the file before restarting the robot, so a bad file never leaves it stuck in install mode.
        await dataFor(connectedChip);
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
        const found = await window.eagletsDesktop!.findBootDrive();
        if (found) {
          const data = await dataFor(found.chip);
          setStep({ kind: 'writing', chip: found.chip });
          log(`Copying MicroPython to the ${BOARD_NAME[found.chip]} drive at ${found.drive}`);
          await window.eagletsDesktop!.writeFirmware(found.drive, data);
          return await waitForRobot();
        }
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
      const chip = await flashWithFolderPicker(dataFor);
      if (!chip) return;
      log(`Copied MicroPython for the ${BOARD_NAME[chip]} with the folder picker`);
      await waitForRobot();
    } catch (e) {
      fail(e);
    }
  };

  const version = manifest?.version;
  const status = (() => {
    if (!connected || !version) return null;
    if (!connectedChip) return { kind: 'warn', text: `This board (${boardMachine ?? 'unknown'}) isn't a Raspberry Pi Pico. Eaglets Code can only install MicroPython on a Pico or Pico 2.` };
    if (!boardRelease) return null;
    const name = BOARD_NAME[connectedChip];
    const c = compareVersions(boardRelease, version);
    if (c < 0) return { kind: 'warn', text: `This ${name} has MicroPython ${boardRelease}. Updating to ${version} is recommended.` };
    if (c === 0) return { kind: 'ok', text: `This ${name} already has MicroPython ${boardRelease}, the version Eaglets Code is tested with.` };
    return { kind: 'ok', text: `This ${name} has MicroPython ${boardRelease}, newer than the bundled ${version}. You don't need to install anything.` };
  })();

  const working = step.kind === 'restarting' || step.kind === 'writing' || step.kind === 'rebooting';
  return (
    <Modal title="Install MicroPython" onClose={onClose} wide>
      {manifest === undefined && <p className="muted">Loading…</p>}
      {manifest === null && (
        <p className="callout callout-warn">
          This copy of Eaglets Code was built without the MicroPython firmware. Run <code>npm run fetch-firmware</code>, then build again.
        </p>
      )}
      {manifest && (
        <>
          <p>
            Puts <b>MicroPython {manifest.version}</b> onto the robot's Raspberry Pi Pico 2 (or original Pico). It's included with Eaglets Code, so no internet is needed. Files
            already on the robot are normally kept.
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
                  <li>{desktop ? 'Press Install below. Eaglets Code finds the Pico by itself.' : 'Press Install below, then choose the drive called RP2350 (Pico 2) or RPI-RP2 (Pico).'}</li>
                </ol>
              )}
              <div className="row">
                <button className="btn btn-primary" onClick={() => void start()} disabled={busy || (connected && !connectedChip)}>
                  Install MicroPython {manifest.version}
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
                A drive called <b>RP2350</b> (Pico 2) or <b>RPI-RP2</b> (Pico) has appeared (it can take a few seconds). Press the button and choose it. Chrome will ask to let Eaglets
                Code change files on it: say yes.
              </p>
              <button className="btn btn-primary" onClick={() => void chooseDrive()}>
                Choose the Pico's drive
              </button>
            </div>
          )}
          {step.kind === 'writing' && <p className="fw-progress">Copying MicroPython onto the {BOARD_NAME[step.chip]}… don't unplug it.</p>}
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
            Official builds from micropython.org (MIT licence): {manifest.builds.map((b) => b.file).join(', ')}. Your Eaglets robot library is put back automatically the next time
            you press Run.
          </p>
        </>
      )}
    </Modal>
  );
}
