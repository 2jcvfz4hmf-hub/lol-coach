// Retrouve le jungler adverse au lancement de la partie, depuis le client LoL
// (écran de chargement) ou, à défaut, depuis l'API du jeu en cours.

const SMITE = 11;

export interface GameflowPlayer {
  puuid?: string;
  championId?: number;
  selectedPosition?: string;
  spell1Id?: number;
  spell2Id?: number;
}

export interface GameflowSession {
  gameData?: { teamOne?: GameflowPlayer[]; teamTwo?: GameflowPlayer[] };
}

export interface LivePlayer {
  championName: string;
  riotId?: string; // « Pseudo#TAG »
  riotIdGameName?: string;
  riotIdTagLine?: string;
  team: "ORDER" | "CHAOS";
  position?: string;
  summonerSpells?: { summonerSpellOne?: { rawDisplayName?: string }; summonerSpellTwo?: { rawDisplayName?: string } };
}

export interface EnemyJungler {
  puuid?: string;
  gameName?: string;
  tagLine?: string;
  championId?: number;
  championName?: string;
}

const isJungle = (position?: string) => position?.toUpperCase() === "JUNGLE";

export function junglerFromGameflow(session: GameflowSession, myPuuid: string): EnemyJungler | undefined {
  const one = session.gameData?.teamOne ?? [];
  const two = session.gameData?.teamTwo ?? [];
  const mine = one.some((p) => p.puuid === myPuuid) ? one : two.some((p) => p.puuid === myPuuid) ? two : undefined;
  if (!mine) return undefined;
  const enemies = mine === one ? two : one;
  const j =
    enemies.find((p) => isJungle(p.selectedPosition)) ?? enemies.find((p) => p.spell1Id === SMITE || p.spell2Id === SMITE);
  return j?.puuid ? { puuid: j.puuid, championId: j.championId } : undefined;
}

export function junglerFromLive(players: LivePlayer[], myRiotId: string): EnemyJungler | undefined {
  const id = (p: LivePlayer) => p.riotId ?? `${p.riotIdGameName}#${p.riotIdTagLine}`;
  const me = players.find((p) => id(p).toLowerCase() === myRiotId.toLowerCase());
  if (!me) return undefined;
  const enemies = players.filter((p) => p.team !== me.team);
  const smite = (p: LivePlayer) =>
    [p.summonerSpells?.summonerSpellOne?.rawDisplayName, p.summonerSpells?.summonerSpellTwo?.rawDisplayName].some((s) => s?.includes("SummonerSmite"));
  const j = enemies.find((p) => isJungle(p.position)) ?? enemies.find(smite);
  if (!j) return undefined;
  const [gameName, tagLine] = id(j).split("#");
  return gameName && tagLine ? { gameName, tagLine, championName: j.championName } : undefined;
}

export interface LineupPlayer {
  ally: boolean;
  puuid?: string;
  gameName?: string;
  tagLine?: string;
  championId?: number;
  championName?: string;
}

/** Les 10 joueurs de la partie, d'après la session du client. */
export function lineupFromGameflow(session: GameflowSession, myPuuid: string): LineupPlayer[] | undefined {
  const one = session.gameData?.teamOne ?? [];
  const two = session.gameData?.teamTwo ?? [];
  const mine = one.some((p) => p.puuid === myPuuid) ? one : two.some((p) => p.puuid === myPuuid) ? two : undefined;
  if (!mine) return undefined;
  const all = [...one, ...two];
  if (all.length < 10 || all.some((p) => !p.puuid)) return undefined;
  return all.map((p) => ({ ally: mine.includes(p), puuid: p.puuid, championId: p.championId }));
}

/** Les 10 joueurs de la partie, d'après l'API du jeu en cours. */
export function lineupFromLive(players: LivePlayer[], myRiotId: string): LineupPlayer[] | undefined {
  const id = (p: LivePlayer) => p.riotId ?? `${p.riotIdGameName}#${p.riotIdTagLine}`;
  const me = players.find((p) => id(p).toLowerCase() === myRiotId.toLowerCase());
  if (!me) return undefined;
  return players.map((p) => {
    const [gameName, tagLine] = id(p).split("#");
    return { ally: p.team === me.team, gameName, tagLine, championName: p.championName };
  });
}
