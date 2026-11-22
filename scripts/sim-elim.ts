/**
 * Dev-only scripted 3-player game that checks elimination: player V loses their last region
 * in round 1, is out afterwards and can no longer pick.
 * Usage: npm run sim:elim   (optional CODE + UID_V + TOKEN_V let the hosting browser play V)
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { RoomPrivate, RoomPublic } from "../lib/game/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const db = getFirestore(initializeApp({ projectId: "demo-australian-battles" }));

type Who = "V" | "B" | "K";
const PLAN: Record<string, { region: string; correct: boolean }> = {
  // V (wa-southwest) answers wrong; K (wa-north) attacks V's only region and wins it -> V is out
  "1:attack:V": { region: "wa-east", correct: false },
  "1:attack:B": { region: "qld-west", correct: true },
  "1:attack:K": { region: "wa-southwest", correct: true },
  "2:attack:B": { region: "nsw-east", correct: true },
  "2:attack:K": { region: "wa-east", correct: true },
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
  const external = process.env.CODE && process.env.UID_V && process.env.TOKEN_V;
  const players: Record<Who, { uid: string; token: string }> = {
    V: external ? { uid: process.env.UID_V!, token: process.env.TOKEN_V! } : await signIn(),
    B: await signIn(),
    K: await signIn(),
  };
  const call = async (who: Who, path: string, body: unknown) => {
    const r = await fetch(`${BASE}/api/g/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${players[who].token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; error?: string; code?: string };
  };
  const code = external ? process.env.CODE! : (await call("V", "room/create", { name: "Vic" })).code!;
  await call("B", "room/join", { code, name: "Bea" });
  await call("K", "room/join", { code, name: "Kim" });
  await call("V", "room/settings", { code, mode: "rounds", rounds: 2 });
  console.log("start", await call("V", "room/start", { code }));

  const read = async () => {
    const [r, p] = await Promise.all([db.doc(`rooms/${code}`).get(), db.doc(`rooms/${code}/private/state`).get()]);
    return { room: r.data() as RoomPublic, priv: p.data() as RoomPrivate };
  };

  let lastStep = -1;
  let outPickRejected: boolean | null = null;
  let outAfterRound1 = false;
  for (let guard = 0; guard < 300; guard++) {
    await sleep(500);
    const { room, priv } = await read();
    if (room.phase === "finished") break;
    const tag = `${room.round}:${room.stage}`;
    if (room.step !== lastStep) {
      lastStep = room.step;
      console.log(`step ${room.step}: round ${room.round} ${room.stage} ${room.phase}`);
    }
    if (room.phase === "pick") {
      if (room.round === 2 && outPickRejected === null) {
        outAfterRound1 = room.players[players.V.uid].eliminated;
        const res = await call("V", "room/pick", { code, regionId: "wa-east" });
        outPickRejected = !res.ok;
      }
      for (const who of ["V", "B", "K"] as const) {
        const planned = PLAN[`${tag}:${who}`];
        if (planned && !room.players[players[who].uid].picked) await call(who, "room/pick", { code, regionId: planned.region });
      }
    }
    if (room.phase === "question") {
      await sleep(3700);
      for (const who of ["V", "B", "K"] as const) {
        const planned = PLAN[`${tag}:${who}`];
        if (planned && !room.players[players[who].uid].answered && room.picks[players[who].uid]) {
          const right = priv.correct[planned.region];
          await call(who, "room/answer", { code, choice: planned.correct ? right : (right + 1) % 4 });
        }
      }
    }
    await call("K", "room/advance", { code, step: room.step });
  }

  const { room } = await read();
  const V = room.players[players.V.uid];
  check(outAfterRound1, "V was marked as eliminated after losing the last region in round 1");
  check(V.eliminated && V.outRound === 1, "V is out since round 1");
  check(outPickRejected === true, "an eliminated player cannot pick");
  check(room.phase === "finished", "game kept going with the 2 remaining players and then finished");
  check(!room.players[players.B.uid].eliminated && !room.players[players.K.uid].eliminated, "B and K are still in");
  check(room.owners["wa-southwest"] === players.K.uid, "K holds the captured wa-southwest");
  console.log("winners", room.winners.map((w) => Object.entries(players).find(([, v]) => v.uid === w)?.[0]));
  process.exit(process.exitCode ?? 0);
}
main();
