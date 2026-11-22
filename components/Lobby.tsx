"use client";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { BackControl } from "@/components/BackControl";
import { RefreshButton } from "@/components/RefreshButton";
import { Glass, Overline, PillButton, PlayerDot, haptic, softSpring, spring } from "@/components/ui";
import { api } from "@/lib/client/api";
import { QrZoom } from "@/components/QrZoom";
import { CONQUEST_ROUND_CAP, DEFAULT_SLOTS, MAX_PLAYERS, MAX_ROUNDS, MIN_PLAYERS, MIN_ROUNDS, PLAYER_COLORS, colorOf } from "@/lib/game/config";
import type { GameMode, RoomPublic } from "@/lib/game/types";

export function Lobby({
  room,
  uid,
  onLeave,
  onEnd,
}: {
  room: RoomPublic;
  uid: string;
  onLeave: () => Promise<void>;
  onEnd: () => Promise<void>;
}) {
  const isHost = room.hostUid === uid;
  const players = Object.values(room.players).sort((a, b) => a.slot - b.slot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/join/${room.code}`;
  const ready = players.length >= MIN_PLAYERS;
  const settings = useGameSettings(room);
  const [zoom, setZoom] = useState(false);
  const seats = settings.shown.slots;

  async function start() {
    setBusy(true);
    setError("");
    try {
      await settings.settled(); // the host's last change must be saved before the game starts
      await api("room/start", { code: room.code });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <main className="relative mx-auto flex min-h-svh w-full max-w-[460px] flex-col px-6 pb-[calc(24px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))] md:max-w-[880px]">
      <div className="flex items-center justify-between">
        <BackControl room={room} uid={uid} onLeave={onLeave} onEnd={onEnd} className="relative" />
        <RefreshButton className="relative" />
      </div>
      <motion.div className="mt-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
        <Overline>Lobby · waiting for players</Overline>
        <h1 className="title-xl mt-3">Game room</h1>
      </motion.div>

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <Glass className="flex min-w-0 flex-col items-center gap-4 p-5 text-center md:flex-row md:gap-6 md:p-6 md:text-left" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.08 }}>
          <motion.button
            type="button"
            onClick={() => {
              haptic(8);
              setZoom(true);
            }}
            aria-label="Enlarge QR code"
            whileTap={{ scale: 0.97 }}
            className="relative shrink-0 cursor-zoom-in rounded-[20px] bg-[#f6efe0] p-2.5 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.7)] outline-none"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring, delay: 0.2 }}
          >
            {/* Big, with a proper quiet zone (marginSize): that is what makes it scan fast from another phone. */}
            {url && <QRCodeSVG value={url} size={256} marginSize={2} className="h-[168px] w-[168px] md:h-[176px] md:w-[176px]" fgColor="#07161a" bgColor="#f6efe0" level="M" />}
            <span className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-[#07161a]/80 text-[#f6efe0]" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
              </svg>
            </span>
          </motion.button>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-dim">Scan or enter code</div>
            <div className="glow-text mt-1 text-[30px] font-semibold leading-none tracking-[0.1em] text-glow md:text-[34px]">{room.code}</div>
            <button
              onClick={copy}
              className="mt-3 rounded-full border border-line px-4 py-1.5 text-[13px] text-dim outline-none transition-colors hover:text-ink"
            >
              {copied ? "Link copied" : "Copy invite link"}
            </button>
          </div>
        </Glass>

        <Glass className="min-w-0 p-5" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.16 }}>
          <div className="flex items-baseline justify-between">
            <Overline>Players</Overline>
            <span className="text-[13px] tabular-nums text-dim">
              {players.length} / {seats}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {Array.from({ length: seats }).map((_, i) => {
              // The last seat can be taken away again while nobody sits in it (never below the default seats).
              const removable = isHost && i === seats - 1 && i >= DEFAULT_SLOTS && !players.some((x) => x.slot === i);
              const p = players.find((x) => x.slot === i);
              return (
                <div key={i} className="relative h-[48px]">
                  <AnimatePresence mode="popLayout">
                    {p ? (
                      <motion.div
                        key={p.uid}
                        initial={{ opacity: 0, scale: 0.9, x: -16 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        transition={spring}
                        className="flex h-full items-center gap-3 rounded-2xl border px-4"
                        style={{ borderColor: `${colorOf(p).hex}66`, background: `${colorOf(p).hex}14` }}
                      >
                        <PlayerDot player={p} size={24} />
                        <span className="truncate text-[16px] font-medium">{p.name}</span>
                        <span className="ml-auto text-[12px] text-dim">
                          {p.uid === room.hostUid ? "Host" : p.uid === uid ? "You" : ""}
                        </span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`empty-${i}`}
                        className="flex h-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 text-[14px] text-faint"
                        style={{ animation: "breathe 2.4s ease-in-out infinite" }}
                      >
                        <span className="h-6 w-6 rounded-full border border-dashed border-line" />
                        Waiting…
                        {removable && (
                          <button
                            type="button"
                            aria-label="Remove this seat"
                            onClick={() => {
                              haptic(8);
                              settings.change((cur) => ({ ...cur, slots: cur.slots - 1 }));
                            }}
                            className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-line text-[18px] leading-none text-dim outline-none transition-colors hover:text-ink"
                          >
                            −
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {isHost && seats < MAX_PLAYERS && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                transition={spring}
                onClick={() => {
                  haptic(8);
                  settings.change((cur) => ({ ...cur, slots: Math.min(MAX_PLAYERS, cur.slots + 1) }));
                }}
                className="flex h-[48px] items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[14px] font-medium text-glow outline-none transition-colors hover:bg-white/[0.03]"
              >
                <span className="text-[20px] leading-none">+</span> Add a seat
              </motion.button>
            )}
          </div>
        </Glass>
        <ColorPicker room={room} uid={uid} />
        <GameSettings settings={settings} isHost={isHost} />
      </div>

      <div className="mt-auto pt-8">
        {isHost ? (
          <>
            <PillButton variant="solid" onClick={start} loading={busy} disabled={!ready}>
              {ready ? "Start game" : `Need ${MIN_PLAYERS - players.length} more player${MIN_PLAYERS - players.length > 1 ? "s" : ""}`}
            </PillButton>
            <p className="min-h-[22px] pt-2 text-center text-[13px] text-bad">{error}</p>
          </>
        ) : (
          <p className="text-center text-[14px] text-dim" style={{ animation: "breathe 2.4s ease-in-out infinite" }}>
            Waiting for the host to start…
          </p>
        )}
      </div>
      <QrZoom open={zoom} url={url} code={room.code} onClose={() => setZoom(false)} />
    </main>
  );
}

/**
 * Everyone picks their own colour from the 10 presets. A taken colour is greyed out for the others
 * the moment its owner picks it (the room is live). The tap is optimistic; if someone else was a
 * split second faster, the server says so and the old colour comes back with a short note.
 */
function ColorPicker({ room, uid }: { room: RoomPublic; uid: string }) {
  const me = room.players[uid];
  const [pending, setPending] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const latest = useRef<number | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const noteTimer = useRef(0);

  const confirmed = me ? (me.color ?? me.slot) : 0;
  // Drop the local choice once the room has caught up with it.
  if (pending !== null && pending === confirmed) setPending(null);
  const mine = pending ?? confirmed;
  const takenBy = new Map<number, string>();
  for (const p of Object.values(room.players)) if (p.uid !== uid) takenBy.set(p.color ?? p.slot, p.name);

  function pick(c: number) {
    if (c === mine || takenBy.has(c)) return;
    haptic(8);
    latest.current = c;
    setPending(c);
    setNote("");
    chain.current = chain.current.then(async () => {
      if (latest.current !== c) return; // superseded by a newer tap
      try {
        await api("room/color", { code: room.code, color: c });
        window.setTimeout(() => {
          if (latest.current !== c) return;
          latest.current = null;
          setPending((cur) => (cur === c ? null : cur)); // safety net
        }, 4000);
      } catch (e) {
        if (latest.current !== c) return;
        latest.current = null;
        setPending(null);
        setNote((e as Error).message);
        window.clearTimeout(noteTimer.current);
        noteTimer.current = window.setTimeout(() => setNote(""), 3200);
      }
    });
  }

  return (
    <Glass className="min-w-0 p-5 md:col-span-2" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.2 }}>
      <div className="flex items-baseline justify-between">
        <Overline>Your colour</Overline>
        <span className="text-[13px] text-dim">{PLAYER_COLORS[mine].name}</span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2.5 sm:gap-3 lg:grid-cols-10">
        {PLAYER_COLORS.map((c, i) => {
          const owner = takenBy.get(i);
          const selected = i === mine;
          return (
            <motion.button
              key={c.name}
              type="button"
              layout
              disabled={!!owner}
              onClick={() => pick(i)}
              whileTap={owner || selected ? undefined : { scale: 0.9 }}
              transition={spring}
              aria-label={owner ? `${c.name}, taken by ${owner}` : selected ? `${c.name}, your colour` : c.name}
              aria-pressed={selected}
              className="relative mx-auto grid aspect-square w-full max-w-[56px] place-items-center rounded-full outline-none"
              style={{
                background: c.hex,
                opacity: owner ? 0.22 : 1,
                boxShadow: selected ? `0 0 0 2px var(--bg), 0 0 0 4px ${c.hex}, 0 10px 24px -8px ${c.hex}` : "inset 0 0 0 1px rgba(255,244,220,0.25)",
              }}
            >
              {selected && (
                <motion.svg initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={c.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5.5 12.5l4.2 4.2 8.8-9.4" />
                </motion.svg>
              )}
              {owner && (
                <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold text-ink" aria-hidden>
                  {owner.slice(0, 1).toUpperCase()}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <p className="min-h-[18px] pt-2.5 text-[12.5px] text-warn-glow" aria-live="polite">
        {note}
      </p>
    </Glass>
  );
}

type Settings = { mode: GameMode; rounds: number; slots: number };

/**
 * The host's game-length choice, optimistic: a tap changes the screen at once and is sent to the
 * server in the background, one request at a time and in order (rapid taps collapse into the latest
 * value). Everyone else just sees the room's live values. If the server refuses, it snaps back.
 */
function useGameSettings(room: RoomPublic) {
  const [local, setLocal] = useState<Settings | null>(null);
  const latest = useRef<Settings | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  // Drop the local value as soon as the server's snapshot has caught up with it.
  const server: Settings = { mode: room.mode, rounds: room.rounds, slots: room.slots ?? DEFAULT_SLOTS };
  if (local && local.mode === server.mode && local.rounds === server.rounds && local.slots === server.slots) setLocal(null);

  const shown: Settings = local ?? server;

  /** `update` receives the newest value, including taps that have not been rendered yet. */
  function change(update: (current: Settings) => Settings) {
    const next = update(latest.current ?? server);
    latest.current = next;
    setLocal(next);
    chain.current = chain.current.then(async () => {
      if (latest.current !== next) return; // superseded by a newer tap
      try {
        await api("room/settings", { code: room.code, ...next });
        // Safety net: if the snapshot never confirms the value, fall back to what the server has.
        setTimeout(() => {
          if (latest.current !== next) return;
          latest.current = null;
          setLocal((l) => (l === next ? null : l));
        }, 4000);
      } catch {
        latest.current = null;
        setLocal(null);
      }
    });
  }

  return { shown, change, settled: () => chain.current };
}

/** Host picks how the game ends; everyone else sees the choice live. */
function GameSettings({ settings, isHost }: { settings: ReturnType<typeof useGameSettings>; isHost: boolean }) {
  const s = settings.shown;
  const clamp = (n: number) => Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, n));
  const modes: { id: GameMode; label: string }[] = [
    { id: "rounds", label: "Rounds" },
    { id: "conquest", label: "Conquest" },
  ];
  return (
    <Glass
      className="min-w-0 p-5 md:col-span-2"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...softSpring, delay: 0.24 }}
    >
      <Overline>Game length</Overline>
      <div className="relative mt-3 grid grid-cols-2 rounded-full border border-line p-1">
        {modes.map((m) => {
          const active = s.mode === m.id;
          return (
            <button
              key={m.id}
              disabled={!isHost}
              onClick={() => settings.change((cur) => ({ ...cur, mode: m.id }))}
              className="relative z-10 h-10 rounded-full text-[15px] font-medium outline-none transition-colors"
              style={{ color: active ? "#fff6e6" : "var(--ink-dim)" }}
            >
              {active && (
                <motion.span
                  layoutId="mode-pill"
                  transition={spring}
                  className="absolute inset-0 -z-10 rounded-full bg-accent shadow-[0_10px_26px_-10px_rgba(207,106,60,0.8)]"
                />
              )}
              {m.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={s.mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
          className="mt-4"
        >
          {s.mode === "rounds" ? (
            <div className="flex items-center gap-4">
              {isHost && (
                <Stepper label="Fewer rounds" disabled={s.rounds <= MIN_ROUNDS} onClick={() => settings.change((cur) => ({ ...cur, mode: "rounds", rounds: clamp(cur.rounds - 1) }))}>
                  −
                </Stepper>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[26px] font-medium leading-none tabular-nums">
                  {s.rounds} <span className="text-[15px] font-normal text-dim">rounds</span>
                </div>
                <p className="mt-2 text-[13px] leading-snug text-dim">Everyone picks a territory and answers once per round. Highest score after the last round wins.</p>
              </div>
              {isHost && (
                <Stepper label="More rounds" disabled={s.rounds >= MAX_ROUNDS} onClick={() => settings.change((cur) => ({ ...cur, mode: "rounds", rounds: clamp(cur.rounds + 1) }))}>
                  +
                </Stepper>
              )}
            </div>
          ) : (
            <p className="text-[13.5px] leading-snug text-dim">
              Play until one player owns all of Australia. If nobody manages it within {CONQUEST_ROUND_CAP} rounds, the highest score wins.
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </Glass>
  );
}

function Stepper({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={spring}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic(8);
        onClick();
      }}
      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line-strong text-[24px] leading-none text-ink outline-none transition-opacity disabled:opacity-30"
      style={{ borderColor: "var(--line-strong)" }}
    >
      {children}
    </motion.button>
  );
}
