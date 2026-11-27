'use strict';

/** Raspberry Pi's USB vendor ID (0x2e8a) as Electron reports it: a decimal string. */
const RPI_VENDOR_ID = String(0x2e8a);

const label = (p) => p.displayName || p.portName || `USB device ${p.portId}`;

/**
 * Decide what to do when the page asks for a serial port.
 *  - exactly one Pico: use it, no dialog
 *  - several Picos: ask which one
 *  - no Pico but other serial ports: ask, so a robot with an unusual ID is still reachable
 *  - nothing: tell the user to check the cable
 */
function choosePort(portList) {
  const picos = portList.filter((p) => p.vendorId === RPI_VENDOR_ID);
  if (picos.length === 1) return { action: 'pick', portId: picos[0].portId };
  const candidates = picos.length ? picos : portList;
  if (candidates.length === 0) return { action: 'none' };
  return { action: 'ask', choices: candidates.map((p) => ({ portId: p.portId, label: label(p) })) };
}

module.exports = { choosePort, RPI_VENDOR_ID };
