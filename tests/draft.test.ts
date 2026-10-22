import { describe, expect, it } from "vitest";
import { parseChampions, type ChampionIndex } from "../src/data/ddragon.ts";
import { buildPool } from "../src/draft/pool.ts";
import { compAdvice, suggestPicks } from "../src/draft/recommend.ts";
import { draftFromSession } from "../src/draft/session.ts";
import { parseCommandLine, parseLockfile } from "../src/lcu/connection.ts";
import type { ChampSelectSession } from "../src/lcu/types.ts";
import { fixture } from "./fixture.ts";

// Extrait de champion.json (Data Dragon) avec les vraies notes Riot.
const champions: ChampionIndex = parseChampions({
  data: Object.fromEntries(
    (
      [
        ["Ivern", "427", "Ivern", ["Support", "Mage"], 3, 7, 5],
        ["Viego", "234", "Viego", ["Assassin", "Fighter"], 6, 2, 4],
        ["Lillia", "876", "Lillia", ["Fighter", "Mage"], 0, 10, 2],
        ["Darius", "122", "Darius", ["Fighter", "Tank"], 9, 0, 5],
        ["Zed", "238", "Zed", ["Assassin"], 9, 1, 2],
        ["Jinx", "222", "Jinx", ["Marksman"], 9, 2, 2],
        ["Vi", "254", "Vi", ["Fighter", "Assassin"], 8, 3, 5],
        ["Ahri", "103", "Ahri", ["Mage", "Assassin"], 3, 8, 4],
        ["Caitlyn", "51", "Caitlyn", ["Marksman"], 8, 2, 2],
        ["Fiddlesticks", "9", "Fiddlesticks", ["Mage", "Support"], 2, 9, 3],
      ] as const
    ).map(([id, key, name, tags, attack, magic, defense]) => [
      id,
      { id, key, name, tags: [...tags], info: { attack, magic, defense, difficulty: 5 } },
    ]),
  ),
});
const byName = (n: string) => [...champions.values()].find((c) => c.key === n)!;

/** Partie où le joueur 2 (jungle bleu) joue `champ` contre l'équipe rouge `enemies`. */
function game(champ: string, win: boolean, enemies: string[] = []) {
  return fixture({
    minutes: 25,
    win,
    events: [],
    participant: (p) =>
      p.participantId === 2 ? { championName: champ } : p.participantId > 5 && enemies[p.participantId - 6] ? { championName: enemies[p.participantId - 6] } : {},
  }).match;
}

describe("connexion au client", () => {
  it("lit le lockfile et la ligne de commande", () => {
    expect(parseLockfile("LeagueClient:1234:54321:s3cr3t:https")).toEqual({ port: 54321, password: "s3cr3t" });
    expect(parseCommandLine('"LeagueClientUx.exe" "--remoting-auth-token=abc_D-1" "--app-port=61234"')).toEqual({ port: 61234, password: "abc_D-1" });
    expect(parseCommandLine("")).toBeUndefined();
  });
});

describe("pool de champions", () => {
  it("compte les parties par champion et contre chaque adversaire, sans tenir compte de la casse", () => {
    const pool = buildPool([game("Ivern", true, ["FiddleSticks"]), game("Ivern", false), game("Viego", true)], "puuid-2");
    expect(pool.champions.get("ivern")).toMatchObject({ games: 2, wins: 1, positions: { JUNGLE: 2 } });
    expect(pool.against.get("fiddlesticks")).toEqual({ games: 1, wins: 1 });
  });
});

describe("conseils de pick", () => {
  const pool = buildPool(
    [
      game("Ivern", true, ["Vi"]),
      game("Ivern", true, ["Vi"]),
      game("Ivern", true),
      game("Ivern", false),
      game("Viego", false, ["Vi"]),
      game("Viego", false),
      game("Lillia", true),
    ],
    "puuid-2",
  );

  it("privilégie les champions qui te réussissent", () => {
    const s = suggestPicks({ position: "jungle", allies: [], enemies: [], unavailable: new Set() }, pool, champions);
    expect(s.map((x) => x.champion.key)).toEqual(["Ivern", "Lillia", "Viego"]);
  });

  it("tient compte de la compo et des bans", () => {
    const allies = ["Darius", "Zed", "Jinx"].map(byName);
    const s = suggestPicks({ position: "jungle", allies, enemies: [byName("Vi")], unavailable: new Set([427]) }, pool, champions);
    expect(s.map((x) => x.champion.key)).not.toContain("Ivern");
    expect(s[0]!.champion.key).toBe("Lillia");
    expect(s[0]!.reasons).toContain("ton équipe n'a que des dégâts physiques");
    const viego = s.find((x) => x.champion.key === "Viego")!;
    expect(viego.reasons).toContain("ton équipe a déjà beaucoup de dégâts AD");
  });

  it("donne des conseils d'objets selon la compo adverse", () => {
    expect(compAdvice(["Vi", "Zed", "Caitlyn"].map(byName))[0]).toContain("armure");
    expect(compAdvice([])).toEqual([]);
  });
});

describe("lecture de la sélection des champions", () => {
  it("retrouve ton poste, les picks, les survols et les bans", () => {
    const session: ChampSelectSession = {
      localPlayerCellId: 1,
      myTeam: [
        { cellId: 0, championId: 122, championPickIntent: 0, assignedPosition: "top" },
        { cellId: 1, championId: 0, championPickIntent: 427, assignedPosition: "jungle" },
        { cellId: 2, championId: 0, championPickIntent: 238, assignedPosition: "middle" },
        { cellId: 3, championId: 0, championPickIntent: 0, assignedPosition: "bottom" },
        { cellId: 4, championId: 0, championPickIntent: 0, assignedPosition: "utility" },
      ],
      theirTeam: [
        { cellId: 5, championId: 254, championPickIntent: 0, assignedPosition: "" },
        { cellId: 6, championId: 0, championPickIntent: 0, assignedPosition: "" },
      ],
      actions: [[{ actorCellId: 0, championId: 234, completed: true, isInProgress: false, type: "ban" }]],
    };
    const d = draftFromSession(session, champions);
    expect(d.state.position).toBe("jungle");
    expect(d.myChampion?.key).toBe("Ivern");
    expect(d.state.allies.map((c) => c.key)).toEqual(["Darius", "Zed"]);
    expect(d.state.enemies.map((c) => c.key)).toEqual(["Vi"]);
    expect([...d.state.unavailable].sort()).toEqual([122, 234, 254]);
  });
});
