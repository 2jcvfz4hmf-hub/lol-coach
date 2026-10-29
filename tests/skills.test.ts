import { describe, expect, it } from "vitest";
import { skillKey, skillSequence, skillUps } from "../src/global/skills.ts";
import type { Timeline } from "../src/riot/types.ts";

describe("ordre des sorts", () => {
  it("repère les trois premiers points et l'ordre de montée", () => {
    // Q E W, puis Q au max, puis E, puis W.
    const ups = ["Q", "E", "W", "Q", "Q", "R", "Q", "E", "Q", "E", "R", "E", "E", "W", "W", "R", "W", "W"];
    expect(skillKey(ups)).toBe("QEW|QEW");
    expect(skillKey(["Q", "W", "E"])).toBeUndefined();
  });

  it("reconstruit les 18 niveaux", () => {
    const levels = skillSequence("QEW|QEW");
    expect(levels.join("")).toBe("QEWQQRQEQEREEWWRWW");
    expect(levels.filter((s) => s === "R")).toHaveLength(3);
    expect(levels.filter((s) => s === "Q")).toHaveLength(5);
    expect(levels[5]).toBe("R");
    // Un sort ne dépasse jamais la moitié du niveau.
    const counts: Record<string, number> = {};
    levels.forEach((s, i) => {
      counts[s] = (counts[s] ?? 0) + 1;
      if (s !== "R") expect(counts[s]).toBeLessThanOrEqual(Math.ceil((i + 1) / 2));
    });
  });

  it("lit les montées de sorts dans la timeline", () => {
    const timeline = {
      info: {
        frames: [
          {
            events: [
              { type: "SKILL_LEVEL_UP", timestamp: 1, participantId: 2, skillSlot: 1, levelUpType: "NORMAL" },
              { type: "SKILL_LEVEL_UP", timestamp: 2, participantId: 2, skillSlot: 4, levelUpType: "EVOLVE" },
              { type: "SKILL_LEVEL_UP", timestamp: 3, participantId: 2, skillSlot: 3, levelUpType: "NORMAL" },
            ],
          },
        ],
      },
    } as unknown as Timeline;
    expect(skillUps(timeline).get(2)).toEqual(["Q", "E"]);
  });
});
