/**
 * Dev-only scripted game: two players follow a fixed plan so attack, failed attack and
 * counter-attack can be verified end to end against the local emulators + dev server.
 * Usage: npm run sim
 * Optional: CODE + UID_A + TOKEN_A let an already open (hosting) browser session play as player A.
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { RoomPrivate, RoomPublic } from "../lib/game/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const db = getFirestore(initializeApp({ projectId: "demo-australian-battles" }));

type Plan = Record<string, { region: string; correct: boolean }>;
// key = `${round}:${stage}:${player}`
const PLAN: Plan = {
  "1:attack:A": { region: "wa-east", correct: true },
  "1:attack:B": { region: "qld-west", correct: true },
  "2:attack:A": { region: "nt-central", correct: true },
  "2:attack:B": { region: "sa-north", correct: true },
  // A attacks B's sa-north and fails -> B unlocks a counter-attack
  "3:attack:A": { region: "sa-north", correct: false },
  "3:attack:B": { region: "nsw-east", correct: true },
  "3:counter:B": { region: "nt-central", correct: true },
};

async function signIn() {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken: string; localId: string };
  return { token: j.idToken, uid: j.localId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) process.exitCode = 1;
};

async function main() {
  const external = process.env.CODE && process.env.UID_A && process.env.TOKEN_A;
  const players = {
    A: external ? { uid: process.env.UID_A!, token: process.env.TOKEN_A! } : await signIn(),
    B: await signIn(),
  };
  const call = async (who: "A" | "B", path: string, body: unknown) => {
    const r = await fetch(`${BASE}/api/g/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${players[who].token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; error?: string; code?: string };
  };

  const code = external ? process.env.CODE! : (await call("A", "room/create", { name: "Ann" })).code!;
  await call("B", "room/join", { code, name: "Ben" });
  console.log("room", code, await call("A", "room/settings", { code, mode: "rounds", rounds: 3 }));
  console.log("start", await call("A", "room/start", { code }));

  const uidOf = (who: "A" | "B") => players[who].uid;
  const read = async () => {
    const [r, p] = await Promise.all([db.doc(`rooms/${code}`).get(), db.doc(`rooms/${code}/private/state`).get()]);
    return { room: r.data() as RoomPublic, priv: p.data() as RoomPrivate };
  };

  let lastStep = -1;
  let sawCounter = false;
  let attackFailedResult = false;
  for (let guard = 0; guard < 400; guard++) {
    await sleep(500);
    const { room, priv } = await read();
    if (room.phase === "finished") break;
    const tag = `${room.round}:${room.stage}`;
    if (room.step !== lastStep) {
      lastStep = room.step;
      console.log(`step ${room.step}: round ${room.round} ${room.stage} ${room.phase}`);
    }
    if (room.phase === "pick") {
      for (const who of ["A", "B"] as const) {
        const planned = PLAN[`${tag}:${who}`];
        if (planned && !room.players[uidOf(who)].picked) {
          const res = await call(who, "room/pick", { code, regionId: planned.region });
          if (!res.ok) console.log("pick rejected", who, planned.region, res.error);
        }
      }
      if (room.stage === "counter") sawCounter = true;
    }
    if (room.phase === "question") {
      await sleep(3700);
      for (const who of ["A", "B"] as const) {
        const planned = PLAN[`${tag}:${who}`];
        const me = room.players[uidOf(who)];
        if (planned && !me.answered && room.picks[uidOf(who)]) {
          const right = priv.correct[planned.region];
          await call(who, "room/answer", { code, choice: planned.correct ? right : (right + 1) % 4 });
        }
      }
    }
    if (room.phase === "result" && room.stage === "attack" && room.round === 3) {
      attackFailedResult = room.results.some((r) => r.kind === "attack" && r.winner === null && r.defender === uidOf("B"));
      check(!!room.counters[uidOf("B")], "failed attack on B's region unlocked a counter-attack for B");
      console.log("counter regions for B:", room.counters[uidOf("B")]?.regions);
    }
    await call("A", "room/advance", { code, step: room.step });
  }

  const { room } = await read();
  check(room.phase === "finished", "game finished after 3 rounds (counter stage included)");
  check(sawCounter, "a counter stage took place");
  check(attackFailedResult, "failed attack was reported with the defender");
  check(room.owners["nt-central"] === uidOf("B"), "B captured nt-central with the counter-attack");
  check(room.owners["sa-north"] === uidOf("B"), "B kept sa-north after the failed attack");
  check(room.owners["wa-east"] === uidOf("A"), "A still owns wa-east");
  console.log("owners", room.owners);
  console.log("winners", room.winners.map((w) => (w === uidOf("A") ? "A" : "B")));
  process.exit(process.exitCode ?? 0);
}
main();
