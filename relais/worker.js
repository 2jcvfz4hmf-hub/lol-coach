// Relais entre l'appli et l'API Riot : la clé reste ici, jamais dans l'appli.
// L'appli appelle /<hôte>/<chemin Riot> ; seules les lectures utiles à la recherche
// de joueurs passent, et les réponses sont gardées en cache.
// Il garde aussi les builds de l'équipe (/builds), modifiables avec le code d'équipe.

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

// --- Builds de l'équipe ---

const CATEGORIES = ["squishy", "tank", "enchanteur"];
const BUILDS_KEY = "all";

/** Garde seulement ce qu'on attend d'un build, ou renvoie un message d'erreur. */
export function cleanBuild(b) {
  if (typeof b !== "object" || !b) return "build manquant";
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length > 6 || !items.every((i) => Number.isInteger(i) && i > 0 && i < 1e6)) return "objets invalides";
  if (b.keystone !== undefined && !(Number.isInteger(b.keystone) && b.keystone > 0 && b.keystone < 1e5)) return "rune invalide";
  if (b.skills !== undefined && !/^[QWE]{3}\|[QWE]{3}$/.test(b.skills)) return "ordre des sorts invalide";
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 300)) return "note trop longue (300 caractères)";
  return { items, keystone: b.keystone, skills: b.skills, note: b.note?.trim() || undefined };
}

async function builds(request, env, url) {
  if (!env.BUILDS) return json(503, { erreur: "stockage des builds pas configuré" });
  if (request.method === "GET" && url.pathname === "/builds") {
    return new Response((await env.BUILDS.get(BUILDS_KEY)) ?? "{}", { headers: { "content-type": "application/json" } });
  }
  const champion = url.pathname.match(/^\/builds\/(\d{1,4})$/)?.[1];
  if (request.method !== "PUT" || !champion) return json(404, { erreur: "chemin non autorisé" });
  if (!env.BUILD_CODE) return json(403, { erreur: "code d'équipe pas configuré" });
  if (request.headers.get("X-Code") !== env.BUILD_CODE) return json(403, { erreur: "code d'équipe incorrect" });

  const text = await request.text();
  if (text.length > 4000) return json(413, { erreur: "build trop long" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { erreur: "JSON invalide" });
  }
  if (!CATEGORIES.includes(body.category)) return json(400, { erreur: "catégorie inconnue" });
  const author = typeof body.author === "string" ? body.author.trim().slice(0, 32) : "";

  const all = JSON.parse((await env.BUILDS.get(BUILDS_KEY)) ?? "{}");
  const entry = (all[champion] ??= {});
  if (body.build === null) delete entry[body.category];
  else {
    const build = cleanBuild(body.build);
    if (typeof build === "string") return json(400, { erreur: build });
    entry[body.category] = { ...build, author: author || undefined, updatedAt: Date.now() };
  }
  if (!Object.keys(entry).length) delete all[champion];
  await env.BUILDS.put(BUILDS_KEY, JSON.stringify(all));
  return json(200, all[champion] ?? {});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/builds" || url.pathname.startsWith("/builds/")) return builds(request, env, url);
    if (request.method !== "GET") return json(405, { erreur: "lecture seule" });
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
