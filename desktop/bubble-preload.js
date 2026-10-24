const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("host", {
  on: (ch, fn) => ipcRenderer.on(ch, (e, d) => fn(d)),
  mouse: (over) => ipcRenderer.send("bubble:mouse", over),
  move: (x, y) => ipcRenderer.send("bubble:move", x, y),
  where: () => ipcRenderer.sendSync("bubble:where"),
  area: () => ipcRenderer.sendSync("bubble:area"),
  open: () => ipcRenderer.send("bubble:open"),
  typing: (on) => ipcRenderer.send("bubble:typing", on),
  send: (text) => ipcRenderer.send("bubble:send", text),
  answer: (yes) => ipcRenderer.send("bubble:answer", yes),
});
