import { isBuilding, isKill, isMonster } from "../riot/types.ts";
import type { BuildingEvent, KillEvent, MonsterEvent, Point, TeamId } from "../riot/types.ts";
import { distance, fmtTime, frameAt, positionNear, respawnMs, teamOf, type GameContext } from "./context.ts";

// Valeur estimée (en or d'équipe) de chaque objectif. Ce sont des ordres de grandeur
// pour comparer les actions entre elles, pas des valeurs exactes du jeu.
const OBJECTIVE_VALUE: Record<string, number> = {
  DRAGON: 500,
  ELDER_DRAGON: 1500,
  BARON_NASHOR: 1500,
  RIFTHERALD: 600,
  HORDE: 150, // un Larvosaure
  ATAKHAN: 800,
  TOWER_BUILDING: 650,
  INHIBITOR_BUILDING: 500,
};
const DEFAULT_KILL_GOLD = 300;
const FIGHT_CHAIN_MS = 20_000; // deux kills à moins de 20 s font partie du même combat
const FOLLOW_UP_MS = 60_000; // un objectif pris dans la minute qui suit est la conséquence du combat
const FAR_AWAY = 5000;

export interface Objective {
  team: TeamId; // équipe qui prend l'objectif
  kind: string;
  label: string;
  timestamp: number;
  value: number;
}

export type Involvement =
  | { kind: "acteur"; died: boolean }
  | { kind: "mort"; diedAt: number }
  | { kind: "loin"; distance: number }
  | { kind: "proche" };

export interface Play {
  start: number;
  end: number;
  position: Point;
  kills: KillEvent[];
  objectives: Objective[];
  allyKills: number;
  enemyKills: number;
  /** Or estimé gagné par ton équipe moins celui gagné par l'adversaire. */
  swing: number;
  me: Involvement;
}

export function killValue(e: KillEvent): number {
  return (e.bounty ?? DEFAULT_KILL_GOLD) + (e.shutdownBounty ?? 0);
}

function objectiveFrom(e: MonsterEvent | BuildingEvent): Objective {
  if (isMonster(e)) {
    const kind = e.monsterSubType === "ELDER_DRAGON" ? "ELDER_DRAGON" : e.monsterType;
    return { team: e.killerTeamId, kind, label: monsterLabel(kind), timestamp: e.timestamp, value: OBJECTIVE_VALUE[kind] ?? 300 };
  }
  const team: TeamId = e.teamId === 100 ? 200 : 100;
  const label = e.buildingType === "INHIBITOR_BUILDING" ? "Inhibiteur" : "Tour";
  return { team, kind: e.buildingType, label, timestamp: e.timestamp, value: OBJECTIVE_VALUE[e.buildingType] ?? 300 };
}

export function monsterLabel(kind: string): string {
  switch (kind) {
    case "DRAGON":
      return "Dragon";
    case "ELDER_DRAGON":
      return "Dragon ancestral";
    case "BARON_NASHOR":
      return "Nashor";
    case "RIFTHERALD":
      return "Héraut";
    case "HORDE":
      return "Larvosaure";
    case "ATAKHAN":
      return "Atakhan";
    default:
      return kind;
  }
}

/** Regroupe les kills et objectifs de la partie en « actions » (combats, prises d'objectifs). */
export function buildPlays(ctx: GameContext): Play[] {
  const plays: Omit<Play, "me" | "swing" | "allyKills" | "enemyKills">[] = [];
  const objectives = ctx.events.filter((e) => isMonster(e) || isBuilding(e)) as (MonsterEvent | BuildingEvent)[];
  const used = new Set<(typeof objectives)[number]>();

  let current: (typeof plays)[number] | undefined;
  for (const e of ctx.events) {
    if (!isKill(e)) continue;
    if (current && e.timestamp - current.end <= FIGHT_CHAIN_MS) {
      current.kills.push(e);
      current.end = e.timestamp;
    } else {
      current = { start: e.timestamp, end: e.timestamp, position: e.position, kills: [e], objectives: [] };
      plays.push(current);
    }
  }

  // Rattache à chaque combat les objectifs pris pendant ou juste après.
  for (const [i, play] of plays.entries()) {
    const nextStart = plays[i + 1]?.start ?? Infinity;
    for (const o of objectives) {
      if (used.has(o)) continue;
      if (o.timestamp >= play.start && o.timestamp <= Math.min(play.end + FOLLOW_UP_MS, nextStart)) {
        play.objectives.push(objectiveFrom(o));
        used.add(o);
      }
    }
    play.position = centroid(play.kills.map((k) => k.position));
  }
  // Objectifs pris sans combat : ce sont aussi des actions (ex. dragon gratuit).
  for (const o of objectives) {
    if (used.has(o)) continue;
    plays.push({ start: o.timestamp, end: o.timestamp, position: o.position, kills: [], objectives: [objectiveFrom(o)] });
  }
  plays.sort((a, b) => a.start - b.start);

  return plays.map((p) => {
    let swing = 0;
    let allyKills = 0;
    let enemyKills = 0;
    for (const k of p.kills) {
      const victimTeam = teamOf(ctx, k.victimId);
      if (victimTeam === ctx.enemy) {
        allyKills++;
        swing += killValue(k);
      } else {
        enemyKills++;
        swing -= killValue(k);
      }
    }
    for (const o of p.objectives) swing += o.team === ctx.ally ? o.value : -o.value;
    return { ...p, swing, allyKills, enemyKills, me: involvement(ctx, p) };
  });
}

function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

function involvement(ctx: GameContext, play: Pick<Play, "start" | "kills" | "position">): Involvement {
  const id = ctx.me.participantId;
  const inKill = play.kills.some((k) => k.killerId === id || k.victimId === id || k.assistingParticipantIds?.includes(id));
  if (inKill) return { kind: "acteur", died: play.kills.some((k) => k.victimId === id) };

  const lastDeath = [...ctx.events].reverse().find((e): e is KillEvent => isKill(e) && e.victimId === id && e.timestamp < play.start);
  if (lastDeath) {
    const level = frameAt(ctx, id, Math.floor(lastDeath.timestamp / 60000))?.level ?? 1;
    if (play.start < lastDeath.timestamp + respawnMs(level, lastDeath.timestamp)) {
      return { kind: "mort", diedAt: lastDeath.timestamp };
    }
  }
  const pos = positionNear(ctx, id, play.start);
  if (pos && distance(pos, play.position) > FAR_AWAY) return { kind: "loin", distance: distance(pos, play.position) };
  return { kind: "proche" };
}

/** Écart d'or total entre les deux équipes, minute par minute (positif = ton équipe devant). */
export function goldDiffByMinute(ctx: GameContext): number[] {
  return ctx.timeline.info.frames.map((f) => {
    let diff = 0;
    for (const pf of Object.values(f.participantFrames)) {
      diff += teamOf(ctx, pf.participantId) === ctx.ally ? pf.totalGold : -pf.totalGold;
    }
    return diff;
  });
}

/** Minute à partir de laquelle l'équipe gagnante n'a plus jamais été derrière à l'or. */
export function leadForGoodMinute(diffs: number[], win: boolean): number | undefined {
  const winnerAhead = (d: number) => (win ? d > 0 : d < 0);
  if (diffs.length === 0 || !winnerAhead(diffs[diffs.length - 1]!)) return undefined;
  let i = diffs.length - 1;
  while (i > 0 && winnerAhead(diffs[i - 1]!)) i--;
  return i;
}

/** Action décisive : la plus grosse perte en cas de défaite, le plus gros gain en cas de victoire. */
export function decisivePlay(ctx: GameContext, plays: Play[]): Play | undefined {
  if (plays.length === 0) return undefined;
  return plays.reduce((best, p) => (ctx.win ? p.swing > best.swing : p.swing < best.swing) ? p : best);
}

export function describePlay(ctx: GameContext, p: Play): string {
  const parts: string[] = [];
  if (p.kills.length) parts.push(`combat ${p.allyKills} kill(s) pour ${p.enemyKills} mort(s)`);
  const objs = p.objectives.map((o) => `${o.label} ${o.team === ctx.ally ? "pris" : "perdu"}`);
  if (objs.length) parts.push(objs.join(", "));
  return `${fmtTime(p.start)} : ${parts.join(", puis ")}`;
}
