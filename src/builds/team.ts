import type { ChampionInfo } from "../data/ddragon.ts";

// Builds écrits par l'équipe (toi et tes potes), un par type de compo en face.
// Ils sont gardés par le relais en ligne : tout le monde voit les mêmes.

export type Category = "squishy" | "tank" | "enchanteur";
export const CATEGORIES: Category[] = ["squishy", "tank", "enchanteur"];

export const CATEGORY_FR: Record<Category, string> = {
  squishy: "Contre une compo squishy",
  tank: "Contre une compo tank",
  enchanteur: "Contre un enchanteur",
};

export interface TeamBuild {
  items: number[];
  keystone?: number;
  /** Ordre des sorts « QEW|QEW ». */
  skills?: string;
  note?: string;
  author?: string;
  updatedAt?: number;
}

/** Par identifiant de champion, puis par type de compo. */
export type TeamBuilds = Record<string, Partial<Record<Category, TeamBuild>>>;

type Kind = "tank" | "enchanteur" | "squishy";

/** Rôle d'un champion pour choisir le build : tank, enchanteur (support qui soigne ou protège) ou squishy. */
export function kindOf(c: ChampionInfo): Kind {
  if (c.tags[0] === "Tank" || (c.tags.includes("Tank") && c.defense >= 6) || (c.tags[0] === "Fighter" && c.defense >= 7)) return "tank";
  if (c.tags[0] === "Support" && !c.tags.includes("Tank")) return "enchanteur";
  return "squishy";
}

/** Type de compo en face : deux tanks ou plus, sinon un enchanteur, sinon squishy. */
export function compCategory(enemies: ChampionInfo[]): { category: Category; why: string } {
  const tanks = enemies.filter((c) => kindOf(c) === "tank");
  const enchanters = enemies.filter((c) => kindOf(c) === "enchanteur");
  const names = (cs: ChampionInfo[]) => cs.map((c) => c.name).join(", ");
  if (tanks.length >= 2) return { category: "tank", why: `${tanks.length} tanks en face (${names(tanks)})` };
  if (enchanters.length) return { category: "enchanteur", why: `enchanteur en face (${names(enchanters)})` };
  return { category: "squishy", why: tanks.length ? `un seul tank en face (${names(tanks)})` : "pas de tank en face" };
}

export class TeamBuildsClient {
  constructor(
    private base: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async all(): Promise<TeamBuilds> {
    const res = await this.fetchImpl(`${this.base.replace(/\/+$/, "")}/builds`);
    if (!res.ok) throw new Error(`Builds de l'équipe indisponibles (HTTP ${res.status}).`);
    return (await res.json()) as TeamBuilds;
  }

  /** `build` à null efface le build de cette catégorie. */
  async save(championId: number, category: Category, build: TeamBuild | null, code: string, author?: string) {
    const res = await this.fetchImpl(`${this.base.replace(/\/+$/, "")}/builds/${championId}`, {
      method: "PUT",
      headers: { "X-Code": code, "content-type": "application/json" },
      body: JSON.stringify({ category, build, author }),
    });
    if (!res.ok) {
      const message = ((await res.json().catch(() => ({}))) as { erreur?: string }).erreur;
      throw new Error(message ? `Enregistrement refusé : ${message}.` : `Enregistrement impossible (HTTP ${res.status}).`);
    }
  }
}
