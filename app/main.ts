import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { championIcon, itemIcon, loadGameData, runeIcon, type ChampionInfo, type GameData } from "../src/data/ddragon.ts";
import { buildAdvice, suggestBans, suggestGlobal, type Mastery } from "../src/draft/global.ts";
import { Crawler } from "../src/global/crawler.ts";
import { StatsStore } from "../src/global/store.ts";
import type { PoolStats } from "../src/draft/pool.ts";
import { compAdvice, suggestPicks } from "../src/draft/recommend.ts";
import { draftFromSession } from "../src/draft/session.ts";
import { findClient, lcuGet, liveClientGet, type LcuCredentials } from "../src/lcu/connection.ts";
import { LcuSource } from "../src/lcu/history.ts";
import type { ChampSelectSession, CurrentSummoner, GameflowPhase } from "../src/lcu/types.ts";
import { analyseLatest, analyseRecent, fullReport, loadPool } from "../src/pipeline.ts";
import { RiotClient } from "../src/riot/client.ts";
import { junglerHabits, scoutLines } from "../src/scout/jungler.ts";
import {
  junglerFromGameflow,
  junglerFromLive,
  lineupFromGameflow,
  lineupFromLive,
  type GameflowSession,
  type LineupPlayer,
  type LivePlayer,
} from "../src/scout/players.ts";
import { profilePlayer } from "../src/scout/profile.ts";
import { PERSONAL_KEY_LIMITS, RateLimiter } from "../src/riot/limiter.ts";
import type { AppState, BuildView, ChampionView, PlayerView, SuggestionView } from "./shared.ts";

// Tes parties sont lues dans le client LoL : aucun pseudo à saisir. Une clé Riot
// (facultative) permet de récolter les parties de tout le serveur pour les conseils.
const IN_GAME: GameflowPhase[] = ["GameStart", "InProgress", "WaitingForStats", "PreEndOfGame"];
const POLL_MS = 2000;

let win: BrowserWindow | undefined;
let state: AppState = { client: "absent", phase: "None", global: { hasKey: false, running: false, paused: false, games: 0 } };

let creds: LcuCredentials | undefined;
let summoner: CurrentSummoner | undefined;
let source: LcuSource | undefined;
let data: GameData | undefined;
let store: StatsStore | undefined;
let crawler: Crawler | undefined;
let riot: RiotClient | undefined;
/** Assez de parties pour que les stats du serveur soient plus fiables que les tiennes. */
const MIN_SERVER_GAMES = 1000;
let pool: PoolStats | undefined;
let mastery: Mastery | undefined;

async function refreshMastery() {
  try {
    const list = await lcuGet<{ championId: number; championPoints: number }[]>(creds!, "/lol-champion-mastery/v1/local-player/champion-mastery");
    mastery = new Map(list.map((m) => [m.championId, m.championPoints]));
  } catch {
    mastery = undefined; // format inattendu : on s'en passe
  }
}
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
  data ??= await loadGameData();
  source = new LcuSource(c, summoner.puuid, data.champions);
  void refreshPool();
  void refreshMastery();
}

function view(c: ChampionInfo): ChampionView {
  return { name: c.name, icon: championIcon(data!.version, c) };
}

function serverStats() {
  const best = store?.best();
  return best && best.games >= MIN_SERVER_GAMES ? best : undefined;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

async function updateDraft() {
  if (!creds || !data) return;
  const session = await lcuGet<ChampSelectSession>(creds, "/lol-champ-select/v1/session");
  const d = draftFromSession(session, data.champions);
  const stats = serverStats();
  let suggestions: SuggestionView[] = [];
  if (stats) {
    suggestions = suggestGlobal(d.state, stats, data.champions, pool, 6, mastery).map((s) => ({
      ...view(s.champion),
      wins: s.wins,
      games: s.games,
      reasons: [`≈ ${pct(s.expected)} de chances de victoire avec cette draft`, ...s.reasons],
    }));
  } else if (pool) {
    suggestions = suggestPicks(d.state, pool, data.champions).map((s) => ({ ...view(s.champion), wins: s.wins, games: s.games, reasons: s.reasons }));
  }

  let build: BuildView | undefined;
  const advice = stats && d.myChampion && d.state.enemies.length ? buildAdvice(stats, d.myChampion, d.state.enemies, data.items, data.runes) : undefined;
  if (advice) {
    const note = (p: { pick: number; winrate: number; note?: string }) =>
      [`pris dans ${pct(p.pick)} des parties`, `${pct(p.winrate)} de victoires`, p.note].filter(Boolean).join(" · ");
    build = {
      summary: advice.summary,
      keystone: advice.keystone && { name: advice.keystone.name, icon: runeIcon(advice.keystone.rune), note: note(advice.keystone) },
      items: advice.items.map((i) => ({ name: i.name, icon: itemIcon(data!.version, i.id), note: note(i) })),
    };
  }

  setState({
    draft: {
      position: d.state.position,
      me: d.myChampion && view(d.myChampion),
      allies: d.allySlots.map((s) => ({ ...(s.champion ? view(s.champion) : { name: "", icon: "" }), position: s.position, me: s.me })),
      enemies: d.enemySlots.map((c) => (c ? view(c) : null)),
      suggestions,
      advice: compAdvice(d.state.enemies),
      build,
      bans: stats ? suggestBans(d.state, stats, data.champions, d.myChampion).map((b) => ({ ...view(b.champion), reason: b.reason })) : [],
      source: stats ? "serveur" : "perso",
    },
  });
}

// --- Récolte des parties du serveur ---

const keyFile = () => path.join(app.getPath("userData"), "cle-riot.bin");

async function saveKey(key: string) {
  const bytes = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8");
  await writeFile(keyFile(), bytes);
}

async function readKey(): Promise<string | undefined> {
  try {
    const bytes = await readFile(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(bytes) : bytes.toString("utf8");
  } catch {
    return undefined;
  }
}

function updateGlobal() {
  const s = crawler?.status();
  setState({
    global: {
      hasKey: !!crawler,
      running: s?.running ?? false,
      paused: state.global.paused,
      games: store?.best()?.games ?? 0,
      patch: store?.best()?.patch,
      error: s?.error,
    },
  });
}

async function startCrawler(key: string) {
  store ??= await new StatsStore(path.join(app.getPath("userData"), "stats")).load();
  await crawler?.stop();
  riot = new RiotClient({ apiKey: key, platform: "euw1", limiter: new RateLimiter(PERSONAL_KEY_LIMITS) });
  crawler = new Crawler(riot, store, updateGlobal);
  // Pas de récolte pendant une partie, pour ne pas gêner ta connexion.
  if (!state.global.paused) crawler.start();
  updateGlobal();
}

// --- Jungler adverse, à l'écran de chargement ---

const SCOUT_GAMES = 8;
let scout: "a-faire" | "en-cours" | "fait" = "a-faire";

async function findPlayers() {
  const session = await lcuGet<GameflowSession>(creds!, "/lol-gameflow/v1/session");
  const me = summoner!;
  let jungler = junglerFromGameflow(session, me.puuid);
  let lineup = lineupFromGameflow(session, me.puuid);
  if (!jungler || !lineup) {
    try {
      const players = await liveClientGet<LivePlayer[]>("/liveclientdata/playerlist");
      jungler ??= junglerFromLive(players, `${me.gameName}#${me.tagLine}`);
      lineup ??= lineupFromLive(players, `${me.gameName}#${me.tagLine}`);
    } catch {
      // la partie n'est pas encore chargée
    }
  }
  return { jungler, lineup };
}

function championOf(p: { championId?: number; championName?: string }): ChampionView {
  const c = (p.championId && data?.champions.get(p.championId)) || [...(data?.champions.values() ?? [])].find((x) => x.name === p.championName);
  return c ? view(c) : { name: p.championName ?? "?", icon: "" };
}

/** Rang, forme et maîtrise des 10 joueurs. */
async function profileLineup(lineup: LineupPlayer[]) {
  const views = await Promise.all(
    lineup.map(async (p): Promise<PlayerView & { ally: boolean }> => {
      const base = { ally: p.ally, champion: championOf(p), name: p.gameName };
      try {
        const puuid = p.puuid ?? (await riot!.accountByRiotId(p.gameName!, p.tagLine!)).puuid;
        const championId = p.championId || (base.champion.name && [...data!.champions.values()].find((c) => c.name === base.champion.name)?.id);
        return { ...base, me: puuid === summoner?.puuid, ...(await profilePlayer(riot!, puuid, championId || undefined)) };
      } catch {
        return { ...base, me: false, rank: "?", badges: [] };
      }
    }),
  );
  setState({ lineup: { allies: views.filter((v) => v.ally), enemies: views.filter((v) => !v.ally) } });
}

/** Lit les dernières games du jungler adverse. Renvoie faux s'il faut réessayer plus tard. */
async function scoutEnemyJungler(): Promise<boolean> {
  if (!riot) {
    setState({ scout: { title: "Jungler adverse", lines: ["Ajoute ta clé Riot dans « Stats de tout le serveur » pour voir les habitudes du jungler adverse."] } });
    return true;
  }
  const { jungler: j, lineup } = await findPlayers();
  if (!j || !lineup) return false;
  void profileLineup(lineup);
  const champion = (j.championId && data?.champions.get(j.championId)?.name) || j.championName || "?";
  setState({ scout: { title: `Jungler adverse : ${champion}`, lines: ["Lecture de ses dernières games…"] } });
  const puuid = j.puuid ?? (await riot.accountByRiotId(j.gameName!, j.tagLine!)).puuid;
  const games = [];
  for (const id of await riot.matchIds(puuid, 20, "ranked")) {
    const match = await riot.match(id);
    if (match.info.participants.find((p) => p.puuid === puuid)?.teamPosition !== "JUNGLE") continue;
    games.push({ match, timeline: await riot.timeline(id) });
    if (games.length >= SCOUT_GAMES) break;
  }
  setState({ scout: { title: `Jungler adverse : ${champion}`, lines: scoutLines(junglerHabits(games, puuid)) } });
  return true;
}

function pauseCrawler(paused: boolean) {
  if (paused === state.global.paused) return;
  state.global.paused = paused;
  if (crawler && !crawler.status().error) {
    if (paused) void crawler.stop();
    else crawler.start();
  }
  updateGlobal();
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
    void refreshMastery();
    setState({ busy: undefined, report: { title: result.score === undefined ? "Ta dernière partie" : `Ta dernière partie : ${result.score.toFixed(1).replace(".", ",")}/10`, markdown: result.report } });
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
    pauseCrawler(IN_GAME.includes(phase));
    if (IN_GAME.includes(phase) && scout === "a-faire") {
      scout = "en-cours";
      scoutEnemyJungler().then(
        (done) => (scout = done ? "fait" : "a-faire"),
        (e) => {
          scout = "fait";
          setState({ scout: { title: "Jungler adverse", lines: [`Impossible de lire ses games : ${friendlyError(e)}`] } });
        },
      );
    }
    if (phase === "ChampSelect" && scout !== "a-faire") {
      scout = "a-faire";
      setState({ scout: undefined, lineup: undefined });
    }
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

ipcMain.handle("set-key", async (_e, raw: string) => {
  const key = raw.trim();
  if (!/^RGAPI-[0-9a-f-]{36}$/i.test(key)) return "Ce n'est pas une clé Riot : elle commence par RGAPI- et fait 42 caractères.";
  await saveKey(key);
  await startCrawler(key);
  return undefined;
});

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
  const key = await readKey();
  if (key) await startCrawler(key);
  else store = await new StatsStore(path.join(app.getPath("userData"), "stats")).load();
  updateGlobal();
  setInterval(() => void tick(), POLL_MS);
  void tick();
});

app.on("window-all-closed", () => {
  void (crawler?.stop() ?? Promise.resolve()).finally(() => app.quit());
});
