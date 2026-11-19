const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  info: () => ipcRenderer.invoke("setup:info"),
  save: (url) => ipcRenderer.invoke("setup:save", url),
});
