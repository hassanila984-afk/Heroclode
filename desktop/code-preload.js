const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("code", { answer: (v) => ipcRenderer.send("code:answer", v) });
