// Sous-ensemble des réponses de l'API locale du client LoL.

export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | string;

export interface CurrentSummoner {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface ChampSelectPlayer {
  cellId: number;
  championId: number; // 0 tant que rien n'est choisi
  championPickIntent: number; // champion survolé
  assignedPosition: string; // "top", "jungle", "middle", "bottom", "utility" ou "" en normal draft
  puuid?: string;
}

export interface ChampSelectAction {
  actorCellId: number;
  championId: number;
  completed: boolean;
  isInProgress: boolean;
  type: "pick" | "ban" | string;
}

export interface ChampSelectSession {
  localPlayerCellId: number;
  myTeam: ChampSelectPlayer[];
  theirTeam: ChampSelectPlayer[];
  actions: ChampSelectAction[][];
  bans?: { myTeamBans: number[]; theirTeamBans: number[] };
}
