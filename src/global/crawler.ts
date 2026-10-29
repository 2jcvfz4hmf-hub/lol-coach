import { RiotApiError, type RiotClient } from "../riot/client.ts";
import { addMatch, addSkills, patchOf } from "./stats.ts";
import type { StatsStore } from "./store.ts";

// Récolte en continu les ranked solo/duo de tout le serveur, pour calculer
// winrates, counters, duos et builds. Deux groupes de rangs, rangés à part :
// Émeraude et plus, et Fer à Platine (si un second dossier de stats est donné).

const DIVISIONS = ["I", "II", "III", "IV"];
const TIERS = ["DIAMOND", "EMERALD"];
const LOW_TIERS = ["PLATINUM", "GOLD", "SILVER", "BRONZE", "IRON"];
const SAVE_EVERY = 25;
/** Une partie sur trois : la timeline coûte un appel de plus, juste pour l'ordre des sorts. */
const SKILLS_EVERY = 3;

export interface CrawlerStatus {
  running: boolean;
  games: number;
  /** Parties Fer à Platine. */
  lowGames?: number;
  patch?: string;
  error?: string;
}

/** Compare deux patchs « 15.9 » et « 15.10 » : positif si a est plus récent. */
export function comparePatch(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

export class Crawler {
  private running = false;
  private players: { puuid: string; low: boolean }[] = [];
  private round = 0;
  private unsaved = 0;
  private added = 0;
  private error?: string;

  constructor(
    private riot: RiotClient,
    private store: StatsStore,
    private onStatus: (s: CrawlerStatus) => void = () => {},
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private low?: StatsStore,
  ) {}

  status(): CrawlerStatus {
    return {
      running: this.running,
      games: this.store.current?.games ?? 0,
      lowGames: this.low ? (this.low.current?.games ?? 0) : undefined,
      patch: this.store.current?.patch ?? this.low?.current?.patch,
      error: this.error,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.error = undefined;
    this.onStatus(this.status());
    void this.loop();
  }

  async stop() {
    this.running = false;
    await this.store.save();
    await this.low?.save();
    this.onStatus(this.status());
  }

  private async loop() {
    while (this.running) {
      try {
        if (this.players.length === 0) await this.seed();
        const player = this.players.shift();
        if (player) await this.crawlPlayer(player.puuid, player.low ? this.low! : this.store);
        else await this.sleep(60_000); // aucun joueur trouvé : on retentera plus tard
      } catch (e) {
        if (e instanceof RiotApiError && (e.status === 401 || e.status === 403)) {
          this.running = false;
          this.error = "Clé Riot refusée : vérifie-la ou génères-en une nouvelle.";
          await this.store.save();
          await this.low?.save();
          this.onStatus(this.status());
          return;
        }
        // Coupure réseau ou erreur passagère de Riot : on réessaie plus tard.
        await this.sleep(30_000);
      }
    }
  }

  /**
   * Liste de joueurs : Master et plus, une page de chaque division Diamant et Émeraude,
   * et une page d'une division au hasard de Platine à Fer.
   */
  private async seed() {
    const puuids: string[] = [];
    const low: string[] = [];
    if (this.round % 3 === 0) {
      for (const tier of ["challenger", "grandmaster", "master"] as const) {
        const league = await this.riot.apexLeague(tier);
        puuids.push(...league.entries.map((e) => e.puuid));
      }
    }
    const page = 1 + Math.floor(this.round / 3);
    for (const tier of TIERS) {
      for (const division of DIVISIONS) {
        const entries = await this.riot.leagueEntries(tier, division, page);
        puuids.push(...entries.map((e) => e.puuid));
      }
    }
    if (this.low) {
      for (const tier of LOW_TIERS) {
        const division = DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)]!;
        const entries = await this.riot.leagueEntries(tier, division, page);
        low.push(...entries.map((e) => e.puuid));
      }
    }
    this.round++;
    this.players = shuffle([
      ...puuids.filter(Boolean).map((puuid) => ({ puuid, low: false })),
      ...low.filter(Boolean).map((puuid) => ({ puuid, low: true })),
    ]);
  }

  private async crawlPlayer(puuid: string, store: StatsStore) {
    const ids = await this.riot.rankedSoloIds(puuid, 20);
    for (const id of ids) {
      if (!this.running) return;
      if (this.store.seen.has(id) || this.low?.seen.has(id)) continue;
      const match = await this.riot.match(id);
      const patch = patchOf(match.info.gameVersion);
      const current = store.current?.patch;
      if (!current || comparePatch(patch, current) > 0) await store.startPatch(patch);
      store.markSeen(id);
      if (comparePatch(patch, current ?? patch) < 0) return; // les suivantes sont encore plus anciennes
      if (!addMatch(store.current!, match)) continue;
      if (++this.added % SKILLS_EVERY === 0) {
        const timeline = await Promise.resolve()
          .then(() => this.riot.timeline(id))
          .catch(() => undefined); // l'ordre des sorts est un bonus : on continue sans
        if (timeline) addSkills(store.current!, match, timeline);
      }
      if (++this.unsaved >= SAVE_EVERY) {
        this.unsaved = 0;
        await this.store.save();
        await this.low?.save();
        this.onStatus(this.status());
      }
    }
  }
}
