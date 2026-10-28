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

export interface BuildItemView {
  name: string;
  icon: string;
  note: string;
}

export interface BuildView {
  summary: string;
  keystone?: BuildItemView;
  items: BuildItemView[];
}

export interface DraftViewState {
  position: string;
  me?: ChampionView;
  allies: (ChampionView & { position: string; me: boolean })[];
  enemies: (ChampionView | null)[];
  suggestions: SuggestionView[];
  advice: string[];
  build?: BuildView;
  /** Les conseils viennent des stats de tout le serveur, ou seulement de tes parties. */
  source: "serveur" | "perso";
}

export interface GlobalView {
  hasKey: boolean;
  running: boolean;
  paused: boolean; // en pause pendant tes parties
  games: number;
  patch?: string;
  error?: string;
}

export interface AppState {
  client: "absent" | "connecte";
  phase: string;
  summoner?: string;
  poolGames?: number;
  busy?: string; // tâche en cours, affichée dans la barre d'état
  error?: string;
  draft?: DraftViewState;
  global: GlobalView;
  /** Habitudes du jungler adverse, affichées dès l'écran de chargement. */
  scout?: { title: string; lines: string[] };
  report?: { title: string; markdown: string };
}

export interface Api {
  analyseRecent(count: number): Promise<void>;
  /** Enregistre la clé Riot et lance la récolte. Renvoie un message d'erreur si la clé est mal formée. */
  setKey(key: string): Promise<string | undefined>;
  onState(cb: (s: AppState) => void): void;
}
