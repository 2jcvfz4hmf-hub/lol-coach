import type { Match, Participant } from "../riot/types.ts";

// Statistiques agrégées sur des milliers de parties classées de tous les joueurs.
// Les champions, objets et runes sont repérés par leur identifiant numérique.

export interface WL {
  g: number; // parties
  w: number; // victoires
}

/** Profil de dégâts d'une équipe : décide du build adapté en face. */
export type CompClass = "AD" | "AP" | "mixte";

type Table<T> = Record<string, T>;

export interface GlobalStats {
  version: 1;
  patch: string; // « 15.21 »
  games: number;
  /** Par poste, puis par champion. */
  champs: Table<Table<WL>>;
  /** Par poste : champion contre l'adversaire au même poste. */
  lane: Table<Table<Table<WL>>>;
  /** Champion contre chaque champion de l'équipe adverse. */
  vs: Table<Table<WL>>;
  /** Champion avec chaque allié. */
  with: Table<Table<WL>>;
  /** Objets terminés en fin de partie, selon les dégâts de l'équipe adverse. */
  items: Table<Table<Table<WL>>>;
  /** Rune principale, selon les dégâts de l'équipe adverse. */
  runes: Table<Table<Table<WL>>>;
  /** Dégâts infligés aux champions : part magique de chaque champion. */
  damage: Table<{ physical: number; magic: number }>;
}

export function emptyStats(patch: string): GlobalStats {
  return { version: 1, patch, games: 0, champs: {}, lane: {}, vs: {}, with: {}, items: {}, runes: {}, damage: {} };
}

/** « 15.21.712.1234 » -> « 15.21 » */
export const patchOf = (gameVersion: string) => gameVersion.split(".").slice(0, 2).join(".");

const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function bump(table: Table<WL>, key: string | number, win: boolean) {
  const r = (table[key] ??= { g: 0, w: 0 });
  r.g++;
  if (win) r.w++;
}

const at = <T>(table: Table<T>, key: string | number, make: () => T): T => (table[key] ??= make());

/** Classe de dégâts d'une équipe d'après ce qu'elle a réellement infligé. */
export function classify(physical: number, magic: number): CompClass {
  const total = physical + magic;
  if (total === 0) return "mixte";
  const magicShare = magic / total;
  if (magicShare >= 0.55) return "AP";
  if (magicShare <= 0.3) return "AD";
  return "mixte";
}

/** Classe de dégâts prévue d'une compo, d'après les dégâts moyens de chaque champion. */
export function predictClass(stats: GlobalStats, championIds: number[]): CompClass {
  let physical = 0;
  let magic = 0;
  for (const id of championIds) {
    const d = stats.damage[id];
    if (!d || d.physical + d.magic === 0) continue;
    // Chaque champion compte pareil, quelle que soit sa popularité.
    physical += d.physical / (d.physical + d.magic);
    magic += d.magic / (d.physical + d.magic);
  }
  return classify(physical, magic);
}

const items = (p: Participant) => [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i): i is number => !!i);

/** Une partie est retenue si c'est une ranked solo/duo complète sur la Faille. */
export function isUsable(m: Match): boolean {
  const ps = m.info.participants;
  return (
    m.info.queueId === 420 &&
    m.info.gameDuration >= 15 * 60 &&
    ps.length === 10 &&
    ps.every((p) => p.championId && POSITIONS.includes(p.teamPosition) && !p.gameEndedInEarlySurrender)
  );
}

export function addMatch(stats: GlobalStats, m: Match): boolean {
  if (!isUsable(m)) return false;
  const ps = m.info.participants;
  stats.games++;

  const teamDamage = new Map<number, { physical: number; magic: number }>();
  for (const p of ps) {
    const d = teamDamage.get(p.teamId) ?? { physical: 0, magic: 0 };
    d.physical += p.physicalDamageDealtToChampions ?? 0;
    d.magic += p.magicDamageDealtToChampions ?? 0;
    teamDamage.set(p.teamId, d);
    const c = at(stats.damage, p.championId!, () => ({ physical: 0, magic: 0 }));
    c.physical += p.physicalDamageDealtToChampions ?? 0;
    c.magic += p.magicDamageDealtToChampions ?? 0;
  }

  for (const p of ps) {
    const id = p.championId!;
    const allies = ps.filter((q) => q.teamId === p.teamId && q !== p);
    const enemies = ps.filter((q) => q.teamId !== p.teamId);

    bump(at(stats.champs, p.teamPosition, () => ({})), id, p.win);
    const opponent = enemies.find((q) => q.teamPosition === p.teamPosition);
    if (opponent) bump(at(at(stats.lane, p.teamPosition, () => ({})), id, () => ({})), opponent.championId!, p.win);
    for (const e of enemies) bump(at(stats.vs, id, () => ({})), e.championId!, p.win);
    for (const a of allies) bump(at(stats.with, id, () => ({})), a.championId!, p.win);

    const theirs = teamDamage.get(enemies[0]!.teamId)!;
    const cls = classify(theirs.physical, theirs.magic);
    const byClass = at(at(stats.items, id, () => ({})), cls, () => ({}));
    for (const item of new Set(items(p))) bump(byClass, item, p.win);
    const keystone = p.perks?.styles[0]?.selections[0]?.perk;
    if (keystone) bump(at(at(stats.runes, id, () => ({})), cls, () => ({})), keystone, p.win);
  }
  return true;
}
