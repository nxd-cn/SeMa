const { contextBridge, ipcRenderer, clipboard } = require("electron");
const {
  clipboardAction,
  selectionDeleteAction,
  selectionDeletePayload,
  lineClearAction,
  LINE_CLEAR_PAYLOAD,
  undoAction,
  UNDO_PAYLOAD,
} = require("./clipboard-keys");
const { shouldSuppressForImeComposition } = require("./ime-composition-keys");
const {
  chatSubmitKeyAction,
  dataLooksLikeSubmit,
} = require("./continue-dismiss-keys");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

contextBridge.exposeInMainWorld("tui", {
  isMac,
  isWin,
  createSession: (opts) => ipcRenderer.invoke("session:create", opts),
  respawnSession: (opts) => ipcRenderer.invoke("session:respawn", opts),
  discoverCliSession: (opts) =>
    ipcRenderer.invoke("session:discoverCliSession", opts),
  killSession: (id) => ipcRenderer.invoke("session:kill", id),
  write: (id, data) => ipcRenderer.send("session:write", id, data),
  resize: (id, cols, rows) => ipcRenderer.send("session:resize", id, cols, rows),
  listCli: () => ipcRenderer.invoke("cli:list"),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (partial) => ipcRenderer.invoke("prefs:set", partial),
  focusWindow: () => ipcRenderer.invoke("window:focus"),
  setUnreadBadge: (count) =>
    ipcRenderer.invoke("badge:set", { count: Number(count) || 0 }),
  clipboardRead: () => clipboard.readText(),
  clipboardWrite: (text) => clipboard.writeText(String(text ?? "")),
  clipboardAction: (ev, hasSelection) =>
    clipboardAction(ev, { hasSelection: !!hasSelection, isMac }),
  selectionDeleteAction: (ev, hasSelection) =>
    selectionDeleteAction(ev, { hasSelection: !!hasSelection }),
  selectionDeletePayload: (text) => selectionDeletePayload(text),
  lineClearAction: (ev) => lineClearAction(ev),
  LINE_CLEAR_PAYLOAD,
  undoAction: (ev) => undoAction(ev, { isMac }),
  UNDO_PAYLOAD,
  shouldSuppressForImeComposition: (ev) => shouldSuppressForImeComposition(ev),
  chatSubmitKeyAction: (ev) => chatSubmitKeyAction(ev),
  dataLooksLikeSubmit: (data) => dataLooksLikeSubmit(data),
  onData: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("session:data", handler);
    return () => ipcRenderer.removeListener("session:data", handler);
  },
  onExit: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("session:exit", handler);
    return () => ipcRenderer.removeListener("session:exit", handler);
  },
});
