import { buildContext, frameAt, fmtTime, hasMinute, inEnemyHalf, side, zoneOf, type GameContext } from "../analysis/context.ts";
import { isKill, isMonster, type Match, type Timeline } from "../riot/types.ts";

// Habitudes de début de partie d'un jungler, tirées de ses dernières games en jungle.
// Affiché à l'écran de chargement : c'est du scouting avant la partie, pas de l'info en direct.

export type Side = "haut" | "bas";
type Lane = "top" | "mid" | "bot";

export interface JunglerHabits {
  games: number;
  /** Côté de la carte à 2:00, pendant le premier camp. */
  start: Record<Side, number>;
  /** Parties où il est dans la jungle adverse à 2:00 (invade niveau 1). */
  invades: number;
  /** Côté de la carte à 4:00, à la fin de son premier tour de jungle. */
  at4: Record<Side, number>;
  /** Lane de sa première action (kill, mort ou assist) avant 8 minutes. */
  firstAction: Record<Lane, number>;
  firstActionTimes: number[];
  /** Premier objectif neutre pris par son équipe avant 15 minutes. */
  firstObjective: Record<string, number>;
}

const OBJECTIVE_FR: Record<string, string> = {
  DRAGON: "le dragon",
  HORDE: "les larves du Néant",
  RIFTHERALD: "le Héraut",
};

const LANE_FR: Record<Lane, string> = { top: "la top", mid: "la mid", bot: "la bot" };
const SIDE_FR: Record<Side, string> = { haut: "côté top", bas: "côté bot" };

function firstAction(ctx: GameContext): { lane: Lane; t: number } | undefined {
  const id = ctx.me.participantId;
  for (const e of ctx.events) {
    if (e.timestamp > 8 * 60_000) return undefined;
    if (!isKill(e)) continue;
    const involved = e.killerId === id || e.victimId === id || e.assistingParticipantIds?.includes(id);
    if (!involved) continue;
    const zone = zoneOf(e.position);
    if (zone !== "jungle") return { lane: zone, t: e.timestamp };
  }
  return undefined;
}

function firstObjective(ctx: GameContext): string | undefined {
  for (const e of ctx.events) {
    if (e.timestamp > 15 * 60_000) return undefined;
    if (isMonster(e) && e.killerTeamId === ctx.ally && OBJECTIVE_FR[e.monsterType]) return e.monsterType;
  }
  return undefined;
}

/** `games` : ses dernières parties, avec timeline. Seules celles où il jouait jungle comptent. */
export function junglerHabits(games: { match: Match; timeline: Timeline }[], puuid: string): JunglerHabits {
  const h: JunglerHabits = {
    games: 0,
    start: { haut: 0, bas: 0 },
    invades: 0,
    at4: { haut: 0, bas: 0 },
    firstAction: { top: 0, mid: 0, bot: 0 },
    firstActionTimes: [],
    firstObjective: {},
  };
  for (const g of games) {
    const ctx = buildContext(g.match, g.timeline, puuid);
    if (ctx.me.teamPosition !== "JUNGLE" || !hasMinute(ctx, 5)) continue;
    h.games++;
    const at2 = frameAt(ctx, ctx.me.participantId, 2)?.position;
    if (at2) {
      h.start[side(at2)]++;
      if (inEnemyHalf(ctx.ally, at2)) h.invades++;
    }
    const at4 = frameAt(ctx, ctx.me.participantId, 4)?.position;
    if (at4) h.at4[side(at4)]++;
    const action = firstAction(ctx);
    if (action) {
      h.firstAction[action.lane]++;
      h.firstActionTimes.push(action.t);
    }
    const objective = firstObjective(ctx);
    if (objective) h.firstObjective[objective] = (h.firstObjective[objective] ?? 0) + 1;
  }
  return h;
}

/** Le cas le plus fréquent, s'il revient au moins dans 60 % des parties. */
function habit<K extends string>(counts: Record<K, number>, total: number): { key: K; count: number } | undefined {
  const [key, count] = (Object.entries(counts) as [K, number][]).sort((a, b) => b[1] - a[1])[0] ?? [];
  return key && count && total >= 3 && count / total >= 0.6 ? { key, count } : undefined;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Phrases en français pour l'écran de chargement. */
export function scoutLines(h: JunglerHabits): string[] {
  if (h.games < 3) return [`Pas assez de parties récentes en jungle pour connaître ses habitudes (${h.games}).`];
  const lines: string[] = [];
  const of = (n: number) => `${n} parties sur ${h.games}`;

  const start = habit(h.start, h.games);
  if (start) lines.push(`Il commence ${SIDE_FR[start.key]} (${of(start.count)}).`);
  else lines.push(`Il commence aussi souvent côté top que côté bot.`);
  if (h.invades >= 2) lines.push(`Il envahit ta jungle au niveau 1 dans ${of(h.invades)} : ne pars pas seul sur ton premier camp.`);

  const at4 = habit(h.at4, h.games);
  if (at4) lines.push(`À 4:00, il est ${SIDE_FR[at4.key]} dans ${of(at4.count)}.`);

  const actions = h.firstActionTimes.length;
  const lane = habit(h.firstAction, actions);
  if (lane) {
    lines.push(`Son premier gank est sur ${LANE_FR[lane.key]} (${lane.count} sur ${actions}), vers ${fmtTime(median(h.firstActionTimes)!)}.`);
  } else if (actions >= 3) {
    lines.push(`Son premier gank arrive vers ${fmtTime(median(h.firstActionTimes)!)}, sans lane préférée.`);
  }

  const totalObjectives = Object.values(h.firstObjective).reduce((s, n) => s + n, 0);
  const objective = habit(h.firstObjective, totalObjectives);
  if (objective) lines.push(`Son équipe prend d'abord ${OBJECTIVE_FR[objective.key]} (${objective.count} fois sur ${totalObjectives}).`);

  // Balise : là où il sera à la fin de son premier tour.
  const wardSide = at4?.key ?? (start ? (start.key === "haut" ? "bas" : "haut") : undefined);
  if (wardSide) {
    lines.push(`Balise conseillée : la rivière ${SIDE_FR[wardSide]} vers 2:45, avant qu'il arrive.`);
  }
  return lines;
}
