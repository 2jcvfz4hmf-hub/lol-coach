import { describe, expect, it } from "vitest";
import type { ChampionInfo } from "../src/data/ddragon.ts";
import { compCategory, kindOf } from "../src/builds/team.ts";

const champ = (name: string, tags: string[], defense = 3): ChampionInfo => ({ id: name.length, key: name, name, tags, attack: 5, magic: 5, defense });
const ornn = champ("Ornn", ["Tank", "Fighter"], 9);
const sejuani = champ("Sejuani", ["Tank", "Fighter"], 7);
const lulu = champ("Lulu", ["Support", "Mage"], 5);
const leona = champ("Leona", ["Tank", "Support"], 8);
const ahri = champ("Ahri", ["Mage", "Assassin"], 4);
const jinx = champ("Jinx", ["Marksman"], 2);

describe("type de compo en face", () => {
  it("classe les champions", () => {
    expect(kindOf(ornn)).toBe("tank");
    expect(kindOf(leona)).toBe("tank");
    expect(kindOf(lulu)).toBe("enchanteur");
    expect(kindOf(ahri)).toBe("squishy");
  });

  it("deux tanks font une compo tank, sinon un enchanteur compte, sinon squishy", () => {
    expect(compCategory([ornn, sejuani, ahri, jinx, lulu]).category).toBe("tank");
    expect(compCategory([ornn, ahri, jinx, lulu]).category).toBe("enchanteur");
    expect(compCategory([ahri, jinx]).category).toBe("squishy");
  });
});
