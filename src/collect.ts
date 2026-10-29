import { parseArgs } from "node:util";
import { Crawler } from "./global/crawler.ts";
import { StatsStore } from "./global/store.ts";
import { RiotClient } from "./riot/client.ts";
import { PERSONAL_KEY_LIMITS, RateLimiter } from "./riot/limiter.ts";

// Récolte des parties du serveur pendant quelques heures, lancée chaque jour par GitHub Actions.
// Les stats sont reprises du dossier (téléchargées depuis la release « stats ») et complétées.

async function main() {
  const { values } = parseArgs({
    options: {
      heures: { type: "string", default: "5" },
      dossier: { type: "string", default: "stats" },
      serveur: { type: "string", default: "euw1" },
    },
  });
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) throw new Error("RIOT_API_KEY manquante (secret du repo GitHub).");

  const store = await new StatsStore(values.dossier).load();
  const low = await new StatsStore(values.dossier, "-bas").load();
  const riot = new RiotClient({ apiKey, platform: values.serveur, limiter: new RateLimiter(PERSONAL_KEY_LIMITS) });
  const startGames = store.current?.games ?? 0;
  const startLow = low.current?.games ?? 0;
  let error: string | undefined;
  const crawler = new Crawler(riot, store, (s) => {
    error = s.error;
    console.log(`${s.games} parties Émeraude+, ${s.lowGames ?? 0} Fer à Platine (patch ${s.patch ?? "?"})${s.error ? ` · ${s.error}` : ""}`);
  }, undefined, low);

  const until = Date.now() + Number(values.heures) * 3600_000;
  crawler.start();
  while (Date.now() < until && crawler.status().running) await new Promise((r) => setTimeout(r, 10_000));
  await crawler.stop();

  const s = crawler.status();
  console.log(`Terminé, patch ${s.patch ?? "?"} : ${s.games} parties Émeraude+ (+${s.games - startGames}), ${s.lowGames ?? 0} Fer à Platine (+${(s.lowGames ?? 0) - startLow}).`);
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
