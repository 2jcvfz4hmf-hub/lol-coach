import { isKill } from "../riot/types.ts";
import type { KillEvent } from "../riot/types.ts";
import { inEnemyHalf, teamOf, type GameContext } from "./context.ts";
import { killValue, type Objective, type Play } from "./plays.ts";

const OBJECTIVE_AFTER_DEATH_MS = 90_000;
// Seuls les monstres neutres comptent : une tour qui tombe après une mort est souvent sans lien avec elle.
const NEUTRAL_OBJECTIVES = new Set(["DRAGON", "ELDER_DRAGON", "BARON_NASHOR", "RIFTHERALD", "HORDE", "ATAKHAN"]);

export interface DeathAnalysis {
  timestamp: number;
  killer?: string; // champion
  enemiesInvolved: number;
  alliesInFight: number;
  goldGiven: number;
  objectivesLost: Objective[];
  tags: DeathTag[];
}

export type DeathTag = "isole" | "1v1" | "avant-objectif" | "shutdown" | "terrain-ennemi";

export function analyseDeaths(ctx: GameContext, plays: Play[]): DeathAnalysis[] {
  const id = ctx.me.participantId;
  const deaths = ctx.events.filter((e): e is KillEvent => isKill(e) && e.victimId === id);

  return deaths.map((d) => {
    const play = plays.find((p) => p.kills.includes(d));
    const allies = new Set<number>();
    for (const k of play?.kills ?? []) {
      for (const pid of [k.killerId, k.victimId, ...(k.assistingParticipantIds ?? [])]) {
        if (pid !== id && teamOf(ctx, pid) === ctx.ally) allies.add(pid);
      }
    }
    const enemiesInvolved = (d.killerId > 0 ? 1 : 0) + (d.assistingParticipantIds?.length ?? 0);
    const objectivesLost = plays
      .flatMap((p) => p.objectives)
      .filter((o) => o.team === ctx.enemy && NEUTRAL_OBJECTIVES.has(o.kind) && o.timestamp > d.timestamp && o.timestamp - d.timestamp <= OBJECTIVE_AFTER_DEATH_MS);

    const tags: DeathTag[] = [];
    if (allies.size === 0) tags.push(enemiesInvolved >= 2 ? "isole" : "1v1");
    if (objectivesLost.length) tags.push("avant-objectif");
    if ((d.shutdownBounty ?? 0) >= 300) tags.push("shutdown");
    if (inEnemyHalf(ctx.ally, d.position)) tags.push("terrain-ennemi");

    return {
      timestamp: d.timestamp,
      killer: ctx.byId.get(d.killerId)?.championName,
      enemiesInvolved,
      alliesInFight: allies.size,
      goldGiven: killValue(d),
      objectivesLost,
      tags,
    };
  });
}
