import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyStats, type GlobalStats } from "./stats.ts";

// Les stats du patch en cours, celles du patch précédent (utilisées tant que le
// nouveau patch n'a pas assez de parties) et la liste des parties déjà comptées.

const MIN_GAMES = 3000;

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export class StatsStore {
  current: GlobalStats | undefined;
  previous: GlobalStats | undefined;
  seen = new Set<string>();
  private unsavedSeen: string[] = [];

  /** suffix : « -bas » pour les rangs Fer à Platine (stats-bas.json, stats-precedent-bas.json, vues-bas.txt). */
  constructor(
    private dir: string,
    private suffix = "",
  ) {}

  private file(name: string) {
    const dot = name.indexOf(".");
    return path.join(this.dir, `${name.slice(0, dot)}${this.suffix}${name.slice(dot)}`);
  }

  async load(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    this.current = await readJson(this.file("stats.json"));
    this.previous = await readJson(this.file("stats-precedent.json"));
    try {
      const text = await readFile(this.file("vues.txt"), "utf8");
      this.seen = new Set(text.split("\n").filter(Boolean));
    } catch {
      this.seen = new Set();
    }
    return this;
  }

  /** Les stats les plus fiables disponibles. */
  best(): GlobalStats | undefined {
    const c = this.current;
    if (c && c.games >= MIN_GAMES) return c;
    if (this.previous && this.previous.games > (c?.games ?? 0)) return this.previous;
    return c;
  }

  markSeen(id: string) {
    this.seen.add(id);
    this.unsavedSeen.push(id);
  }

  /** Nouveau patch : on archive les stats actuelles et on repart de zéro. */
  async startPatch(patch: string) {
    if (this.current && this.current.games > 0) {
      await this.save();
      await rename(this.file("stats.json"), this.file("stats-precedent.json"));
      this.previous = this.current;
    }
    this.current = emptyStats(patch);
    this.seen.clear();
    this.unsavedSeen = [];
    await rm(this.file("vues.txt"), { force: true });
    await this.save();
  }

  async save() {
    if (!this.current) return;
    const tmp = this.file("stats.json.tmp");
    await writeFile(tmp, JSON.stringify(this.current));
    await rename(tmp, this.file("stats.json"));
    if (this.unsavedSeen.length) {
      await appendFile(this.file("vues.txt"), this.unsavedSeen.join("\n") + "\n");
      this.unsavedSeen = [];
    }
  }
}
