import type { Timeline } from "../riot/types.ts";

// Ordre des sorts : les trois premiers points, puis l'ordre dans lequel Q, W et E sont montés au max.
// Clé compacte « QEW|QEW » : premiers points | priorité de montée.

const SLOT = ["", "Q", "W", "E", "R"];
const BASIC = ["Q", "W", "E"];

interface SkillEvent {
  type: "SKILL_LEVEL_UP";
  participantId: number;
  skillSlot: number;
  levelUpType?: string;
}

const isSkillUp = (e: { type: string }): e is SkillEvent & { timestamp: number } => e.type === "SKILL_LEVEL_UP";

/** Sorts montés par chaque joueur, dans l'ordre (« Q », « E », « W », « Q », « R »…). */
export function skillUps(timeline: Timeline): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const frame of timeline.info.frames) {
    for (const e of frame.events) {
      if (!isSkillUp(e) || (e.levelUpType && e.levelUpType !== "NORMAL")) continue;
      const slot = SLOT[e.skillSlot];
      if (!slot) continue;
      const list = out.get(e.participantId) ?? [];
      list.push(slot);
      out.set(e.participantId, list);
    }
  }
  return out;
}

/** « QEW|QEW », ou undefined si la partie est trop courte pour savoir. */
export function skillKey(ups: string[]): string | undefined {
  const basics = ups.filter((s) => s !== "R");
  if (basics.length < 9) return undefined;
  const first = basics.slice(0, 3).join("");
  const counts: Record<string, number> = { Q: 0, W: 0, E: 0 };
  const maxedAt: Record<string, number> = {};
  basics.forEach((s, i) => {
    counts[s]!++;
    if (counts[s] === 5) maxedAt[s] = i;
  });
  const order = [...BASIC].sort((a, b) => (maxedAt[a] ?? 99) - (maxedAt[b] ?? 99) || counts[b]! - counts[a]!);
  return `${first}|${order.join("")}`;
}

/** Les 18 niveaux d'après une clé : R aux niveaux 6, 11 et 16, puis les sorts dans l'ordre de priorité. */
export function skillSequence(key: string): string[] {
  const [first = "", order = "QWE"] = key.split("|");
  const counts: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 };
  const levels: string[] = [];
  for (let lvl = 1; lvl <= 18; lvl++) {
    let s: string | undefined;
    if (lvl === 6 || lvl === 11 || lvl === 16) s = "R";
    else if (lvl <= 3) s = first[lvl - 1];
    // Un sort ne peut pas dépasser la moitié du niveau (arrondie au-dessus), ni le rang 5.
    s ??= [...order].find((x) => counts[x]! < Math.min(5, Math.ceil(lvl / 2)));
    s ??= [...order].find((x) => counts[x]! < 5) ?? "Q";
    counts[s]!++;
    levels.push(s);
  }
  return levels;
}
