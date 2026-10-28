import { describe, expect, it } from "vitest";
import { junglerHabits, scoutLines } from "../src/scout/jungler.ts";
import { junglerFromGameflow, junglerFromLive, lineupFromGameflow, type LivePlayer } from "../src/scout/players.ts";
import { describeRank, masteryBadge } from "../src/scout/profile.ts";
import { fixture, kill, ME, min, monster } from "./fixture.ts";

/** Jungler bleu (joueur 2) : commence côté top, finit côté bot à 4:00 et gank la bot. */
function game(opts: { invade?: boolean; gankBot?: boolean } = {}) {
  return fixture({
    minutes: 20,
    win: true,
    events: [
      ...(opts.gankBot === false ? [] : [kill(min(3, 30), 2, 8, { x: 13000, y: 2000 }, [4])]),
      monster(min(6), 100, "DRAGON"),
    ],
    position: (pid, m) => {
      if (pid !== 2) return pid <= 5 ? { x: 3000, y: 3000 } : { x: 11000, y: 11000 };
      if (m === 2) return opts.invade ? { x: 11000, y: 7000 } : { x: 3800, y: 7900 };
      if (m === 4) return { x: 7800, y: 3000 };
      return { x: 5000, y: 5000 };
    },
  });
}

describe("habitudes du jungler adverse", () => {
  it("repère son côté de départ, son premier gank et son premier objectif", () => {
    const h = junglerHabits([game(), game(), game(), game({ gankBot: false }), game({ invade: true })], ME);
    expect(h.games).toBe(5);
    expect(h.start).toEqual({ haut: 4, bas: 1 });
    expect(h.invades).toBe(1);
    expect(h.at4.bas).toBe(5);
    expect(h.firstAction.bot).toBe(4);
    expect(h.firstObjective).toEqual({ DRAGON: 5 });

    const lines = scoutLines(h).join("\n");
    expect(lines).toMatch(/commence côté top \(4 parties sur 5\)/);
    expect(lines).toMatch(/premier gank est sur la bot \(4 sur 4\), vers 3:30/);
    expect(lines).toMatch(/d'abord le dragon/);
    expect(lines).toMatch(/Balise conseillée : la rivière côté bot/);
  });

  it("ignore les parties hors jungle et prévient s'il y en a trop peu", () => {
    const top = game();
    top.match.info.participants[1]!.teamPosition = "TOP";
    const h = junglerHabits([top, game()], ME);
    expect(h.games).toBe(1);
    expect(scoutLines(h)[0]).toMatch(/Pas assez de parties/);
  });
});

describe("repérage du jungler adverse", () => {
  it("le trouve dans la session du client", () => {
    const session = {
      gameData: {
        teamOne: [{ puuid: "moi", championId: 427, selectedPosition: "JUNGLE" }],
        teamTwo: [
          { puuid: "lui", championId: 254, selectedPosition: "", spell1Id: 4, spell2Id: 11 },
          { puuid: "autre", championId: 103, selectedPosition: "", spell1Id: 4, spell2Id: 14 },
        ],
      },
    };
    expect(junglerFromGameflow(session, "moi")).toEqual({ puuid: "lui", championId: 254 });
  });

  it("le trouve dans l'API du jeu en cours grâce au Châtiment", () => {
    const smite = { summonerSpellOne: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerSmite_DisplayName" } };
    const players: LivePlayer[] = [
      { championName: "Ivern", riotId: "AURA#지배자", team: "ORDER", summonerSpells: smite },
      { championName: "Ahri", riotId: "Mid#EUW", team: "CHAOS" },
      { championName: "Vi", riotId: "Jungler#EUW", team: "CHAOS", summonerSpells: smite },
    ];
    expect(junglerFromLive(players, "aura#지배자")).toEqual({ gameName: "Jungler", tagLine: "EUW", championName: "Vi" });
  });
});

describe("fiche des joueurs", () => {
  it("décrit le rang et la forme", () => {
    const r = describeRank([
      { queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "I", leaguePoints: 10, wins: 1, losses: 1 },
      { queueType: "RANKED_SOLO_5x5", tier: "EMERALD", rank: "II", leaguePoints: 45, wins: 60, losses: 40, hotStreak: true },
    ]);
    expect(r).toEqual({ rank: "Émeraude II · 45 LP", record: "60 % sur 100 parties", badges: ["🔥 série de victoires"] });
    expect(describeRank([]).rank).toBe("Non classé");
  });

  it("repère les premières fois et les spécialistes", () => {
    expect(masteryBadge(undefined, 0)).toMatch(/première fois/);
    expect(masteryBadge(450_000, 0)).toMatch(/spécialiste \(450k/);
    expect(masteryBadge(50_000, Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 1))).toBeUndefined();
  });

  it("liste les 10 joueurs de la partie", () => {
    const team = (prefix: string) => Array.from({ length: 5 }, (_, i) => ({ puuid: `${prefix}${i}`, championId: i + 1 }));
    const lineup = lineupFromGameflow({ gameData: { teamOne: team("a"), teamTwo: team("b") } }, "b2")!;
    expect(lineup).toHaveLength(10);
    expect(lineup.filter((p) => p.ally).map((p) => p.puuid)).toEqual(["b0", "b1", "b2", "b3", "b4"]);
  });
});
