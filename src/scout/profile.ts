import type { RiotClient } from "../riot/client.ts";
import type { RankedEntry } from "../riot/types.ts";

// Fiche de chaque joueur pour l'écran de chargement : rang, forme et maîtrise du champion.

const TIER_FR: Record<string, string> = {
  IRON: "Fer",
  BRONZE: "Bronze",
  SILVER: "Argent",
  GOLD: "Or",
  PLATINUM: "Platine",
  EMERALD: "Émeraude",
  DIAMOND: "Diamant",
  MASTER: "Maître",
  GRANDMASTER: "Grand Maître",
  CHALLENGER: "Challenger",
};
const APEX = ["MASTER", "GRANDMASTER", "CHALLENGER"];

export interface PlayerProfile {
  rank: string; // « Émeraude II · 45 LP »
  record?: string; // « 54 % sur 120 parties »
  badges: string[];
}

export function describeRank(entries: RankedEntry[]): Pick<PlayerProfile, "rank" | "record"> & { badges: string[] } {
  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  if (!solo) return { rank: "Non classé", badges: [] };
  const tier = TIER_FR[solo.tier] ?? solo.tier;
  const games = solo.wins + solo.losses;
  const badges: string[] = [];
  if (solo.hotStreak) badges.push("🔥 série de victoires");
  if (games > 0 && games < 20) badges.push("peu de parties cette saison");
  return {
    rank: `${tier}${APEX.includes(solo.tier) ? "" : ` ${solo.rank}`} · ${solo.leaguePoints} LP`,
    record: games ? `${Math.round((solo.wins / games) * 100)} % sur ${games} parties` : undefined,
    badges,
  };
}

export function masteryBadge(points: number | undefined, now: number, lastPlayTime?: number): string | undefined {
  if (!points || points < 1000) return "⚠️ première fois sur ce champion";
  if (points < 10_000) return "peu d'expérience sur ce champion";
  const months = lastPlayTime ? (now - lastPlayTime) / (30 * 24 * 3600_000) : 0;
  if (points >= 300_000) return `★ spécialiste (${Math.round(points / 1000)}k points)`;
  if (months >= 6) return "n'a pas joué ce champion depuis des mois";
  return undefined;
}

export async function profilePlayer(riot: RiotClient, puuid: string, championId?: number): Promise<PlayerProfile> {
  const [entries, mastery] = await Promise.all([
    riot.leagueByPuuid(puuid),
    championId ? riot.mastery(puuid, championId) : Promise.resolve(undefined),
  ]);
  const r = describeRank(entries);
  const badge = championId ? masteryBadge(mastery?.championPoints, Date.now(), mastery?.lastPlayTime) : undefined;
  return { rank: r.rank, record: r.record, badges: badge ? [badge, ...r.badges] : r.badges };
}
