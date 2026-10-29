import { contextBridge, ipcRenderer } from "electron";
import type { Api, AppState } from "./shared.ts";

const api: Api = {
  analyseRecent: (count: number) => ipcRenderer.invoke("analyse-recent", count),
  profile: (riotId?: string) => ipcRenderer.invoke("profile", riotId),
  gameDetail: (puuid: string, matchId: string) => ipcRenderer.invoke("game-detail", puuid, matchId),
  tierList: (position: string) => ipcRenderer.invoke("tier-list", position),
  champions: () => ipcRenderer.invoke("champions"),
  champion: (id: number, position?: string) => ipcRenderer.invoke("champion", id, position),
  buildChoices: () => ipcRenderer.invoke("build-choices"),
  setRank: (rank) => ipcRenderer.invoke("set-rank", rank),
  teamIdentity: () => ipcRenderer.invoke("team-identity"),
  saveTeamBuild: (championId, category, build, code, author) => ipcRenderer.invoke("save-team-build", championId, category, build, code, author),
  onState: (cb: (s: AppState) => void) => {
    ipcRenderer.on("state", (_e, s: AppState) => cb(s));
  },
};

contextBridge.exposeInMainWorld("coach", api);
