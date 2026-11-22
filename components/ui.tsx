"use client";
import { motion, type HTMLMotionProps } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PLAYER_SYMBOLS, colorOf } from "@/lib/game/config";
import { serverNow } from "@/lib/client/api";

const noop = () => () => {};
/** True on the client after hydration (portals need `document`; the server markup stays empty). */
export const useIsClient = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

export const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;
export const softSpring = { type: "spring", stiffness: 220, damping: 26 } as const;

export function haptic(ms: number | number[] = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

export function Glass({ className = "", ...p }: HTMLMotionProps<"div">) {
  return <motion.div className={`glass ${className}`} {...p} />;
}

export function Overline({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Outlined pill with a white circular arrow, as in the design reference. */
export function PillButton({
  children,
  onClick,
  disabled,
  loading,
  variant = "outline",
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "outline" | "solid";
  icon?: React.ReactNode;
}) {
  const off = disabled || loading;
  return (
    <motion.button
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={spring}
      onClick={() => {
        if (off) return;
        haptic(10);
        onClick?.();
      }}
      disabled={off}
      className={`relative flex h-[64px] w-full items-center justify-between rounded-full pl-7 pr-2.5 text-left text-[18px] font-medium tracking-tight outline-none transition-opacity ${
        variant === "solid"
          ? "bg-accent text-[#fff6e6] shadow-[0_14px_34px_-12px_rgba(207,106,60,0.75)]"
          : "border border-white/25 bg-white/[0.03] text-ink"
      } ${off ? "opacity-45" : ""}`}
    >
      <span>{children}</span>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f3ead7] text-[#07161a]">
        {loading ? (
          <motion.span
            className="h-4 w-4 rounded-full border-2 border-[#07161a] border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
          />
        ) : (
          (icon ?? <ArrowIcon className="h-5 w-5" />)
        )}
      </span>
    </motion.button>
  );
}

export function GhostButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={spring}
      onClick={onClick}
      className="h-12 rounded-full px-5 text-[15px] font-medium text-dim outline-none transition-colors hover:text-ink"
    >
      {children}
    </motion.button>
  );
}

/** The player's colour as a dot; the symbol (by seat) makes players distinguishable without colour. */
export function PlayerDot({ player, size = 14 }: { player: { slot: number; color?: number }; size?: number }) {
  const c = colorOf(player);
  const slot = player.slot;
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, background: c.hex, color: c.ink, boxShadow: "inset 0 0 0 1px rgba(255,244,220,0.28)", fontSize: size * 0.5 }}
    >
      {size >= 22 ? PLAYER_SYMBOLS[slot] : null}
    </span>
  );
}

/** Seconds remaining until a server-clock deadline. */
export function useCountdown(deadline: number | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - serverNow()) : 0;
}

export function CountdownRing({ deadline, total, size = 56 }: { deadline: number | null; total: number; size?: number }) {
  const left = useCountdown(deadline);
  const frac = Math.min(1, left / (total * 1000));
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const urgent = left < 5000 && left > 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(236,220,186,0.16)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? "var(--bad)" : "var(--accent-glow)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="absolute text-[15px] font-medium tabular-nums">{Math.ceil(left / 1000)}</span>
    </div>
  );
}
