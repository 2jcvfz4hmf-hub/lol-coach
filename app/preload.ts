import { contextBridge, ipcRenderer } from "electron";
import type { Api, AppState, Settings } from "./shared.ts";

const api: Api = {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s: Settings) => ipcRenderer.invoke("save-settings", s),
  analyseRecent: (count: number) => ipcRenderer.invoke("analyse-recent", count),
  onState: (cb: (s: AppState) => void) => {
    ipcRenderer.on("state", (_e, s: AppState) => cb(s));
  },
};

contextBridge.exposeInMainWorld("coach", api);
