import type { ChampionIndex, ChampionInfo, ItemIndex, RuneIndex, RuneInfo } from "../data/ddragon.ts";
import { predictClass, type CompClass, type GlobalStats, type WL } from "../global/stats.ts";
import { normalize, type PoolStats } from "./pool.ts";
import type { DraftState, Suggestion } from "./recommend.ts";

// Conseils de draft et de build tirés des stats de tout le serveur.

const POSITION: Record<string, string> = {
  top: "TOP",
  jungle: "JUNGLE",
  middle: "MIDDLE",
  bottom: "BOTTOM",
  utility: "UTILITY",
};

const POSITION_FR: Record<string, string> = {
  TOP: "au top",
  JUNGLE: "en jungle",
  MIDDLE: "au mid",
  BOTTOM: "en ADC",
  UTILITY: "en support",
};

const CLASS_FR: Record<CompClass, string> = {
  AD: "surtout des dégâts physiques",
  AP: "surtout des dégâts magiques",
  mixte: "des dégâts mixtes",
};

/** Winrate ramené vers 50 % tant qu'il y a peu de parties. */
const baseRate = (r: WL) => (r.w + 50) / (r.g + 100);

/** Écart de winrate par rapport à la moyenne du champion, ramené vers 0 s'il y a peu de parties. */
const delta = (r: WL | undefined, base: number) => (r ? (r.w - r.g * base) / (r.g + 50) : 0);

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${pct(Math.abs(x))}`;

const sum = (records: Record<string, WL> | undefined) => Object.values(records ?? {}).reduce((s, r) => s + r.g, 0);

export interface GlobalSuggestion extends Suggestion {
  /** Chances de victoire estimées. */
  expected: number;
}

/** Points de maîtrise de tes champions (client LoL), par identifiant. */
export type Mastery = Map<number, number>;

/** Probabilité que ce champion joue à ce poste, d'après le serveur. */
function roleShare(stats: GlobalStats, championId: number, position: string): number {
  let total = 0;
  for (const table of Object.values(stats.champs)) total += table[championId]?.g ?? 0;
  return total ? (stats.champs[position]?.[championId]?.g ?? 0) / total : 0;
}

/** Bonus de confort en points de winrate : jouer un champion qu'on ne connaît pas coûte cher. */
export function comfortBonus(points: number | undefined): number {
  const p = points ?? 0;
  if (p < 1000) return -0.03;
  return Math.max(-0.02, Math.min(0.03, 0.015 * Math.log10(p / 5000)));
}

const MIN_MATCHUP = 20;

/** Champions joués à ce poste assez souvent, avec leur part des parties. */
function rolePool(stats: GlobalStats, position: string, minShare: number): { id: string; share: number }[] {
  const atRole = stats.champs[position] ?? {};
  const total = sum(atRole);
  return Object.entries(atRole)
    .map(([id, r]) => ({ id, share: total ? r.g / total : 0 }))
    .filter((x) => x.share >= minShare);
}

export function suggestGlobal(
  state: DraftState,
  stats: GlobalStats,
  champions: ChampionIndex,
  pool?: PoolStats,
  limit = 6,
  mastery?: Mastery,
): GlobalSuggestion[] {
  const position = POSITION[state.position];
  if (!position) return [];
  const atRole = stats.champs[position] ?? {};
  const roleGames = sum(atRole);
  const minGames = Math.max(30, roleGames * 0.004);

  // Adversaire de lane probable : un ennemi qui joue presque toujours à ton poste.
  const shares = state.enemies.map((e) => ({ e, share: roleShare(stats, e.id, position) }));
  const laneKnown = shares.some((x) => x.share >= 0.5);
  const likelyOpponents = rolePool(stats, position, 0.02);

  const results: GlobalSuggestion[] = [];
  for (const [id, record] of Object.entries(atRole)) {
    const c = champions.get(Number(id));
    if (!c || state.unavailable.has(c.id) || record.g < minGames) continue;
    const base = baseRate(record);
    const reasons = [`${pct(record.w / record.g)} de victoires ${POSITION_FR[position]} (${record.g} parties)`];
    let expected = base;

    const effects: { text: string; value: number }[] = [];
    for (const { e, share } of shares) {
      const lane = stats.lane[position]?.[id]?.[e.id];
      const vs = delta(stats.vs[id]?.[e.id], base);
      const d = lane && lane.g >= MIN_MATCHUP ? share * delta(lane, base) + (1 - share) * vs : vs;
      expected += d;
      effects.push({ text: `${signed(d)} contre ${e.name}${share >= 0.5 ? " (ta lane)" : ""}`, value: d });
    }
    for (const a of state.allies) {
      const d = delta(stats.with[id]?.[a.id], base);
      expected += d;
      effects.push({ text: `${signed(d)} avec ${a.name}`, value: d });
    }
    // Les effets les plus marqués expliquent le conseil.
    for (const e of effects.filter((x) => Math.abs(x.value) >= 0.01).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3)) {
      reasons.push(e.text);
    }

    // Pick à l'aveugle : on évite les champions qui se font facilement counter.
    let score = expected;
    if (!laneKnown) {
      let risk = 0;
      let worst: { id: string; d: number } | undefined;
      for (const o of likelyOpponents) {
        const d = delta(stats.lane[position]?.[id]?.[o.id], base);
        if (d < 0) risk += o.share * d;
        if (!worst || d < worst.d) worst = { id: o.id, d };
      }
      score += risk;
      if (worst && worst.d <= -0.03) reasons.push(`attention, se fait counter par ${champions.get(Number(worst.id))?.name ?? "?"} (${signed(worst.d)})`);
      else if (risk > -0.005) reasons.push("pick sûr tant que ton adversaire n'a pas choisi");
    }

    const points = mastery?.get(c.id);
    if (mastery) {
      const bonus = comfortBonus(points);
      score += bonus;
      if (bonus <= -0.02) reasons.push("tu ne le joues presque jamais : pick risqué");
      else if (bonus >= 0.015) reasons.push(`ton champion (${Math.round((points ?? 0) / 1000)}k points de maîtrise)`);
    }
    const mine = pool?.champions.get(normalize(c.key));
    if (mine && mine.games >= 2) {
      score += Math.min(mine.games, 10) * 0.0025;
      reasons.push(`tu l'as joué ${mine.games} fois récemment (${mine.wins} victoire(s))`);
    }
    results.push({ champion: c, score: score * 100, expected, games: record.g, wins: record.w, reasons });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface BanSuggestion {
  champion: ChampionInfo;
  reason: string;
}

/** Bans conseillés : ce qui counter ton champion, sinon les champions les plus forts à ton poste. */
export function suggestBans(state: DraftState, stats: GlobalStats, champions: ChampionIndex, myChampion?: ChampionInfo, limit = 3): BanSuggestion[] {
  const position = POSITION[state.position];
  if (!position) return [];
  const bans: BanSuggestion[] = [];
  const taken = (id: number) =>
    state.unavailable.has(id) || state.allies.some((a) => a.id === id) || bans.some((b) => b.champion.id === id) || id === myChampion?.id;

  if (myChampion) {
    const mine = stats.champs[position]?.[myChampion.id];
    const base = mine ? baseRate(mine) : 0.5;
    const counters = Object.entries(stats.lane[position]?.[myChampion.id] ?? {})
      .filter(([, r]) => r.g >= MIN_MATCHUP)
      .map(([id, r]) => ({ id: Number(id), d: delta(r, base) }))
      .filter((x) => x.d <= -0.02)
      .sort((a, b) => a.d - b.d);
    for (const x of counters) {
      const c = champions.get(x.id);
      if (!c || taken(c.id) || bans.length >= limit) continue;
      bans.push({ champion: c, reason: `counter ${myChampion.name} (${signed(x.d)} pour toi)` });
    }
  }
  const strongest = rolePool(stats, position, 0.02)
    .map((x) => ({ ...x, r: stats.champs[position]![x.id]! }))
    .sort((a, b) => baseRate(b.r) - baseRate(a.r));
  for (const x of strongest) {
    const c = champions.get(Number(x.id));
    if (!c || taken(c.id) || bans.length >= limit) continue;
    bans.push({ champion: c, reason: `${pct(x.r.w / x.r.g)} de victoires ${POSITION_FR[position]}, joué dans ${pct(x.share)} des parties` });
  }
  return bans;
}

export interface BuildPick {
  id: number;
  name: string;
  pick: number; // part des parties où il est pris
  winrate: number;
  note?: string;
}

export interface BuildAdvice {
  enemyClass: CompClass;
  games: number;
  keystone?: BuildPick & { rune: RuneInfo };
  items: BuildPick[];
  summary: string;
}

const CORE_ITEMS = 4;

/** Le build qui marche pour ce champion contre ce type de compo, d'après le serveur. */
export function buildAdvice(
  stats: GlobalStats,
  champion: ChampionInfo,
  enemies: ChampionInfo[],
  items: ItemIndex,
  runes: RuneIndex,
): BuildAdvice | undefined {
  const cls = predictClass(stats, enemies.map((e) => e.id));
  const runeTable = stats.runes[champion.id]?.[cls] ?? {};
  const games = sum(runeTable);
  if (games < 20) return undefined;

  const itemTable = stats.items[champion.id]?.[cls] ?? {};
  // Fréquence de chaque objet toutes compos confondues, pour repérer les objets de situation.
  const allClasses = Object.values(stats.items[champion.id] ?? {});
  const allGames = Object.values(stats.runes[champion.id] ?? {}).reduce((s, t) => s + sum(t), 0);
  const overallPick = (item: string) => allClasses.reduce((s, t) => s + (t[item]?.g ?? 0), 0) / allGames;

  const candidates = Object.entries(itemTable)
    .filter(([id, r]) => items.get(Number(id))?.completed && r.g / games >= 0.08)
    .map(([id, r]): BuildPick => {
      const pick = r.g / games;
      const ratio = pick / Math.max(overallPick(id), 0.001);
      return {
        id: Number(id),
        name: items.get(Number(id))!.name,
        pick,
        winrate: r.w / r.g,
        note: ratio >= 1.3 && cls !== "mixte" ? `pris ${ratio.toFixed(1).replace(".", ",")}× plus souvent contre ce type de compo` : undefined,
      };
    });
  const core = [...candidates].sort((a, b) => b.pick - a.pick).slice(0, CORE_ITEMS);
  const situational = candidates
    .filter((c) => c.note && !core.includes(c))
    .sort((a, b) => b.winrate - a.winrate)
    .slice(0, 2);

  const [keyId, keyRecord] = Object.entries(runeTable).sort((a, b) => b[1].g - a[1].g)[0] ?? [];
  const rune = keyId ? runes.get(Number(keyId)) : undefined;
  const keystone =
    rune && keyRecord ? { id: rune.id, name: rune.name, rune, pick: keyRecord.g / games, winrate: keyRecord.w / keyRecord.g } : undefined;

  return {
    enemyClass: cls,
    games,
    keystone,
    items: [...core, ...situational],
    summary: `Leur équipe fait ${CLASS_FR[cls]}. Build des joueurs Émeraude+ sur ${champion.name} contre ce type de compo (${games} parties) :`,
  };
}
