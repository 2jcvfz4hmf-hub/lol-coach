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

  $("scout").hidden = !s.scout;
  if (s.scout) {
    $("scout-title").textContent = s.scout.title;
    $("scout-lines").innerHTML = s.scout.lines.map((l) => `<li>${escape(l)}</li>`).join("");
  }

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
    $("suggestions-source").textContent =
      d.source === "serveur" ? "· d'après les ranked du serveur" : "· d'après tes parties (la récolte du serveur n'a pas encore assez de parties)";
    $("build").hidden = !d.build;
    if (d.build) {
      $("build-summary").textContent = d.build.summary;
      $("build-items").innerHTML = [d.build.keystone, ...d.build.items]
        .filter((x) => !!x)
        .map((x) => `<li><img src="${escape(x.icon)}" alt="" /><div><strong>${escape(x.name)}</strong><small>${escape(x.note)}</small></div></li>`)
        .join("");
    }
    $("advice").innerHTML = d.advice.length
      ? d.advice.map((a) => `<li>${escape(a)}</li>`).join("")
      : `<li class="empty">Les conseils arrivent dès que l'adversaire a choisi ses champions.</li>`;
  }

  renderGlobal(s);

  ($("analyse-recent") as HTMLButtonElement).disabled = s.client !== "connecte" || !!s.busy;
  if (s.report && s.report.markdown !== lastReport) {
    lastReport = s.report.markdown;
    $("report-title").textContent = s.report.title;
    $("report").innerHTML = marked.parse(s.report.markdown, { async: false });
  }
}

let editingKey = false;

function renderGlobal(s: AppState) {
  const g = s.global;
  const showForm = !g.hasKey || editingKey || !!g.error;
  $("global-nokey").hidden = !showForm;
  $("global-status").hidden = showForm;
  if (g.error) {
    $("key-error").hidden = false;
    $("key-error").textContent = g.error;
  }
  const count = g.games.toLocaleString("fr-FR");
  const patch = g.patch ? ` (patch ${g.patch})` : "";
  const state = g.paused ? "En pause pendant ta partie." : g.running ? "Récolte en cours, laisse l'app ouverte." : "Récolte arrêtée.";
  const ready =
    g.games >= 1000 ? "Les conseils de draft et de build utilisent ces stats." : "Les conseils du serveur s'activent à partir de 1 000 parties.";
  $("global-text").textContent = `${count} parties récoltées${patch}. ${state} ${ready}`;
}

function init() {
  $("key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("key");
    void window.coach.setKey(input.value).then((error) => {
      $("key-error").hidden = !error;
      $("key-error").textContent = error ?? "";
      if (!error) {
        input.value = "";
        editingKey = false;
      }
    });
  });
  $("change-key").addEventListener("click", () => {
    editingKey = true;
    $("global-nokey").hidden = false;
    $("global-status").hidden = true;
  });
  $("analyse-recent").addEventListener("click", () => void window.coach.analyseRecent(20));
  window.coach.onState(render);
}

init();
