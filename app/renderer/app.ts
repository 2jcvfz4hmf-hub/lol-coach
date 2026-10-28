import { marked } from "marked";
import type { Api, AppState, ChampionView, PlayerView } from "../shared.ts";

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

function player(p: PlayerView): string {
  const details = [p.rank, p.record].filter(Boolean).map((x) => escape(x!)).join(" · ");
  const badges = p.badges.map((b) => `<span class="badge">${escape(b)}</span>`).join("");
  const icon = p.champion.icon ? `<img src="${escape(p.champion.icon)}" alt="" />` : "";
  return `<li>${icon}<div><strong>${escape(p.champion.name)}${p.me ? " (toi)" : ""}</strong><small>${details}</small>${badges}</div></li>`;
}

/** Courbe de la note sur 10, minute par minute, avec un point par action (+ en vert, − en rouge). */
function curveSvg(curve: number[], marks: { t: number; points: number; text: string }[]): string {
  const w = 640;
  const h = 160;
  const pad = 24;
  const last = Math.max(1, curve.length - 1);
  const x = (minute: number) => pad + (minute / last) * (w - 2 * pad);
  const y = (score: number) => h - pad - (score / 10) * (h - 2 * pad);
  // Courbe en escalier : la note change au moment exact de chaque action.
  const clamp = (v: number) => Math.max(0, Math.min(10, v));
  let score = 5;
  let path = `M${x(0)},${y(score)}`;
  const dots: string[] = [];
  for (const m of [...marks].sort((a, b) => a.t - b.t)) {
    const minute = m.t / 60000;
    path += ` H${x(minute).toFixed(1)}`;
    score = clamp(score + m.points);
    path += ` V${y(score).toFixed(1)}`;
    const label = `${Math.floor(minute)}:${String(Math.floor((m.t / 1000) % 60)).padStart(2, "0")} ${m.points > 0 ? "+" : ""}${m.points} · ${m.text}`;
    dots.push(`<circle cx="${x(minute).toFixed(1)}" cy="${y(score).toFixed(1)}" r="4" class="${m.points > 0 ? "plus" : "minus"}"><title>${escape(label)}</title></circle>`);
  }
  // Le dernier point ajoute les stats de fin de partie (farm, vision...).
  path += ` H${x(last)} V${y(curve[last] ?? score)}`;
  const grid = [0, 5, 10]
    .map((v) => `<line x1="${pad}" x2="${w - pad}" y1="${y(v)}" y2="${y(v)}" class="grid" /><text x="4" y="${y(v) + 4}">${v}</text>`)
    .join("");
  const ticks = Array.from({ length: Math.floor(last / 5) + 1 }, (_, i) => i * 5)
    .map((m) => `<text x="${x(m)}" y="${h - 6}" text-anchor="middle">${m}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="curve" role="img" aria-label="Note minute par minute">${grid}${ticks}<path d="${path}" />${dots.join("")}</svg>`;
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

  $("lineup").hidden = !s.lineup;
  if (s.lineup) {
    $("lineup-allies").innerHTML = s.lineup.allies.map(player).join("");
    $("lineup-enemies").innerHTML = s.lineup.enemies.map(player).join("");
  }

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
    $("bans-block").hidden = d.bans.length === 0;
    $("bans").innerHTML = d.bans
      .map((b) => `<li><img src="${escape(b.icon)}" alt="" /><div><strong>${escape(b.name)}</strong><small>${escape(b.reason)}</small></div></li>`)
      .join("");
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
    $("curve").hidden = !s.report.curve;
    if (s.report.curve) $("curve").innerHTML = curveSvg(s.report.curve, s.report.marks ?? []);
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
