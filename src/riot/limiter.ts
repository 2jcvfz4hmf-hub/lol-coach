// Respecte les limites de requêtes de Riot (clé de développement ou Personal :
// 20 requêtes par seconde et 100 toutes les 2 minutes) en attendant avant d'envoyer.

export interface Window {
  max: number;
  ms: number;
}

export const PERSONAL_KEY_LIMITS: Window[] = [
  { max: 20, ms: 1_000 },
  { max: 100, ms: 120_000 },
];

export class RateLimiter {
  private sent: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private windows: Window[],
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Résout quand une requête peut partir. Les appels sont servis dans l'ordre. */
  take(): Promise<void> {
    const turn = this.chain.then(() => this.wait());
    this.chain = turn;
    return turn;
  }

  private async wait(): Promise<void> {
    for (;;) {
      const t = this.now();
      const longest = Math.max(...this.windows.map((w) => w.ms));
      this.sent = this.sent.filter((s) => s > t - longest);
      let delay = 0;
      for (const w of this.windows) {
        const inWindow = this.sent.filter((s) => s > t - w.ms);
        if (inWindow.length >= w.max) delay = Math.max(delay, inWindow[inWindow.length - w.max]! + w.ms - t);
      }
      if (delay <= 0) {
        this.sent.push(t);
        return;
      }
      await this.sleep(delay + 5);
    }
  }
}
