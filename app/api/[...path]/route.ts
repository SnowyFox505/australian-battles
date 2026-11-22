import { HttpError, respond, uidFromRequest } from "@/lib/server/admin";
import {
  advance,
  chooseColor,
  createRoom,
  joinRoom,
  leaveRoom,
  resetToLobby,
  setSettings,
  startGame,
  submitAnswer,
  submitPick,
} from "@/lib/server/engine";

/**
 * One function serves the whole game API: `/api/g/time` and `/api/g/room/<action>`.
 * On Vercel every route file is its own serverless function with its own cold start; a single
 * handler means one warm instance answers every action, so buttons do not stall for seconds.
 * Add new actions to the `actions` table below instead of creating new route files.
 */
type Body = Record<string, unknown>;
type Action = (uid: string, body: Body) => Promise<unknown>;

const actions: Record<string, Action> = {
  "room/create": (uid, b) => createRoom(uid, b.name),
  "room/join": (uid, b) => joinRoom(uid, b.code, b.name),
  "room/settings": (uid, b) => setSettings(uid, String(b.code), b.mode, b.rounds, b.slots),
  "room/start": (uid, b) => startGame(uid, String(b.code)),
  "room/pick": (uid, b) => submitPick(uid, String(b.code), b.regionId),
  "room/answer": (uid, b) => submitAnswer(uid, String(b.code), b.choice),
  "room/advance": (_uid, b) => advance(String(b.code), b.step),
  "room/color": (uid, b) => chooseColor(uid, b.code, b.color),
  "room/leave": (uid, b) => leaveRoom(uid, b.code),
  "room/reset": (uid, b) => resetToLobby(uid, b.code),
};

type Ctx = { params: Promise<{ path: string[] }> };

/** `/api/g/room/pick` -> "room/pick"; anything outside `/api/g/` is unknown. */
async function keyOf(ctx: Ctx) {
  const [prefix, ...rest] = (await ctx.params).path;
  return prefix === "g" ? rest.join("/") : "";
}

export async function GET(_req: Request, ctx: Ctx) {
  const key = await keyOf(ctx);
  return respond(async () => {
    // Clock sync and warm-up ping: no login, no database.
    if (key === "time") return {};
    throw new HttpError(404, "Unknown endpoint");
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const key = await keyOf(ctx);
  return respond(async () => {
    const action = actions[key];
    if (!action) throw new HttpError(404, "Unknown endpoint");
    const uid = await uidFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    return action(uid, body ?? {});
  });
}
