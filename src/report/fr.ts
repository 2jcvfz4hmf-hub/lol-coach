import { fmtTime } from "../analysis/context.ts";
import type { GameAnalysis } from "../analysis/game.ts";
import type { Summary } from "../analysis/recurring.ts";

const ROLE: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "ADC",
  UTILITY: "Support",
};

// Conseil concret associé à chaque erreur récurrente.
const TIPS: Record<string, string> = {
  "decisif-mort": "Avant un gros objectif, demande-toi si ton équipe peut gagner le combat sans toi. Si tu es la cible prioritaire, joue derrière ton tank.",
  "decisif-mort-avant": "Ta mort juste avant l'action décisive a ouvert la porte. Après 20 min, chaque mort coûte un objectif : joue plus safe quand un objectif arrive dans la minute.",
  "decisif-absent": "Regarde les timers d'objectifs : 1 min avant le spawn, rejoins ton équipe au lieu de farmer loin.",
  "morts-isolees": "Avant d'aller seul en side ou en vision, regarde combien d'ennemis sont visibles sur la carte. S'il en manque 3 ou plus, ne t'avance pas.",
  "morts-avant-objectif": "Les 90 s avant un dragon ou un Nashor sont les plus importantes. Pose ta vision tôt, reset avant le spawn, et évite les combats pour rien juste avant.",
  "shutdown-donne": "Quand tu as une prime, ton or vaut double pour l'adversaire : reset et achète plutôt que de tenter un play risqué.",
  "morts-terrain-ennemi": "Après 15 min, n'entre dans la jungle adverse qu'avec ton équipe ou de la vision.",
  "morts-early": "Trop de morts en début de partie. Joue la lane pour le farm et respecte la jungle adverse quand elle n'est pas visible.",
  "farm-retard": "Travaille ton last-hit en mode entraînement (objectif : 80 sbires à 10 min) et évite de perdre des vagues en roamant au mauvais moment.",
  "retard-15": "Tu sors de la phase de lane en retard. Regarde à quel moment l'écart se creuse (morts, recalls ratés, vagues perdues).",
  "vision-faible": "Achète une balise de contrôle à chaque recall et utilise ta trinket dès qu'elle est disponible.",
  "zero-pink": "Une balise de contrôle coûte 75 or et peut sauver un objectif. Prends-en une à chaque recall.",
  "jungle-zero-impact": "Cherche les lanes où l'ennemi a poussé et n'a pas de flash : un gank réussi avant 14 min fait souvent toute la différence.",
  "jungle-objectifs-early": "Planifie ton clear pour finir du côté du prochain objectif au moment du spawn, et préviens tes laners 1 min avant.",
  "jungle-absent-objectifs": "Ne lance pas un objectif quand tu es loin ou mort. Sinon, échange-le : prends l'objectif opposé ou des tours.",
  "jungle-farm-retard": "Ton clear est trop lent. Entraîne ton full clear en partie personnalisée et ne laisse pas tes camps réapparaître sans les prendre.",
};

// Intitulé générique de chaque constat, pour le bilan multi-parties.
const LABEL: Record<string, string> = {
  "decisif-mort": "Tu meurs pendant l'action qui coûte la partie",
  "decisif-mort-avant": "Tu es mort au moment de l'action qui coûte la partie",
  "decisif-absent": "Tu es loin de l'action qui coûte la partie",
  "morts-isolees": "Plusieurs morts attrapé seul contre plusieurs ennemis",
  "morts-avant-objectif": "Une mort suivie d'un dragon, Nashor ou Héraut perdu",
  "shutdown-donne": "Tu donnes un shutdown",
  "morts-terrain-ennemi": "Morts répétées dans la moitié adverse après 15 min",
  "morts-early": "3 morts ou plus avant 15 min",
  "farm-retard": "15 sbires ou plus de retard à 10 min",
  "farm-avance": "15 sbires ou plus d'avance à 10 min",
  "retard-15": "1000 or ou plus de retard sur ton vis-à-vis à 15 min",
  "avance-15": "1000 or ou plus d'avance sur ton vis-à-vis à 15 min",
  "vision-faible": "Vision nettement plus faible que ton vis-à-vis",
  "zero-pink": "Aucune balise de contrôle achetée",
  "roams": "Roams efficaces avant 14 min",
  "jungle-zero-impact": "Aucun kill ni assist sur une lane avant 14 min",
  "jungle-objectifs-early": "L'adversaire prend nettement plus d'objectifs neutres avant 20 min",
  "jungle-absent-objectifs": "Objectifs neutres perdus alors que tu es mort ou loin",
  "jungle-farm-retard": "Clear plus lent que le jungler adverse",
};

export function gameReport(g: GameAnalysis): string {
  const lines: string[] = [];
  const result = g.win ? "Victoire" : "Défaite";
  const vs = g.opponentChampion ? ` contre ${g.opponentChampion}` : "";
  lines.push(`### ${result} · ${g.champion} ${ROLE[g.position] ?? g.position}${vs} · ${Math.round(g.durationMin)} min`);
  lines.push(`KDA ${g.kda.kills}/${g.kda.deaths}/${g.kda.assists} · ${g.date.toLocaleDateString("fr-FR")} · ${g.matchId}`);
  lines.push("");

  if (g.decisive) {
    const label = g.win ? "Moment où la partie est gagnée" : "Moment où la partie est perdue";
    const swing = Math.abs(g.decisive.play.swing);
    lines.push(`**${label}** : ${g.decisive.summary} (environ ${swing} or d'écart).`);
  }
  if (g.leadForGoodMinute !== undefined) {
    const who = g.win ? "Ton équipe prend" : "L'adversaire prend";
    lines.push(`${who} l'avantage à l'or pour de bon à ${g.leadForGoodMinute} min.`);
  }
  lines.push("");

  for (const f of g.findings) {
    const icon = f.severity === "grave" ? "🔴" : f.severity === "moyen" ? "🟠" : "🟢";
    lines.push(`- ${icon} ${f.text}`);
  }
  if (g.findings.length === 0) lines.push("- Rien de marquant à signaler.");

  if (g.deaths.length) {
    lines.push("");
    lines.push("Tes morts :");
    for (const d of g.deaths) {
      const by = d.killer ? `par ${d.killer}` : "par une tour ou un monstre";
      const ctx = d.alliesInFight ? `${d.alliesInFight} allié(s) dans le combat` : "aucun allié dans le combat";
      const lost = d.objectivesLost.length ? `, puis ${d.objectivesLost.map((o) => o.label).join(" + ")} perdu` : "";
      lines.push(`- ${fmtTime(d.timestamp)} ${by}, ${d.enemiesInvolved} ennemi(s), ${ctx}${lost}`);
    }
  }
  return lines.join("\n");
}

export function summaryReport(name: string, s: Summary): string {
  const lines: string[] = [];
  const fmt = (n: number | undefined, unit: string) => (n === undefined ? "n/a" : `${n > 0 ? "+" : ""}${Math.round(n)} ${unit}`);
  lines.push(`## Bilan de ${name} sur ${s.games} partie(s)`);
  lines.push("");
  lines.push(`${s.wins} victoire(s), ${s.games - s.wins} défaite(s) · KDA moyen ${s.avgKda.toFixed(2)}`);
  lines.push(
    `Écart moyen avec ton vis-à-vis : ${fmt(s.avgCsDiffAt10, "sbires")} à 10 min, ${fmt(s.avgGoldDiffAt15, "or")} à 15 min · vision ${s.avgVisionPerMin.toFixed(1)}/min`,
  );
  lines.push("");

  if (s.champions.length) {
    lines.push("### Par champion");
    lines.push("| Champion | Parties | Victoires | KDA | Or à 15 min | Objectifs neutres avant 20 min |");
    lines.push("|---|---|---|---|---|---|");
    for (const c of s.champions) {
      const obj = c.earlyObjectives ? `${c.earlyObjectives.allies} pour vous, ${c.earlyObjectives.enemies} pour eux` : "";
      lines.push(
        `| ${c.champion} | ${c.games} | ${c.wins} (${Math.round((c.wins / c.games) * 100)} %) | ${c.kda.toFixed(1)} | ${fmt(c.avgGoldDiffAt15, "or")} | ${obj} |`,
      );
    }
    lines.push("");
  }

  if (s.issues.length) {
    lines.push("### Ce qui revient le plus souvent");
    for (const i of s.issues) {
      const pct = Math.round(i.share * 100);
      lines.push(`- **${pct} % des parties** · ${LABEL[i.code] ?? i.example}`);
      if (TIPS[i.code]) lines.push(`  → ${TIPS[i.code]}`);
    }
  } else {
    lines.push("Aucune erreur ne revient dans plus de 30 % des parties.");
  }
  if (s.strengths.length) {
    lines.push("");
    lines.push("### Tes points forts");
    for (const i of s.strengths) lines.push(`- ${Math.round(i.share * 100)} % des parties · ${LABEL[i.code] ?? i.example}`);
  }
  return lines.join("\n");
}
