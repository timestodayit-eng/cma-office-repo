// What the office web page can ask the desktop app (window.cmaDesktop). Nothing else is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cmaDesktop", {
  version: 1,
  authUser: () => ipcRenderer.invoke("cma:authUser"),
  setAuth: (a) => ipcRenderer.invoke("cma:setAuth", a),
  state: () => ipcRenderer.invoke("cma:state"),
  start: () => ipcRenderer.invoke("cma:start"),
  stop: () => ipcRenderer.invoke("cma:stop"),
  onState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on("cma:state", fn);
    return () => ipcRenderer.removeListener("cma:state", fn);
  },
  retry: () => ipcRenderer.invoke("offline:retry"),
});
