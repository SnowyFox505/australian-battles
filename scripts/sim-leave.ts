/**
 * Dev-only scripted check of leaving and resetting:
 * lobby leave (guest and host, host hand-over), rejoin, mid-pick leave (the others are not left
 * waiting), a leave that ends the game, host-only reset back to the lobby, closing an empty room.
 * Usage: npm run sim:leave   (needs `npm run dev:all`)
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { attackableRegions } from "../lib/game/rules";
import type { RoomPublic } from "../lib/game/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const db = getFirestore(initializeApp({ projectId: "demo-australian-battles" }));

async function signIn() {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken: string; localId: string };
  return { token: j.idToken, uid: j.localId };
}
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) process.exitCode = 1;
};

async function main() {
  const P = { H: await signIn(), A: await signIn(), B: await signIn() };
  type Who = keyof typeof P;
  const call = async (who: Who, path: string, body: unknown) => {
    const r = await fetch(`${BASE}/api/g/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${P[who].token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; error?: string; code?: string };
  };
  const read = async (code: string) => (await db.doc(`rooms/${code}`).get()).data() as RoomPublic | undefined;

  // --- Lobby ---
  const code = (await call("H", "room/create", { name: "Hal" })).code!;
  await call("A", "room/join", { code, name: "Ann" });
  await call("B", "room/join", { code, name: "Bob" });
  check(Object.keys((await read(code))!.players).length === 3, "3 players in the lobby");

  check((await call("B", "room/leave", { code })).ok, "guest B leaves the lobby");
  let room = (await read(code))!;
  check(!room.players[P.B.uid] && Object.keys(room.players).length === 2, "B's seat is gone");
  check((await call("B", "room/leave", { code })).ok, "leaving twice is harmless");
  check(!(await call("A", "room/reset", { code })).ok, "a guest cannot reset the room");

  check((await call("H", "room/leave", { code })).ok, "host H leaves the lobby");
  room = (await read(code))!;
  check(room.hostUid === P.A.uid && !room.players[P.H.uid], "host passed to A, H is gone");

  check((await call("H", "room/join", { code, name: "Hal" })).ok, "H can rejoin the lobby");
  check((await call("B", "room/join", { code, name: "Bob" })).ok, "B can rejoin the lobby");
  room = (await read(code))!;
  check(Object.keys(room.players).length === 3, "3 players again");

  // --- Game ---
  await call("A", "room/settings", { code, mode: "rounds", rounds: 3 });
  check((await call("A", "room/start", { code })).ok, "A (host) starts the game");
  room = (await read(code))!;
  const bRegion = Object.entries(room.owners).find(([, o]) => o === P.B.uid)![0];
  const step0 = room.step;

  for (const who of ["A", "H"] as const) {
    const target = attackableRegions(room.owners, P[who].uid)[0];
    await call(who, "room/pick", { code, regionId: target });
  }
  room = (await read(code))!;
  check(room.phase === "pick", "B has not picked yet, so the game still waits");

  check((await call("B", "room/leave", { code })).ok, "B leaves in the middle of the pick phase");
  room = (await read(code))!;
  const B = room.players[P.B.uid];
  check(!!B?.left && B.eliminated, "B is marked as left and eliminated");
  check(!room.owners[bRegion], "B's territory became free");
  check(room.phase === "question" && room.step > step0, "the others were not left waiting: game moved on to the questions");

  check(!(await call("H", "room/reset", { code })).ok, "a guest cannot end the game");

  check((await call("H", "room/leave", { code })).ok, "H leaves too");
  room = (await read(code))!;
  check(room.phase === "finished" && room.winners.length === 1 && room.winners[0] === P.A.uid, "only A is left: game over, A wins");

  // --- Reset ---
  check((await call("A", "room/reset", { code })).ok, "host A returns to the lobby");
  room = (await read(code))!;
  check(room.phase === "lobby" && room.round === 0 && Object.keys(room.owners).length === 0, "lobby is clean (no owners, round 0)");
  check(Object.keys(room.players).length === 1 && !!room.players[P.A.uid] && !room.players[P.A.uid].left, "players who left are removed, A stays");
  check(room.rounds === 3, "game settings are kept");
  check((await call("A", "room/reset", { code })).ok, "resetting a lobby is harmless");

  // --- Closing ---
  check((await call("A", "room/leave", { code })).ok, "the last player leaves");
  check(!(await read(code)), "the empty room is closed");
  check((await call("A", "room/leave", { code })).ok, "leaving a closed room is harmless");

  // --- Seats ---
  const host = await signIn();
  const guests = await Promise.all([1, 2, 3, 4, 5].map(() => signIn()));
  const raw = async (who: { token: string }, path: string, body: unknown) =>
    (await (
      await fetch(`${BASE}/api/g/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${who.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as { ok: boolean; error?: string; code?: string };
  const c2 = (await raw(host, "room/create", { name: "Hostess" })).code!;
  check(((await read(c2))!.slots ?? 0) === 4, "a new room has 4 seats");
  for (let i = 0; i < 3; i++) await raw(guests[i], "room/join", { code: c2, name: `G${i}` });
  check(!(await raw(guests[3], "room/join", { code: c2, name: "G3" })).ok, "the 5th player is turned away with 4 seats");
  check(!(await raw(guests[0], "room/settings", { code: c2, mode: "rounds", rounds: 5, slots: 6 })).ok, "a guest cannot add seats");
  await raw(host, "room/settings", { code: c2, mode: "rounds", rounds: 5, slots: 6 });
  check((await read(c2))!.slots === 6, "host opens 6 seats");
  await raw(host, "room/settings", { code: c2, mode: "rounds", rounds: 5, slots: 99 });
  check((await read(c2))!.slots === 6, "seats are capped at 6");
  check((await raw(guests[3], "room/join", { code: c2, name: "G3" })).ok && (await raw(guests[4], "room/join", { code: c2, name: "G4" })).ok, "5th and 6th player can join");
  await raw(host, "room/settings", { code: c2, mode: "rounds", rounds: 5, slots: 1 });
  check((await read(c2))!.slots === 6, "seats never drop below a taken seat");
  // Colours
  const colorsNow = Object.values((await read(c2))!.players).map((p) => p.color);
  check(new Set(colorsNow).size === 6, "every player starts with a different colour");
  const race = await Promise.all([raw(guests[0], "room/color", { code: c2, color: 9 }), raw(guests[1], "room/color", { code: c2, color: 9 })]);
  check(race.filter((r) => r.ok).length === 1, "two players grabbing the same colour at once: exactly one gets it");
  const after = Object.values((await read(c2))!.players).map((p) => p.color);
  check(after.filter((c) => c === 9).length === 1, "the room never holds the same colour twice");
  check(!(await raw(guests[2], "room/color", { code: c2, color: 0 })).ok, "a taken colour cannot be picked");
  check(!(await raw(guests[2], "room/color", { code: c2, color: 99 })).ok, "an unknown colour is refused");
  check((await raw(host, "room/color", { code: c2, color: 7 })).ok, "a free colour can be picked");

  check((await raw(host, "room/start", { code: c2 })).ok, "6 players can start");
  check((await raw(guests[2], "room/color", { code: c2, color: 8 })).ok === false, "colours are locked once the game started");
  const r6 = (await read(c2))!;
  check(new Set(Object.keys(r6.owners)).size === 6, "every player gets their own start region");

  process.exit(process.exitCode ?? 0);
}
main();
