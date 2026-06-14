/**
 * preload-overlay.js
 * Runs in the overlay window's renderer process (isolated context).
 * Bridges IPC between main process and the overlay HTML.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Main → Overlay: start blinking with contact name
  onStartBlink: (callback) => {
    ipcRenderer.on("start-blink", (_event, contactName) =>
      callback(contactName),
    );
  },
  // Main → Overlay: stop blinking
  onStopBlink: (callback) => {
    ipcRenderer.on("stop-blink", callback);
  },
  // Overlay → Main: user clicked the dot to dismiss
  dismiss: () => ipcRenderer.send("dismiss"),
  // Overlay → Main: toggle click-through
  setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore-mouse", ignore),
  // Main → Overlay: play notification sound
  onPlaySound: (callback) => ipcRenderer.on("play-sound", callback),
});
