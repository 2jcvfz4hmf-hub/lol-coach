import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseChampions, parseItems, parseRunes } from "../src/data/ddragon.ts";
import { buildAdvice, comfortBonus, suggestBans, suggestGlobal } from "../src/draft/global.ts";
import { comparePatch, Crawler } from "../src/global/crawler.ts";
import { addMatch, emptyStats, mergeStats, predictClass } from "../src/global/stats.ts";
import { StatsStore } from "../src/global/store.ts";
import { RateLimiter } from "../src/riot/limiter.ts";
import { RiotApiError, type RiotClient } from "../src/riot/client.ts";
import type { Match, Participant, Position } from "../src/riot/types.ts";

const POSITIONS: Position[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

const champions = parseChampions({
  data: Object.fromEntries(
    (
      [
        ["Darius", 122, "Fighter"],
        ["Vi", 254, "Fighter"],
        ["Ahri", 103, "Mage"],
        ["Jinx", 222, "Marksman"],
        ["Thresh", 412, "Support"],
        ["Garen", 86, "Fighter"],
        ["Lillia", 876, "Mage"],
        ["Zed", 238, "Assassin"],
        ["Caitlyn", 51, "Marksman"],
        ["Lux", 99, "Mage"],
        ["Ivern", 427, "Support"],
        ["Nami", 267, "Support"],
      ] as const
    ).map(([key, id, tag]) => [key, { id: key, key: String(id), name: key, tags: [tag], info: { attack: 5, magic: 5, defense: 5, difficulty: 5 } }]),
  ),
});
const id = (key: string) => [...champions.values()].find((c) => c.key === key)!.id;
const champ = (key: string) => champions.get(id(key))!;

const items = parseItems({
  data: {
    "1001": { name: "Bottes", into: ["3047"], tags: ["Boots"], gold: { total: 300, purchasable: true } },
    "3047": { name: "Coques en acier", tags: ["Boots"], gold: { total: 1200, purchasable: true } },
    "3111": { name: "Sandales de mercure", tags: ["Boots"], gold: { total: 1250, purchasable: true } },
    "6630": { name: "Croc-de-Fer", gold: { total: 3300, purchasable: true } },
    "1036": { name: "Épée longue", into: ["6630"], gold: { total: 350, purchasable: true } },
    "2055": { name: "Balise de contrôle", tags: ["Consumable"], gold: { total: 75, purchasable: true } },
  },
});
const runes = parseRunes([{ slots: [{ runes: [{ id: 8010, name: "Conquérant", icon: "perk/Conqueror.png" }] }] }]);

let nextId = 1;
/** Partie classée : `blue` et `red` dans l'ordre top, jungle, mid, ADC, support. */
function match(blue: string[], red: string[], blueWins: boolean, opts: { redMagic?: boolean; patch?: string; items?: number[] } = {}): Match {
  const participants: Participant[] = [...blue, ...red].map((key, i) => {
    const teamId = i < 5 ? 100 : 200;
    const magic = teamId === 200 && opts.redMagic;
    return {
      puuid: `p${i}`,
      participantId: i + 1,
      teamId,
      teamPosition: POSITIONS[i % 5]!,
      championName: key,
      championId: id(key),
      win: teamId === 100 ? blueWins : !blueWins,
      kills: 0,
      deaths: 0,
      assists: 0,
      totalMinionsKilled: 0,
      neutralMinionsKilled: 0,
      goldEarned: 0,
      visionScore: 0,
      wardsPlaced: 0,
      wardsKilled: 0,
      visionWardsBoughtInGame: 0,
      totalDamageDealtToChampions: 20000,
      physicalDamageDealtToChampions: magic ? 2000 : 18000,
      magicDamageDealtToChampions: magic ? 18000 : 2000,
      item0: opts.items?.[0] ?? 6630,
      item1: opts.items?.[1] ?? 3047,
      item2: 2055,
      perks: { styles: [{ style: 8000, selections: [{ perk: 8010 }] }] },
    } as Participant;
  });
  return {
    metadata: { matchId: `EUW1_${nextId++}`, participants: participants.map((p) => p.puuid) },
    info: { gameCreation: 0, gameDuration: 1800, queueId: 420, gameVersion: `${opts.patch ?? "15.21"}.1.1`, participants },
  };
}

const BLUE = ["Darius", "Vi", "Ahri", "Jinx", "Thresh"];
const RED = ["Garen", "Lillia", "Zed", "Caitlyn", "Lux"];

describe("stats globales", () => {
  it("compte winrates, counters et duos", () => {
    const s = emptyStats("15.21");
    for (let i = 0; i < 10; i++) addMatch(s, match(BLUE, RED, i < 7));
    expect(s.games).toBe(10);
    expect(s.champs.JUNGLE![id("Vi")]).toEqual({ g: 10, w: 7 });
    expect(s.lane.JUNGLE![id("Vi")]![id("Lillia")]).toEqual({ g: 10, w: 7 });
    expect(s.vs[id("Vi")]![id("Lux")]).toEqual({ g: 10, w: 7 });
    expect(s.with[id("Lillia")]![id("Zed")]).toEqual({ g: 10, w: 3 });
    // La balise de contrôle et les bottes de base ne sont pas des objets de build.
    expect(Object.keys(s.items[id("Vi")]!.AD!)).toContain("6630");
  });

  it("ignore les parties trop courtes ou hors ranked solo", () => {
    const s = emptyStats("15.21");
    const short = match(BLUE, RED, true);
    short.info.gameDuration = 600;
    const flex = match(BLUE, RED, true);
    flex.info.queueId = 440;
    expect(addMatch(s, short)).toBe(false);
    expect(addMatch(s, flex)).toBe(false);
    expect(s.games).toBe(0);
  });

  it("prévoit le profil de dégâts d'une compo", () => {
    const s = emptyStats("15.21");
    addMatch(s, match(BLUE, RED, true, { redMagic: true }));
    expect(predictClass(s, RED.map(id))).toBe("AP");
    expect(predictClass(s, BLUE.map(id))).toBe("AD");
  });

  it("compare les patchs", () => {
    expect(comparePatch("15.10", "15.9")).toBeGreaterThan(0);
    expect(comparePatch("15.9", "16.1")).toBeLessThan(0);
  });
});

describe("conseils avec les stats du serveur", () => {
  // Vi et Lillia gagnent autant au global, mais Vi gagne bien plus contre Lux.
  const s = emptyStats("15.21");
  const winsVsLux = { Vi: 23, Lillia: 10 };
  const winsOther = { Vi: 12, Lillia: 25 };
  for (const jungler of ["Vi", "Lillia"] as const) {
    for (let i = 0; i < 50; i++) {
      const lux = i < 25;
      const k = lux ? i : i - 25;
      const win = k < (lux ? winsVsLux : winsOther)[jungler];
      const red = ["Garen", "Ivern", "Zed", "Caitlyn", lux ? "Lux" : "Thresh"];
      const blue = ["Darius", jungler, "Ahri", "Jinx", lux ? "Thresh" : "Nami"];
      addMatch(s, match(blue, red, win, { redMagic: lux }));
    }
  }

  it("conseille le champion qui gagne contre la compo adverse", () => {
    const state = { position: "jungle", allies: [], enemies: [champ("Lux")], unavailable: new Set<number>() };
    const picks = suggestGlobal(state, s, champions);
    expect(picks[0]!.champion.key).toBe("Vi");
    expect(picks[0]!.reasons.join(" ")).toMatch(/contre Lux/);
    expect(picks.map((p) => p.champion.key)).not.toContain("Darius"); // pas joué en jungle
  });

  it("ne conseille pas un champion déjà pris ou banni", () => {
    const state = { position: "jungle", allies: [], enemies: [], unavailable: new Set([id("Vi")]) };
    const keys = suggestGlobal(state, s, champions).map((p) => p.champion.key);
    expect(keys).toContain("Lillia");
    expect(keys).not.toContain("Vi");
  });

  it("évite un champion que tu ne joues jamais", () => {
    const state = { position: "jungle", allies: [], enemies: [], unavailable: new Set<number>() };
    const mastery = new Map([
      [id("Vi"), 0],
      [id("Lillia"), 200_000],
    ]);
    const picks = suggestGlobal(state, s, champions, undefined, 6, mastery);
    expect(picks[0]!.champion.key).toBe("Lillia");
    expect(picks.find((p) => p.champion.key === "Vi")!.reasons.join(" ")).toMatch(/pick risqué/);
    expect(comfortBonus(5000)).toBeCloseTo(0);
    expect(comfortBonus(500_000)).toBeCloseTo(0.03);
  });

  it("conseille des bans sans bannir ton champion ni ceux de tes alliés", () => {
    const state = { position: "jungle", allies: [champ("Ahri")], enemies: [], unavailable: new Set<number>() };
    const bans = suggestBans(state, s, champions, champ("Vi"));
    expect(bans.map((b) => b.champion.key)).not.toContain("Vi");
    expect(bans[0]!.champion.key).toBe("Lillia");
    expect(bans[0]!.reason).toMatch(/de victoires en jungle/);
  });

  it("donne le build adapté aux dégâts de l'équipe adverse", () => {
    const advice = buildAdvice(s, champ("Vi"), [champ("Lux"), champ("Garen")], items, runes)!;
    expect(advice.enemyClass).toBe("AP");
    expect(advice.keystone?.name).toBe("Conquérant");
    expect(advice.items.map((i) => i.name).sort()).toEqual(["Coques en acier", "Croc-de-Fer"]);
  });
});

describe("récolte", () => {
  it("respecte la limite de requêtes", async () => {
    let t = 0;
    const limiter = new RateLimiter([{ max: 2, ms: 1000 }], () => t, async (ms) => void (t += ms));
    const at: number[] = [];
    for (let i = 0; i < 5; i++) {
      await limiter.take();
      at.push(t);
    }
    expect(at[1]).toBe(0);
    expect(at[2]).toBeGreaterThanOrEqual(1000);
    expect(at[4]).toBeGreaterThanOrEqual(2000);
  });

  it("récolte les parties du patch en cours et passe au patch suivant", async () => {
    const games = new Map<string, Match>();
    const add = (m: Match) => (games.set(m.metadata.matchId, m), m.metadata.matchId);
    const recent = [add(match(BLUE, RED, true, { patch: "15.22" })), add(match(BLUE, RED, false, { patch: "15.22" }))];
    const old = add(match(BLUE, RED, true, { patch: "15.21" }));
    let calls = 0;
    const riot = {
      apexLeague: async () => ({ entries: [{ puuid: "a", leaguePoints: 900 }] }),
      leagueEntries: async () => [],
      rankedSoloIds: async () => (calls++ === 0 ? [old] : [...recent, old]),
      match: async (m: string) => games.get(m)!,
    } as unknown as RiotClient;

    const store = await new StatsStore(await mkdtemp(path.join(tmpdir(), "coach-"))).load();
    // Le récolteur se met en pause quand il n'a plus de joueurs : tout est récolté.
    let idle!: () => void;
    const done = new Promise<void>((r) => (idle = r));
    const crawler = new Crawler(riot, store, () => {}, () => (idle(), new Promise((r) => setTimeout(r, 1))));
    crawler.start();
    await done;
    await crawler.stop();
    expect(store.previous?.patch).toBe("15.21");
    expect(store.previous?.games).toBe(1);
    expect(store.current?.patch).toBe("15.22");
    expect(store.current?.games).toBe(2);

    const reloaded = await new StatsStore((store as unknown as { dir: string }).dir).load();
    expect(reloaded.current?.games).toBe(2);
    expect(reloaded.seen.has(recent[0]!)).toBe(true);
  });

  it("range les parties Fer à Platine à part", async () => {
    const games = new Map<string, Match>();
    const add = (m: Match) => (games.set(m.metadata.matchId, m), m.metadata.matchId);
    const high = add(match(BLUE, RED, true, { patch: "15.22" }));
    const low = add(match(BLUE, RED, false, { patch: "15.22" }));
    const riot = {
      apexLeague: async () => ({ entries: [{ puuid: "pro", leaguePoints: 900 }] }),
      leagueEntries: async (tier: string, _d: string, page: number) => (tier === "GOLD" && page === 1 ? [{ puuid: "gold" }] : []),
      rankedSoloIds: async (puuid: string) => (puuid === "gold" ? [low, high] : [high]),
      match: async (m: string) => games.get(m)!,
    } as unknown as RiotClient;
    const dir = await mkdtemp(path.join(tmpdir(), "coach-"));
    const store = await new StatsStore(dir).load();
    const lowStore = await new StatsStore(dir, "-bas").load();
    let idle!: () => void;
    const done = new Promise<void>((r) => (idle = r));
    const crawler = new Crawler(riot, store, () => {}, () => (idle(), new Promise((r) => setTimeout(r, 1))), lowStore);
    crawler.start();
    await done;
    await crawler.stop();
    // Chaque partie n'est comptée qu'une fois, dans le groupe du joueur par qui on l'a trouvée.
    expect((store.current?.games ?? 0) + (lowStore.current?.games ?? 0)).toBe(2);
    expect(lowStore.current?.games).toBeGreaterThanOrEqual(1);
    expect((await new StatsStore(dir, "-bas").load()).current?.games).toBe(lowStore.current?.games);
  });

  it("réunit les stats de deux groupes de rangs", () => {
    const a = emptyStats("15.22");
    const b = emptyStats("15.22");
    addMatch(a, match(BLUE, RED, true));
    addMatch(b, match(BLUE, RED, false));
    const m = mergeStats(a, b);
    expect(m.games).toBe(2);
    expect(m.champs.JUNGLE?.[id("Vi")]).toEqual({ g: 2, w: 1 });
    expect(a.games).toBe(1); // l'original ne change pas
  });

  it("s'arrête si la clé est refusée", async () => {
    const riot = {
      apexLeague: async () => {
        throw new RiotApiError(403, "x");
      },
    } as unknown as RiotClient;
    const store = await new StatsStore(await mkdtemp(path.join(tmpdir(), "coach-"))).load();
    const statuses: string[] = [];
    const crawler = new Crawler(riot, store, (s) => s.error && statuses.push(s.error), async () => {});
    crawler.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(crawler.status().running).toBe(false);
    expect(statuses[0]).toMatch(/Clé Riot refusée/);
  });
});
