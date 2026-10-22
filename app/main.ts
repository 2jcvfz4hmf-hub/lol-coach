import { app, BrowserWindow, ipcMain, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { championIcon, loadChampions, type ChampionIndex, type ChampionInfo } from "../src/data/ddragon.ts";
import type { PoolStats } from "../src/draft/pool.ts";
import { compAdvice, suggestPicks } from "../src/draft/recommend.ts";
import { draftFromSession } from "../src/draft/session.ts";
import { findClient, lcuGet, type LcuCredentials } from "../src/lcu/connection.ts";
import type { ChampSelectSession, CurrentSummoner, GameflowPhase } from "../src/lcu/types.ts";
import { analyseLatest, analyseRecent, fullReport, loadPool } from "../src/pipeline.ts";
import { RiotClient } from "../src/riot/client.ts";
import type { AppState, ChampionView, Settings } from "./shared.ts";

// Région du client LoL -> serveur de l'API Riot.
const PLATFORM: Record<string, string> = {
  EUW: "euw1",
  EUNE: "eun1",
  NA: "na1",
  KR: "kr",
  BR: "br1",
  LAN: "la1",
  LAS: "la2",
  OCE: "oc1",
  TR: "tr1",
  RU: "ru",
  JP: "jp1",
  ME: "me1",
};
const IN_GAME: GameflowPhase[] = ["GameStart", "InProgress", "WaitingForStats", "PreEndOfGame"];
const POLL_MS = 2000;

let win: BrowserWindow | undefined;
let settings: Settings = {};
let state: AppState = { client: "absent", phase: "None", hasKey: false };

let creds: LcuCredentials | undefined;
let summoner: CurrentSummoner | undefined;
let region: string | undefined;
let riot: RiotClient | undefined;
let champions: { version: string; champions: ChampionIndex } | undefined;
let pool: PoolStats | undefined;
let lastAnalysedMatch: string | undefined;
let pendingPostGame = false;

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  win?.webContents.send("state", state);
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsFile(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function friendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message === "fetch failed" ? "Impossible de joindre l'API Riot, vérifie ta connexion internet." : message;
}

/** Recrée le client de l'API Riot quand la clé ou le serveur change. */
function refreshRiot() {
  const platform = settings.platform || PLATFORM[region ?? ""] || "euw1";
  riot = settings.apiKey
    ? new RiotClient({ apiKey: settings.apiKey, platform, cacheDir: path.join(app.getPath("userData"), "cache") })
    : undefined;
  setState({ hasKey: !!riot });
}

async function refreshPool() {
  if (!riot || !summoner) return;
  setState({ busy: "Chargement de tes dernières parties…" });
  try {
    pool = await loadPool(riot, summoner.puuid);
    const games = [...pool.champions.values()].reduce((s, e) => s + e.games, 0);
    setState({ poolGames: games, busy: undefined, error: undefined });
  } catch (e) {
    setState({ busy: undefined, error: friendlyError(e) });
  }
}

async function onClientConnected(c: LcuCredentials) {
  creds = c;
  summoner = await lcuGet<CurrentSummoner>(c, "/lol-summoner/v1/current-summoner");
  try {
    region = (await lcuGet<{ region: string }>(c, "/riotclient/region-locale")).region;
  } catch {
    region = undefined;
  }
  setState({ client: "connecte", summoner: `${summoner.gameName}#${summoner.tagLine}` });
  champions ??= await loadChampions();
  refreshRiot();
  void refreshPool();
}

function view(c: ChampionInfo): ChampionView {
  return { name: c.name, icon: championIcon(champions!.version, c) };
}

async function updateDraft() {
  if (!creds || !champions) return;
  const session = await lcuGet<ChampSelectSession>(creds, "/lol-champ-select/v1/session");
  const d = draftFromSession(session, champions.champions);
  const suggestions = pool
    ? suggestPicks(d.state, pool, champions.champions).map((s) => ({ ...view(s.champion), wins: s.wins, games: s.games, reasons: s.reasons }))
    : [];
  setState({
    draft: {
      position: d.state.position,
      me: d.myChampion && view(d.myChampion),
      allies: d.allySlots.map((s) => ({ ...(s.champion ? view(s.champion) : { name: "", icon: "" }), position: s.position, me: s.me })),
      enemies: d.enemySlots.map((c) => (c ? view(c) : null)),
      suggestions,
      advice: compAdvice(d.state.enemies),
    },
  });
}

async function postGameAnalysis(attempt = 0) {
  if (!riot || !summoner) return;
  try {
    const result = await analyseLatest(riot, summoner.puuid, lastAnalysedMatch);
    if (!result) {
      // L'API Riot met souvent une à deux minutes à publier la partie.
      if (attempt < 10) setTimeout(() => void postGameAnalysis(attempt + 1), 30_000);
      else setState({ busy: undefined });
      return;
    }
    lastAnalysedMatch = result.matchId;
    setState({ busy: undefined, report: { title: "Ta dernière partie", markdown: result.report } });
    void refreshPool();
  } catch (e) {
    setState({ busy: undefined, error: friendlyError(e) });
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (!creds) {
      const found = await findClient();
      if (!found) {
        setState({ client: "absent", phase: "None" });
        return;
      }
      await onClientConnected(found);
    }
    const phase = await lcuGet<GameflowPhase>(creds!, "/lol-gameflow/v1/gameflow-phase");
    if (phase === "ChampSelect") await updateDraft();
    else if (!IN_GAME.includes(phase)) {
      // On garde la draft affichée pendant la partie, pour le build.
      if (state.draft) setState({ draft: undefined });
    }
    if (IN_GAME.includes(phase)) pendingPostGame = true;
    if (pendingPostGame && (phase === "EndOfGame" || phase === "Lobby" || phase === "None")) {
      pendingPostGame = false;
      setState({ busy: "Analyse de ta partie dès que Riot la publie…" });
      void postGameAnalysis();
    }
    if (phase !== state.phase) setState({ phase });
  } catch {
    // Client fermé ou redémarré : on le recherchera au prochain tour.
    creds = undefined;
  } finally {
    ticking = false;
  }
}

ipcMain.handle("get-settings", () => settings);
ipcMain.handle("save-settings", async (_e, s: Settings) => {
  settings = { apiKey: s.apiKey?.trim() || undefined, platform: s.platform?.trim() || undefined };
  await writeFile(settingsFile(), JSON.stringify(settings));
  refreshRiot();
  void refreshPool();
});
ipcMain.handle("analyse-recent", async (_e, count: number) => {
  if (!riot || !summoner) return;
  try {
    const games = await analyseRecent(riot, summoner.puuid, count, "ranked", (done, total) =>
      setState({ busy: `Analyse de tes parties : ${done}/${total}` }),
    );
    setState({ busy: undefined, error: undefined, report: { title: `Bilan de tes ${games.length} dernières parties`, markdown: fullReport(state.summoner ?? "", games) } });
  } catch (e) {
    setState({ busy: undefined, error: friendlyError(e) });
  }
});

app.whenReady().then(async () => {
  settings = await readSettings();
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: "LoL Coach",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // Les liens s'ouvrent dans le navigateur, pas dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.send("state", state);
  setInterval(() => void tick(), POLL_MS);
  void tick();
});

app.on("window-all-closed", () => app.quit());
