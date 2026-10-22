import { describe, expect, it } from "vitest";
import { analyseGame } from "../src/analysis/game.ts";
import { parseChampions } from "../src/data/ddragon.ts";
import { convertGame, convertTimeline, positionOf, type LcuGame, type LcuTimeline } from "../src/lcu/history.ts";

const champions = parseChampions({
  data: Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `Champ${i + 1}`,
      { id: `Champ${i + 1}`, key: String(i + 1), name: `Champion ${i + 1}`, tags: ["Fighter"], info: { attack: 5, magic: 5, defense: 5, difficulty: 5 } },
    ]),
  ),
});

const LANES: [string, string][] = [
  ["TOP", "SOLO"],
  ["JUNGLE", "NONE"],
  ["MIDDLE", "SOLO"],
  ["BOTTOM", "DUO_CARRY"],
  ["BOTTOM", "DUO_SUPPORT"],
];

// Partie au format de l'historique du client (ancien format « v4 »).
const game: LcuGame = {
  gameId: 7_123_456_789,
  gameCreation: Date.UTC(2026, 9, 22),
  gameDuration: 1800,
  queueId: 420,
  mapId: 11,
  participants: Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1,
    teamId: i < 5 ? 100 : 200,
    championId: i + 1,
    spell1Id: 4,
    spell2Id: i % 5 === 1 ? 11 : 14,
    stats: { win: i < 5, kills: 2, deaths: 1, assists: 3, totalMinionsKilled: 150, visionScore: 20, visionWardsBoughtInGame: 1 },
    timeline: { lane: LANES[i % 5]![0], role: LANES[i % 5]![1] },
  })),
  participantIdentities: Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1,
    player: { puuid: `puuid-${i + 1}`, gameName: `Joueur${i + 1}`, tagLine: "EUW" },
  })),
};

const timeline: LcuTimeline = {
  frames: Array.from({ length: 31 }, (_, m) => ({
    timestamp: m * 60_000,
    participantFrames: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        String(i + 1),
        { participantId: i + 1, position: { x: 3000, y: 3000 }, totalGold: 500 + 400 * m, xp: 300 * m, level: 1 + Math.floor(m / 2), minionsKilled: 7 * m, jungleMinionsKilled: 0 },
      ]),
    ),
    events:
      m === 20
        ? [
            { type: "CHAMPION_KILL", timestamp: 1_200_500, killerId: 7, victimId: 2, assistingParticipantIds: [8], position: { x: 9800, y: 4400 } },
            { type: "ELITE_MONSTER_KILL", timestamp: 1_230_000, killerId: 7, monsterType: "DRAGON", monsterSubType: "FIRE_DRAGON", position: { x: 9800, y: 4400 } },
          ]
        : [],
  })),
};

describe("historique du client LoL", () => {
  it("déduit le poste de chaque joueur", () => {
    const match = convertGame(game, champions);
    expect(match.info.participants.slice(0, 5).map((p) => p.teamPosition)).toEqual(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);
    expect(positionOf({ participantId: 1, teamId: 100, championId: 1, spell1Id: 11, stats: { win: true, kills: 0, deaths: 0, assists: 0 } })).toBe("JUNGLE");
  });

  it("convertit la partie et la timeline pour l'analyse", () => {
    const match = convertGame(game, champions);
    expect(match.metadata.matchId).toBe("7123456789");
    expect(match.info.participants[1]).toMatchObject({ puuid: "puuid-2", championName: "Champ2", win: true, kills: 2 });

    const t = convertTimeline(timeline, match);
    const dragon = t.info.frames[20]!.events[1] as { killerTeamId: number };
    expect(dragon.killerTeamId).toBe(200);

    const g = analyseGame(match, t, "puuid-2");
    expect(g.position).toBe("JUNGLE");
    expect(g.deaths).toHaveLength(1);
    expect(g.deaths[0]!.objectivesLost.map((o) => o.label)).toEqual(["Dragon"]);
  });
});
