import { damageType, isFrontline, type ChampionIndex, type ChampionInfo, type DamageType } from "../data/ddragon.ts";
import { normalize, type PoolStats } from "./pool.ts";

// Positions du client (champ select) -> positions Match-V5.
const POSITION: Record<string, string> = {
  top: "TOP",
  jungle: "JUNGLE",
  middle: "MIDDLE",
  bottom: "BOTTOM",
  utility: "UTILITY",
};

export interface DraftState {
  position: string; // position du client : "jungle", "" si inconnue
  allies: ChampionInfo[]; // champions choisis (ou survolés) par tes alliés
  enemies: ChampionInfo[];
  unavailable: Set<number>; // bannis ou déjà pris
}

export interface CompProfile {
  ad: number;
  ap: number;
  frontline: number;
}

export interface Suggestion {
  champion: ChampionInfo;
  score: number;
  games: number;
  wins: number;
  reasons: string[];
}

export function profile(champs: ChampionInfo[]): CompProfile {
  const p = { ad: 0, ap: 0, frontline: 0 };
  for (const c of champs) {
    const t = damageType(c);
    if (t === "AD") p.ad++;
    if (t === "AP") p.ap++;
    if (isFrontline(c)) p.frontline++;
  }
  return p;
}

/** Winrate lissé vers 50 % : 1 victoire sur 1 partie ne vaut pas 100 %. */
const smoothedWinrate = (wins: number, games: number) => (wins + 2) / (games + 4);

export function suggestPicks(state: DraftState, pool: PoolStats, champions: ChampionIndex, limit = 5): Suggestion[] {
  const byKey = new Map([...champions.values()].map((c) => [normalize(c.key), c]));
  const position = POSITION[state.position];
  const allies = profile(state.allies);

  const entries = [...pool.champions.values()].filter((e) => {
    const c = byKey.get(e.champion);
    return c && !state.unavailable.has(c.id);
  });
  // Les champions joués à ce poste ; à défaut, tout le pool.
  const onRole = position ? entries.filter((e) => (e.positions[position] ?? 0) > 0) : entries;
  const candidates = onRole.length >= 3 ? onRole : entries;

  return candidates
    .map((e) => {
      const c = byKey.get(e.champion)!;
      const reasons: string[] = [];
      const wr = smoothedWinrate(e.wins, e.games);
      let score = (wr - 0.5) * 100 + Math.min(e.games, 10);
      reasons.push(`${e.wins} victoire(s) sur ${e.games} partie(s) récentes`);

      const type: DamageType = damageType(c);
      if (type === "AP" && allies.ad >= 3 && allies.ap === 0) {
        score += 8;
        reasons.push("ton équipe n'a que des dégâts physiques");
      } else if (type === "AD" && allies.ap >= 3 && allies.ad === 0) {
        score += 8;
        reasons.push("ton équipe n'a que des dégâts magiques");
      } else if ((type === "AD" && allies.ad >= 3) || (type === "AP" && allies.ap >= 3)) {
        score -= 6;
        reasons.push(`ton équipe a déjà beaucoup de dégâts ${type}`);
      }
      if (allies.frontline === 0 && state.allies.length >= 2 && isFrontline(c)) {
        score += 5;
        reasons.push("ton équipe n'a pas encore de frontline");
      }

      for (const enemy of state.enemies) {
        const r = pool.against.get(normalize(enemy.key));
        if (!r || r.games < 2) continue;
        const delta = (smoothedWinrate(r.wins, r.games) - 0.5) * 20;
        score += delta;
        if (Math.abs(delta) >= 2) {
          reasons.push(`contre ${enemy.name} : ${r.wins} victoire(s) sur ${r.games}`);
        }
      }
      return { champion: c, score, games: e.games, wins: e.wins, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Conseils d'itemisation génériques selon la compo adverse. */
export function compAdvice(enemies: ChampionInfo[]): string[] {
  if (enemies.length === 0) return [];
  const p = profile(enemies);
  const advice: string[] = [];
  if (p.ad >= 3) advice.push(`${p.ad} champions à dégâts physiques en face : prévois de l'armure.`);
  if (p.ap >= 3) advice.push(`${p.ap} champions à dégâts magiques en face : prévois de la résistance magique.`);
  if (p.frontline >= 2) advice.push(`${p.frontline} tanks ou bruisers en face : la pénétration d'armure ou magique sera rentable.`);
  if (enemies.filter((c) => c.tags.includes("Assassin")).length >= 2) {
    advice.push("Plusieurs assassins en face : évite de te balader seul et pense à un objet défensif tôt.");
  }
  return advice;
}
