import { describe, expect, it } from "vitest";
import { analyseGame } from "../src/analysis/game.ts";
import { parseChampions, parseItems, parseRunes } from "../src/data/ddragon.ts";
import { emptyStats } from "../src/global/stats.ts";
import { championDetail } from "../src/views/champion.ts";
import { champRows, gameRow } from "../src/views/profile.ts";
import { tierList, tierOf } from "../src/views/tierlist.ts";
import { fixture, ME } from "./fixture.ts";

const stats = emptyStats("15.21");
stats.games = 1000;
stats.champs.JUNGLE = {
  "1": { g: 400, w: 230 }, // 57,5 %
  "2": { g: 300, w: 150 },
  "3": { g: 200, w: 90 },
  "4": { g: 2, w: 2 }, // trop rare pour la tier list
};
stats.champs.TOP = { "1": { g: 50, w: 20 } };
stats.lane.JUNGLE = { "1": { "2": { g: 100, w: 70 }, "3": { g: 100, w: 40 } } };
stats.with["1"] = { "5": { g: 80, w: 60 } };
stats.items["1"] = { AD: { "6630": { g: 60, w: 35 } } };
stats.runes["1"] = { AD: { "8010": { g: 60, w: 35 } } };

const champions = parseChampions({
  data: Object.fromEntries(
    [1, 2, 3, 4, 5].map((i) => [`C${i}`, { id: `C${i}`, key: String(i), name: `Champion ${i}`, tags: ["Fighter"], info: { attack: 5, magic: 5, defense: 5, difficulty: 5 } }]),
  ),
});
const items = parseItems({ data: { "6630": { name: "Croc-de-Fer", gold: { total: 3300, purchasable: true } } } });
const runes = parseRunes([{ slots: [{ runes: [{ id: 8010, name: "Conquérant", icon: "x.png" }] }] }]);

describe("tier list", () => {
  it("classe les champions par winrate lissé et écarte les plus rares", () => {
    const rows = tierList(stats, "JUNGLE");
    expect(rows.map((r) => [r.championId, r.tier])).toEqual([
      [1, "S"],
      [2, "B"],
      [3, "D"],
    ]);
    expect(rows[0]!.pickrate).toBeCloseTo(0.4);
    expect(tierOf(0.511)).toBe("A");
  });
});

describe("page champion", () => {
  it("donne postes, matchups, duos et builds", () => {
    const d = championDetail(stats, champions.get(1)!, items, runes);
    expect(d.position).toBe("JUNGLE");
    expect(d.positions.map((p) => p.position)).toEqual(["JUNGLE", "TOP"]);
    expect(d.bestMatchups[0]!.championId).toBe(2);
    expect(d.worstMatchups[0]!.championId).toBe(3);
    expect(d.synergies[0]!.championId).toBe(5);
    expect(d.builds.map((b) => b.against)).toEqual(["AD"]);
    expect(d.builds[0]!.build.items[0]!.name).toBe("Croc-de-Fer");
  });
});

describe("profil", () => {
  it("résume chaque game et les stats par champion", () => {
    const a = fixture({ minutes: 30, win: true, events: [] });
    const b = fixture({ minutes: 25, win: false, events: [] });
    const rows = [a, b].map((g) => gameRow(g.match, ME, analyseGame(g.match, g.timeline, ME))!);
    expect(rows[0]).toMatchObject({ champion: "Champ2", opponent: "Champ7", queue: "Solo/Duo", win: true, position: "JUNGLE" });
    expect(rows[0]!.score).toBeGreaterThan(0);
    const champs = champRows(rows);
    expect(champs).toHaveLength(1);
    expect(champs[0]).toMatchObject({ champion: "Champ2", games: 2, wins: 1 });
  });
});
