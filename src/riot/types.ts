// Sous-ensemble des réponses Match-V5 de l'API Riot utilisé par l'analyse.
// Doc : https://developer.riotgames.com/apis#match-v5

export type TeamId = 100 | 200;
export type Position = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "";

export interface Account {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface LeagueEntry {
  puuid: string;
  leaguePoints: number;
}

export interface LeagueList {
  entries: LeagueEntry[];
}

export interface Participant {
  puuid: string;
  participantId: number;
  teamId: TeamId;
  teamPosition: Position;
  championName: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  visionWardsBoughtInGame: number;
  totalDamageDealtToChampions: number;
  gameEndedInEarlySurrender?: boolean;
  // Utilisés par la récolte de données globales.
  championId?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  physicalDamageDealtToChampions?: number;
  magicDamageDealtToChampions?: number;
  perks?: { styles: { style: number; selections: { perk: number }[] }[] };
}

export interface Match {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameDuration: number; // secondes
    queueId: number;
    gameVersion: string;
    mapId?: number;
    participants: Participant[];
  };
}

export interface Point {
  x: number;
  y: number;
}

export interface ParticipantFrame {
  participantId: number;
  position: Point;
  totalGold: number;
  xp: number;
  level: number;
  minionsKilled: number;
  jungleMinionsKilled: number;
}

export interface KillEvent {
  type: "CHAMPION_KILL";
  timestamp: number;
  killerId: number; // 0 = tué par une tour ou un monstre
  victimId: number;
  assistingParticipantIds?: number[];
  position: Point;
  bounty?: number;
  shutdownBounty?: number;
}

export interface MonsterEvent {
  type: "ELITE_MONSTER_KILL";
  timestamp: number;
  killerId: number;
  killerTeamId: TeamId;
  monsterType: string; // DRAGON, BARON_NASHOR, RIFTHERALD, HORDE, ATAKHAN
  monsterSubType?: string;
  position: Point;
}

export interface BuildingEvent {
  type: "BUILDING_KILL";
  timestamp: number;
  killerId: number;
  teamId: TeamId; // équipe qui PERD le bâtiment
  buildingType: string; // TOWER_BUILDING, INHIBITOR_BUILDING
  laneType?: string;
  position: Point;
}

export interface OtherEvent {
  type: string;
  timestamp: number;
  [k: string]: unknown;
}

export type TimelineEvent = KillEvent | MonsterEvent | BuildingEvent | OtherEvent;

export const isKill = (e: TimelineEvent): e is KillEvent => e.type === "CHAMPION_KILL";
export const isMonster = (e: TimelineEvent): e is MonsterEvent => e.type === "ELITE_MONSTER_KILL";
export const isBuilding = (e: TimelineEvent): e is BuildingEvent => e.type === "BUILDING_KILL";

export interface Frame {
  timestamp: number;
  participantFrames: Record<string, ParticipantFrame>;
  events: TimelineEvent[];
}

export interface Timeline {
  metadata: { matchId: string };
  info: {
    frameInterval: number;
    frames: Frame[];
    participants?: { participantId: number; puuid: string }[];
  };
}
