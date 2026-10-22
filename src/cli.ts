import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyseGame, type GameAnalysis } from "./analysis/game.ts";
import { summarise } from "./analysis/recurring.ts";
import { gameReport, summaryReport } from "./report/fr.ts";
import { RiotClient } from "./riot/client.ts";

const USAGE = `Utilisation : npm run analyse -- "Pseudo#TAG" [--parties 20] [--serveur euw1] [--type ranked]

La clé API Riot est lue dans la variable RIOT_API_KEY ou dans un fichier .env :
  RIOT_API_KEY=RGAPI-xxxxxxxx`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      parties: { type: "string", default: "20" },
      serveur: { type: "string", default: "euw1" },
      type: { type: "string", default: "ranked" },
      aide: { type: "boolean", default: false },
    },
  });
  const riotId = positionals[0];
  if (values.aide || !riotId || !riotId.includes("#")) {
    console.log(USAGE);
    process.exit(riotId ? 1 : 0);
  }
  if (existsSync(".env")) process.loadEnvFile(".env");
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    console.error("RIOT_API_KEY manquante.\n\n" + USAGE);
    process.exit(1);
  }

  const [gameName, tagLine] = riotId.split("#") as [string, string];
  const riot = new RiotClient({ apiKey, platform: values.serveur, cacheDir: ".cache" });
  const account = await riot.accountByRiotId(gameName, tagLine);
  const ids = await riot.matchIds(account.puuid, Number(values.parties), values.type);
  if (ids.length === 0) {
    console.log("Aucune partie trouvée pour ce type de file.");
    return;
  }

  const games: GameAnalysis[] = [];
  for (const [i, id] of ids.entries()) {
    process.stderr.write(`\rAnalyse des parties : ${i + 1}/${ids.length}`);
    const [match, timeline] = await Promise.all([riot.match(id), riot.timeline(id)]);
    // Les remakes faussent les stats.
    if (match.info.gameDuration < 5 * 60) continue;
    games.push(analyseGame(match, timeline, account.puuid));
  }
  process.stderr.write("\n\n");

  const name = `${account.gameName}#${account.tagLine}`;
  const report = [summaryReport(name, summarise(games)), "## Détail partie par partie", ...games.map(gameReport)].join("\n\n");
  console.log(report);

  await mkdir("rapports", { recursive: true });
  const file = path.join("rapports", `${account.gameName}-${new Date().toISOString().slice(0, 10)}.md`);
  await writeFile(file, report);
  console.error(`\nRapport enregistré dans ${file}`);
}

main().catch((err: Error) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
