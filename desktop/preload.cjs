'use strict';
// The only things the page can ask the desktop app to do beyond a normal web
// page: find a Pico waiting for firmware, and copy the bundled firmware onto it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eagletsDesktop', {
  findBootDrive: () => ipcRenderer.invoke('eaglets:find-boot-drive'),
  writeFirmware: (drive, data) => ipcRenderer.invoke('eaglets:write-firmware', drive, data),
});
