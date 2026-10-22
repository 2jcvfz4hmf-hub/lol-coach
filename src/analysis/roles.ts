import { isKill } from "../riot/types.ts";
import type { KillEvent, Participant } from "../riot/types.ts";
import { frameAt, hasMinute, side, teamOf, zoneOf, type GameContext, type Zone } from "./context.ts";
import type { Play } from "./plays.ts";

const EARLY_MS = 14 * 60_000;

export interface LaneStats {
  csAt10?: number;
  csDiffAt10?: number;
  goldDiffAt15?: number;
  xpDiffAt15?: number;
  deathsBefore15: number;
  killParticipation: number; // 0..1
  visionPerMin: number;
  opponentVisionPerMin?: number;
  controlWards: number;
  /** Kills/assists avant 14 min dans les autres lignes que la sienne (roams, ganks). */
  earlyImpactByZone: Record<Zone, number>;
}

export interface JungleStats {
  jungleCsAt10?: number;
  opponentJungleCsAt10?: number;
  /** Côté de la carte où tu étais aux minutes 2 à 6. */
  earlySide: { haut: number; bas: number };
  /** Objectifs neutres pris par chaque équipe avant 20 min (dragons, Larvosaures, Héraut). */
  earlyObjectives: { allies: number; enemies: number };
  /** Objectifs neutres pris par l'adversaire alors que tu étais mort ou loin. */
  enemyObjectivesWhileAway: number;
}

export interface RoleStats {
  lane: LaneStats;
  jungle?: JungleStats;
}

function cs(ctx: GameContext, p: Participant, minute: number): number | undefined {
  if (!hasMinute(ctx, minute)) return undefined;
  const f = frameAt(ctx, p.participantId, minute);
  return f ? f.minionsKilled + f.jungleMinionsKilled : undefined;
}

function diffAt(ctx: GameContext, minute: number, key: "totalGold" | "xp"): number | undefined {
  if (!ctx.opponent || !hasMinute(ctx, minute)) return undefined;
  const mine = frameAt(ctx, ctx.me.participantId, minute)?.[key];
  const theirs = frameAt(ctx, ctx.opponent.participantId, minute)?.[key];
  return mine !== undefined && theirs !== undefined ? mine - theirs : undefined;
}

export function roleStats(ctx: GameContext, plays: Play[]): RoleStats {
  const id = ctx.me.participantId;
  const kills = ctx.events.filter(isKill);
  const teamKills = kills.filter((k) => teamOf(ctx, k.victimId) === ctx.enemy).length;
  const involved = (k: KillEvent) => k.killerId === id || k.assistingParticipantIds?.includes(id);

  const earlyImpactByZone: Record<Zone, number> = { top: 0, mid: 0, bot: 0, jungle: 0 };
  for (const k of kills) {
    if (k.timestamp < EARLY_MS && teamOf(ctx, k.victimId) === ctx.enemy && involved(k)) {
      earlyImpactByZone[zoneOf(k.position)]++;
    }
  }

  const csAt10 = cs(ctx, ctx.me, 10);
  const oppCs = ctx.opponent ? cs(ctx, ctx.opponent, 10) : undefined;
  const lane: LaneStats = {
    csAt10,
    csDiffAt10: csAt10 !== undefined && oppCs !== undefined ? csAt10 - oppCs : undefined,
    goldDiffAt15: diffAt(ctx, 15, "totalGold"),
    xpDiffAt15: diffAt(ctx, 15, "xp"),
    deathsBefore15: kills.filter((k) => k.victimId === id && k.timestamp < 15 * 60_000).length,
    killParticipation: teamKills ? (ctx.me.kills + ctx.me.assists) / teamKills : 0,
    visionPerMin: ctx.me.visionScore / ctx.durationMin,
    opponentVisionPerMin: ctx.opponent ? ctx.opponent.visionScore / ctx.durationMin : undefined,
    controlWards: ctx.me.visionWardsBoughtInGame,
    earlyImpactByZone,
  };

  if (ctx.me.teamPosition !== "JUNGLE") return { lane };

  const earlySide = { haut: 0, bas: 0 };
  for (let m = 2; m <= 6 && hasMinute(ctx, m); m++) {
    const pos = frameAt(ctx, id, m)?.position;
    if (pos) earlySide[side(pos)]++;
  }
  const neutral = new Set(["DRAGON", "HORDE", "RIFTHERALD"]);
  const earlyObjectives = { allies: 0, enemies: 0 };
  let enemyObjectivesWhileAway = 0;
  for (const p of plays) {
    for (const o of p.objectives) {
      if (!neutral.has(o.kind) && o.kind !== "BARON_NASHOR" && o.kind !== "ELDER_DRAGON") continue;
      if (neutral.has(o.kind) && o.timestamp < 20 * 60_000) {
        earlyObjectives[o.team === ctx.ally ? "allies" : "enemies"]++;
      }
      if (o.team === ctx.enemy && (p.me.kind === "mort" || p.me.kind === "loin")) enemyObjectivesWhileAway++;
    }
  }
  const jungleCs = (p?: Participant) =>
    p && hasMinute(ctx, 10) ? frameAt(ctx, p.participantId, 10)?.jungleMinionsKilled : undefined;

  return {
    lane,
    jungle: {
      jungleCsAt10: jungleCs(ctx.me),
      opponentJungleCsAt10: jungleCs(ctx.opponent),
      earlySide,
      earlyObjectives,
      enemyObjectivesWhileAway,
    },
  };
}
