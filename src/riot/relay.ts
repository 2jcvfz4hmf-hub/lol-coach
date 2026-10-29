import { RiotClient } from "./client.ts";

// Client Riot qui passe par le relais en ligne (relais/worker.js) : l'appli n'a pas de clé,
// c'est le relais qui l'ajoute. Même interface que le client direct.

/** Transforme https://<hôte>.api.riotgames.com/<chemin> en <relais>/<hôte>/<chemin>. */
export function relayFetch(base: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  const root = base.replace(/\/+$/, "");
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const host = url.hostname.replace(/\.api\.riotgames\.com$/, "");
    return fetchImpl(`${root}/${host}${url.pathname}${url.search}`, { method: init?.method });
  };
}

export function relayClient(base: string, fetchImpl?: typeof fetch): RiotClient {
  return new RiotClient({ apiKey: "", platform: "euw1", fetchImpl: relayFetch(base, fetchImpl) });
}
