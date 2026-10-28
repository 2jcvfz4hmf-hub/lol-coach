import { describe, expect, it } from "vitest";
import { buildContext } from "../src/analysis/context.ts";
import { analyseGame } from "../src/analysis/game.ts";
import { analyseGanks, summariseGanks } from "../src/analysis/ganks.ts";
import { summarise } from "../src/analysis/recurring.ts";
import { gameReport, summaryReport } from "../src/report/fr.ts";
import { fixture, kill, ME, min } from "./fixture.ts";

// Jungler bleu = joueur 2. En face : 6 top, 7 jungle, 8 mid, 9 ADC, 10 support.
const game = () =>
  fixture({
    minutes: 25,
    win: false,
    events: [
      kill(min(3, 30), 2, 9, { x: 13000, y: 2000 }, [4]),
      kill(min(6, 10), 6, 2, { x: 1500, y: 12000 }, [7]),
    ],
    position: (pid, m) => {
      if (pid === 2) return m === 9 ? { x: 7400, y: 7400 } : { x: 5000, y: 9000 };
      return pid <= 5 ? { x: 3000, y: 3000 } : { x: 11000, y: 11000 };
    },
  });

describe("bilan des ganks", () => {
  it("classe chaque gank et explique les échecs", () => {
    const { match, timeline } = game();
    const ganks = analyseGanks(buildContext(match, timeline, ME));
    expect(ganks.map((g) => [g.lane, g.outcome])).toEqual([
      ["bot", "reussi"],
      ["top", "rate"],
      ["mid", "sans-resultat"],
    ]);
    expect(ganks[0]!.kills).toEqual(["Champ9"]);
    expect(ganks[1]!.reasons).toEqual([
      "le jungler adverse était là (contre-gank)",
      "ton laner n'était pas là pour suivre",
      "en infériorité numérique (1 contre 2)",
    ]);
    expect(summariseGanks(ganks)).toMatchObject({ total: 3, success: 1, byLane: { bot: { total: 1, success: 1 } } });
  });

  it("apparaît dans le rapport de la partie et dans le bilan", () => {
    const { match, timeline } = game();
    const g = analyseGame(match, timeline, ME);
    expect(gameReport(g)).toMatch(/3:30 · bot · ✅ réussi : kill sur Champ9/);
    // 5 + gank réussi (0,5) + kill (0,3) − gank raté (0,3) − mort seule (0,7)
    expect(g.score.score).toBeLessThan(5);
    expect(gameReport(g)).toMatch(/\*\*Note : [\d,]+\/10\*\*/);
    expect(gameReport(g)).toMatch(/\+0,5 · 3:30 · gank bot réussi/);
    const report = summaryReport("AURA", summarise([g]));
    expect(report).toMatch(/note moyenne/);
    // La courbe démarre à 5, monte après le gank réussi puis baisse après la mort.
    expect(g.score.curve[0]).toBe(5);
    expect(g.score.curve[4]).toBe(5.8);
    expect(g.score.curve[7]).toBeLessThan(5);
    expect(g.score.curve).toHaveLength(26);
    expect(report).toMatch(/3 ganks, 33 % réussis/);
  });

  it("ne concerne que les junglers", () => {
    const { match, timeline } = game();
    expect(analyseGanks(buildContext(match, timeline, "puuid-1"))).toEqual([]);
  });
});
