import type { Match, Participant, Timeline } from "../riot/types.ts";
import { skillKey, skillUps } from "./skills.ts";

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
  /** Ordre des sorts (« QEW|QEW »), sur une partie des matchs dont on lit la timeline. */
  skills?: Table<Table<WL>>;
  /** Page de runes complète (voir pageKey), par champion. */
  pages?: Table<Table<WL>>;
}

export function emptyStats(patch: string): GlobalStats {
  return { version: 1, patch, games: 0, champs: {}, lane: {}, vs: {}, with: {}, items: {}, runes: {}, damage: {} };
}

/** Additionne deux tables de stats (mêmes clés : on somme les nombres). */
function sumInto(into: Record<string, unknown>, from: Record<string, unknown>) {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (typeof v === "number") into[k] = (typeof cur === "number" ? cur : 0) + v;
    else if (v && typeof v === "object") {
      const target = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : (into[k] = {});
      sumInto(target as Record<string, unknown>, v as Record<string, unknown>);
    }
  }
}

/** Stats de deux groupes de rangs réunies (même patch), sans modifier les originales. */
export function mergeStats(a: GlobalStats, b: GlobalStats): GlobalStats {
  const out = structuredClone(a);
  const { version: _v, patch: _p, ...rest } = b;
  sumInto(out as unknown as Record<string, unknown>, rest as unknown as Record<string, unknown>);
  return out;
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
    const page = pageKey(p);
    if (page) bump(at((stats.pages ??= {}), id, () => ({})), page, p.win);
  }
  return true;
}

/**
 * Page de runes d'un joueur : « 8000:8010,9111,9104,8299|8300:8304,8347|5008,5008,5011 »
 * (arbre principal et ses 4 runes | arbre secondaire et ses 2 runes | les 3 fragments).
 */
export function pageKey(p: Participant): string | undefined {
  const [main, sub] = p.perks?.styles ?? [];
  if (!main || !sub || main.selections.length !== 4 || sub.selections.length !== 2) return undefined;
  const s = p.perks!.statPerks;
  const shards = s ? [s.offense, s.flex, s.defense].join(",") : "";
  return `${main.style}:${main.selections.map((x) => x.perk).join(",")}|${sub.style}:${sub.selections.map((x) => x.perk).join(",")}|${shards}`;
}

/** Ordre des sorts de chaque joueur, lu dans la timeline d'une partie déjà comptée. */
export function addSkills(stats: GlobalStats, m: Match, timeline: Timeline) {
  const ups = skillUps(timeline);
  stats.skills ??= {};
  for (const p of m.info.participants) {
    const key = skillKey(ups.get(p.participantId) ?? []);
    if (key) bump(at(stats.skills, p.championId!, () => ({})), key, p.win);
  }
}
