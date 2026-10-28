import { fmtTime, type GameContext } from "./context.ts";
import type { DeathAnalysis } from "./deaths.ts";
import type { Finding } from "./game.ts";
import { isSuccess, type Gank } from "./ganks.ts";
import type { Play } from "./plays.ts";
import { isKill } from "../riot/types.ts";

// Note sur 10 de ta partie : on part de 5, chaque action ajoute ou retire des points.
// Le résultat de la partie n'entre pas dans la note : on note ton jeu, pas ton équipe.

export interface ScoreItem {
  t?: number; // moment de l'action, absent pour les stats de fin de partie
  points: number;
  text: string;
}

export interface GameScore {
  score: number;
  items: ScoreItem[];
}

const NEUTRAL = new Set(["DRAGON", "ELDER_DRAGON", "BARON_NASHOR", "RIFTHERALD", "HORDE", "ATAKHAN"]);

// Points des constats de la partie qui ne sont pas déjà comptés action par action.
const FINDING_POINTS: Record<string, number> = {
  "decisif-mort": -0.5, // la mort elle-même est déjà comptée
  "decisif-mort-avant": -0.5,
  "decisif-absent": -0.75,
  "farm-avance": 0.5,
  "farm-retard": -0.5,
  "avance-15": 0.75,
  "retard-15": -0.75,
  "vision-faible": -0.5,
  "zero-pink": -0.5,
  "jungle-farm-retard": -0.5,
  "jungle-zero-impact": -0.75,
  roams: 0.5,
};

/** Plafond par type d'action, pour qu'une stat ne fasse pas toute la note. */
function capped(items: ScoreItem[], max: number): ScoreItem[] {
  let total = 0;
  return items.filter((i) => {
    if (Math.abs(total + i.points) > max) return false;
    total += i.points;
    return true;
  });
}

export function scoreGame(ctx: GameContext, plays: Play[], deaths: DeathAnalysis[], ganks: Gank[], findings: Finding[]): GameScore {
  const me = ctx.me.participantId;
  const champ = (id: number) => ctx.byId.get(id)?.championName ?? "?";

  const kills: ScoreItem[] = [];
  for (const e of ctx.events) {
    if (!isKill(e)) continue;
    if (e.killerId === me) kills.push({ t: e.timestamp, points: e.shutdownBounty ? 0.5 : 0.3, text: `kill sur ${champ(e.victimId)}${e.shutdownBounty ? " (shutdown)" : ""}` });
    else if (e.assistingParticipantIds?.includes(me)) kills.push({ t: e.timestamp, points: 0.15, text: `assist sur ${champ(e.victimId)}` });
  }

  const deathItems: ScoreItem[] = deaths.map((d) => {
    let points = -0.4;
    const why: string[] = [];
    if (d.tags.includes("isole")) (points -= 0.3), why.push("seul");
    if (d.objectivesLost.length) (points -= 0.4), why.push(`${d.objectivesLost.map((o) => o.label).join(" + ")} perdu ensuite`);
    if (d.tags.includes("shutdown")) (points -= 0.2), why.push("shutdown donné");
    return { t: d.timestamp, points, text: `mort${d.killer ? ` contre ${d.killer}` : ""}${why.length ? ` (${why.join(", ")})` : ""}` };
  });

  const gankItems: ScoreItem[] = ganks
    .filter((g) => g.outcome !== "sans-resultat")
    .map((g) => ({
      t: g.t,
      points: isSuccess(g) ? 0.5 : g.outcome === "echange" ? 0 : -0.3,
      text: `gank ${g.lane} ${isSuccess(g) ? "réussi" : g.outcome === "echange" ? "en échange" : "raté"}`,
    }))
    .filter((i) => i.points !== 0);

  const objectives: ScoreItem[] = [];
  for (const p of plays) {
    for (const o of p.objectives) {
      if (!NEUTRAL.has(o.kind)) continue;
      const ours = o.team === ctx.ally;
      if (ours && (p.me.kind === "acteur" || p.me.kind === "proche")) objectives.push({ t: o.timestamp, points: 0.4, text: `${o.label} pris avec toi` });
      // Une mort est déjà comptée avec l'objectif perdu qui suit.
      if (!ours && p.me.kind === "loin") objectives.push({ t: o.timestamp, points: -0.3, text: `${o.label} perdu pendant que tu étais loin` });
    }
  }

  const stats: ScoreItem[] = findings
    .filter((f) => FINDING_POINTS[f.code] !== undefined)
    .map((f) => ({ points: FINDING_POINTS[f.code]!, text: f.text }));

  const items = [...capped(kills, 2.5), ...capped(deathItems, 4), ...capped(gankItems, 2), ...capped(objectives, 2), ...stats];
  const raw = 5 + items.reduce((s, i) => s + i.points, 0);
  return {
    score: Math.round(Math.max(0, Math.min(10, raw)) * 10) / 10,
    items: items.sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity)),
  };
}

const sign = (p: number) => `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(2).replace(/0$/, "").replace(".", ",")}`;

/** Liste des + et des − pour le rapport. */
export function scoreLines(s: GameScore): string[] {
  return s.items.map((i) => `${sign(i.points)}${i.t !== undefined ? ` · ${fmtTime(i.t)}` : ""} · ${i.text}`);
}
