import { distance, frameAt, hasMinute, zoneOf, type GameContext } from "./context.ts";
import { isKill, type KillEvent } from "../riot/types.ts";

// Bilan de chaque gank du jungler entre 2:30 et 14:00 : réussi, raté ou sans effet, et pourquoi.
// Les positions ne sont connues qu'une fois par minute, les kills à la seconde près.

export type Lane = "top" | "mid" | "bot";
export type GankOutcome = "reussi" | "echange" | "rate" | "sans-resultat";

export interface Gank {
  t: number;
  lane: Lane;
  outcome: GankOutcome;
  /** Champions adverses tués pendant le gank. */
  kills: string[];
  /** Champions alliés morts pendant le gank (toi compris). */
  deaths: string[];
  reasons: string[];
}

const START = 150_000;
const END = 14 * 60_000;
const CHAIN_MS = 30_000;
const NEAR = 3000;

const LANE_POSITIONS: Record<Lane, string[]> = {
  top: ["TOP"],
  mid: ["MIDDLE"],
  bot: ["BOTTOM", "UTILITY"],
};

const involved = (e: KillEvent, id: number) => e.killerId === id || e.victimId === id || !!e.assistingParticipantIds?.includes(id);

/** Combats sur une lane : kills enchaînés à moins de 30 s sur la même lane. */
function laneFights(ctx: GameContext): { lane: Lane; events: KillEvent[] }[] {
  const fights: { lane: Lane; events: KillEvent[] }[] = [];
  for (const e of ctx.events) {
    if (!isKill(e) || e.timestamp < START || e.timestamp > END) continue;
    const zone = zoneOf(e.position);
    if (zone === "jungle") continue;
    const last = [...fights].reverse().find((f) => f.lane === zone);
    if (last && e.timestamp - last.events[last.events.length - 1]!.timestamp <= CHAIN_MS) last.events.push(e);
    else fights.push({ lane: zone, events: [e] });
  }
  return fights;
}

function levelGap(ctx: GameContext, lane: Lane, minute: number): number {
  let gap = 0;
  for (const p of ctx.match.info.participants) {
    if (!LANE_POSITIONS[lane].includes(p.teamPosition)) continue;
    const level = frameAt(ctx, p.participantId, minute)?.level ?? 0;
    gap += p.teamId === ctx.ally ? level : -level;
  }
  return gap;
}

function reasonsFor(ctx: GameContext, lane: Lane, t: number, events: KillEvent[], outcome: GankOutcome): string[] {
  const reasons: string[] = [];
  const me = ctx.me.participantId;
  const minute = Math.round(t / 60_000);
  const enemyJungler = ctx.match.info.participants.find((p) => p.teamId === ctx.enemy && p.teamPosition === "JUNGLE");
  const laners = ctx.match.info.participants.filter((p) => p.teamId === ctx.ally && LANE_POSITIONS[lane].includes(p.teamPosition));

  const myPos = frameAt(ctx, me, minute)?.position;
  const theirPos = enemyJungler && frameAt(ctx, enemyJungler.participantId, minute)?.position;
  const counter =
    enemyJungler &&
    (events.some((e) => involved(e, enemyJungler.participantId)) || (myPos && theirPos && distance(myPos, theirPos) < NEAR));
  if (counter) reasons.push(outcome === "reussi" ? "malgré le jungler adverse" : "le jungler adverse était là (contre-gank)");

  if (outcome !== "reussi") {
    const gap = levelGap(ctx, lane, minute);
    if (gap <= -2) reasons.push(`ta lane avait ${-gap} niveaux de retard`);
    const followed = laners.some((l) => events.some((e) => involved(e, l.participantId)));
    const nearby = laners.some((l) => {
      const p = frameAt(ctx, l.participantId, minute)?.position;
      return p && myPos && distance(p, myPos) < NEAR;
    });
    if (!followed && !nearby) reasons.push("ton laner n'était pas là pour suivre");
  }

  // Combien d'ennemis ont participé aux kills sur ton équipe ?
  const enemies = new Set<number>();
  const allies = new Set<number>([me]);
  for (const e of events) {
    const killerTeam = ctx.byId.get(e.killerId)?.teamId;
    const side = killerTeam === ctx.ally ? allies : enemies;
    if (e.killerId) side.add(e.killerId);
    for (const a of e.assistingParticipantIds ?? []) side.add(a);
  }
  if (outcome !== "reussi" && enemies.size > allies.size) reasons.push(`en infériorité numérique (${allies.size} contre ${enemies.size})`);
  return reasons;
}

export function analyseGanks(ctx: GameContext): Gank[] {
  if (ctx.me.teamPosition !== "JUNGLE") return [];
  const me = ctx.me.participantId;
  const champ = (id: number) => ctx.byId.get(id)?.championName ?? "?";
  const ganks: Gank[] = [];

  for (const f of laneFights(ctx)) {
    if (!f.events.some((e) => involved(e, me))) continue;
    const kills = f.events.filter((e) => ctx.byId.get(e.victimId)?.teamId === ctx.enemy).map((e) => champ(e.victimId));
    const deaths = f.events.filter((e) => ctx.byId.get(e.victimId)?.teamId === ctx.ally).map((e) => champ(e.victimId));
    const outcome: GankOutcome = kills.length && deaths.length ? "echange" : kills.length ? "reussi" : "rate";
    const t = f.events[0]!.timestamp;
    ganks.push({ t, lane: f.lane, outcome, kills, deaths, reasons: reasonsFor(ctx, f.lane, t, f.events, outcome) });
  }

  // Passages sur une lane sans aucun kill : le gank n'a rien donné.
  for (let m = 3; m <= 14 && hasMinute(ctx, m); m++) {
    const p = frameAt(ctx, me, m)?.position;
    if (!p) continue;
    const zone = zoneOf(p);
    if (zone === "jungle") continue;
    const t = m * 60_000;
    if (ganks.some((g) => g.lane === zone && Math.abs(g.t - t) <= 90_000)) continue;
    ganks.push({ t, lane: zone, outcome: "sans-resultat", kills: [], deaths: [], reasons: reasonsFor(ctx, zone, t, [], "sans-resultat") });
  }
  return ganks.sort((a, b) => a.t - b.t);
}

export interface GankSummary {
  total: number;
  success: number;
  byLane: Record<Lane, { total: number; success: number }>;
}

/** Un échange compte comme réussi s'il rapporte plus de kills qu'il n'en coûte. */
export const isSuccess = (g: Gank) => g.outcome === "reussi" || (g.outcome === "echange" && g.kills.length > g.deaths.length);

export function summariseGanks(ganks: Gank[]): GankSummary {
  const byLane = { top: { total: 0, success: 0 }, mid: { total: 0, success: 0 }, bot: { total: 0, success: 0 } };
  for (const g of ganks) {
    byLane[g.lane].total++;
    if (isSuccess(g)) byLane[g.lane].success++;
  }
  return { total: ganks.length, success: ganks.filter(isSuccess).length, byLane };
}
