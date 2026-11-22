"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BackControl } from "@/components/BackControl";
import { Lobby } from "@/components/Lobby";
import { MapView } from "@/components/MapView";
import { RefreshButton } from "@/components/RefreshButton";
import { CountdownRing, Glass, Overline, PillButton, PlayerDot, haptic, softSpring, spring } from "@/components/ui";
import { api, serverNow } from "@/lib/client/api";
import { useRoom, useUid } from "@/lib/client/useRoom";
import { PICK_SECONDS, QUESTION_SECONDS, REGION_BY_ID, REGIONS, RESULT_SECONDS } from "@/lib/game/config";
import { pickableRegions, rankPlayers, scoreOf, soleOwner, territoryCount } from "@/lib/game/rules";
import type { PlayerPublic, RoomPublic } from "@/lib/game/types";

const REVEAL_MS = 3500;
const TIER_LABEL = { 1: "Easy", 2: "Medium", 3: "Hard" } as const;

export function RoomScreen({ code }: { code: string }) {
  const uid = useUid();
  const { room, missing } = useRoom(code, uid);
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  /** Leave the room for good and go to the start screen. */
  async function leave() {
    // Set first: the server removes us from the room before the answer arrives, and without this
    // flag the screen would flash "Join this room" / "Room not found" in between.
    setLeaving(true);
    try {
      await api("room/leave", { code });
    } catch (e) {
      setLeaving(false);
      throw e;
    }
    router.replace("/");
  }

  /** Host: end the running game for everybody, back to the lobby. */
  async function endGame() {
    await api("room/reset", { code });
  }

  if (leaving && (missing || !room || (uid && !room.players[uid]) || (uid && room.players[uid]?.left))) {
    return <Centered title="Leaving…" pulse />;
  }
  if (missing) return <Centered title="Room not found" body="Check the code or ask the host for a new invite." />;
  if (!room || !uid) return <Centered title="Connecting…" pulse />;
  if (room.players[uid]?.left) {
    return <Centered title="You left this game" body="Your seat is gone. Ask the host for a new game." />;
  }
  if (!room.players[uid]) {
    if (room.phase === "lobby") {
      return (
        <Centered title="Join this room" body={`Room ${code}`}>
          <Link href={`/join/${code}`} className="mt-6 inline-block rounded-full bg-accent px-7 py-3.5 font-medium">
            Enter your name
          </Link>
        </Centered>
      );
    }
    return <Centered title="Game in progress" body="This game has already started." />;
  }
  if (room.phase === "lobby") return <Lobby room={room} uid={uid} onLeave={leave} onEnd={endGame} />;
  return <Game room={room} uid={uid} onLeave={leave} onEnd={endGame} />;
}

function Centered({ title, body, pulse, children }: { title: string; body?: string; pulse?: boolean; children?: React.ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-svh max-w-[460px] flex-col items-center justify-center px-6 text-center">
      <RefreshButton className="absolute right-6 top-[calc(20px+var(--safe-top))]" />
      <h1 className="title-xl text-[34px]" style={pulse ? { animation: "breathe 1.6s ease-in-out infinite" } : undefined}>
        {title}
      </h1>
      {body && <p className="mt-3 text-[15px] text-dim">{body}</p>}
      {children}
      {!pulse && (
        <Link href="/" className="mt-8 text-[14px] text-dim underline-offset-4 hover:underline">
          Back to start
        </Link>
      )}
    </main>
  );
}

/** Every client nudges the server forward; the server decides if it is really time. */
function useAutoAdvance(room: RoomPublic, uid: string) {
  const isHost = room.hostUid === uid;
  useEffect(() => {
    if (room.phase === "finished" || room.phase === "lobby") return;
    const players = Object.values(room.players);
    const done =
      room.phase === "pick"
        ? players.every((p) => p.picked)
        : room.phase === "question"
          ? Object.keys(room.picks).every((id) => room.players[id]?.answered)
          : false;
    const body = { code: room.code, step: room.step };
    const go = () => api("room/advance", body).catch(() => {});
    // The server already moves on by itself when the last player picks or answers; this is only
    // the safety net for that case. The host reacts first, everybody else a moment later.
    if (done) {
      const t = setTimeout(go, isHost ? 400 : 1500);
      return () => clearTimeout(t);
    }
    // Deadline: send the nudge slightly early so it lands right as the countdown hits zero
    // (the server accepts it ~350 ms ahead). Others follow as a backup.
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (room.phaseDeadline !== null) {
      const wait = Math.max(0, room.phaseDeadline - serverNow() - 150);
      timers.push(setTimeout(go, wait + (isHost ? 0 : 1800)));
    }
    // And keep retrying while the step is overdue (lost request, sleeping host, …).
    const id = setInterval(() => {
      const late = room.phaseDeadline !== null && serverNow() - room.phaseDeadline;
      if (late !== false && late >= (isHost ? 800 : 2600)) go();
    }, 900);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(id);
    };
  }, [room.phase, room.step, room.code, room.phaseDeadline, room.players, room.picks, isHost]);
}

function Game({ room, uid, onLeave, onEnd }: { room: RoomPublic; uid: string; onLeave: () => Promise<void>; onEnd: () => Promise<void> }) {
  useAutoAdvance(room, uid);
  const me = room.players[uid];
  const [selected, setSelected] = useState<string | null>(null);
  const [lockedPick, setLockedPick] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // Reset local pick/answer state whenever the game moves to a new step.
  const [stepSeen, setStepSeen] = useState(room.step);
  if (stepSeen !== room.step) {
    setStepSeen(room.step);
    setSelected(null);
    setLockedPick(null);
    setMyChoice(null);
    setErr("");
  }

  const mine = pickableRegions(room, uid);
  const myRegion = room.picks[uid];
  const total = room.phase === "pick" ? PICK_SECONDS : room.phase === "question" ? QUESTION_SECONDS + REVEAL_MS / 1000 : RESULT_SECONDS;
  const players = Object.values(room.players).sort((a, b) => a.slot - b.slot);

  const selectable = room.phase === "pick" ? mine : [];
  const active = room.phase === "question" || room.phase === "result" ? Object.keys(room.questions) : [];
  const mapSelected = room.phase === "pick" ? selected : (myRegion ?? null);

  // Optimistic: the button flips to "Locked in" at once; the request runs in the background and
  // only undoes it (with the reason) if the server refuses.
  function lockIn() {
    if (!selected || lockedPick === selected) return;
    const id = selected;
    setLockedPick(id);
    setErr("");
    haptic([10, 30, 10]);
    api("room/pick", { code: room.code, regionId: id }).catch((e: Error) => {
      setLockedPick((cur) => (cur === id ? null : cur));
      setErr(e.message);
    });
  }

  async function answer(i: number) {
    if (myChoice !== null) return;
    setMyChoice(i);
    haptic(14);
    try {
      await api("room/answer", { code: room.code, choice: i });
    } catch (e) {
      setErr((e as Error).message);
      setMyChoice(null);
    }
  }

  return (
    <main className="mx-auto flex h-svh w-full max-w-[1100px] flex-col px-4 pb-[calc(12px+var(--safe-bottom))] pt-[calc(12px+var(--safe-top))] md:grid md:grid-cols-[1fr_400px] md:gap-5 md:px-6">
      <section className="flex min-h-0 flex-1 flex-col md:py-2">
        <Hud room={room} uid={uid} total={total} players={players} />
        <div className="relative min-h-[150px] flex-1 overflow-hidden rounded-[28px] border border-line">
          <MapView
            className="absolute inset-0"
            owners={room.owners}
            players={room.players}
            selectable={selectable}
            selected={mapSelected}
            active={active}
            onSelect={(id) => {
              if (room.phase !== "pick") return;
              haptic(8);
              setSelected(id);
            }}
          />
          <BackControl room={room} uid={uid} onLeave={onLeave} onEnd={onEnd} onMap className="absolute left-2.5 top-2.5 z-10" />
        </div>
      </section>

      <aside className="mt-3 max-h-[68svh] shrink-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mt-0 md:flex md:max-h-none md:flex-col md:justify-end md:overflow-visible md:py-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${room.step}-${room.phase}`}
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.12, ease: "easeIn" } }}
            transition={softSpring}
          >
            {room.phase === "pick" && (
              <PickPanel
                room={room}
                uid={uid}
                selected={selected}
                lockedPick={lockedPick}
                canPick={mine.length > 0 && !!me}
                err={err}
                onLock={lockIn}
              />
            )}
            {room.phase === "question" && <QuestionPanel room={room} uid={uid} myChoice={myChoice} onAnswer={answer} err={err} />}
            {room.phase === "result" && <ResultPanel room={room} uid={uid} />}
            {room.phase === "finished" && <FinishedPanel room={room} uid={uid} />}
          </motion.div>
        </AnimatePresence>
      </aside>
    </main>
  );
}

function Hud({ room, uid, total, players }: { room: RoomPublic; uid: string; total: number; players: PlayerPublic[] }) {
  const counter = room.stage === "counter" && room.phase !== "finished";
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {players.map((p) => (
          <motion.div
            key={p.uid}
            layout
            transition={spring}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-white/[0.03] py-1.5 pl-2 pr-3.5"
            style={{ opacity: p.eliminated ? 0.4 : 1 }}
          >
            <PlayerDot player={p} size={22} />
            <div className="leading-tight">
              <div className="text-[12.5px] font-medium">
                {p.name}
                {p.uid === uid ? <span className="text-faint"> · you</span> : null}
              </div>
              <div className="text-[11px] tabular-nums text-dim">
                {p.left ? "left" : p.eliminated ? "out" : `${scoreOf(room.owners, p.uid)} pts · ${territoryCount(room.owners, p.uid)}/${REGIONS.length}`}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="text-right leading-tight">
          <div className="text-[11px]" style={{ color: counter ? "var(--accent-glow)" : "var(--ink-faint)" }}>
            {counter ? "Counter" : room.mode === "conquest" ? "Conquest" : "Round"}
          </div>
          <div className="text-[14px] font-medium tabular-nums">
            {room.mode === "conquest" ? room.round : `${room.round}/${room.maxRounds}`}
          </div>
        </div>
        {room.phase !== "finished" && <CountdownRing deadline={room.phaseDeadline} total={total} size={46} />}
      </div>
    </div>
  );
}

function Tier({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-dim">
      <span className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className="h-1.5 w-3.5 rounded-full" style={{ background: i <= tier ? "var(--accent-glow)" : "rgba(236,220,186,.18)" }} />
        ))}
      </span>
      {TIER_LABEL[tier]}
    </span>
  );
}

function PointsChip({ points }: { points: number }) {
  return (
    <span className="rounded-full border bg-accent/15 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-glow" style={{ borderColor: "var(--line-strong)" }}>
      {points} {points === 1 ? "pt" : "pts"}
    </span>
  );
}

function Tag({ children, tone = "bad" }: { children: React.ReactNode; tone?: "bad" | "blue" }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={
        tone === "bad"
          ? { background: "rgba(226,112,95,0.16)", color: "var(--bad)" }
          : { background: "rgba(63,166,161,0.2)", color: "#8fd6cd" }
      }
    >
      {children}
    </span>
  );
}

function names(room: RoomPublic, uids: string[]) {
  return uids.map((u) => room.players[u]?.name ?? "?").join(" & ");
}

function PickPanel({
  room,
  uid,
  selected,
  lockedPick,
  canPick,
  err,
  onLock,
}: {
  room: RoomPublic;
  uid: string;
  selected: string | null;
  lockedPick: string | null;
  canPick: boolean;
  err: string;
  onLock: () => void;
}) {
  const counter = room.stage === "counter";
  // Who we are still waiting for: my own pick counts as done the moment I lock it in.
  const waiting = Object.values(room.players).filter((p) => !p.picked && !(p.uid === uid && lockedPick)).length;
  const region = selected ? REGION_BY_ID[selected] : null;
  const ownerUid = selected ? room.owners[selected] : undefined;
  const owner = ownerUid ? room.players[ownerUid] : null;
  const locked = lockedPick && lockedPick === selected;
  const myCounter = room.counters[uid];
  const strikers = Object.keys(room.counters);

  const heading = counter ? `Round ${room.round} · Counter-attack` : `Round ${room.round} · Choose a territory`;
  const intro = counter
    ? `${names(room, myCounter?.against ?? [])} failed to take your land. Strike back: pick one of their territories next to yours.`
    : "Tap a glowing territory touching yours, free or held by an opponent. Bigger regions are worth more points but bring harder questions.";

  return (
    <Glass className="p-5">
      <Overline>{heading}</Overline>
      {canPick ? (
        <>
          <div className="mt-2 min-h-[100px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={selected ?? "none"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {region ? (
                  <>
                    <h2 className="text-[28px] font-medium leading-tight tracking-tight">{region.name}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <PointsChip points={region.points} />
                      <Tier tier={region.tier} />
                      <span className="text-[12px] text-faint">{region.areaKm2.toLocaleString("en-US")} km²</span>
                    </div>
                    {owner && (
                      <div className="mt-2.5 flex items-center gap-2 text-[13px] text-dim">
                        <PlayerDot player={owner} size={16} />
                        Held by {owner.name} · {counter ? "take it back" : "win the question to capture it"}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="pt-1 text-[15px] leading-relaxed text-dim">{intro}</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-4">
            <PillButton variant="solid" onClick={onLock} disabled={!selected || !!locked}>
              {locked ? "Locked in" : selected ? (owner ? "Attack" : "Lock in") : "Select a territory"}
            </PillButton>
          </div>
          <p className="min-h-[20px] pt-2 text-center text-[12.5px] text-dim">
            {err ? <span className="text-bad">{err}</span> : lockedPick ? `Waiting for ${waiting} player${waiting === 1 ? "" : "s"}…` : ""}
          </p>
        </>
      ) : room.players[uid]?.eliminated ? (
        <p className="mt-2 text-[16px] leading-relaxed text-dim">You are out of the game. Watch how it ends.</p>
      ) : counter ? (
        <p className="mt-2 text-[16px] leading-relaxed text-dim">
          {strikers.length ? `${names(room, strikers)} ${strikers.length > 1 ? "are" : "is"} striking back. Hold on to your land.` : "Waiting…"}
        </p>
      ) : (
        <p className="mt-2 text-[16px] text-dim">No territory within reach. You sit this round out.</p>
      )}
    </Glass>
  );
}

function QuestionPanel({
  room,
  uid,
  myChoice,
  onAnswer,
  err,
}: {
  room: RoomPublic;
  uid: string;
  myChoice: number | null;
  onAnswer: (i: number) => void;
  err: string;
}) {
  // The picks are shown first; the question appears when the reveal ends. One timer flips it exactly
  // on time instead of re-rendering the whole panel ten times a second.
  const revealEnd = room.phaseDeadline ? room.phaseDeadline - QUESTION_SECONDS * 1000 : 0;
  const [, flip] = useState(0);
  useEffect(() => {
    const ms = revealEnd - serverNow();
    if (!revealEnd || ms <= 0) return;
    const t = setTimeout(() => flip((n) => n + 1), ms + 20);
    return () => clearTimeout(t);
  }, [revealEnd]);
  const revealing = revealEnd > serverNow();
  const myRegion = room.picks[uid];
  const q = myRegion ? room.questions[myRegion] : null;
  const picks = Object.entries(room.picks);
  const counter = room.stage === "counter";

  if (revealing || !q) {
    return (
      <Glass className="p-5">
        <Overline>{revealing ? (counter ? "Counter-attacks revealed" : "Picks revealed") : "Round " + room.round}</Overline>
        <div className="mt-3 flex flex-col gap-2">
          {picks.map(([pid, rid], i) => {
            const p = room.players[pid];
            const pq = room.questions[rid];
            const def = pq?.defender ? room.players[pq.defender] : null;
            return (
              <motion.div
                key={pid}
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: 0.12 * i }}
                className="flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] px-4 py-3"
              >
                <PlayerDot player={p} size={22} />
                <span className="text-[15px] font-medium">{p.name}</span>
                <span className="ml-auto text-right">
                  <span className="block text-[14px] text-dim">{REGION_BY_ID[rid].short}</span>
                  {def && (
                    <span className="block text-[11px] text-faint">
                      {pq.kind === "counter" ? "striking back at" : "attacking"} {def.name}
                    </span>
                  )}
                </span>
                {pq?.clash && <Tag>CLASH</Tag>}
              </motion.div>
            );
          })}
          {!picks.length && <p className="text-[15px] text-dim">Nobody picked a territory this round.</p>}
        </div>
        {!revealing && !q && picks.length > 0 && <p className="mt-3 text-[14px] text-dim">You are watching this round.</p>}
      </Glass>
    );
  }

  const def = q.defender ? room.players[q.defender] : null;
  return (
    <Glass className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <Overline>{REGION_BY_ID[q.regionId].name}</Overline>
        <div className="flex items-center gap-3">
          {q.clash && <Tag>CLASH · fastest wins</Tag>}
          <PointsChip points={REGION_BY_ID[q.regionId].points} />
          <Tier tier={q.tier} />
        </div>
      </div>
      {def && (
        <p className="mt-1 text-[12.5px] text-faint">
          {q.kind === "counter" ? "Counter-attack on" : "Attacking"} {def.name}&apos;s territory
        </p>
      )}
      <h2 className="mt-2 text-[19px] font-medium leading-snug tracking-tight sm:text-[22px]">{q.text}</h2>
      <div className="mt-3 flex flex-col gap-2">
        {q.options.map((o, i) => {
          const chosen = myChoice === i;
          return (
            <motion.button
              key={i}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.06 * i }}
              whileTap={myChoice === null ? { scale: 0.975 } : undefined}
              onClick={() => onAnswer(i)}
              disabled={myChoice !== null}
              className="flex min-h-[48px] items-center gap-3 rounded-2xl border px-3.5 py-2 text-left text-[15px] outline-none transition-colors sm:min-h-[54px] sm:text-[16px]"
              style={{
                borderColor: chosen ? "var(--accent-glow)" : "var(--line)",
                background: chosen ? "rgba(207,106,60,0.22)" : "rgba(255,244,220,0.03)",
                opacity: myChoice !== null && !chosen ? 0.45 : 1,
                boxShadow: chosen ? "0 10px 28px -12px rgba(207,106,60,0.7)" : undefined,
              }}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-[13px] font-semibold text-dim">
                {"ABCD"[i]}
              </span>
              {o}
            </motion.button>
          );
        })}
      </div>
      <p className="min-h-[20px] pt-2.5 text-center text-[12.5px] text-dim">
        {err ? <span className="text-bad">{err}</span> : myChoice !== null ? "Answer locked in" : ""}
      </p>
    </Glass>
  );
}

function ResultPanel({ room, uid }: { room: RoomPublic; uid: string }) {
  const mineRes = room.results.find((r) => r.answers[uid]);
  const won = mineRes?.winner === uid;
  const newlyOut = Object.values(room.players).filter((p) => p.eliminated && !p.left && p.outRound === room.round && p.outStage === room.stage);
  const iAmOut = newlyOut.some((p) => p.uid === uid);
  const lost = room.results.filter((r) => r.defender === uid && r.winner && r.winner !== uid);
  let headline = "Round complete";
  if (mineRes) {
    if (won) headline = mineRes.defender ? "Territory captured" : "Territory claimed";
    else if (mineRes.answers[uid].correct) headline = "Beaten to it";
    else headline = mineRes.defender && mineRes.kind === "attack" ? "Attack failed" : "Missed it";
  } else if (lost.length) {
    headline = "Territory lost";
  }
  if (iAmOut) headline = "You are out";
  const bad = iAmOut || (!won && (lost.length > 0 || (mineRes && !mineRes.answers[uid].correct)));
  const myCounter = room.stage === "attack" ? room.counters[uid] : undefined;
  const strikers = room.stage === "attack" ? Object.keys(room.counters) : [];

  return (
    <Glass className="p-5">
      <Overline>{room.stage === "counter" ? `Round ${room.round} · Counter-attack results` : `Round ${room.round} · Results`}</Overline>
      <motion.h2
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring}
        className="mt-2 text-[30px] font-medium leading-tight tracking-tight"
        style={{ color: won ? "var(--ok)" : bad ? "var(--bad)" : "var(--ink)" }}
      >
        {headline}
      </motion.h2>
      <div className="mt-4 flex flex-col gap-2">
        {room.results.map((r, i) => {
          const w = r.winner ? room.players[r.winner] : null;
          const d = r.defender ? room.players[r.defender] : null;
          const q = room.questions[r.regionId];
          const pts = REGION_BY_ID[r.regionId].points;
          const takenFromMe = r.defender === uid && r.winner && r.winner !== uid;
          let line = "Nobody claimed it";
          if (w && d) line = `${w.name} captured it from ${d.name} · +${pts} pts`;
          else if (w) line = `Claimed by ${w.name} · +${pts} pts`;
          else if (d) line = `Attack repelled · ${d.name} holds it`;
          return (
            <motion.div
              key={r.regionId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.1 * i }}
              className="rounded-2xl border border-line bg-white/[0.03] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {w ? <PlayerDot player={w} size={22} /> : <span className="h-[22px] w-[22px] rounded-full border border-dashed border-line" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{REGION_BY_ID[r.regionId].name}</div>
                  <div className="text-[12.5px]" style={{ color: takenFromMe ? "var(--bad)" : "var(--ink-dim)" }}>
                    {line}
                  </div>
                </div>
                {r.clash && <Tag>CLASH</Tag>}
                {r.kind === "counter" && <Tag tone="blue">COUNTER</Tag>}
              </div>
              <div className="mt-2 text-[12.5px] text-faint">
                Answer: <span className="text-dim">{q.options[r.correctIndex]}</span>
              </div>
            </motion.div>
          );
        })}
        {!room.results.length && <p className="text-[15px] text-dim">No picks this round.</p>}
        {newlyOut.some((p) => p.uid !== uid) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 * (room.results.length + 1) }}
            className="rounded-2xl border px-4 py-3 text-[13.5px]"
            style={{ borderColor: "rgba(226,112,95,0.4)", background: "rgba(226,112,95,0.1)" }}
          >
            <span className="font-semibold text-bad">{names(room, newlyOut.filter((p) => p.uid !== uid).map((p) => p.uid))}</span>{" "}
            <span className="text-dim">lost the last region and is out of the game.</span>
          </motion.div>
        )}
        {strikers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 * (room.results.length + 1) }}
            className="rounded-2xl border px-4 py-3 text-[13.5px]"
            style={{ borderColor: "var(--line-strong)", background: "rgba(63,166,161,0.14)" }}
          >
            {myCounter ? (
              <>
                <span className="font-semibold text-glow">Counter-attack unlocked.</span>{" "}
                <span className="text-dim">Strike back at {names(room, myCounter.against)} next.</span>
              </>
            ) : (
              <span className="text-dim">Counter-attack next: {names(room, strikers)} {strikers.length > 1 ? "strike" : "strikes"} back.</span>
            )}
          </motion.div>
        )}
      </div>
    </Glass>
  );
}

function FinishedPanel({ room, uid }: { room: RoomPublic; uid: string }) {
  const ranked = rankPlayers(room);
  const iWon = room.winners.includes(uid);
  const sole = soleOwner(room.owners);
  const tie = room.winners.length > 1;
  const title = sole
    ? sole === uid
      ? "You conquered Australia"
      : `${room.players[sole]?.name ?? "Someone"} conquered Australia`
    : tie
      ? iWon
        ? "You tied for the win"
        : "It's a tie"
      : iWon
        ? "You win"
        : `${room.players[room.winners[0]]?.name ?? "Someone"} wins`;
  return (
    <Glass className="p-5">
      <Overline>Game over</Overline>
      <motion.h2
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring}
        className="glow-text mt-2 text-[34px] font-medium leading-tight tracking-tight"
      >
        {title}
      </motion.h2>
      <div className="mt-4 flex flex-col gap-2">
        {ranked.map((p, i) => (
          <motion.div
            key={p.uid}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.1 * i }}
            className="flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] px-4 py-3"
          >
            <span className="w-4 text-[13px] tabular-nums text-faint">{i + 1}</span>
            <PlayerDot player={p} size={22} />
            <span className="text-[15px] font-medium">{p.name}</span>
            <span className="ml-auto text-right text-[13px] tabular-nums text-dim">
              {scoreOf(room.owners, p.uid)} pts · {territoryCount(room.owners, p.uid)} regions
            </span>
          </motion.div>
        ))}
      </div>
      <div className="mt-5">
        <Link href="/">
          <PillButton variant="solid">Back to start</PillButton>
        </Link>
      </div>
    </Glass>
  );
}
