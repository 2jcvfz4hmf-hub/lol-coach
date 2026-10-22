import type { Frame, Match, Participant, Point, Position, TeamId, Timeline, TimelineEvent } from "../src/riot/types.ts";

// Construit une partie synthétique : joueurs 1-5 en bleu (100), 6-10 en rouge (200).
const POSITIONS: Position[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
export const ME = "puuid-2"; // jungler bleu
export const min = (m: number, s = 0) => (m * 60 + s) * 1000;

export interface FixtureOptions {
  minutes: number;
  win: boolean;
  events: TimelineEvent[];
  /** Or total de chaque joueur à une minute donnée (par défaut 500 + 400/min). */
  gold?: (pid: number, minute: number) => number;
  position?: (pid: number, minute: number) => Point;
  cs?: (pid: number, minute: number) => { minions: number; jungle: number };
  participant?: (p: Participant) => Partial<Participant>;
}

export function fixture(o: FixtureOptions): { match: Match; timeline: Timeline } {
  const participants: Participant[] = Array.from({ length: 10 }, (_, i) => {
    const pid = i + 1;
    const teamId: TeamId = pid <= 5 ? 100 : 200;
    const base: Participant = {
      puuid: `puuid-${pid}`,
      participantId: pid,
      teamId,
      teamPosition: POSITIONS[i % 5]!,
      championName: `Champ${pid}`,
      win: teamId === 100 ? o.win : !o.win,
      kills: 0,
      deaths: 0,
      assists: 0,
      totalMinionsKilled: 0,
      neutralMinionsKilled: 0,
      goldEarned: 0,
      visionScore: 30,
      wardsPlaced: 10,
      wardsKilled: 2,
      visionWardsBoughtInGame: 2,
      totalDamageDealtToChampions: 10000,
    };
    return { ...base, ...o.participant?.(base) };
  });

  const frames: Frame[] = [];
  for (let m = 0; m <= o.minutes; m++) {
    const participantFrames: Frame["participantFrames"] = {};
    for (const p of participants) {
      const pid = p.participantId;
      const cs = o.cs?.(pid, m) ?? { minions: m * 7, jungle: 0 };
      participantFrames[String(pid)] = {
        participantId: pid,
        position: o.position?.(pid, m) ?? (pid <= 5 ? { x: 3000, y: 3000 } : { x: 11000, y: 11000 }),
        totalGold: o.gold?.(pid, m) ?? 500 + 400 * m,
        xp: 300 * m,
        level: Math.min(18, 1 + Math.floor(m / 2)),
        minionsKilled: cs.minions,
        jungleMinionsKilled: cs.jungle,
      };
    }
    const events = o.events.filter((e) => Math.floor(e.timestamp / 60000) === m);
    frames.push({ timestamp: m * 60000, participantFrames, events });
  }

  return {
    match: {
      metadata: { matchId: "EUW1_TEST", participants: participants.map((p) => p.puuid) },
      info: { gameCreation: Date.UTC(2026, 9, 21), gameDuration: o.minutes * 60, queueId: 420, gameVersion: "16.20", participants },
    },
    timeline: { metadata: { matchId: "EUW1_TEST" }, info: { frameInterval: 60000, frames } },
  };
}

export function kill(t: number, killerId: number, victimId: number, at: Point, assists: number[] = [], extra = {}): TimelineEvent {
  return { type: "CHAMPION_KILL", timestamp: t, killerId, victimId, assistingParticipantIds: assists, position: at, bounty: 300, ...extra };
}

export function monster(t: number, team: TeamId, monsterType: string, at: Point = { x: 9800, y: 4400 }): TimelineEvent {
  return { type: "ELITE_MONSTER_KILL", timestamp: t, killerId: team === 100 ? 2 : 7, killerTeamId: team, monsterType, position: at };
}

export function tower(t: number, lostBy: TeamId, at: Point = { x: 8000, y: 8000 }): TimelineEvent {
  return { type: "BUILDING_KILL", timestamp: t, killerId: 0, teamId: lostBy, buildingType: "TOWER_BUILDING", position: at };
}
