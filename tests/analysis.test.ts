import { describe, expect, it } from "vitest";
import { buildContext, zoneOf } from "../src/analysis/context.ts";
import { analyseGame, isPlayable } from "../src/analysis/game.ts";
import { buildPlays, leadForGoodMinute } from "../src/analysis/plays.ts";
import { summarise } from "../src/analysis/recurring.ts";
import { summaryReport, gameReport } from "../src/report/fr.ts";
import { fixture, kill, ME, min, monster, tower } from "./fixture.ts";

const BARON_PIT = { x: 5000, y: 10400 };
const DRAGON_PIT = { x: 9800, y: 4400 };

describe("actions de jeu", () => {
  it("regroupe les kills proches dans le temps et rattache l'objectif qui suit", () => {
    const { match, timeline } = fixture({
      minutes: 30,
      win: false,
      events: [
        kill(min(25, 0), 6, 1, BARON_PIT),
        kill(min(25, 10), 7, 3, BARON_PIT),
        kill(min(25, 25), 8, 4, BARON_PIT),
        monster(min(25, 50), 200, "BARON_NASHOR", BARON_PIT),
        kill(min(28), 1, 6, DRAGON_PIT),
      ],
    });
    const plays = buildPlays(buildContext(match, timeline, ME));
    expect(plays).toHaveLength(2);
    expect(plays[0]!.kills).toHaveLength(3);
    expect(plays[0]!.objectives.map((o) => o.kind)).toEqual(["BARON_NASHOR"]);
    expect(plays[0]!.swing).toBe(-900 - 1500);
    expect(plays[1]!.swing).toBe(300);
  });

  it("garde un objectif pris sans combat comme action à part", () => {
    const { match, timeline } = fixture({ minutes: 20, win: true, events: [monster(min(8), 100, "DRAGON")] });
    const plays = buildPlays(buildContext(match, timeline, ME));
    expect(plays).toHaveLength(1);
    expect(plays[0]!.swing).toBe(500);
  });

  it("sait que le joueur était mort pendant l'action", () => {
    const { match, timeline } = fixture({
      minutes: 30,
      win: false,
      events: [kill(min(24, 30), 7, 2, { x: 9000, y: 9000 }), kill(min(25), 6, 1, BARON_PIT), monster(min(25, 30), 200, "BARON_NASHOR", BARON_PIT)],
    });
    const plays = buildPlays(buildContext(match, timeline, ME));
    expect(plays[1]!.me.kind).toBe("mort");
  });
});

describe("écart d'or", () => {
  it("trouve la minute où l'équipe gagnante prend l'avantage pour de bon", () => {
    expect(leadForGoodMinute([0, 100, -200, 300, -50, -400, -900], false)).toBe(4);
    expect(leadForGoodMinute([0, 100, -200, 300, 500], true)).toBe(3);
    expect(leadForGoodMinute([0, -100, 200], false)).toBeUndefined();
  });
});

describe("zones de la carte", () => {
  it("classe les positions par ligne", () => {
    expect(zoneOf({ x: 1500, y: 9000 })).toBe("top");
    expect(zoneOf({ x: 7400, y: 7400 })).toBe("mid");
    expect(zoneOf({ x: 12000, y: 1500 })).toBe("bot");
    expect(zoneOf({ x: 3500, y: 7500 })).toBe("jungle");
  });
});

describe("analyse d'une défaite en jungle", () => {
  const { match, timeline } = fixture({
    minutes: 32,
    win: false,
    participant: (p) => (p.participantId === 2 ? { visionScore: 10, visionWardsBoughtInGame: 0, deaths: 3 } : {}),
    events: [
      monster(min(6), 200, "HORDE", { x: 5000, y: 10400 }),
      monster(min(6, 5), 200, "HORDE", { x: 5000, y: 10400 }),
      monster(min(9), 200, "DRAGON"),
      // Attrapé seul dans la jungle adverse.
      kill(min(12), 7, 2, { x: 9000, y: 11000 }, [6]),
      // Encore seul, puis dragon perdu.
      kill(min(18), 7, 2, { x: 9500, y: 9000 }, [8], { shutdownBounty: 450 }),
      monster(min(19), 200, "DRAGON", DRAGON_PIT),
      // Mort dans le combat au Nashor : action décisive.
      kill(min(27), 6, 2, { x: 4000, y: 11500 }, [9, 10]),
      kill(min(27, 15), 7, 1, BARON_PIT),
      kill(min(27, 30), 8, 3, BARON_PIT),
      monster(min(28), 200, "BARON_NASHOR", BARON_PIT),
      tower(min(29), 100),
    ],
  });
  const g = analyseGame(match, timeline, ME);
  const codes = g.findings.map((f) => f.code);

  it("identifie l'action qui coûte la partie et ton rôle dedans", () => {
    expect(g.decisive?.play.objectives.map((o) => o.kind)).toContain("BARON_NASHOR");
    expect(codes).toContain("decisif-mort");
  });

  it("repère les morts isolées, les objectifs perdus et le shutdown", () => {
    expect(g.deaths).toHaveLength(3);
    expect(g.deaths[0]!.tags).toEqual(["isole", "terrain-ennemi"]);
    expect(g.deaths[1]!.tags).toEqual(expect.arrayContaining(["isole", "avant-objectif", "shutdown", "terrain-ennemi"]));
    expect(codes).toEqual(expect.arrayContaining(["morts-isolees", "morts-avant-objectif", "shutdown-donne"]));
  });

  it("donne des constats propres au jungler", () => {
    expect(g.stats.jungle?.earlyObjectives).toEqual({ allies: 0, enemies: 4 });
    expect(codes).toEqual(expect.arrayContaining(["jungle-objectifs-early", "jungle-zero-impact", "vision-faible", "zero-pink"]));
  });

  it("produit un rapport lisible", () => {
    const text = gameReport(g);
    expect(text).toContain("Défaite");
    expect(text).toContain("Moment où la partie est perdue");
    expect(text).toContain("Nashor perdu");
  });
});

describe("analyse en lane", () => {
  it("compare le farm et l'or avec le vis-à-vis", () => {
    const { match, timeline } = fixture({
      minutes: 25,
      win: true,
      gold: (pid, m) => 500 + 400 * m + (pid === 1 ? 100 * m : 0),
      cs: (pid, m) => ({ minions: pid === 6 ? m * 9 : m * 7, jungle: 0 }),
      events: [],
    });
    const g = analyseGame(match, timeline, "puuid-1");
    expect(g.stats.lane.csDiffAt10).toBe(-20);
    expect(g.stats.lane.goldDiffAt15).toBe(1500);
    expect(g.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["farm-retard", "avance-15"]));
  });
});

describe("erreurs récurrentes", () => {
  it("ne garde que ce qui revient dans au moins 30 % des parties", () => {
    const loss = fixture({ minutes: 25, win: false, participant: (p) => (p.participantId === 2 ? { visionWardsBoughtInGame: 0 } : {}), events: [] });
    const win = fixture({ minutes: 25, win: true, events: [] });
    const games = [
      analyseGame(loss.match, loss.timeline, ME),
      analyseGame(win.match, win.timeline, ME),
      analyseGame(win.match, win.timeline, ME),
      analyseGame(win.match, win.timeline, ME),
    ];
    const s = summarise(games);
    expect(s.wins).toBe(3);
    // zero-pink : 1 partie sur 4 (25 %), en dessous du seuil.
    expect(s.issues.map((i) => i.code)).not.toContain("zero-pink");
    // jungle-zero-impact : toutes les parties.
    expect(s.issues[0]?.share).toBe(1);
    expect(summaryReport("Ju#EUW", s)).toContain("100 % des parties");
  });
});

describe("retours après le premier test réel", () => {
  it("ignore les remakes et les early surrenders", () => {
    expect(isPlayable(fixture({ minutes: 25, win: true, events: [] }).match)).toBe(true);
    expect(isPlayable(fixture({ minutes: 3, win: false, events: [] }).match)).toBe(false);
    const ff = fixture({ minutes: 6, win: false, events: [], participant: () => ({ gameEndedInEarlySurrender: true }) });
    expect(isPlayable(ff.match)).toBe(false);
  });

  it("ne lie pas une mort à une tour qui tombe juste après", () => {
    const { match, timeline } = fixture({
      minutes: 25,
      win: false,
      events: [kill(min(20), 7, 2, { x: 7000, y: 7000 }, [8]), tower(min(20, 30), 100)],
    });
    const g = analyseGame(match, timeline, ME);
    expect(g.deaths[0]!.objectivesLost).toEqual([]);
    expect(g.findings.map((f) => f.code)).not.toContain("morts-avant-objectif");
  });

  it("fait un bilan par champion", () => {
    const loss = fixture({ minutes: 25, win: false, events: [monster(min(8), 200, "DRAGON")] });
    const win = fixture({ minutes: 25, win: true, events: [], participant: (p) => (p.participantId === 2 ? { championName: "Ivern" } : {}) });
    const s = summarise([
      analyseGame(loss.match, loss.timeline, ME),
      analyseGame(loss.match, loss.timeline, ME),
      analyseGame(win.match, win.timeline, ME),
    ]);
    expect(s.champions.map((c) => [c.champion, c.games, c.wins])).toEqual([
      ["Champ2", 2, 0],
      ["Ivern", 1, 1],
    ]);
    expect(s.champions[0]!.earlyObjectives).toEqual({ allies: 0, enemies: 2 });
    expect(summaryReport("Ju#EUW", s)).toContain("| Ivern | 1 | 1 (100 %)");
  });
});
