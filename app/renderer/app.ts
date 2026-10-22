import { marked } from "marked";
import type { Api, AppState, ChampionView } from "../shared.ts";

declare global {
  interface Window {
    coach: Api;
  }
}

const POSITION: Record<string, string> = {
  top: "Top",
  jungle: "Jungle",
  middle: "Mid",
  bottom: "ADC",
  utility: "Support",
};
const PHASE: Record<string, string> = {
  None: "Dans le client",
  Lobby: "Dans un salon",
  Matchmaking: "Recherche de partie",
  ReadyCheck: "Partie trouvée",
  ChampSelect: "Sélection des champions",
  GameStart: "Chargement de la partie",
  InProgress: "En partie",
  WaitingForStats: "Fin de partie",
  PreEndOfGame: "Fin de partie",
  EndOfGame: "Écran de fin",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function champ(c: ChampionView | null | undefined, extra = ""): string {
  if (!c || !c.name) return `<li class="empty">…${extra}</li>`;
  return `<li><img src="${escape(c.icon)}" alt="" /><span>${escape(c.name)}${extra}</span></li>`;
}

let lastReport = "";

function render(s: AppState) {
  const status = [
    s.client === "connecte" ? `${s.summoner ?? ""} · ${PHASE[s.phase] ?? s.phase}` : "Client LoL fermé",
    s.busy,
    s.error && `⚠️ ${s.error}`,
  ].filter(Boolean);
  $("status").textContent = status.join(" · ");

  let waiting = "";
  if (s.client === "absent") waiting = "Lance League of Legends : l'app se connecte toute seule au client.";
  else if (!s.draft) waiting = `Prêt. Lance une partie : les conseils s'afficheront pendant la sélection des champions.${s.poolGames ? ` (basés sur tes ${s.poolGames} dernières ranked)` : ""}`;
  $("waiting").hidden = !waiting;
  $("waiting-text").textContent = waiting;

  const d = s.draft;
  $("draft").hidden = !d;
  if (d) {
    $("allies").innerHTML = d.allies
      .map((a) => champ(a, `${a.position ? ` · ${POSITION[a.position] ?? a.position}` : ""}${a.me ? " (toi)" : ""}`))
      .join("");
    $("enemies").innerHTML = d.enemies.map((e) => champ(e)).join("");
    $("suggestions").innerHTML = d.suggestions.length
      ? d.suggestions
          .map(
            (x) =>
              `<li><img src="${escape(x.icon)}" alt="" /><div><strong>${escape(x.name)}</strong><small>${x.reasons.map(escape).join(" · ")}</small></div></li>`,
          )
          .join("")
      : `<li class="empty">Pas encore assez de parties récentes pour conseiller un pick à ce poste.</li>`;
    $("advice").innerHTML = d.advice.length
      ? d.advice.map((a) => `<li>${escape(a)}</li>`).join("")
      : `<li class="empty">Les conseils arrivent dès que l'adversaire a choisi ses champions.</li>`;
  }

  ($("analyse-recent") as HTMLButtonElement).disabled = s.client !== "connecte" || !!s.busy;
  if (s.report && s.report.markdown !== lastReport) {
    lastReport = s.report.markdown;
    $("report-title").textContent = s.report.title;
    $("report").innerHTML = marked.parse(s.report.markdown, { async: false });
  }
}

function init() {
  $("analyse-recent").addEventListener("click", () => void window.coach.analyseRecent(20));
  window.coach.onState(render);
}

init();
