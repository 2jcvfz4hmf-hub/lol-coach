import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { championIcon, loadChampions, type ChampionIndex, type ChampionInfo } from "../src/data/ddragon.ts";
import type { PoolStats } from "../src/draft/pool.ts";
import { compAdvice, suggestPicks } from "../src/draft/recommend.ts";
import { draftFromSession } from "../src/draft/session.ts";
import { findClient, lcuGet, type LcuCredentials } from "../src/lcu/connection.ts";
import { LcuSource } from "../src/lcu/history.ts";
import type { ChampSelectSession, CurrentSummoner, GameflowPhase } from "../src/lcu/types.ts";
import { analyseLatest, analyseRecent, fullReport, loadPool } from "../src/pipeline.ts";
import type { AppState, ChampionView } from "./shared.ts";

// Tout passe par le client LoL du joueur : aucune clé ni pseudo à saisir.
const IN_GAME: GameflowPhase[] = ["GameStart", "InProgress", "WaitingForStats", "PreEndOfGame"];
const POLL_MS = 2000;

let win: BrowserWindow | undefined;
let state: AppState = { client: "absent", phase: "None" };

let creds: LcuCredentials | undefined;
let summoner: CurrentSummoner | undefined;
let source: LcuSource | undefined;
let champions: { version: string; champions: ChampionIndex } | undefined;
let pool: PoolStats | undefined;
let lastAnalysedMatch: string | undefined;
let pendingPostGame = false;

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  win?.webContents.send("state", state);
}

function friendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message === "fetch failed" ? "Pas de connexion internet (nécessaire pour les données des champions)." : message;
}

async function refreshPool() {
  if (!source || !summoner) return;
  setState({ busy: "Lecture de tes dernières parties…" });
  try {
    pool = await loadPool(source, summoner.puuid);
    const games = [...pool.champions.values()].reduce((s, e) => s + e.games, 0);
    setState({ poolGames: games, busy: undefined, error: undefined });
  } catch (e) {
    setState({ busy: undefined, error: friendlyError(e) });
  }
}

async function onClientConnected(c: LcuCredentials) {
  creds = c;
  summoner = await lcuGet<CurrentSummoner>(c, "/lol-summoner/v1/current-summoner");
  setState({ client: "connecte", summoner: `${summoner.gameName}#${summoner.tagLine}` });
  champions ??= await loadChampions();
  source = new LcuSource(c, summoner.puuid, champions.champions);
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
  if (!source || !summoner) return;
  try {
    const result = await analyseLatest(source, summoner.puuid, lastAnalysedMatch);
    if (!result) {
      // L'historique du client peut mettre quelques secondes à se mettre à jour.
      if (attempt < 10) setTimeout(() => void postGameAnalysis(attempt + 1), 15_000);
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
    if (IN_GAME.includes(phase) && !pendingPostGame) {
      pendingPostGame = true;
      // On note la dernière partie connue pour ne pas la reprendre pour la nouvelle.
      void source?.recentGameIds(1, false).then(([id]) => (lastAnalysedMatch = id ?? lastAnalysedMatch), () => undefined);
    }
    if (pendingPostGame && (phase === "EndOfGame" || phase === "Lobby" || phase === "None")) {
      pendingPostGame = false;
      setState({ busy: "Analyse de ta partie…" });
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

ipcMain.handle("analyse-recent", async (_e, count: number) => {
  if (!source || !summoner) return;
  try {
    const games = await analyseRecent(source, summoner.puuid, count, (done, total) =>
      setState({ busy: `Analyse de tes parties : ${done}/${total}` }),
    );
    setState({ busy: undefined, error: undefined, report: { title: `Bilan de tes ${games.length} dernières parties`, markdown: fullReport(state.summoner ?? "", games) } });
  } catch (e) {
    setState({ busy: undefined, error: friendlyError(e) });
  }
});

app.whenReady().then(async () => {
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
