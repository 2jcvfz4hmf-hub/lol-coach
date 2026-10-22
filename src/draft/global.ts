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

export function suggestGlobal(
  state: DraftState,
  stats: GlobalStats,
  champions: ChampionIndex,
  pool?: PoolStats,
  limit = 6,
): GlobalSuggestion[] {
  const position = POSITION[state.position];
  if (!position) return [];
  const atRole = stats.champs[position] ?? {};
  const roleGames = sum(atRole);
  const minGames = Math.max(30, roleGames * 0.004);

  const results: GlobalSuggestion[] = [];
  for (const [id, record] of Object.entries(atRole)) {
    const c = champions.get(Number(id));
    if (!c || state.unavailable.has(c.id) || record.g < minGames) continue;
    const base = baseRate(record);
    const reasons = [`${pct(record.w / record.g)} de victoires ${POSITION_FR[position]} (${record.g} parties)`];
    let expected = base;

    const effects: { text: string; value: number }[] = [];
    for (const e of state.enemies) {
      const r = stats.vs[id]?.[e.id];
      const d = delta(r, base);
      expected += d;
      effects.push({ text: `${signed(d)} contre ${e.name}`, value: d });
    }
    for (const a of state.allies) {
      const r = stats.with[id]?.[a.id];
      const d = delta(r, base);
      expected += d;
      effects.push({ text: `${signed(d)} avec ${a.name}`, value: d });
    }
    // Les effets les plus marqués expliquent le conseil.
    for (const e of effects.filter((x) => Math.abs(x.value) >= 0.01).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3)) {
      reasons.push(e.text);
    }

    const mine = pool?.champions.get(normalize(c.key));
    let score = expected * 100;
    if (mine && mine.games >= 2) {
      score += Math.min(mine.games, 10) * 0.25;
      reasons.push(`tu l'as joué ${mine.games} fois récemment (${mine.wins} victoire(s))`);
    }
    results.push({ champion: c, score, expected, games: record.g, wins: record.w, reasons });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
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
