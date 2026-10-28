import { analyseGanks, isSuccess, summariseGanks, type Gank } from "./ganks.ts";
import type { Match, Timeline } from "../riot/types.ts";
import { buildContext, fmtTime, type GameContext } from "./context.ts";
import { analyseDeaths, type DeathAnalysis } from "./deaths.ts";
import { buildPlays, decisivePlay, describePlay, goldDiffByMinute, leadForGoodMinute, type Play } from "./plays.ts";
import { roleStats, type RoleStats } from "./roles.ts";

export type Severity = "grave" | "moyen" | "positif";

export interface Finding {
  code: string; // stable, sert à repérer les erreurs récurrentes
  severity: Severity;
  text: string;
}

export interface GameAnalysis {
  matchId: string;
  date: Date;
  champion: string;
  position: string;
  opponentChampion?: string;
  win: boolean;
  durationMin: number;
  kda: { kills: number; deaths: number; assists: number };
  goldDiff: number[];
  leadForGoodMinute?: number;
  decisive?: { play: Play; summary: string };
  deaths: DeathAnalysis[];
  stats: RoleStats;
  findings: Finding[];
  /** Jungle uniquement. */
  ganks: Gank[];
}

/** Les remakes et les early surrenders (vote à 3 min) faussent les stats. */
export function isPlayable(match: Match): boolean {
  return match.info.gameDuration >= 5 * 60 && !match.info.participants.some((p) => p.gameEndedInEarlySurrender);
}

export function analyseGame(match: Match, timeline: Timeline, puuid: string): GameAnalysis {
  const ctx = buildContext(match, timeline, puuid);
  const plays = buildPlays(ctx);
  const deaths = analyseDeaths(ctx, plays);
  const stats = roleStats(ctx, plays);
  const goldDiff = goldDiffByMinute(ctx);
  const decisive = decisivePlay(ctx, plays);
  const ganks = analyseGanks(ctx);

  return {
    matchId: match.metadata.matchId,
    date: new Date(match.info.gameCreation),
    champion: ctx.me.championName,
    position: ctx.me.teamPosition,
    opponentChampion: ctx.opponent?.championName,
    win: ctx.win,
    durationMin: ctx.durationMin,
    kda: { kills: ctx.me.kills, deaths: ctx.me.deaths, assists: ctx.me.assists },
    goldDiff,
    leadForGoodMinute: leadForGoodMinute(goldDiff, ctx.win),
    decisive: decisive && { play: decisive, summary: describePlay(ctx, decisive) },
    deaths,
    stats,
    findings: [...findings(ctx, deaths, stats, decisive), ...gankFindings(ganks)],
    ganks,
  };
}

function gankFindings(ganks: Gank[]): Finding[] {
  const out: Finding[] = [];
  const s = summariseGanks(ganks);
  if (s.total >= 3 && s.success / s.total < 0.3) {
    out.push({ code: "ganks-rates", severity: "moyen", text: `Seulement ${s.success} gank(s) réussi(s) sur ${s.total} avant 14 min.` });
  }
  const countered = ganks.filter((g) => !isSuccess(g) && g.reasons.some((r) => r.includes("contre-gank"))).length;
  if (countered >= 2) out.push({ code: "ganks-contre", severity: "moyen", text: `${countered} ganks gâchés par le jungler adverse.` });
  const late = ganks.filter((g) => !isSuccess(g) && g.reasons.some((r) => r.includes("niveaux de retard"))).length;
  if (late >= 2) out.push({ code: "ganks-lane-en-retard", severity: "moyen", text: `${late} ganks sur une lane qui avait des niveaux de retard.` });
  if (s.total >= 3 && s.success / s.total >= 0.6) out.push({ code: "ganks-efficaces", severity: "positif", text: `${s.success} ganks réussis sur ${s.total}.` });
  return out;
}

function findings(ctx: GameContext, deaths: DeathAnalysis[], stats: RoleStats, decisive?: Play): Finding[] {
  const out: Finding[] = [];
  const { lane, jungle } = stats;
  const role = ctx.me.teamPosition;
  const vs = ctx.opponent ? ` face à ${ctx.opponent.championName}` : "";

  if (decisive && !ctx.win) {
    const when = fmtTime(decisive.start);
    switch (decisive.me.kind) {
      case "acteur":
        if (decisive.me.died) {
          out.push({ code: "decisif-mort", severity: "grave", text: `Tu meurs pendant l'action qui coûte la partie (${when}).` });
        }
        break;
      case "mort":
        out.push({
          code: "decisif-mort-avant",
          severity: "grave",
          text: `Tu étais mort (depuis ${fmtTime(decisive.me.diedAt)}) au moment de l'action qui coûte la partie (${when}).`,
        });
        break;
      case "loin":
        out.push({ code: "decisif-absent", severity: "grave", text: `Tu étais loin de l'action qui coûte la partie (${when}).` });
        break;
    }
  }

  const isolated = deaths.filter((d) => d.tags.includes("isole"));
  if (isolated.length >= 2) {
    out.push({
      code: "morts-isolees",
      severity: "grave",
      text: `${isolated.length} morts attrapé seul contre plusieurs ennemis (${isolated.map((d) => fmtTime(d.timestamp)).join(", ")}).`,
    });
  }
  const beforeObj = deaths.filter((d) => d.tags.includes("avant-objectif"));
  if (beforeObj.length >= 1) {
    const detail = beforeObj
      .map((d) => `${fmtTime(d.timestamp)} → ${d.objectivesLost.map((o) => o.label).join(" + ")}`)
      .join(" ; ");
    out.push({
      code: "morts-avant-objectif",
      severity: beforeObj.length >= 2 ? "grave" : "moyen",
      text: `${beforeObj.length} mort(s) suivie(s) d'un objectif neutre perdu dans les 90 s (${detail}).`,
    });
  }
  const shutdowns = deaths.filter((d) => d.tags.includes("shutdown"));
  if (shutdowns.length) {
    out.push({
      code: "shutdown-donne",
      severity: "moyen",
      text: `Tu donnes ${shutdowns.length} shutdown(s) (${shutdowns.map((d) => `${d.goldGiven} or à ${fmtTime(d.timestamp)}`).join(", ")}).`,
    });
  }
  const deep = deaths.filter((d) => d.tags.includes("terrain-ennemi") && d.timestamp > 15 * 60_000);
  if (deep.length >= 2) {
    out.push({ code: "morts-terrain-ennemi", severity: "moyen", text: `${deep.length} morts dans la moitié adverse après 15 min.` });
  }

  if (lane.deathsBefore15 >= 3) {
    out.push({ code: "morts-early", severity: "grave", text: `${lane.deathsBefore15} morts avant 15 min.` });
  }
  if (role !== "UTILITY" && role !== "JUNGLE" && lane.csDiffAt10 !== undefined) {
    if (lane.csDiffAt10 <= -15) {
      out.push({ code: "farm-retard", severity: "moyen", text: `${-lane.csDiffAt10} sbires de retard à 10 min${vs}.` });
    } else if (lane.csDiffAt10 >= 15) {
      out.push({ code: "farm-avance", severity: "positif", text: `${lane.csDiffAt10} sbires d'avance à 10 min${vs}.` });
    }
  }
  if (lane.goldDiffAt15 !== undefined) {
    if (lane.goldDiffAt15 <= -1000) {
      out.push({ code: "retard-15", severity: "grave", text: `${-lane.goldDiffAt15} or de retard à 15 min${vs}.` });
    } else if (lane.goldDiffAt15 >= 1000) {
      out.push({ code: "avance-15", severity: "positif", text: `${lane.goldDiffAt15} or d'avance à 15 min${vs}.` });
    }
  }
  const visionRole = role === "UTILITY" || role === "JUNGLE";
  if (visionRole && lane.opponentVisionPerMin && lane.visionPerMin < lane.opponentVisionPerMin * 0.75) {
    out.push({
      code: "vision-faible",
      severity: "moyen",
      text: `Score de vision ${lane.visionPerMin.toFixed(1)}/min contre ${lane.opponentVisionPerMin.toFixed(1)}/min${vs}.`,
    });
  }
  if (lane.controlWards === 0 && ctx.durationMin >= 20) {
    out.push({ code: "zero-pink", severity: "moyen", text: "Aucune balise de contrôle achetée de la partie." });
  }

  if (role === "MIDDLE") {
    const roams = lane.earlyImpactByZone.top + lane.earlyImpactByZone.bot;
    if (roams >= 2) out.push({ code: "roams", severity: "positif", text: `${roams} kills/assists en roam avant 14 min.` });
  }

  if (jungle) {
    const ganks = lane.earlyImpactByZone.top + lane.earlyImpactByZone.mid + lane.earlyImpactByZone.bot;
    if (ganks === 0) {
      out.push({ code: "jungle-zero-impact", severity: "moyen", text: "Aucun kill ni assist sur une lane avant 14 min." });
    }
    const { allies, enemies } = jungle.earlyObjectives;
    if (enemies - allies >= 2) {
      out.push({
        code: "jungle-objectifs-early",
        severity: "grave",
        text: `Objectifs neutres avant 20 min : ${allies} pour vous, ${enemies} pour eux.`,
      });
    }
    if (jungle.enemyObjectivesWhileAway >= 2) {
      out.push({
        code: "jungle-absent-objectifs",
        severity: "grave",
        text: `${jungle.enemyObjectivesWhileAway} objectifs neutres pris par l'adversaire alors que tu étais mort ou loin.`,
      });
    }
    if (jungle.jungleCsAt10 !== undefined && jungle.opponentJungleCsAt10 !== undefined) {
      const d = jungle.jungleCsAt10 - jungle.opponentJungleCsAt10;
      if (d <= -12) out.push({ code: "jungle-farm-retard", severity: "moyen", text: `${-d} monstres de retard à 10 min${vs}.` });
    }
  }

  return out;
}
