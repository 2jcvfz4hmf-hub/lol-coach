import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyseGame, isPlayable, type GameAnalysis } from "./analysis/game.ts";
import { summarise } from "./analysis/recurring.ts";
import { gameReport, summaryReport } from "./report/fr.ts";
import { RiotClient } from "./riot/client.ts";

const USAGE = `Utilisation : npm run analyse -- "Pseudo#TAG" [--parties 20] [--serveur euw1] [--type ranked]

La clé API Riot et ton pseudo peuvent être mis dans un fichier .env :
  RIOT_API_KEY=RGAPI-xxxxxxxx
  RIOT_ID=Pseudo#TAG
Avec RIOT_ID dans le .env, il suffit de lancer : npm run analyse`;

/** Charge .env (ou .env.txt, créé par erreur avec le Bloc-notes) sans écraser les variables existantes. */
function loadEnv() {
  const file = [".env", ".env.txt"].find((f) => existsSync(f));
  if (!file) return;
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, ""); // le Bloc-notes peut ajouter un BOM
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

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
  if (values.aide) {
    console.log(USAGE);
    return;
  }
  loadEnv();
  // Le pseudo peut arriver découpé en plusieurs arguments selon le terminal.
  const riotId = positionals.join(" ").trim() || process.env.RIOT_ID?.trim();
  if (!riotId || !riotId.includes("#")) {
    console.error(riotId ? `Pseudo reçu : "${riotId}", il manque le #TAG.\n` : "Aucun pseudo indiqué.\n");
    console.error(USAGE);
    process.exit(1);
  }
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    console.error("RIOT_API_KEY manquante.\n\n" + USAGE);
    process.exit(1);
  }

  const hash = riotId.lastIndexOf("#");
  const gameName = riotId.slice(0, hash).trim();
  const tagLine = riotId.slice(hash + 1).trim();
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
    if (!isPlayable(match)) continue;
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
  const message = err.message === "fetch failed" ? "impossible de joindre l'API Riot, vérifie ta connexion internet." : err.message;
  console.error(`Erreur : ${message}`);
  process.exit(1);
});
