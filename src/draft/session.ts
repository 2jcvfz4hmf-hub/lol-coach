import type { ChampionIndex, ChampionInfo } from "../data/ddragon.ts";
import type { ChampSelectSession } from "../lcu/types.ts";
import type { DraftState } from "./recommend.ts";

export interface DraftView {
  state: DraftState;
  myChampion?: ChampionInfo;
  /** Alliés et ennemis dans l'ordre des cases, undefined tant qu'ils n'ont rien choisi. */
  allySlots: { position: string; champion?: ChampionInfo; me: boolean }[];
  enemySlots: (ChampionInfo | undefined)[];
}

/** Transforme la session de sélection du client en état exploitable par les recommandations. */
export function draftFromSession(session: ChampSelectSession, champions: ChampionIndex): DraftView {
  const me = session.myTeam.find((p) => p.cellId === session.localPlayerCellId);
  const pick = (id: number) => (id ? champions.get(id) : undefined);

  const unavailable = new Set<number>();
  for (const group of session.actions) {
    for (const a of group) {
      if (a.completed && a.championId) unavailable.add(a.championId);
    }
  }
  for (const id of [...(session.bans?.myTeamBans ?? []), ...(session.bans?.theirTeamBans ?? [])]) {
    if (id) unavailable.add(id);
  }
  for (const p of [...session.myTeam, ...session.theirTeam]) {
    if (p.championId && p.cellId !== session.localPlayerCellId) unavailable.add(p.championId);
  }

  const allySlots = session.myTeam.map((p) => ({
    position: p.assignedPosition,
    // Le champion survolé par un allié compte déjà pour la compo.
    champion: pick(p.championId) ?? pick(p.championPickIntent),
    me: p.cellId === session.localPlayerCellId,
  }));
  const enemySlots = session.theirTeam.map((p) => pick(p.championId));

  return {
    state: {
      position: me?.assignedPosition ?? "",
      allies: allySlots.filter((s) => !s.me && s.champion).map((s) => s.champion!),
      enemies: enemySlots.filter((c): c is ChampionInfo => c !== undefined),
      unavailable,
    },
    myChampion: me ? pick(me.championId) ?? pick(me.championPickIntent) : undefined,
    allySlots,
    enemySlots,
  };
}
