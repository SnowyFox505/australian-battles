/**
 * Dev-only test player. Joins a room on the local emulators and plays randomly.
 * Usage: npm run bot -- ROOMCODE [Name] [accuracy 0..1]
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pickableRegions } from "../lib/game/rules";
import type { RoomPrivate, RoomPublic } from "../lib/game/types";

const [code = "", name = "Bot", acc = "0.6"] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const app = initializeApp({ projectId: "demo-australian-battles" });
const db = getFirestore(app);

async function signIn() {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken: string; localId: string };
  return { token: j.idToken, uid: j.localId };
}

async function main() {
  const { token, uid } = await signIn();
  const call = async (path: string, body: unknown) => {
    const r = await fetch(`${BASE}/api/g/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  };
  console.log("join", await call("room/join", { code, name }));
  let lastKey = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 900));
    const [rs, ps] = await Promise.all([db.doc(`rooms/${code}`).get(), db.doc(`rooms/${code}/private/state`).get()]);
    const room = rs.data() as RoomPublic | undefined;
    if (!room || room.phase === "finished") return console.log("done", room?.winners);
    const priv = ps.data() as RoomPrivate | undefined;
    const me = room.players[uid];
    const key = `${room.step}:${me?.picked}:${me?.answered}`;
    if (key === lastKey) continue;
    lastKey = key;
    if (room.phase === "pick" && me && !me.picked) {
      const opts = pickableRegions(room, uid);
      const regionId = opts[Math.floor(Math.random() * opts.length)];
      console.log("pick", regionId, await call("room/pick", { code, regionId }));
    }
    if (room.phase === "question") {
      const rid = room.picks[uid];
      if (rid && !me.answered) {
        await new Promise((r) => setTimeout(r, 4500 + Math.random() * 6000));
        const right = priv!.correct[rid];
        const choice = Math.random() < Number(acc) ? right : (right + 1) % 4;
        console.log("answer", await call("room/answer", { code, choice }));
      }
    }
  }
}
main();
