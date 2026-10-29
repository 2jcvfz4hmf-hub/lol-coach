// Relais entre l'appli et l'API Riot : la clé reste ici, jamais dans l'appli.
// L'appli appelle /<hôte>/<chemin Riot> ; seules les lectures utiles à la recherche
// de joueurs passent, et les réponses sont gardées en cache.

const HOSTS = new Set(["europe", "euw1"]);
const PUUID = "[\\w-]{20,100}";

// Chemin autorisé -> durée du cache en secondes.
const ROUTES = [
  [new RegExp("^/riot/account/v1/accounts/by-riot-id/[^/]{1,64}/[^/]{1,16}$"), 86400],
  [new RegExp(`^/lol/league/v4/entries/by-puuid/${PUUID}$`), 300],
  [new RegExp(`^/lol/match/v5/matches/by-puuid/${PUUID}/ids$`), 120],
  [new RegExp("^/lol/match/v5/matches/EUW1_\\d{5,15}$"), 604800],
  [new RegExp("^/lol/match/v5/matches/EUW1_\\d{5,15}/timeline$"), 604800],
  [new RegExp(`^/lol/champion-mastery/v4/champion-masteries/by-puuid/${PUUID}/by-champion/\\d{1,4}$`), 3600],
];
const PARAMS = new Set(["type", "queue", "start", "count", "startTime"]);

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") return json(405, { erreur: "lecture seule" });
    const url = new URL(request.url);
    if (url.pathname === "/") return json(200, { ok: true });

    const [, host, ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`;
    const route = ROUTES.find(([re]) => re.test(path));
    if (!HOSTS.has(host) || !route) return json(404, { erreur: "chemin non autorisé" });
    for (const [k, v] of url.searchParams) {
      if (!PARAMS.has(k) || !/^[\w]{0,20}$/.test(v)) return json(400, { erreur: `paramètre refusé : ${k}` });
    }
    if (Number(url.searchParams.get("count") ?? 0) > 20) return json(400, { erreur: "20 parties au maximum" });

    const cache = caches.default;
    const key = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(key);
    if (hit) return hit;

    const res = await fetch(`https://${host}.api.riotgames.com${path}${url.search}`, {
      headers: { "X-Riot-Token": env.RIOT_API_KEY },
    });
    const headers = { "cache-control": `public, max-age=${route[1]}` };
    const retry = res.headers.get("Retry-After");
    if (retry) headers["Retry-After"] = retry;
    const out = new Response(res.body, { status: res.status, headers: { "content-type": "application/json", ...headers } });
    if (res.ok) ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  },
};
