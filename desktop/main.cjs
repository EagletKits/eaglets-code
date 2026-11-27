'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { choosePort } = require('./ports.cjs');
const { findBootDrive, writeFirmware } = require('./bootDrive.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.ELECTRON_DEV_URL; // e.g. http://localhost:5173 while `npm run dev` is running
const MOCK = process.env.EAGLETS_MOCK === '1'; // practice robot instead of USB, for testing

// Web Serial only works in a secure context, so the built app is served from a
// custom secure scheme rather than file://.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveDist() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function setUpSerial(win) {
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      callback(id);
    };
    const decision = choosePort(portList);
    if (decision.action === 'pick') return finish(decision.portId);
    if (decision.action === 'none') {
      void dialog
        .showMessageBox(win, {
          type: 'info',
          message: 'No robot found',
          detail: 'Plug the robot in with a USB data cable (some cables only charge), then press Connect Robot again.',
        })
        .then(() => finish(''));
      return;
    }
    const names = decision.choices.map((c) => c.label);
    void dialog
      .showMessageBox(win, { type: 'question', message: 'Which robot?', buttons: [...names, 'Cancel'], cancelId: names.length, defaultId: 0 })
      .then(({ response }) => finish(response < names.length ? decision.choices[response].portId : ''));
  });
}

/** Only our own page may ask for firmware work, never a page it navigated to. */
function fromApp(event) {
  try {
    const u = new URL(event.senderFrame?.url ?? '');
    // app:// isn't a scheme Node knows, so its .origin is "null"; compare scheme and host instead.
    return DEV_URL ? u.origin === new URL(DEV_URL).origin : u.protocol === 'app:' && u.host === 'app';
  } catch {
    return false;
  }
}

function setUpFirmware() {
  ipcMain.handle('eaglets:find-boot-drive', (event) => (fromApp(event) ? findBootDrive() : null));
  ipcMain.handle('eaglets:write-firmware', (event, drive, data) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    return writeFirmware(drive, data);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Eaglets Code',
    backgroundColor: '#0b1633',
    // spellcheck off: Chromium's spellchecker can download dictionaries from
    // Google, and the privacy policy promises the app makes no network requests.
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  setUpSerial(win);

  // Keep the window on the app; send any web link to the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const origin = DEV_URL ? new URL(DEV_URL).origin : 'app://app';
    if (new URL(url).origin !== origin) {
      e.preventDefault();
      if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
    }
  });

  const query = MOCK ? '?mock=1' : '';
  void win.loadURL(DEV_URL ? `${DEV_URL}/${query}` : `app://app/${query}`);
  return win;
}

app.whenReady().then(() => {
  if (!DEV_URL) serveDist();
  setUpFirmware();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
