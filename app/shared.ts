// Types échangés entre le processus principal et la fenêtre.

export interface Settings {
  apiKey?: string;
  /** Serveur forcé ; sinon on prend celui du client LoL. */
  platform?: string;
}

export interface ChampionView {
  name: string;
  icon: string;
}

export interface SuggestionView extends ChampionView {
  wins: number;
  games: number;
  reasons: string[];
}

export interface DraftViewState {
  position: string;
  me?: ChampionView;
  allies: (ChampionView & { position: string; me: boolean })[];
  enemies: (ChampionView | null)[];
  suggestions: SuggestionView[];
  advice: string[];
}

export interface AppState {
  client: "absent" | "connecte";
  phase: string;
  summoner?: string;
  hasKey: boolean;
  poolGames?: number;
  busy?: string; // tâche en cours, affichée dans la barre d'état
  error?: string;
  draft?: DraftViewState;
  report?: { title: string; markdown: string };
}

export interface Api {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  analyseRecent(count: number): Promise<void>;
  onState(cb: (s: AppState) => void): void;
}
