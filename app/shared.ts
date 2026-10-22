// Types échangés entre le processus principal et la fenêtre.

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
  poolGames?: number;
  busy?: string; // tâche en cours, affichée dans la barre d'état
  error?: string;
  draft?: DraftViewState;
  report?: { title: string; markdown: string };
}

export interface Api {
  analyseRecent(count: number): Promise<void>;
  onState(cb: (s: AppState) => void): void;
}
