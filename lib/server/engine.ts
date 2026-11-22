import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { getDb, HttpError } from "./admin";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CONQUEST_ROUND_CAP,
  DEFAULT_ROUNDS,
  DEFAULT_SLOTS,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_ROUNDS,
  PICK_SECONDS,
  PLAYER_COLORS,
  QUESTION_SECONDS,
  REGION_BY_ID,
  RESULT_SECONDS,
  START_REGIONS,
} from "@/lib/game/config";
import { pickQuestion } from "@/lib/game/questions";
import { buildCounters, ownedBy, pickableRegions, pickStartRegions, rankPlayers, scoreOf, soleOwner, territoryCount } from "@/lib/game/rules";
import type {
  GameMode,
  PlayerPublic,
  QuestionKind,
  QuestionPublic,
  RoomPrivate,
  RoomPublic,
  RoundResult,
  Stage,
} from "@/lib/game/types";

/** Time the question stays hidden while the picks are revealed. */
const REVEAL_MS = 3500;
/** Tolerance for network latency on deadlines. */
const GRACE_MS = 1500;
/** A client may nudge the game forward this much before the deadline (its request needs time to arrive). */
const EARLY_MS = 350;

const roomRef = (code: string) => getDb().collection("rooms").doc(code);
const privRef = (code: string) => roomRef(code).collection("private").doc("state");

function cleanName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 14);
  if (name.length < 1) throw new HttpError(400, "Please enter a name");
  return name;
}

/** Lowest colour nobody in the room has yet. */
function freeColor(room: RoomPublic, ignoreUid?: string): number {
  const used = new Set(Object.values(room.players).filter((p) => p.uid !== ignoreUid).map((p) => p.color ?? p.slot));
  const free = PLAYER_COLORS.findIndex((_, i) => !used.has(i));
  return free === -1 ? 0 : free;
}

function newPlayer(uid: string, name: string, slot: number, color: number): PlayerPublic {
  return { uid, name, slot, color, startRegion: null, score: 0, picked: false, answered: false, eliminated: false, outRound: null, outStage: null };
}

function randomCode(): string {
  let c = "";
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

function emptyPrivate(): RoomPrivate {
  return { picks: {}, correct: {}, shownAt: {}, answers: {}, usedQuestionIds: [], questionIds: {} };
}

async function load(tx: Transaction, code: string) {
  const [roomSnap, privSnap] = await Promise.all([tx.get(roomRef(code)), tx.get(privRef(code))]);
  if (!roomSnap.exists) throw new HttpError(404, "Room not found");
  return {
    room: roomSnap.data() as RoomPublic,
    priv: (privSnap.data() as RoomPrivate | undefined) ?? emptyPrivate(),
  };
}

function save(tx: Transaction, code: string, room: RoomPublic, priv: RoomPrivate) {
  tx.set(roomRef(code), room);
  tx.set(privRef(code), priv);
}

export async function createRoom(uid: string, rawName: unknown) {
  const name = cleanName(rawName);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const created = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (snap.exists) return false;
      const room: RoomPublic = {
        code,
        hostUid: uid,
        phase: "lobby",
        round: 0,
        slots: DEFAULT_SLOTS,
        mode: "rounds",
        rounds: DEFAULT_ROUNDS,
        maxRounds: DEFAULT_ROUNDS,
        stage: "attack",
        step: 0,
        counters: {},
        phaseDeadline: null,
        players: { [uid]: newPlayer(uid, name, 0, 0) },
        owners: {},
        picks: {},
        questions: {},
        results: [],
        winners: [],
        createdAt: Date.now(),
      };
      save(tx, code, room, emptyPrivate());
      return true;
    });
    if (created) return { code };
  }
  throw new HttpError(500, "Could not create a room, try again");
}

export async function joinRoom(uid: string, rawCode: unknown, rawName: unknown) {
  const code = String(rawCode ?? "").toUpperCase().trim();
  const name = cleanName(rawName);
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    if (room.players[uid]) {
      room.players[uid].name = name; // re-join / rename
    } else {
      if (room.phase !== "lobby") throw new HttpError(409, "This game has already started");
      const taken = new Set(Object.values(room.players).map((p) => p.slot));
      const seats = Math.min(MAX_PLAYERS, room.slots ?? DEFAULT_SLOTS);
      const slot = Array.from({ length: seats }, (_, s) => s).find((s) => !taken.has(s));
      if (slot === undefined) {
        throw new HttpError(409, "This room is full");
      }
      room.players[uid] = newPlayer(uid, name, slot, freeColor(room));
    }
    save(tx, code, room, priv);
  });
  return { code };
}

/**
 * A player leaves for good.
 * - Lobby: the seat is freed; if the host leaves, the next player takes over (an empty room is closed).
 * - Running or finished game: the player is marked as gone, their land becomes free, and the round
 *   carries on without them (or the game ends if nobody is left to play against).
 * Safe to call twice.
 */
export async function leaveRoom(uid: string, rawCode: unknown) {
  const code = String(rawCode ?? "").toUpperCase().trim();
  await getDb().runTransaction(async (tx) => {
    let loaded;
    try {
      loaded = await load(tx, code);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return; // room is already gone
      throw e;
    }
    const { room, priv } = loaded;
    const me = room.players[uid];
    if (!me) return;

    const others = Object.values(room.players)
      .filter((p) => p.uid !== uid && !p.left)
      .sort((a, b) => a.slot - b.slot);
    if (!others.length) {
      tx.delete(roomRef(code));
      tx.delete(privRef(code));
      return;
    }
    if (room.hostUid === uid) room.hostUid = others[0].uid;

    if (room.phase === "lobby") {
      delete room.players[uid];
    } else {
      const activeBefore = Object.values(room.players).filter((p) => !p.eliminated).length;
      me.left = true;
      if (!me.eliminated) {
        me.eliminated = true;
        me.outRound = room.round;
        me.outStage = room.stage;
      }
      for (const regionId of ownedBy(room.owners, uid)) delete room.owners[regionId];
      me.score = 0;
      me.picked = true;
      me.answered = true;
      delete priv.picks[uid];
      delete room.counters[uid];

      if (room.phase !== "finished") {
        const activeNow = Object.values(room.players).filter((p) => !p.eliminated).length;
        if (activeBefore > 1 && activeNow <= 1) {
          finish(room); // nobody left to play against
          room.step += 1;
        } else {
          completeIfDone(room, priv, Date.now()); // the others may have been waiting only for this player
        }
      }
    }
    save(tx, code, room, priv);
  });
}

/** Host ends the running game for everybody and returns the room to the lobby (settings are kept). */
export async function resetToLobby(uid: string, rawCode: unknown) {
  const code = String(rawCode ?? "").toUpperCase().trim();
  await getDb().runTransaction(async (tx) => {
    const { room } = await load(tx, code);
    if (room.hostUid !== uid) throw new HttpError(403, "Only the host can do this");
    if (room.phase === "lobby") return; // already there
    for (const p of Object.values(room.players)) {
      if (p.left) delete room.players[p.uid];
      else room.players[p.uid] = newPlayer(p.uid, p.name, p.slot, p.color ?? p.slot);
    }
    room.phase = "lobby";
    room.round = 0;
    room.stage = "attack";
    room.counters = {};
    room.phaseDeadline = null;
    room.owners = {};
    room.picks = {};
    room.questions = {};
    room.results = [];
    room.winners = [];
    room.step += 1; // stale advance calls from the old game become no-ops
    save(tx, code, room, emptyPrivate());
  });
}

/**
 * A player picks their colour in the lobby. The room is updated in a transaction, so when two
 * players grab the same colour at the same moment the database serialises them: the first one
 * wins, the other gets "taken" back at once and the screen puts their old colour back.
 */
export async function chooseColor(uid: string, rawCode: unknown, rawColor: unknown) {
  const code = String(rawCode ?? "").toUpperCase().trim();
  const color = Number(rawColor);
  if (!Number.isInteger(color) || color < 0 || color >= PLAYER_COLORS.length) throw new HttpError(400, "Unknown colour");
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    const me = room.players[uid];
    if (!me) throw new HttpError(403, "You are not in this room");
    if (room.phase !== "lobby") throw new HttpError(409, "The game has already started");
    if (Object.values(room.players).some((p) => p.uid !== uid && (p.color ?? p.slot) === color)) {
      throw new HttpError(409, "Someone just took that colour");
    }
    if ((me.color ?? me.slot) === color) return;
    me.color = color;
    save(tx, code, room, priv);
  });
}

/** Host chooses how the game ends: a fixed number of rounds, or until one player owns everything. */
export async function setSettings(uid: string, code: string, rawMode: unknown, rawRounds: unknown, rawSlots?: unknown) {
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    if (room.hostUid !== uid) throw new HttpError(403, "Only the host can change settings");
    if (room.phase !== "lobby") throw new HttpError(409, "The game has already started");
    if (rawMode !== "rounds" && rawMode !== "conquest") throw new HttpError(400, "Unknown game mode");
    const mode: GameMode = rawMode;
    const n = Math.round(Number(rawRounds));
    room.mode = mode;
    room.rounds = Number.isFinite(n) ? Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, n)) : DEFAULT_ROUNDS;
    room.maxRounds = mode === "rounds" ? room.rounds : CONQUEST_ROUND_CAP;
    if (rawSlots !== undefined) {
      // Seats: never fewer than the default, never below a seat that is already taken, never above the cap.
      const highestTaken = Math.max(-1, ...Object.values(room.players).map((p) => p.slot)) + 1;
      const n = Math.round(Number(rawSlots));
      const wanted = Number.isFinite(n) ? n : DEFAULT_SLOTS;
      room.slots = Math.min(MAX_PLAYERS, Math.max(DEFAULT_SLOTS, highestTaken, wanted));
    }
    save(tx, code, room, priv);
  });
}

export async function startGame(uid: string, code: string) {
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    if (room.hostUid !== uid) throw new HttpError(403, "Only the host can start");
    if (room.phase !== "lobby") throw new HttpError(409, "Already started");
    const players = Object.values(room.players);
    if (players.length < MIN_PLAYERS) throw new HttpError(409, `Need at least ${MIN_PLAYERS} players`);
    // Random, well-spread start regions every game. Dev scripts can pin the old fixed order.
    const fixed = process.env.ABT_FIXED_STARTS === "1";
    const drawn = pickStartRegions(players.length);
    const sorted = [...players].sort((a, b) => a.slot - b.slot);
    for (const [i, p] of sorted.entries()) {
      const region = fixed ? START_REGIONS[p.slot] : drawn[i];
      p.startRegion = region;
      room.owners[region] = p.uid;
    }
    beginPickPhase(room, priv, 1, "attack");
    room.step = 1;
    save(tx, code, room, priv);
  });
}

function beginPickPhase(room: RoomPublic, priv: RoomPrivate, round: number, stage: Stage) {
  room.phase = "pick";
  room.round = round;
  room.stage = stage;
  room.phaseDeadline = Date.now() + PICK_SECONDS * 1000;
  room.picks = {};
  room.questions = {};
  room.results = [];
  if (stage === "attack") room.counters = {};
  priv.picks = {};
  priv.answers = {};
  priv.correct = {};
  priv.shownAt = {};
  priv.questionIds = {};
  for (const p of Object.values(room.players)) {
    p.answered = false;
    // Players with nothing to pick (e.g. no revenge strike available) sit this step out.
    p.picked = pickableRegions(room, p.uid).length === 0;
    p.score = scoreOf(room.owners, p.uid);
  }
}

export async function submitPick(uid: string, code: string, regionId: unknown) {
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    const me = room.players[uid];
    if (!me) throw new HttpError(403, "You are not in this room");
    if (room.phase !== "pick" || Date.now() > (room.phaseDeadline ?? 0) + GRACE_MS) {
      throw new HttpError(409, "Picking is closed");
    }
    const id = String(regionId);
    if (!pickableRegions(room, uid).includes(id)) throw new HttpError(400, "You cannot pick that region");
    priv.picks[uid] = id;
    me.picked = true;
    completeIfDone(room, priv, Date.now());
    save(tx, code, room, priv);
  });
}

export async function submitAnswer(uid: string, code: string, choice: unknown) {
  await getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    if (!room.players[uid]) throw new HttpError(403, "You are not in this room");
    if (room.phase !== "question") throw new HttpError(409, "No open question");
    const regionId = room.picks[uid];
    const q = regionId ? room.questions[regionId] : undefined;
    if (!q) throw new HttpError(409, "You have no question this round");
    const now = Date.now();
    if (now < priv.shownAt[regionId] - 500) throw new HttpError(409, "Question not shown yet");
    if (now > (room.phaseDeadline ?? 0) + GRACE_MS) throw new HttpError(409, "Time is up");
    if (priv.answers[uid]) throw new HttpError(409, "Already answered");
    const c = Number(choice);
    if (!Number.isInteger(c) || c < 0 || c >= q.options.length) throw new HttpError(400, "Invalid choice");
    priv.answers[uid] = { choice: c, at: now };
    room.players[uid].answered = true;
    completeIfDone(room, priv, now);
    save(tx, code, room, priv);
  });
}

/**
 * When the last player has picked / answered, the game moves on in the same transaction.
 * Everybody sees the next screen with one database update instead of waiting for a client to nudge.
 */
function completeIfDone(room: RoomPublic, priv: RoomPrivate, now: number) {
  if (room.phase === "pick" && Object.values(room.players).every((p) => p.picked)) {
    startQuestions(room, priv, now);
    room.step += 1;
  } else if (room.phase === "question" && Object.keys(room.picks).every((id) => room.players[id]?.answered)) {
    resolveRound(room, priv);
    room.step += 1;
  }
}

/**
 * Moves the game forward when the current step is complete (everyone done or
 * deadline passed). Safe to call from every client: stale or early calls are no-ops.
 */
export async function advance(code: string, expectStep: unknown) {
  return getDb().runTransaction(async (tx) => {
    const { room, priv } = await load(tx, code);
    if (room.phase === "lobby" || room.phase === "finished" || room.step !== Number(expectStep)) {
      return { advanced: false };
    }
    const now = Date.now();
    const timeUp = room.phaseDeadline !== null && now >= room.phaseDeadline - EARLY_MS;
    const players = Object.values(room.players);

    if (room.phase === "pick") {
      if (!timeUp && !players.every((p) => p.picked)) return { advanced: false };
      startQuestions(room, priv, now);
    } else if (room.phase === "question") {
      const everyoneAnswered = Object.keys(room.picks).every((id) => room.players[id]?.answered);
      if (!timeUp && !everyoneAnswered) return { advanced: false };
      resolveRound(room, priv);
    } else {
      if (!timeUp) return { advanced: false };
      afterResult(room, priv);
    }
    room.step += 1;
    save(tx, code, room, priv);
    return { advanced: true };
  });
}

function startQuestions(room: RoomPublic, priv: RoomPrivate, now: number) {
  const picks = priv.picks;
  room.picks = { ...picks };
  const byRegion: Record<string, string[]> = {};
  for (const [uid, regionId] of Object.entries(picks)) (byRegion[regionId] ??= []).push(uid);

  for (const [regionId, uids] of Object.entries(byRegion)) {
    const meta = REGION_BY_ID[regionId];
    const q = pickQuestion(meta.tier, priv.usedQuestionIds);
    priv.usedQuestionIds.push(q.id);
    priv.questionIds[regionId] = q.id;
    priv.correct[regionId] = q.answer;
    priv.shownAt[regionId] = now + REVEAL_MS;
    const defender = room.owners[regionId] ?? null;
    const kind: QuestionKind = room.stage === "counter" ? "counter" : defender ? "attack" : "free";
    const pub: QuestionPublic = {
      regionId,
      tier: meta.tier,
      text: q.text,
      options: q.options,
      players: uids,
      clash: uids.length > 1,
      kind,
      defender,
    };
    room.questions[regionId] = pub;
  }

  if (!Object.keys(byRegion).length) {
    resolveRound(room, priv);
    return;
  }
  room.phase = "question";
  room.phaseDeadline = now + REVEAL_MS + QUESTION_SECONDS * 1000;
}

function resolveRound(room: RoomPublic, priv: RoomPrivate) {
  const results: RoundResult[] = [];
  const fails: { attacker: string; defender: string }[] = [];
  for (const q of Object.values(room.questions)) {
    const correctIndex = priv.correct[q.regionId];
    const shownAt = priv.shownAt[q.regionId];
    const answers: RoundResult["answers"] = {};
    let winner: string | null = null;
    let best = Infinity;
    for (const uid of q.players) {
      const a = priv.answers[uid];
      const correct = !!a && a.choice === correctIndex;
      const ms = a ? Math.max(0, a.at - shownAt) : null;
      answers[uid] = { correct, ms };
      if (correct && ms !== null && ms < best) {
        best = ms;
        winner = uid;
      }
      // A wrong (or missing) answer against an owned region unlocks a revenge strike for its owner.
      if (!correct && q.kind === "attack" && q.defender) fails.push({ attacker: uid, defender: q.defender });
    }
    // Placeholder clash rule: fastest correct answer wins. (Final rules to be defined.)
    if (winner) room.owners[q.regionId] = winner;
    results.push({ regionId: q.regionId, kind: q.kind, defender: q.defender, clash: q.clash, winner, answers, correctIndex });
  }
  room.results = results;
  if (room.stage === "attack") room.counters = buildCounters(room.owners, fails);
  for (const p of Object.values(room.players)) {
    p.score = scoreOf(room.owners, p.uid);
    // A player without any region left is out for the rest of the game.
    if (!p.eliminated && territoryCount(room.owners, p.uid) === 0) {
      p.eliminated = true;
      p.outRound = room.round;
      p.outStage = room.stage;
    }
  }
  room.phase = "result";
  room.phaseDeadline = Date.now() + RESULT_SECONDS * 1000;
}

/** After a result screen: end the game, open the revenge stage, or start the next round. */
function afterResult(room: RoomPublic, priv: RoomPrivate) {
  // Last player standing (or one player owning everything) ends the game right away.
  if (soleOwner(room.owners) || Object.values(room.players).filter((p) => !p.eliminated).length <= 1) {
    return finish(room);
  }
  if (room.stage === "attack" && Object.keys(room.counters).length) {
    return beginPickPhase(room, priv, room.round, "counter");
  }
  if (room.round >= room.maxRounds) return finish(room);
  beginPickPhase(room, priv, room.round + 1, "attack");
}

function finish(room: RoomPublic) {
  // Highest total points wins; most regions breaks ties; anything still equal is a shared win.
  const ranked = rankPlayers(room);
  const top = ranked[0];
  room.winners = ranked
    .filter(
      (p) =>
        scoreOf(room.owners, p.uid) === scoreOf(room.owners, top.uid) &&
        territoryCount(room.owners, p.uid) === territoryCount(room.owners, top.uid),
    )
    .map((p) => p.uid);
  room.phase = "finished";
  room.phaseDeadline = null;
}
