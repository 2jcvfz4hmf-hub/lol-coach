import { marked } from "marked";
import type { Api, AppState, BuildView, ChampionPageView, ChampionView, MatchupView, PlayerView, ProfileView } from "../shared.ts";

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

/** Carte de la sélection des champions, avec l'image d'écran de chargement. */
function slot(c: ChampionView | null | undefined, label = "", me = false): string {
  const cls = `slot${!c?.name ? " empty" : ""}${me ? " me" : ""}`;
  const art = loadingUrl(c) ? `<img src="${escape(loadingUrl(c))}" alt="" />` : "";
  return `<li class="${cls}">${art}<div class="slot-text"><strong>${escape(c?.name || "?")}</strong><small>${escape(label)}</small></div></li>`;
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
    .map((v) => `<line x1="${pad}" x2="${w - pad}" y1="${y(v)}" y2="${y(v)}" class="${v === 5 ? "mid-line" : "grid"}" /><text x="4" y="${y(v) + 4}">${v}</text>`)
    .join("");
  const area = `${path} V${y(0)} H${x(0)} Z`;
  const defs = `<defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7aa9ff" stop-opacity="0.35" /><stop offset="1" stop-color="#7aa9ff" stop-opacity="0" /></linearGradient></defs>`;
  const ticks = Array.from({ length: Math.floor(last / 5) + 1 }, (_, i) => i * 5)
    .map((m) => `<text x="${x(m)}" y="${h - 6}" text-anchor="middle">${m}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="curve" role="img" aria-label="Note minute par minute">${defs}${grid}${ticks}<path d="${area}" class="area" /><path d="${path}" class="line" />${dots.join("")}</svg>`;
}

let lastReport = "";

function render(s: AppState) {
  const status = [
    s.client === "connecte" ? `${s.summoner ?? ""} · ${PHASE[s.phase] ?? s.phase}` : "Client LoL fermé",
    s.busy,
    s.error && `⚠️ ${s.error}`,
  ].filter(Boolean);
  $("status").textContent = status.join(" · ");
  $("client-dot").classList.toggle("on", s.client === "connecte");

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
      .map((a) => slot(a, `${a.me ? "Toi · " : ""}${POSITION[a.position] ?? a.position ?? ""}`, a.me))
      .join("");
    $("enemies").innerHTML = d.enemies.map((e) => slot(e, "Ennemi")).join("");
    const mine = d.allies.find((a) => a.me && a.name);
    setBackdrop(mine ?? d.suggestions[0]);
    $("suggestions").innerHTML = d.suggestions.length
      ? d.suggestions
          .map(
            (x, i) => `<li class="pick${i === 0 ? " first" : ""}">${splash(x, "art")}
              <span class="rank-no">${i + 1}</span>
              ${x.expected !== undefined ? `<span class="chance${x.expected < 0.5 ? " low" : ""}">${fmtPct(x.expected)} de victoire</span>` : ""}
              ${i === 0 ? `<span class="crown">Meilleur pick</span>` : ""}
              <strong>${escape(x.name)}</strong>
              <ul>${x.reasons.slice(0, i === 0 ? 4 : 2).map((r) => `<li>${escape(r)}</li>`).join("")}</ul></li>`,
          )
          .join("")
      : `<li class="pick empty">Pas encore assez de parties récentes pour conseiller un pick à ce poste.</li>`;
    $("suggestions-source").textContent =
      d.source === "serveur" ? "· d'après les ranked du serveur" : "· d'après tes parties (la récolte du serveur n'a pas encore assez de parties)";
    $("bans-block").hidden = d.bans.length === 0;
    $("bans").innerHTML = d.bans
      .map((b) => `<li><span class="ban-icon"><img src="${escape(b.icon)}" alt="" /></span><div><strong>${escape(b.name)}</strong><small>${escape(b.reason)}</small></div></li>`)
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

function renderGlobal(s: AppState) {
  const g = s.global;
  const count = g.games.toLocaleString("fr-FR");
  let text: string;
  if (g.games === 0) text = "Pas encore de stats du serveur : elles arriveront après la première récolte de GitHub. En attendant, les conseils viennent de tes parties.";
  else if (g.games < 1000) text = `${count} parties Émeraude+ récoltées (patch ${g.patch}). Les conseils du serveur s'activent à partir de 1 000 parties.`;
  else text = `${count} parties Émeraude+ (patch ${g.patch}), mises à jour chaque jour. Les conseils de draft et de build utilisent ces stats.`;
  $("global-text").textContent = g.error ? `${text} ⚠️ ${g.error}` : text;
}

// --- Onglets ---

type Tab = "partie" | "profil" | "tierlist" | "champions" | "recherche";
let currentTab: Tab = "partie";
let lastPhase = "";

function showTab(tab: Tab) {
  currentTab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs .tab")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const p of document.querySelectorAll<HTMLElement>(".page")) p.hidden = p.id !== `page-${tab}`;
  if (tab === "profil" && !profileLoaded) void loadMyProfile();
  if (tab === "tierlist") void loadTierList(tierRole);
  if (tab === "champions") void loadChampionGrid();
}

/** Pendant la sélection et la partie, on affiche l'onglet Partie. */
function followPhase(phase: string) {
  if (phase === lastPhase) return;
  lastPhase = phase;
  if (["ChampSelect", "GameStart", "InProgress"].includes(phase) && currentTab !== "partie") showTab("partie");
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const fmtScore = (x: number) => x.toFixed(1).replace(".", ",");
const scoreClass = (x: number) => (x >= 7 ? "s-good" : x >= 5 ? "s-mid" : "s-bad");
/** Note sur 10 dans un anneau qui se remplit. */
const scoreRing = (x: number | undefined, size = "", label = "") =>
  x === undefined
    ? `<div class="score ${size}">–</div>`
    : `<div class="score ${size} ${scoreClass(x)}" data-p="${Math.round(x * 10)}" title="${label || "note sur 10"}">${fmtScore(x)}</div>`;
/** Images du champion sur Data Dragon, retrouvées à partir de son icône. */
const ART = "https://ddragon.leagueoflegends.com/cdn/img/champion";
const artKey = (c: ChampionView | null | undefined) => c?.icon.match(/\/champion\/([^/.]+)\.png$/)?.[1];
const splashUrl = (c: ChampionView | null | undefined) => (artKey(c) ? `${ART}/splash/${artKey(c)}_0.jpg` : "");
const loadingUrl = (c: ChampionView | null | undefined) => (artKey(c) ? `${ART}/loading/${artKey(c)}_0.jpg` : "");
const splash = (c: ChampionView | undefined, cls = "hero-bg") => (splashUrl(c) ? `<img class="${cls}" src="${escape(splashUrl(c))}" alt="" />` : "");

/** Fond de l'appli : le champion du moment (ton pick, ou ton champion le plus joué). */
let backdropKey = "";
function setBackdrop(c: ChampionView | null | undefined) {
  const url = splashUrl(c);
  if (!url || url === backdropKey) return;
  backdropKey = url;
  const img = $<HTMLImageElement>("backdrop-art");
  img.src = url;
  img.hidden = false;
}
const loading = (text: string) => `<section class="card"><p class="hint">${text}</p><div class="skeleton"></div><div class="skeleton short"></div></section>`;
const icon = (c: ChampionView, cls = "") => (c.icon ? `<img src="${escape(c.icon)}" alt="" class="${cls}" />` : "");
const ROLE_FR: Record<string, string> = { TOP: "Top", JUNGLE: "Jungle", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };

function since(date: number): string {
  const h = (Date.now() - date) / 3600_000;
  if (h < 1) return "il y a moins d'1 h";
  if (h < 24) return `il y a ${Math.round(h)} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

// --- Profil (le tien ou celui d'un autre joueur) ---

let profileLoaded = false;

async function loadMyProfile() {
  profileLoaded = true;
  await loadProfile($("profil-me"));
}

async function loadProfile(container: HTMLElement, riotId?: string) {
  container.innerHTML = loading("Chargement des dernières parties…");
  const p = await window.coach.profile(riotId);
  if ("error" in p) {
    container.innerHTML = `<section class="card"><p class="error">${escape(p.error)}</p></section>`;
    if (!riotId) profileLoaded = false;
    return;
  }
  renderProfile(container, p);
}

function renderProfile(container: HTMLElement, p: ProfileView) {
  const wins = p.games.filter((g) => g.win).length;
  const losses = p.games.length - wins;
  const main = p.champions[0]?.champion ?? p.games[0]?.champion;
  if (container.id === "profil-me") setBackdrop(main);
  const head = `
    <section class="hero">
      ${splash(main)}
      <div class="hero-id">
        ${main ? `<div class="portrait">${icon(main)}</div>` : ""}
        <div>
          <div class="profile-name">${escape(p.name)}</div>
          <div class="rank"><span class="crest">${escape((p.rank ?? "?").charAt(0))}</span>${escape(p.rank ?? "Non classé")}${p.record ? `<span class="muted">· ${escape(p.record)}</span>` : ""}</div>
          <div>${p.badges.map((b) => `<span class="badge">${escape(b)}</span>`).join("")}</div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="stat"><strong>${wins}V ${losses}D</strong>
          <div class="winbar"><span data-w="${p.games.length ? (wins / p.games.length) * 100 : 0}"></span></div>
          <small>${p.games.length} dernières parties</small></div>
        ${p.avgScore !== undefined ? `<div class="stat">${scoreRing(p.avgScore, "big")}<small>note moyenne</small></div>` : ""}
        <button class="ghost refresh">Actualiser</button>
      </div>
    </section>`;
  const games = p.games
    .map(
      (g) => `
      <li class="game ${g.win ? "win" : "loss"}" data-match="${escape(g.matchId)}">
        ${splash(g.champion, "strip")}
        ${icon(g.champion, "champ")}
        <div class="game-main">
          <strong>${g.win ? "Victoire" : "Défaite"} <span class="champ-name">· ${escape(g.champion.name)}</span></strong>
          <small>${escape(g.queue)} · ${escape(ROLE_FR[g.position] ?? "")} · ${Math.round(g.durationMin)} min · ${since(g.date)}</small>
        </div>
        <div class="game-kda"><strong>${escape(g.kda)}</strong><small>${g.cs} CS · ${(g.cs / Math.max(1, g.durationMin)).toFixed(1).replace(".", ",")}/min</small></div>
        <div class="game-vs">${g.opponent ? `<small>contre</small>${icon(g.opponent, "mini")}` : ""}</div>
        ${scoreRing(g.score)}
      </li>`,
    )
    .join("");
  const champs = p.champions
    .map(
      (c) => `<tr><td class="champ-cell">${icon(c.champion, "mini")}${escape(c.champion.name)}</td><td>${c.games}</td>
        <td class="${c.wins / c.games >= 0.5 ? "good" : "bad"}">${fmtPct(c.wins / c.games)}</td><td>${c.kda.toFixed(2).replace(".", ",")}</td>
        <td>${scoreRing(c.avgScore, "small")}</td></tr>`,
    )
    .join("");
  container.innerHTML = `${head}
    <div class="profile-grid">
      <section class="card"><h2>Dernières parties</h2><ul class="games">${games || `<li class="empty">Aucune partie récente.</li>`}</ul></section>
      <section class="card flush"><h2 class="pad">Champions</h2>
        <table class="table"><thead><tr><th>Champion</th><th>Parties</th><th>Victoires</th><th>KDA</th><th>Note</th></tr></thead><tbody>${champs}</tbody></table>
      </section>
    </div>
    <section class="card detail" hidden></section>`;

  const detail = container.querySelector<HTMLElement>(".detail")!;
  for (const li of container.querySelectorAll<HTMLElement>("li.game")) {
    li.addEventListener("click", async () => {
      for (const x of container.querySelectorAll("li.game")) x.classList.toggle("selected", x === li);
      const d = await window.coach.gameDetail(p.puuid, li.dataset.match!);
      detail.hidden = false;
      detail.innerHTML =
        "error" in d
          ? `<p class="error">${escape(d.error)}</p>`
          : `<div class="detail-head"><h2>${escape(d.title)}</h2></div>${d.curve ? `<div id="curve">${curveSvg(d.curve, d.marks ?? [])}</div>` : ""}<article class="report">${marked.parse(d.markdown, { async: false })}</article>`;
      detail.scrollIntoView({ behavior: "smooth" });
    });
  }
  container.querySelector(".refresh")?.addEventListener("click", () => void loadProfile(container, p.name === state?.summoner ? undefined : p.name));
}

// --- Tier list ---

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
let tierRole = "JUNGLE";

async function loadTierList(role: string) {
  tierRole = role;
  $("tier-roles").innerHTML = ROLES.map((r) => `<button class="role ${r === role ? "active" : ""}" data-role="${r}">${ROLE_FR[r]}</button>`).join("");
  for (const b of $("tier-roles").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => void loadTierList(b.dataset.role!));
  const rows = await window.coach.tierList(role);
  $("tier-patch").textContent = `Ranked solo/duo · Émeraude et plus${state?.global.patch ? ` · patch ${state.global.patch}` : ""}`;
  $("tier-empty").hidden = rows.length > 0;
  $("tier-empty").textContent = "Pas encore de stats du serveur : elles arrivent après la première récolte de GitHub.";
  // Un bandeau par tier, du meilleur au moins bon.
  $("tier-bands").innerHTML = ["S", "A", "B", "C", "D"]
    .map((t) => {
      const champs = rows.filter((r) => r.tier === t);
      if (!champs.length) return "";
      const tiles = champs
        .map(
          (r) => `<button class="tier-champ" data-id="${r.champion.id}" title="${escape(r.champion.name)} · ${r.games.toLocaleString("fr-FR")} parties">
            ${icon(r.champion)}<span>${escape(r.champion.name)}</span>
            <small class="${r.winrate >= 0.5 ? "good" : "bad"}">${fmtPct(r.winrate)}</small><em>pick ${fmtPct(r.pickrate)}</em></button>`,
        )
        .join("");
      return `<section class="band t-${t}"><div class="band-letter">${t}</div><div class="band-champs">${tiles}</div></section>`;
    })
    .join("");
  for (const b of $("tier-bands").querySelectorAll<HTMLElement>(".tier-champ")) {
    b.addEventListener("click", () => {
      showTab("champions");
      void openChampion(Number(b.dataset.id), role);
    });
  }
}

// --- Champions ---

let championList: (ChampionView & { id: number })[] = [];

async function loadChampionGrid() {
  if (!championList.length) championList = await window.coach.champions();
  const filter = $<HTMLInputElement>("champ-filter").value.trim().toLowerCase();
  $("champ-grid").innerHTML = championList
    .filter((c) => !filter || c.name.toLowerCase().includes(filter))
    .map((c) => `<button class="champ-tile" data-id="${c.id}" title="${escape(c.name)}"><img src="${escape(loadingUrl(c))}" alt="" loading="lazy" /><small>${escape(c.name)}</small></button>`)
    .join("");
  for (const b of $("champ-grid").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => void openChampion(Number(b.dataset.id)));
}

function matchupList(title: string, rows: MatchupView[], hint: string): string {
  const items = rows
    .map(
      (m) => `<li class="clickable" data-id="${m.champion.id}">${icon(m.champion, "mini")}<span>${escape(m.champion.name)}</span>
        <span class="${m.delta >= 0 ? "good" : "bad"}">${fmtPct(m.winrate)}</span><small>${m.games} parties</small></li>`,
    )
    .join("");
  return `<section class="card"><h2>${title}</h2><p class="hint">${hint}</p><ul class="matchups">${items || `<li class="empty">Pas assez de parties.</li>`}</ul></section>`;
}

const AGAINST_FR: Record<string, string> = { AD: "Contre une compo AD", AP: "Contre une compo AP", mixte: "Contre une compo mixte" };

function buildCard(title: string, b: BuildView): string {
  const items = [b.keystone, ...b.items]
    .filter((x) => !!x)
    .map((x) => `<li><img src="${escape(x.icon)}" alt="" /><div><strong>${escape(x.name)}</strong><small>${escape(x.note)}</small></div></li>`)
    .join("");
  return `<section class="card"><h2>${title}</h2><ul class="build">${items}</ul></section>`;
}

async function openChampion(id: number, position?: string) {
  const box = $("champ-detail");
  box.innerHTML = loading("Chargement…");
  const d = await window.coach.champion(id, position);
  if ("error" in d) {
    box.innerHTML = `<section class="card"><p class="error">${escape(d.error)}</p></section>`;
    return;
  }
  renderChampion(d);
  setBackdrop(d.champion);
  box.scrollIntoView({ behavior: "smooth" });
}

function renderChampion(d: ChampionPageView) {
  const box = $("champ-detail");
  const roles = d.positions
    .map((p) => `<button class="role ${p.position === d.position ? "active" : ""}" data-role="${p.position}">${ROLE_FR[p.position] ?? p.position} · ${fmtPct(p.winrate)}</button>`)
    .join("");
  box.innerHTML = `
    <section class="hero">
      ${splash(d.champion)}
      <div class="hero-id">
      <div class="portrait">${icon(d.champion)}</div>
      <div>
        <p class="eyebrow">${d.position ? escape(ROLE_FR[d.position] ?? d.position) : "Champion"}</p>
        <div class="profile-name">${escape(d.champion.name)}</div>
        <div class="rank">${d.games ? `${fmtPct(d.winrate)} de victoires ${d.position ? `en ${escape(ROLE_FR[d.position] ?? d.position)}` : ""} sur ${d.games.toLocaleString("fr-FR")} parties` : "Pas assez de parties."}</div>
        <div class="roles">${roles}</div>
      </div>
      </div>
    </section>
    <div class="three">
      ${matchupList("Bons matchups", d.bestMatchups, "Adversaires de lane qu'il bat le plus.")}
      ${matchupList("Counters", d.worstMatchups, "Adversaires de lane qui le battent.")}
      ${matchupList("Meilleurs duos", d.synergies, "Alliés avec qui il gagne le plus.")}
    </div>
    <div class="three">${d.builds.map((b) => buildCard(AGAINST_FR[b.against] ?? b.against, b.build)).join("") || `<section class="card"><p class="hint">Pas assez de parties pour les builds.</p></section>`}</div>`;
  for (const b of box.querySelectorAll<HTMLButtonElement>(".roles button")) b.addEventListener("click", () => void openChampion(d.champion.id, b.dataset.role));
  for (const li of box.querySelectorAll<HTMLElement>("li.clickable")) li.addEventListener("click", () => void openChampion(Number(li.dataset.id)));
}

let state: AppState | undefined;

/** La page interdit les styles écrits dans le HTML : largeurs des barres et remplissage des notes posés ici. */
function applyDataStyles(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) el.style.width = `${el.dataset.w}%`;
  for (const el of root.querySelectorAll<HTMLElement>("[data-p]")) el.style.setProperty("--p", el.dataset.p!);
}

function init() {
  new MutationObserver(() => applyDataStyles(document)).observe(document.body, { childList: true, subtree: true });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs .tab")) b.addEventListener("click", () => showTab(b.dataset.tab as Tab));
  $("champ-filter").addEventListener("input", () => void loadChampionGrid());
  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $<HTMLInputElement>("search-input").value.trim();
    if (q) void loadProfile($("profil-search"), q);
  });
  $("analyse-recent").addEventListener("click", () => void window.coach.analyseRecent(20));
  window.coach.onState((s) => {
    state = s;
    render(s);
    followPhase(s.phase);
  });
}

init();
