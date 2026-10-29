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

describe("builds de l'équipe", () => {
  function kv() {
    const data = new Map<string, string>();
    return { get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v) };
  }
  const put = (body: unknown, code = "secret") =>
    new Request("https://relais.test/builds/427", { method: "PUT", headers: { "X-Code": code }, body: JSON.stringify(body) });

  it("enregistre un build avec le bon code et le relit", async () => {
    const e = { ...env, BUILD_CODE: "secret", BUILDS: kv() };
    const ok = await worker.fetch(put({ category: "tank", author: "ju", build: { items: [3011, 6617], keystone: 8128, skills: "QEW|QEW", note: " anti-heal tôt " } }), e, ctx);
    expect(ok.status).toBe(200);
    const all = await (await worker.fetch(new Request("https://relais.test/builds"), e, ctx)).json();
    expect(all["427"].tank).toMatchObject({ items: [3011, 6617], keystone: 8128, skills: "QEW|QEW", note: "anti-heal tôt", author: "ju" });
  });

  it("refuse un mauvais code ou un build invalide", async () => {
    const e = { ...env, BUILD_CODE: "secret", BUILDS: kv() };
    expect((await worker.fetch(put({ category: "tank", build: { items: [] } }, "faux"), e, ctx)).status).toBe(403);
    expect((await worker.fetch(put({ category: "tank", build: { items: [1, 2, 3, 4, 5, 6, 7] } }), e, ctx)).status).toBe(400);
    expect((await worker.fetch(put({ category: "support", build: { items: [] } }), e, ctx)).status).toBe(400);
    expect((await worker.fetch(put({ category: "tank", build: { items: [], note: "x".repeat(301) } }), e, ctx)).status).toBe(400);
  });
});
