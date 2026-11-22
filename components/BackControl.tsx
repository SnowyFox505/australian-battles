"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic, spring, useIsClient } from "@/components/ui";
import type { RoomPublic } from "@/lib/game/types";

/**
 * Confirmation dialog in a warm orange-red: loud enough to make you stop, not an alarm-bell red.
 * Rendered in a portal so no animated parent can bend its fixed positioning.
 */
export function WarnDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Stay",
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const client = useIsClient();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus(); // the safe choice has the focus
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!client) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="warn-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.2 }}
          onClick={() => !busy && onCancel()}
          className="fixed inset-0 z-[100] grid place-items-center px-5 pb-[calc(20px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))]"
          style={{ background: "rgba(4, 11, 13, 0.66)" }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="warn-title"
            aria-describedby="warn-body"
            initial={{ opacity: 0, y: 28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.14, ease: "easeIn" } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-[28px] border p-6"
            style={{
              borderColor: "rgba(234, 90, 53, 0.46)",
              background: "radial-gradient(130% 90% at 0% 0%, rgba(234, 90, 53, 0.26), transparent 62%), linear-gradient(180deg, #241915, #151211)",
              boxShadow: "0 36px 90px -34px rgba(234, 90, 53, 0.5), inset 0 1px 0 rgba(255, 224, 205, 0.08)",
            }}
          >
            <motion.div
              initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ ...spring, delay: 0.08 }}
              className="grid h-12 w-12 place-items-center rounded-full border"
              style={{ borderColor: "rgba(234, 90, 53, 0.55)", background: "rgba(234, 90, 53, 0.16)", color: "var(--warn-glow)" }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9.5v4.2M12 17.2h.01" />
              </svg>
            </motion.div>

            <h2 id="warn-title" className="mt-4 text-[25px] font-medium leading-tight tracking-tight">
              {title}
            </h2>
            <p id="warn-body" className="mt-2 text-[15px] leading-relaxed text-dim">
              {body}
            </p>
            <p className="min-h-[18px] pt-2 text-[13px] text-warn-glow">{error}</p>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <motion.button
                ref={cancelRef}
                whileTap={busy ? undefined : { scale: 0.97 }}
                transition={spring}
                disabled={busy}
                onClick={() => {
                  haptic(8);
                  onCancel();
                }}
                className="h-[52px] rounded-full border border-white/20 bg-white/[0.04] text-[16px] font-medium text-ink outline-none transition-opacity focus-visible:border-white/50 disabled:opacity-45"
              >
                {cancelLabel}
              </motion.button>
              <motion.button
                whileTap={busy ? undefined : { scale: 0.97 }}
                transition={spring}
                disabled={busy}
                onClick={() => {
                  haptic([10, 40, 10]);
                  onConfirm();
                }}
                className="grid h-[52px] place-items-center rounded-full bg-warn text-[16px] font-medium text-white outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-70"
                style={{ boxShadow: "0 14px 34px -12px rgba(234, 90, 53, 0.85)" }}
              >
                {busy ? (
                  <motion.span
                    className="h-[18px] w-[18px] rounded-full border-2 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                  />
                ) : (
                  confirmLabel
                )}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Round "back" button plus its warning. What it does depends on where you are:
 * - lobby: leave the room, back to the start screen
 * - running game, host: end the game for everybody, back to the lobby
 * - running game, anyone else: leave the game, back to the start screen
 * - finished game: no warning, the same destinations
 */
export function BackControl({
  room,
  uid,
  onLeave,
  onEnd,
  className = "",
  onMap = false,
}: {
  room: RoomPublic;
  uid: string;
  /** Leave the room and go to the start screen. */
  onLeave: () => Promise<void>;
  /** Host: end the game for everybody and go back to the lobby. */
  onEnd: () => Promise<void>;
  /** Placement. Must make the button `relative` or `absolute` (its hit area hangs off that). */
  className?: string;
  onMap?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isHost = room.hostUid === uid;
  const inLobby = room.phase === "lobby";
  const toLobby = !inLobby && isHost;
  const run = toLobby ? onEnd : onLeave;
  const nextHost = Object.values(room.players)
    .filter((p) => p.uid !== uid && !p.left)
    .sort((a, b) => a.slot - b.slot)[0];

  let title = "Back to the start screen?";
  let body = "You leave this room. You can rejoin any time with the code or the invite link.";
  let confirmLabel = "Leave room";
  if (toLobby) {
    title = "Back to the lobby?";
    body = "The game ends for everyone. All players return to the lobby and the current standings are lost.";
    confirmLabel = "Back to lobby";
  } else if (!inLobby) {
    body = "You leave this game and can't rejoin it. Your territory becomes free for the others.";
    confirmLabel = "Leave game";
  } else if (isHost) {
    body = nextHost ? `You leave the room. ${nextHost.name} becomes the host.` : "Nobody else is here yet, so the room will be closed.";
    confirmLabel = nextHost ? "Leave room" : "Close room";
  }

  function press() {
    haptic(8);
    if (room.phase === "finished") {
      run().catch(() => {}); // nothing is lost any more, so no warning
      return;
    }
    setError("");
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await run();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const label = toLobby ? "Back to lobby" : "Back to start screen";
  return (
    <>
      <button
        type="button"
        onClick={press}
        aria-label={label}
        title={label}
        className={`back-btn ${onMap ? "back-btn-map" : ""} ${className}`}
      >
        <svg viewBox="0 0 24 24" className="back-arrow" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <WarnDialog
        open={open}
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
