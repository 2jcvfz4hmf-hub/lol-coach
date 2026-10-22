// Données des champions depuis Data Dragon (CDN public de Riot, sans clé).

export interface ChampionInfo {
  id: number; // identifiant numérique utilisé par le client
  key: string; // « MonkeyKing », utilisé par Match-V5 (championName)
  name: string; // nom affiché en français
  tags: string[]; // Fighter, Tank, Mage, Assassin, Marksman, Support
  /** Notes Riot de 0 à 10. */
  attack: number;
  magic: number;
  defense: number;
}

export type ChampionIndex = Map<number, ChampionInfo>;

interface RawChampion {
  id: string;
  key: string;
  name: string;
  tags: string[];
  info: { attack: number; defense: number; magic: number; difficulty: number };
}

export function parseChampions(json: { data: Record<string, RawChampion> }): ChampionIndex {
  const index: ChampionIndex = new Map();
  for (const c of Object.values(json.data)) {
    index.set(Number(c.key), {
      id: Number(c.key),
      key: c.id,
      name: c.name,
      tags: c.tags,
      attack: c.info.attack,
      magic: c.info.magic,
      defense: c.info.defense,
    });
  }
  return index;
}

export async function loadChampions(fetchImpl: typeof fetch = fetch): Promise<{ version: string; champions: ChampionIndex }> {
  const versions = (await (await fetchImpl("https://ddragon.leagueoflegends.com/api/versions.json")).json()) as string[];
  const version = versions[0]!;
  const json = await (await fetchImpl(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`)).json();
  return { version, champions: parseChampions(json as { data: Record<string, RawChampion> }) };
}

export function championIcon(version: string, c: ChampionInfo): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.key}.png`;
}

export type DamageType = "AD" | "AP" | "mixte";

export function damageType(c: ChampionInfo): DamageType {
  if (c.magic >= c.attack + 3) return "AP";
  if (c.attack >= c.magic + 3) return "AD";
  return "mixte";
}

export const isFrontline = (c: ChampionInfo) => c.tags.includes("Tank") || (c.tags[0] === "Fighter" && c.defense >= 5);
