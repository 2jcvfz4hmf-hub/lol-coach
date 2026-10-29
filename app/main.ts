import { app, BrowserWindow, ipcMain, shell } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { championIcon, itemIcon, loadGameData, runeIcon, type ChampionInfo, type GameData } from "../src/data/ddragon.ts";
import { buildAdvice, suggestBans, suggestGlobal, type Mastery } from "../src/draft/global.ts";
import { StatsStore } from "../src/global/store.ts";
import type { PoolStats } from "../src/draft/pool.ts";
import { compAdvice, suggestPicks } from "../src/draft/recommend.ts";
import { draftFromSession } from "../src/draft/session.ts";
import { findClient, lcuGet, liveClientGet, type LcuCredentials } from "../src/lcu/connection.ts";
import { LcuSource } from "../src/lcu/history.ts";
import type { ChampSelectSession, CurrentSummoner, GameflowPhase } from "../src/lcu/types.ts";
import { analyseLatest, analyseRecent, fullReport, loadPool } from "../src/pipeline.ts";
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
import { profileFromLcu, puuidByRiotId } from "../src/scout/lcu.ts";
import { analyseGame, isPlayable, type GameAnalysis } from "../src/analysis/game.ts";
import { gameReport } from "../src/report/fr.ts";
import { describeRank } from "../src/scout/profile.ts";
import { rankedFromLcu, type LcuRankedStats } from "../src/scout/lcu.ts";
import { championDetail } from "../src/views/champion.ts";
import { champRows, gameRow, type GameRow } from "../src/views/profile.ts";
import { tierList } from "../src/views/tierlist.ts";
import { relayClient } from "../src/riot/relay.ts";
import { CATEGORIES, CATEGORY_FR, compCategory, TeamBuildsClient, type Category, type TeamBuild, type TeamBuilds } from "../src/builds/team.ts";
import { runePage, skillOrder, type RunePage } from "../src/views/champion.ts";
import { skillSequence } from "../src/global/skills.ts";
import { riotSource, type GameSource } from "../src/pipeline.ts";
import type { RiotClient } from "../src/riot/client.ts";
import type { BuildAdvice } from "../src/draft/global.ts";
import type {
  AppState,
  BuildView,
  ChampionPageView,
  ChampionView,
  GameDetailView,
  GameRowView,
  MatchupView,
  PlayerView,
  ProfileView,
  SkillOrderView,
  RunePageView,
  SuggestionView,
  TeamBuildInput,
  TeamBuildView,
  TeamCategory,
} from "./shared.ts";

// Tes parties sont lues dans le client LoL : aucun pseudo à saisir. Une clé Riot
// (facultative) permet de récolter les parties de tout le serveur pour les conseils.
const IN_GAME: GameflowPhase[] = ["GameStart", "InProgress", "WaitingForStats", "PreEndOfGame"];
const POLL_MS = 2000;

let win: BrowserWindow | undefined;
let state: AppState = { client: "absent", phase: "None", global: { games: 0 } };

let creds: LcuCredentials | undefined;
let summoner: CurrentSummoner | undefined;
let source: LcuSource | undefined;
let data: GameData | undefined;
let store: StatsStore | undefined;
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
  void saveMe(`${summoner.gameName}#${summoner.tagLine}`);
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
      expected: s.expected,
      reasons: s.reasons,
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
      ...draftTeam(d.myChampion, d.state.enemies),
    },
  });
}

/** Build de l'équipe et ordre des sorts pour ton champion, selon la compo d'en face. */
function draftTeam(me: ChampionInfo | undefined, enemies: ChampionInfo[]) {
  if (!me) return {};
  const team = enemies.length ? compCategory(enemies) : undefined;
  const build = team ? teamBuilds[me.id]?.[team.category] : undefined;
  const stats = store?.best();
  const order = stats ? skillOrder(stats, me.id) : undefined;
  const page = stats ? runePage(stats, me.id) : undefined;
  const skills: SkillOrderView | undefined = build?.skills
    ? { key: build.skills, levels: skillSequence(build.skills) }
    : order && { key: order.key, levels: order.levels, games: order.games, winrate: order.winrate, pick: order.pick };
  return {
    team: team && { category: team.category, label: CATEGORY_FR[team.category], why: team.why, build: build && teamBuildView(build) },
    skills,
    runes: page && runePageView(page),
  };
}

// Noms des fragments de stats (pas dans les données de Riot).
const SHARDS: Record<number, string> = {
  5001: "Santé évolutive",
  5002: "Armure",
  5003: "Résistance magique",
  5005: "Vitesse d'attaque",
  5007: "Accélération de compétence",
  5008: "Force adaptative",
  5010: "Vitesse de déplacement",
  5011: "Santé",
  5013: "Ténacité et résistance aux ralentissements",
};

function runePageView(p: RunePage): RunePageView | undefined {
  const rune = (id: number) => {
    const r = data?.runes.get(id);
    return r && { name: r.name, icon: runeIcon(r) };
  };
  const primary = rune(p.primary);
  const secondary = rune(p.secondary);
  const primaryRunes = p.primaryRunes.map(rune);
  const secondaryRunes = p.secondaryRunes.map(rune);
  if (!primary || !secondary || primaryRunes.some((r) => !r) || secondaryRunes.some((r) => !r)) return undefined; // runes changées depuis
  return {
    primary,
    secondary,
    primaryRunes: primaryRunes as RunePageView["primaryRunes"],
    secondaryRunes: secondaryRunes as RunePageView["secondaryRunes"],
    shards: p.shards.map((id) => SHARDS[id] ?? "Fragment"),
    games: p.games,
    winrate: p.winrate,
    pick: p.pick,
  };
}

// --- Stats du serveur ---
// Récoltées chaque jour par GitHub (voir .github/workflows/stats.yml) : aucune clé dans l'app.

const STATS_URL = "https://github.com/2jcvfz4hmf-hub/lol-coach/releases/download/stats/";
const STATS_FILES = ["stats.json", "stats-precedent.json", "relais.txt"];
const STATS_REFRESH_MS = 6 * 3600_000;
const statsDir = () => path.join(app.getPath("userData"), "stats");

function updateGlobal(error?: string) {
  const best = store?.best();
  setState({ global: { games: best?.games ?? 0, patch: best?.patch, error } });
}

/** Télécharge les dernières stats ; en cas d'échec, on garde celles déjà sur le PC. */
async function downloadStats() {
  let error: string | undefined;
  await mkdir(statsDir(), { recursive: true });
  for (const file of STATS_FILES) {
    try {
      const res = await fetch(STATS_URL + file);
      if (res.ok) await writeFile(path.join(statsDir(), file), Buffer.from(await res.arrayBuffer()));
      else if (file === "stats.json" && res.status !== 404) error = `Téléchargement des stats impossible (HTTP ${res.status}).`;
    } catch (e) {
      error = friendlyError(e);
    }
  }
  store = await new StatsStore(statsDir()).load();
  await loadRelay();
  updateGlobal(error);
}

// --- Relais en ligne : chercher un joueur sans lancer LoL ---
// Son adresse est publiée par GitHub (voir .github/workflows/relais.yml) avec les stats.

let relay: RiotClient | undefined;
let teamClient: TeamBuildsClient | undefined;
let teamBuilds: TeamBuilds = {};

async function loadRelay() {
  const url = (await readFile(path.join(statsDir(), "relais.txt"), "utf8").catch(() => "")).trim();
  const ok = /^https:\/\/[\w.-]+(\/.*)?$/.test(url);
  relay = ok ? relayClient(url) : undefined;
  teamClient = ok ? new TeamBuildsClient(url) : undefined;
  await refreshTeamBuilds();
}

async function refreshTeamBuilds() {
  if (!teamClient) return;
  teamBuilds = await teamClient.all().catch(() => teamBuilds); // hors ligne : on garde les derniers connus
}

function teamBuildView(b: TeamBuild): TeamBuildView {
  const items = b.items.flatMap((id) => {
    const it = data?.items.get(id);
    return it ? [{ id, name: it.name, icon: itemIcon(data!.version, id) }] : [];
  });
  const rune = b.keystone ? data?.runes.get(b.keystone) : undefined;
  return {
    items,
    keystone: rune && { id: rune.id, name: rune.name, icon: runeIcon(rune) },
    skills: b.skills ? { key: b.skills, levels: skillSequence(b.skills) } : undefined,
    note: b.note,
    author: b.author,
    updatedAt: b.updatedAt,
  };
}

/** Ton pseudo, retenu pour afficher ton profil même quand LoL est fermé. */
const mePath = () => path.join(app.getPath("userData"), "moi.json");

interface Me {
  riotId?: string;
  /** Code d'équipe pour modifier les builds, et pseudo affiché dessus. */
  code?: string;
  author?: string;
}

async function readMe(): Promise<Me> {
  try {
    return JSON.parse(await readFile(mePath(), "utf8")) as Me;
  } catch {
    return {};
  }
}

async function writeMe(patch: Me) {
  await writeFile(mePath(), JSON.stringify({ ...(await readMe()), ...patch })).catch(() => {});
}

const saveMe = (riotId: string) => writeMe({ riotId });
const savedMe = async () => (await readMe()).riotId;

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
        const puuid = p.puuid ?? (await puuidByRiotId(creds!, p.gameName!, p.tagLine!));
        const championId = p.championId || (base.champion.name && [...data!.champions.values()].find((c) => c.name === base.champion.name)?.id);
        return { ...base, me: puuid === summoner?.puuid, ...(await profileFromLcu(creds!, puuid, championId || undefined)) };
      } catch {
        return { ...base, me: false, rank: "?", badges: [] };
      }
    }),
  );
  setState({ lineup: { allies: views.filter((v) => v.ally), enemies: views.filter((v) => !v.ally) } });
}

/** Lit les dernières games du jungler adverse dans ton client. Renvoie faux s'il faut réessayer plus tard. */
async function scoutEnemyJungler(): Promise<boolean> {
  if (!creds || !summoner || !data) return false;
  const { jungler: j, lineup } = await findPlayers();
  if (!j || !lineup) return false;
  void profileLineup(lineup);
  const champion = (j.championId && data?.champions.get(j.championId)?.name) || j.championName || "?";
  setState({ scout: { title: `Jungler adverse : ${champion}`, lines: ["Lecture de ses dernières games…"] } });
  const puuid = j.puuid ?? (await puuidByRiotId(creds, j.gameName!, j.tagLine!));
  const history = new LcuSource(creds, puuid, data.champions);
  const games = [];
  for (const id of await history.recentGameIds(20, true)) {
    const match = await history.match(id);
    if (match.info.participants.find((p) => p.puuid === puuid)?.teamPosition !== "JUNGLE") continue;
    games.push({ match, timeline: await history.timeline(id) });
    if (games.length >= SCOUT_GAMES) break;
  }
  setState({ scout: { title: `Jungler adverse : ${champion}`, lines: scoutLines(junglerHabits(games, puuid)) } });
  return true;
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
    setState({ busy: undefined, report: {
        title: result.score ? `Ta dernière partie : ${result.score.score.toFixed(1).replace(".", ",")}/10` : "Ta dernière partie",
        markdown: result.report,
        curve: result.score?.curve,
        marks: result.score?.items.filter((i) => i.t !== undefined).map((i) => ({ t: i.t!, points: i.points, text: i.text })),
      },
    });
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


// --- Pages façon dpm.lol ---

const PROFILE_GAMES = 20;
/** Par le relais, chaque partie coûte deux appels à Riot : on en lit moins. */
const RELAY_GAMES = 10;
const analyses = new Map<string, { analysis?: GameAnalysis; source: GameSource }>();

function byKey(key: string): ChampionInfo | undefined {
  return [...data!.champions.values()].find((c) => c.key.toLowerCase() === key.toLowerCase());
}

const viewById = (c: ChampionInfo) => ({ ...view(c), id: c.id });
const viewByKey = (key: string): ChampionView => {
  const c = byKey(key);
  return c ? view(c) : { name: key, icon: "" };
};

function buildView(b: BuildAdvice): BuildView {
  const note = (p: { pick: number; winrate: number; note?: string }) =>
    [`pris dans ${pct(p.pick)} des parties`, `${pct(p.winrate)} de victoires`, p.note].filter(Boolean).join(" · ");
  return {
    summary: b.summary,
    keystone: b.keystone && { name: b.keystone.name, icon: runeIcon(b.keystone.rune), note: note(b.keystone) },
    items: b.items.map((i) => ({ name: i.name, icon: itemIcon(data!.version, i.id), note: note(i) })),
  };
}

function splitRiotId(riotId: string): [string, string] {
  const [gameName, tagLine] = riotId.split("#").map((x) => x.trim());
  if (!gameName || !tagLine) throw new Error("Écris le pseudo sous la forme Pseudo#TAG.");
  return [gameName, tagLine];
}

/** Où lire le profil : le client LoL s'il est ouvert, sinon le relais en ligne. */
async function profileSource(riotId?: string) {
  data ??= await loadGameData();
  if (creds && summoner && (!riotId || !relay)) {
    if (!riotId) return { puuid: summoner.puuid, name: `${summoner.gameName}#${summoner.tagLine}`, history: source!, count: PROFILE_GAMES, rank: await lcuRank(summoner.puuid) };
    const [gameName, tagLine] = splitRiotId(riotId);
    const puuid = await puuidByRiotId(creds, gameName, tagLine).catch(() => {
      throw new Error(`Joueur introuvable : ${gameName}#${tagLine}`);
    });
    return { puuid, name: `${gameName}#${tagLine}`, history: new LcuSource(creds, puuid, data.champions) as GameSource, count: PROFILE_GAMES, rank: await lcuRank(puuid) };
  }
  const id = riotId ?? (await savedMe());
  if (!relay) throw new Error("Lance League of Legends : la recherche sans LoL n'est pas encore en ligne.");
  if (!id) throw new Error("Lance League of Legends une fois pour que l'appli connaisse ton pseudo, ou cherche-le dans Recherche.");
  const [gameName, tagLine] = splitRiotId(id);
  const account = await relay.accountByRiotId(gameName, tagLine).catch(() => {
    throw new Error(`Joueur introuvable : ${gameName}#${tagLine} (serveur EUW)`);
  });
  const rank = describeRank(await relay.leagueByPuuid(account.puuid).catch(() => []));
  return { puuid: account.puuid, name: `${account.gameName ?? gameName}#${account.tagLine ?? tagLine}`, history: riotSource(relay, account.puuid), count: RELAY_GAMES, rank };
}

async function lcuRank(puuid: string) {
  const ranked = await lcuGet<LcuRankedStats>(creds!, `/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => ({}));
  return describeRank(rankedFromLcu(ranked));
}

async function loadProfile(riotId?: string): Promise<ProfileView> {
  const { puuid, name, history, count, rank } = await profileSource(riotId);

  const rows: GameRow[] = [];
  for (const id of await history.recentGameIds(count, false)) {
    const match = await history.match(id).catch(() => undefined);
    if (!match || !isPlayable(match)) continue;
    let cached = analyses.get(`${puuid}:${id}`);
    if (!cached) {
      const timeline = await history.timeline(id).catch(() => undefined);
      cached = { analysis: timeline ? analyseGame(match, timeline, puuid) : undefined, source: history };
      analyses.set(`${puuid}:${id}`, cached);
    }
    const row = gameRow(match, puuid, cached.analysis);
    if (row) rows.push(row);
  }
  const games: GameRowView[] = rows.map((r) => ({
    matchId: r.matchId,
    champion: viewByKey(r.champion),
    opponent: r.opponent ? viewByKey(r.opponent) : undefined,
    position: r.position,
    queue: r.queue,
    win: r.win,
    kda: `${r.kills}/${r.deaths}/${r.assists}`,
    cs: r.cs,
    durationMin: r.durationMin,
    date: r.date,
    score: r.score,
  }));
  const scored = rows.filter((r) => r.score !== undefined);
  return {
    puuid,
    name,
    rank: rank.rank,
    record: rank.record,
    badges: rank.badges,
    avgScore: scored.length ? scored.reduce((s, r) => s + r.score!, 0) / scored.length : undefined,
    games,
    champions: champRows(rows).map((c) => ({ ...c, champion: viewByKey(c.champion) })),
  };
}

const asError = (e: unknown) => ({ error: friendlyError(e) });

ipcMain.handle("profile", (_e, riotId?: string) => loadProfile(riotId).catch(asError));

ipcMain.handle("game-detail", async (_e, puuid: string, matchId: string): Promise<GameDetailView | { error: string }> => {
  const cached = analyses.get(`${puuid}:${matchId}`);
  if (!cached?.analysis) return { error: "Pas de détail pour cette partie (timeline indisponible)." };
  const g = cached.analysis;
  return {
    title: `${g.win ? "Victoire" : "Défaite"} · ${byKey(g.champion)?.name ?? g.champion} · ${g.score.score.toFixed(1).replace(".", ",")}/10`,
    markdown: gameReport(g),
    curve: g.score.curve,
    marks: g.score.items.filter((i) => i.t !== undefined).map((i) => ({ t: i.t!, points: i.points, text: i.text })),
  };
});

ipcMain.handle("tier-list", (_e, position: string) => {
  const stats = store?.best();
  if (!stats || !data) return [];
  return tierList(stats, position).flatMap((r) => {
    const c = data!.champions.get(r.championId);
    return c ? [{ ...r, champion: viewById(c) }] : [];
  });
});

ipcMain.handle("champions", () =>
  data ? [...data.champions.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")).map(viewById) : [],
);

ipcMain.handle("champion", async (_e, id: number, position?: string): Promise<ChampionPageView | { error: string }> => {
  const c = data?.champions.get(id);
  if (!c || !data) return { error: "Champion inconnu." };
  await refreshTeamBuilds();
  const mine = teamBuilds[id] ?? {};
  const teamViews = Object.fromEntries(CATEGORIES.flatMap((cat) => (mine[cat] ? [[cat, teamBuildView(mine[cat]!)]] : [])));
  const stats = store?.best();
  if (!stats) {
    return {
      champion: viewById(c),
      positions: [],
      games: 0,
      winrate: 0,
      bestMatchups: [],
      worstMatchups: [],
      synergies: [],
      builds: [],
      teamBuilds: teamViews,
      teamBuildsReady: !!teamClient,
    };
  }
  const d = championDetail(stats, c, data.items, data.runes, position);
  const matchup = (m: { championId: number; games: number; winrate: number; delta: number }): MatchupView[] => {
    const other = data!.champions.get(m.championId);
    return other ? [{ ...m, champion: viewById(other) }] : [];
  };
  return {
    champion: viewById(c),
    position: d.position,
    positions: d.positions,
    games: d.games,
    winrate: d.winrate,
    bestMatchups: d.bestMatchups.flatMap(matchup),
    worstMatchups: d.worstMatchups.flatMap(matchup),
    synergies: d.synergies.flatMap(matchup),
    builds: d.builds.map((b) => ({ against: b.against, build: buildView(b.build) })),
    skillOrder: d.skillOrder && { key: d.skillOrder.key, levels: d.skillOrder.levels, games: d.skillOrder.games, winrate: d.skillOrder.winrate, pick: d.skillOrder.pick },
    runePage: d.runePage && runePageView(d.runePage),
    teamBuilds: teamViews,
    teamBuildsReady: !!teamClient,
  };
});

ipcMain.handle("build-choices", () => {
  if (!data) return { items: [], keystones: [] };
  const items = [...data.items.values()]
    .filter((i) => i.completed)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((i) => ({ id: i.id, name: i.name, icon: itemIcon(data!.version, i.id) }));
  const keystones = [...data.runes.values()].filter((r) => r.keystone).map((r) => ({ id: r.id, name: r.name, icon: runeIcon(r) }));
  return { items, keystones };
});

ipcMain.handle("team-identity", async () => {
  const me = await readMe();
  return { code: me.code, author: me.author ?? me.riotId?.split("#")[0] };
});

ipcMain.handle(
  "save-team-build",
  async (_e, championId: number, category: TeamCategory, build: TeamBuildInput | null, code: string, author: string) => {
    if (!teamClient) return { error: "Le relais n'est pas encore en ligne : impossible d'enregistrer." };
    try {
      await teamClient.save(championId, category as Category, build, code, author);
      await writeMe({ code, author });
      await refreshTeamBuilds();
      void updateDraft().catch(() => {});
      return { ok: true as const };
    } catch (e) {
      return asError(e);
    }
  },
);

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
    width: 1200,
    height: 840,
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
  void downloadStats();
  setInterval(() => void downloadStats(), STATS_REFRESH_MS);
  setInterval(() => void tick(), POLL_MS);
  void tick();
});

app.on("window-all-closed", () => app.quit());
