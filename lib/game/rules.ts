import { REGIONS, REGION_BY_ID } from "./config";
import type { RoomPublic } from "./types";

type Owners = RoomPublic["owners"];

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * Random start regions for `count` players, as far apart as possible: two players end up on
 * opposite sides of the continent. Only the biggest (4-point) regions are used so nobody starts
 * ahead; when there are more players than 4-pointers the rest get 3-point regions. Every call picks
 * one of the well-spread layouts at random and hands the regions out in random order.
 */
export function pickStartRegions(count: number, rng: () => number = Math.random): string[] {
  const top = REGIONS.filter((r) => r.points === 4);
  const next = REGIONS.filter((r) => r.points === 3);
  const fromTop = Math.min(count, top.length);
  const layouts = combinations(top, fromTop).flatMap((a) =>
    combinations(next, count - fromTop).map((b) => [...a, ...b]),
  );
  const spread = (set: typeof top) => {
    let min = Infinity;
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        min = Math.min(min, Math.hypot(set[i].label[0] - set[j].label[0], set[i].label[1] - set[j].label[1]));
      }
    }
    return min;
  };
  const scored = layouts.map((set) => ({ set, score: spread(set) }));
  const best = Math.max(...scored.map((s) => s.score));
  const good = scored.filter((s) => s.score >= best * 0.7);
  const chosen = good[Math.floor(rng() * good.length)].set.map((r) => r.id);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  return chosen;
}

/** Regions owned by a player. */
export function ownedBy(owners: Owners, uid: string): string[] {
  return Object.entries(owners)
    .filter(([, o]) => o === uid)
    .map(([r]) => r);
}

/**
 * Regions a player may attack: every region (free or held by someone else)
 * that touches their territory. A player with no territory left is out and picks nothing.
 */
export function attackableRegions(owners: Owners, uid: string): string[] {
  const mine = ownedBy(owners, uid);
  if (mine.length === 0) return [];
  return REGIONS.filter((r) => owners[r.id] !== uid && r.neighbours.some((n) => owners[n] === uid)).map((r) => r.id);
}

/** What the player can pick right now (normal attack, or the revenge strike in the counter stage). */
export function pickableRegions(room: Pick<RoomPublic, "owners" | "stage" | "counters">, uid: string): string[] {
  if (room.stage === "counter") return room.counters[uid]?.regions ?? [];
  return attackableRegions(room.owners, uid);
}

export function territoryCount(owners: Owners, uid: string): number {
  return ownedBy(owners, uid).length;
}

/** The player who owns every region, if any. */
export function soleOwner(owners: Owners): string | null {
  const first = owners[REGIONS[0].id];
  return first && REGIONS.every((r) => owners[r.id] === first) ? first : null;
}

/** Total points of a player's territory (each region has its own weight). */
export function scoreOf(owners: Owners, uid: string): number {
  return ownedBy(owners, uid).reduce((sum, id) => sum + (REGION_BY_ID[id]?.points ?? 0), 0);
}

/** Ranking: most points first, then most regions. */
export function rankPlayers(room: Pick<RoomPublic, "owners" | "players">) {
  return Object.values(room.players).sort(
    (a, b) =>
      scoreOf(room.owners, b.uid) - scoreOf(room.owners, a.uid) ||
      territoryCount(room.owners, b.uid) - territoryCount(room.owners, a.uid),
  );
}

/** Revenge strikes unlocked by failed attacks: defender -> regions of the attackers touching the defender's land. */
export function buildCounters(owners: Owners, fails: { attacker: string; defender: string }[]): RoomPublic["counters"] {
  const counters: RoomPublic["counters"] = {};
  for (const { attacker, defender } of fails) {
    const regions = REGIONS.filter(
      (r) => owners[r.id] === attacker && r.neighbours.some((n) => owners[n] === defender),
    ).map((r) => r.id);
    if (!regions.length) continue;
    const c = (counters[defender] ??= { against: [], regions: [] });
    if (!c.against.includes(attacker)) c.against.push(attacker);
    for (const r of regions) if (!c.regions.includes(r)) c.regions.push(r);
  }
  return counters;
}
