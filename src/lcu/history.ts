import type { ChampionIndex } from "../data/ddragon.ts";
import type { GameSource } from "../pipeline.ts";
import type { Frame, Match, Participant, Position, TeamId, Timeline, TimelineEvent } from "../riot/types.ts";
import { lcuGet, type LcuCredentials } from "./connection.ts";

// Le client LoL garde l'historique du joueur connecté et le détail minute par
// minute de ses parties. On s'en sert à la place de l'API Riot : pas de clé à
// demander. Le format est l'ancien format « v4 » de Riot, converti ici vers
// celui de Match-V5 utilisé par l'analyse.

interface LcuParticipant {
  participantId: number;
  teamId: number;
  championId: number;
  spell1Id?: number;
  spell2Id?: number;
  stats: {
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    totalMinionsKilled?: number;
    neutralMinionsKilled?: number;
    goldEarned?: number;
    visionScore?: number;
    wardsPlaced?: number;
    wardsKilled?: number;
    visionWardsBoughtInGame?: number;
    totalDamageDealtToChampions?: number;
    gameEndedInEarlySurrender?: boolean;
  };
  timeline?: { lane?: string; role?: string };
}

export interface LcuGame {
  gameId: number;
  gameCreation: number;
  gameDuration: number; // secondes
  gameVersion?: string;
  queueId: number;
  mapId?: number;
  participants: LcuParticipant[];
  participantIdentities: { participantId: number; player: { puuid: string; gameName?: string; tagLine?: string } }[];
}

interface LcuFrame {
  timestamp: number;
  participantFrames: Record<
    string,
    {
      participantId: number;
      position?: { x: number; y: number };
      totalGold: number;
      xp: number;
      level: number;
      minionsKilled: number;
      jungleMinionsKilled: number;
    }
  >;
  events: (Record<string, unknown> & { type: string; timestamp: number })[];
}

export interface LcuTimeline {
  frames: LcuFrame[];
  frameInterval?: number;
}

const SMITE = 11;
const RANKED_QUEUES = new Set([420, 440]);
const SUMMONERS_RIFT = 11;
const PAGE = 20;

/** Poste joué, déduit des infos lane/role du client (et du Châtiment pour la jungle). */
export function positionOf(p: LcuParticipant): Position {
  const lane = p.timeline?.lane ?? "";
  const role = p.timeline?.role ?? "";
  if (lane === "JUNGLE" || p.spell1Id === SMITE || p.spell2Id === SMITE) return "JUNGLE";
  if (lane === "TOP") return "TOP";
  if (lane === "MIDDLE" || lane === "MID") return "MIDDLE";
  if (lane === "BOTTOM" || lane === "BOT") return role === "DUO_SUPPORT" ? "UTILITY" : "BOTTOM";
  return "";
}

export function convertGame(g: LcuGame, champions: ChampionIndex): Match {
  const identity = new Map(g.participantIdentities.map((i) => [i.participantId, i.player]));
  const participants: Participant[] = g.participants.map((p) => {
    const player = identity.get(p.participantId);
    const s = p.stats;
    return {
      puuid: player?.puuid ?? `inconnu-${p.participantId}`,
      participantId: p.participantId,
      teamId: p.teamId as TeamId,
      teamPosition: positionOf(p),
      championName: champions.get(p.championId)?.key ?? String(p.championId),
      riotIdGameName: player?.gameName,
      riotIdTagline: player?.tagLine,
      win: s.win,
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      totalMinionsKilled: s.totalMinionsKilled ?? 0,
      neutralMinionsKilled: s.neutralMinionsKilled ?? 0,
      goldEarned: s.goldEarned ?? 0,
      visionScore: s.visionScore ?? 0,
      wardsPlaced: s.wardsPlaced ?? 0,
      wardsKilled: s.wardsKilled ?? 0,
      visionWardsBoughtInGame: s.visionWardsBoughtInGame ?? 0,
      totalDamageDealtToChampions: s.totalDamageDealtToChampions ?? 0,
      gameEndedInEarlySurrender: s.gameEndedInEarlySurrender,
    };
  });
  return {
    metadata: { matchId: String(g.gameId), participants: participants.map((p) => p.puuid) },
    info: {
      gameCreation: g.gameCreation,
      gameDuration: g.gameDuration,
      queueId: g.queueId,
      gameVersion: g.gameVersion ?? "",
      participants,
    },
  };
}

export function convertTimeline(t: LcuTimeline, match: Match): Timeline {
  const teamOf = new Map(match.info.participants.map((p) => [p.participantId, p.teamId]));
  const frames: Frame[] = t.frames.map((f) => ({
    timestamp: f.timestamp,
    participantFrames: Object.fromEntries(
      Object.entries(f.participantFrames).map(([k, pf]) => [
        k,
        { ...pf, position: pf.position ?? { x: 0, y: 0 } },
      ]),
    ),
    events: f.events.map((e) => {
      // L'ancien format ne donne pas l'équipe qui tue le monstre.
      if (e.type === "ELITE_MONSTER_KILL" && e.killerTeamId === undefined) {
        return { ...e, killerTeamId: teamOf.get(Number(e.killerId)) ?? 100 } as TimelineEvent;
      }
      return e as TimelineEvent;
    }),
  }));
  return { metadata: { matchId: match.metadata.matchId }, info: { frameInterval: t.frameInterval ?? 60_000, frames } };
}

/** Parties du joueur connecté au client LoL, sans clé API. */
export class LcuSource implements GameSource {
  private games = new Map<string, Promise<Match>>();
  private timelines = new Map<string, Promise<Timeline>>();

  constructor(
    private creds: LcuCredentials,
    private puuid: string,
    private champions: ChampionIndex,
  ) {}

  async recentGameIds(count: number, rankedOnly: boolean): Promise<string[]> {
    const ids: string[] = [];
    // L'historique est paginé ; on s'arrête quand il n'y a plus rien.
    for (let beg = 0; ids.length < count && beg < 200; beg += PAGE) {
      const res = await lcuGet<{ games: { games: LcuGame[] } }>(
        this.creds,
        `/lol-match-history/v1/products/lol/${this.puuid}/matches?begIndex=${beg}&endIndex=${beg + PAGE}`,
      );
      const page = res.games?.games ?? [];
      for (const g of page) {
        if (g.mapId !== undefined && g.mapId !== SUMMONERS_RIFT) continue;
        if (rankedOnly && !RANKED_QUEUES.has(g.queueId)) continue;
        ids.push(String(g.gameId));
      }
      if (page.length < PAGE) break;
    }
    // Le client renvoie parfois les parties de la plus ancienne à la plus récente.
    return [...new Set(ids)].sort((a, b) => Number(b) - Number(a)).slice(0, count);
  }

  match(id: string): Promise<Match> {
    let m = this.games.get(id);
    if (!m) {
      m = lcuGet<LcuGame>(this.creds, `/lol-match-history/v1/games/${id}`).then((g) => convertGame(g, this.champions));
      this.games.set(id, m);
      m.catch(() => this.games.delete(id));
    }
    return m;
  }

  timeline(id: string): Promise<Timeline> {
    let t = this.timelines.get(id);
    if (!t) {
      t = Promise.all([lcuGet<LcuTimeline>(this.creds, `/lol-match-history/v1/game-timelines/${id}`), this.match(id)]).then(([raw, m]) =>
        convertTimeline(raw, m),
      );
      this.timelines.set(id, t);
      t.catch(() => this.timelines.delete(id));
    }
    return t;
  }
}
