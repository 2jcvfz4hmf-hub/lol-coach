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
  bans: (ChampionView & { reason: string })[];
  /** Les conseils viennent des stats de tout le serveur, ou seulement de tes parties. */
  source: "serveur" | "perso";
}

export interface PlayerView {
  champion: ChampionView;
  name?: string;
  me: boolean;
  rank: string;
  record?: string;
  badges: string[];
}

export interface GlobalView {
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
  /** Les 10 joueurs de la partie, à l'écran de chargement. */
  lineup?: { allies: PlayerView[]; enemies: PlayerView[] };
  report?: {
    title: string;
    markdown: string;
    /** Note minute par minute de la dernière partie, avec chaque + et chaque −. */
    curve?: number[];
    marks?: { t: number; points: number; text: string }[];
  };
}

export interface Api {
  analyseRecent(count: number): Promise<void>;
  onState(cb: (s: AppState) => void): void;
}
