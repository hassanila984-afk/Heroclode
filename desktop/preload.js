// What Firefly's page can call on Windows: window.AndroidLuma, the same bridge the Android app offers
// (so the page works unchanged), with platform() saying it's a computer.
const { contextBridge, ipcRenderer, webFrame } = require("electron");
const get = (name, ...a) => ipcRenderer.sendSync("luma:sync", name, ...a);
const send = (name, ...a) => ipcRenderer.send("luma:do", name, ...a);

contextBridge.exposeInMainWorld("AndroidLuma", {
  isApp: () => true,
  platform: () => "windows",
  version: () => get("version"),
  // hearing: calls use the mic through the page (Whisper); there's no phone recognizer here
  canListen: () => false, listen() {}, stopListen() {},
  // her bubble on the desktop
  bubbleShow: () => send("bubbleShow"), bubbleHide: () => send("bubbleHide"), bubbleOn: () => get("bubbleOn"),
  bubbleSay: (text, mood) => send("bubbleSay", String(text || ""), String(mood || "")),
  bubbleText: (text) => send("bubbleText", String(text || "")),
  stayWithMe: (on) => send("stayWithMe", !!on),
  // seeing the screen (no dialog each time; they turn it on with "Show her my screen")
  startCapture: () => send("startCapture"), stopCapture: () => send("stopCapture"),
  capturing: () => get("capturing"), frame: () => get("frame") || "", captureInfo: () => get("captureInfo"),
  // her hands on the computer
  doAction: (name, arg) => ipcRenderer.invoke("luma:act", String(name || ""), String(arg || "")),
  accessOn: () => get("accessOn"), accessOpen: () => send("accessOpen"),
  screen: () => get("screen") || "", answerAsk: (yes) => send("answerAsk", !!yes), autoScrolling: () => get("autoScrolling"),
  // signing in with the access code
  askCode: (text) => ipcRenderer.invoke("luma:askCode", String(text || "")),
  // reaching out on her own: a message or a call; how long he's been away from the keyboard
  notify: (text, call) => send("notify", String(text || ""), !!call), showMain: () => send("showMain"), pendingCall: () => get("pendingCall") || "", idleSecs: () => get("idleSecs"),
});
// The built-in speech recognizer doesn't work in desktop apps; without it the page hears through the mic (Whisper).
webFrame.executeJavaScript("try { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; } catch (e) {}");
