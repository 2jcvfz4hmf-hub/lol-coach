import { contextBridge, ipcRenderer } from "electron";
import type { Api, AppState } from "./shared.ts";

const api: Api = {
  analyseRecent: (count: number) => ipcRenderer.invoke("analyse-recent", count),
  onState: (cb: (s: AppState) => void) => {
    ipcRenderer.on("state", (_e, s: AppState) => cb(s));
  },
};

contextBridge.exposeInMainWorld("coach", api);
