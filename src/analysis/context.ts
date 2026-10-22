import type { Match, Participant, ParticipantFrame, Point, TeamId, Timeline, TimelineEvent } from "../riot/types.ts";

// Les coordonnées de la Faille vont de 0 à ~14 800. La base bleue (100) est en bas à gauche.
const MAP_DIAGONAL = 14800;

export interface GameContext {
  match: Match;
  timeline: Timeline;
  me: Participant;
  ally: TeamId;
  enemy: TeamId;
  byId: Map<number, Participant>;
  opponent?: Participant; // même rôle dans l'équipe adverse
  events: TimelineEvent[];
  win: boolean;
  durationMin: number;
}

export function buildContext(match: Match, timeline: Timeline, puuid: string): GameContext {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (!me) throw new Error(`Le joueur n'est pas dans la partie ${match.metadata.matchId}`);
  const ally = me.teamId;
  const enemy: TeamId = ally === 100 ? 200 : 100;
  const byId = new Map(match.info.participants.map((p) => [p.participantId, p]));
  const opponent = me.teamPosition
    ? match.info.participants.find((p) => p.teamId === enemy && p.teamPosition === me.teamPosition)
    : undefined;
  const events = timeline.info.frames.flatMap((f) => f.events).sort((a, b) => a.timestamp - b.timestamp);
  return {
    match,
    timeline,
    me,
    ally,
    enemy,
    byId,
    opponent,
    events,
    win: me.win,
    durationMin: match.info.gameDuration / 60,
  };
}

export function teamOf(ctx: GameContext, participantId: number): TeamId | undefined {
  return ctx.byId.get(participantId)?.teamId;
}

/** Frame de la minute demandée (ou la dernière si la partie a fini avant). */
export function frameAt(ctx: GameContext, participantId: number, minute: number): ParticipantFrame | undefined {
  const frames = ctx.timeline.info.frames;
  const f = frames[Math.min(minute, frames.length - 1)];
  return f?.participantFrames[String(participantId)];
}

export function hasMinute(ctx: GameContext, minute: number): boolean {
  return ctx.timeline.info.frames.length > minute;
}

/** Position la plus proche dans le temps (l'API ne donne qu'une position par minute). */
export function positionNear(ctx: GameContext, participantId: number, timestamp: number): Point | undefined {
  const interval = ctx.timeline.info.frameInterval || 60000;
  return frameAt(ctx, participantId, Math.round(timestamp / interval))?.position;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Vrai si le point est clairement dans la moitié de carte adverse (rivière exclue). */
export function inEnemyHalf(team: TeamId, p: Point): boolean {
  const offset = p.x + p.y - MAP_DIAGONAL;
  return team === 100 ? offset > 1500 : offset < -1500;
}

export type Zone = "top" | "mid" | "bot" | "jungle";

export function zoneOf(p: Point): Zone {
  const d = p.y - p.x; // > 0 côté haut de la carte
  if (Math.abs(d) < 1800) return "mid";
  if (d > 0 && (p.x < 2500 || p.y > 12300)) return "top";
  if (d < 0 && (p.y < 2500 || p.x > 12300)) return "bot";
  return "jungle";
}

export function side(p: Point): "haut" | "bas" {
  return p.y - p.x > 0 ? "haut" : "bas";
}

export function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Temps de réapparition approximatif (base par niveau, majorée après 15 min). */
export function respawnMs(level: number, timestamp: number): number {
  const base = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];
  const b = base[Math.max(0, Math.min(17, level - 1))] ?? 30;
  const min = timestamp / 60000;
  const factor = min <= 15 ? 0 : Math.min(0.5, ((min - 15) / 30) * 0.5);
  return b * (1 + factor) * 1000;
}
