import { describe, expect, it } from "vitest";
import { parseRunes } from "../src/data/ddragon.ts";
import { emptyStats, pageKey } from "../src/global/stats.ts";
import type { Participant } from "../src/riot/types.ts";
import { runePage } from "../src/views/champion.ts";

const perks = {
  styles: [
    { style: 8000, selections: [{ perk: 8010 }, { perk: 9111 }, { perk: 9104 }, { perk: 8299 }] },
    { style: 8400, selections: [{ perk: 8446 }, { perk: 8451 }] },
  ],
  statPerks: { offense: 5008, flex: 5008, defense: 5011 },
};

describe("pages de runes", () => {
  it("résume la page d'un joueur", () => {
    expect(pageKey({ perks } as Participant)).toBe("8000:8010,9111,9104,8299|8400:8446,8451|5008,5008,5011");
    expect(pageKey({} as Participant)).toBeUndefined();
  });

  it("choisit la page la plus jouée, avec assez de parties", () => {
    const stats = emptyStats("16.21");
    stats.pages = { 266: { "8000:8010,9111,9104,8299|8400:8446,8451|5008,5008,5011": { g: 30, w: 17 }, "8100:8112,8139,8138,8135|8300:8304,8347|": { g: 10, w: 6 } } };
    const p = runePage(stats, 266)!;
    expect(p.primary).toBe(8000);
    expect(p.primaryRunes).toEqual([8010, 9111, 9104, 8299]);
    expect(p.secondary).toBe(8400);
    expect(p.secondaryRunes).toEqual([8446, 8451]);
    expect(p.shards).toEqual([5008, 5008, 5011]);
    expect(p.pick).toBeCloseTo(0.75);
    stats.pages[266] = { "8000:8010,9111,9104,8299|8400:8446,8451|": { g: 5, w: 3 } };
    expect(runePage(stats, 266)).toBeUndefined();
  });

  it("garde les arbres de runes", () => {
    const runes = parseRunes([{ id: 8000, name: "Précision", icon: "p.png", slots: [{ runes: [{ id: 8010, name: "Conquérant", icon: "c.png" }] }] }]);
    expect(runes.get(8000)).toMatchObject({ name: "Précision", tree: 8000 });
    expect(runes.get(8010)).toMatchObject({ keystone: true, tree: 8000 });
  });
});
