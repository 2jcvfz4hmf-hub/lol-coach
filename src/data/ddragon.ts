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

export interface ItemInfo {
  id: number;
  name: string;
  /** Objet terminé (légendaire, bottes...), pas un composant ni un consommable. */
  completed: boolean;
}

export type ItemIndex = Map<number, ItemInfo>;

interface RawItem {
  name: string;
  into?: string[];
  tags?: string[];
  gold: { total: number; purchasable: boolean };
  maps?: Record<string, boolean>;
}

export function parseItems(json: { data: Record<string, RawItem> }): ItemIndex {
  const index: ItemIndex = new Map();
  for (const [id, it] of Object.entries(json.data)) {
    const tags = it.tags ?? [];
    const boots = tags.includes("Boots");
    const completed =
      (!it.into?.length || boots) &&
      it.gold.total >= 900 &&
      !tags.includes("Consumable") &&
      !tags.includes("Trinket") &&
      it.maps?.["11"] !== false;
    index.set(Number(id), { id: Number(id), name: it.name, completed });
  }
  return index;
}

export interface RuneInfo {
  id: number;
  name: string;
  icon: string; // chemin relatif sur le CDN
  /** Rune principale (première ligne d'un arbre). */
  keystone?: boolean;
  /** Arbre de la rune (Précision, Domination…), ou l'arbre lui-même. */
  tree?: number;
}

export type RuneIndex = Map<number, RuneInfo>;

interface RawRuneTree {
  id?: number;
  name?: string;
  icon?: string;
  slots: { runes: { id: number; name: string; icon: string }[] }[];
}

export function parseRunes(json: RawRuneTree[]): RuneIndex {
  const index: RuneIndex = new Map();
  for (const tree of json) {
    if (tree.id && tree.name && tree.icon) index.set(tree.id, { id: tree.id, name: tree.name, icon: tree.icon, tree: tree.id });
    tree.slots.forEach((slot, i) => {
      for (const r of slot.runes) index.set(r.id, { id: r.id, name: r.name, icon: r.icon, keystone: i === 0, tree: tree.id });
    });
  }
  return index;
}

export interface GameData {
  version: string;
  champions: ChampionIndex;
  items: ItemIndex;
  runes: RuneIndex;
}

/** Champions, objets et runes du dernier patch, en français. */
export async function loadGameData(fetchImpl: typeof fetch = fetch): Promise<GameData> {
  const { version, champions } = await loadChampions(fetchImpl);
  const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR`;
  const [items, runes] = await Promise.all([
    fetchImpl(`${base}/item.json`).then((r) => r.json()),
    fetchImpl(`${base}/runesReforged.json`).then((r) => r.json()),
  ]);
  return { version, champions, items: parseItems(items as { data: Record<string, RawItem> }), runes: parseRunes(runes as RawRuneTree[]) };
}

export const itemIcon = (version: string, id: number) => `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;
export const runeIcon = (r: RuneInfo) => `https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`;
