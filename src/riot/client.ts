import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RateLimiter } from "./limiter.ts";
import type { Account, LeagueEntry, LeagueList, Match, Timeline } from "./types.ts";

// Plateforme du joueur -> cluster régional utilisé par Account-V1 et Match-V5.
const REGIONAL: Record<string, string> = {
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe",
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  kr: "asia",
  jp1: "asia",
  oc1: "sea",
  sg2: "sea",
  tw2: "sea",
  vn2: "sea",
};

export interface RiotClientOptions {
  apiKey: string;
  platform?: string; // euw1 par défaut
  cacheDir?: string; // les parties terminées ne changent jamais, on les garde sur disque
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
}

export class RiotApiError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(RiotApiError.describe(status));
  }

  static describe(status: number): string {
    switch (status) {
      case 401:
      case 403:
        return "Clé API Riot invalide ou expirée (les clés de développement expirent après 24 h).";
      case 404:
        return "Introuvable : vérifie le pseudo et le tag (ex. Pseudo#EUW).";
      default:
        return `Erreur de l'API Riot (HTTP ${status}).`;
    }
  }
}

export class RiotClient {
  private regional: string;
  private platform: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: RiotClientOptions) {
    const platform = (opts.platform ?? "euw1").toLowerCase();
    const regional = REGIONAL[platform];
    if (!regional) throw new Error(`Serveur inconnu : ${platform}`);
    this.regional = regional;
    this.platform = platform;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  accountByRiotId(gameName: string, tagLine: string): Promise<Account> {
    return this.get(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  }

  /** type : "ranked", "normal"... ou "" pour toutes les files. */
  matchIds(puuid: string, count = 20, type = "ranked"): Promise<string[]> {
    const filter = type ? `type=${type}&` : "";
    return this.get(`/lol/match/v5/matches/by-puuid/${puuid}/ids?${filter}start=0&count=${count}`);
  }

  /** Parties classées solo/duo, les plus récentes d'abord. */
  rankedSoloIds(puuid: string, count = 20, startTime?: number): Promise<string[]> {
    const since = startTime ? `&startTime=${Math.floor(startTime / 1000)}` : "";
    return this.get(`/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${count}${since}`);
  }

  /** Challenger, Grandmaster ou Master. */
  apexLeague(tier: "challenger" | "grandmaster" | "master"): Promise<LeagueList> {
    return this.get(`/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`, this.platform);
  }

  leagueEntries(tier: string, division: string, page = 1): Promise<LeagueEntry[]> {
    return this.get(`/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`, this.platform);
  }

  match(matchId: string): Promise<Match> {
    return this.cached(`${matchId}.json`, () => this.get(`/lol/match/v5/matches/${matchId}`));
  }

  timeline(matchId: string): Promise<Timeline> {
    return this.cached(`${matchId}.timeline.json`, () => this.get(`/lol/match/v5/matches/${matchId}/timeline`));
  }

  private async cached<T>(file: string, load: () => Promise<T>): Promise<T> {
    if (!this.opts.cacheDir) return load();
    const p = path.join(this.opts.cacheDir, file);
    try {
      return JSON.parse(await readFile(p, "utf8")) as T;
    } catch {
      const data = await load();
      await mkdir(this.opts.cacheDir, { recursive: true });
      await writeFile(p, JSON.stringify(data));
      return data;
    }
  }

  private async get<T>(pathAndQuery: string, host = this.regional, attempt = 0): Promise<T> {
    await this.opts.limiter?.take();
    const url = `https://${host}.api.riotgames.com${pathAndQuery}`;
    const res = await this.fetchImpl(url, { headers: { "X-Riot-Token": this.opts.apiKey } });
    if (res.status === 429 && attempt < 3) {
      // Limite de requêtes atteinte : on attend ce que Riot demande.
      const wait = Number(res.headers.get("Retry-After") ?? "10");
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.get(pathAndQuery, host, attempt + 1);
    }
    if (!res.ok) throw new RiotApiError(res.status, url);
    return (await res.json()) as T;
  }
}
