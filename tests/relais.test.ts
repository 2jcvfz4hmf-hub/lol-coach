import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../relais/worker.js";
import { relayClient } from "../src/riot/relay.ts";

const ctx = { waitUntil: () => {} };
const env = { RIOT_API_KEY: "cle-secrete" };

function stubRiot() {
  const calls: { url: string; token?: string }[] = [];
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, token: (init?.headers as Record<string, string>)?.["X-Riot-Token"] });
      return new Response(JSON.stringify({ ok: url }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("relais", () => {
  it("ajoute la clé et transmet les chemins autorisés", async () => {
    const calls = stubRiot();
    const res = await worker.fetch(new Request("https://relais.test/europe/riot/account/v1/accounts/by-riot-id/AURA/EUW"), env, ctx);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ url: "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/AURA/EUW", token: "cle-secrete" }]);
  });

  it("refuse le reste", async () => {
    const calls = stubRiot();
    const bad = [
      "https://relais.test/europe/lol/league/v4/entries/RANKED_SOLO_5x5/DIAMOND/I",
      "https://relais.test/evil.com/riot/account/v1/accounts/by-riot-id/a/b",
      "https://relais.test/europe/lol/match/v5/matches/by-puuid/aaaaaaaaaaaaaaaaaaaaaaaa/ids?count=100",
      "https://relais.test/europe/lol/match/v5/matches/by-puuid/aaaaaaaaaaaaaaaaaaaaaaaa/ids?api_key=x",
    ];
    for (const u of bad) expect((await worker.fetch(new Request(u), env, ctx)).status).toBeGreaterThanOrEqual(400);
    expect((await worker.fetch(new Request("https://relais.test/europe/riot/account/v1/accounts/by-riot-id/a/b", { method: "POST" }), env, ctx)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("l'appli passe par le relais sans clé", async () => {
    const seen: string[] = [];
    const riot = relayClient("https://relais.test/", async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify(["EUW1_123456"]), { status: 200 });
    });
    await riot.matchIds("p".repeat(30), 10, "");
    expect(seen).toEqual([`https://relais.test/europe/lol/match/v5/matches/by-puuid/${"p".repeat(30)}/ids?start=0&count=10`]);
  });
});
