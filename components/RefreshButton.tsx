"use client";
import { useRef, useState } from "react";
import { haptic } from "@/components/ui";

type Phase = "idle" | "spin" | "done" | "fail";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Same effect as closing the installed app and opening it again, in one tap: fetch a fresh copy of
 * the page first (so nothing is wiped if we are offline), then clear every cache and the service
 * worker. The next load registers the new service worker again. Game state lives on the server and
 * the player's name in localStorage, so neither is touched.
 */
async function wipeAndPrepare(): Promise<boolean> {
  try {
    // Also refreshes the browser's HTTP cache. A slow or dead connection must never leave the button
    // spinning forever, so this gives up after a few seconds.
    const stop = new AbortController(); // (AbortSignal.timeout is missing on older iPhones)
    const timer = setTimeout(() => stop.abort(), 6000);
    const res = await fetch(location.href, { cache: "reload", signal: stop.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return false;
  } catch {
    return false;
  }
  try {
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {}
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
  return true;
}

/**
 * Small round refresh arrow. Tap: it spins, wipes the app cache, flashes a check mark and restarts
 * the app. Position it with `className` (it must be `absolute`/`relative`); `onMap` darkens it for
 * use on top of the map.
 */
export function RefreshButton({ className = "", onMap = false }: { className?: string; onMap?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = useRef(false);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    haptic(10);
    setPhase("spin");
    // Spin for at least one full turn so the animation is always visible.
    // Hard cap as well: whatever happens inside, the button is usable again after 12 s at the latest.
    const [ok] = await Promise.all([Promise.race([wipeAndPrepare(), wait(12000).then(() => false)]), wait(900)]);
    if (!ok) {
      setPhase("fail"); // offline or server unreachable: nothing was wiped
      await wait(1200);
      setPhase("idle");
      busy.current = false;
      return;
    }
    setPhase("done");
    haptic([8, 30, 8]);
    await wait(480);
    location.reload();
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={phase !== "idle"}
      aria-label="Refresh app"
      title={phase === "fail" ? "No connection" : "Refresh app"}
      data-phase={phase}
      className={`refresh-btn ${onMap ? "refresh-btn-map" : ""} ${className}`}
    >
      <span className="refresh-ripple" />
      <svg viewBox="0 0 24 24" className="refresh-arrow" aria-hidden>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
      <svg viewBox="0 0 24 24" className="refresh-check" aria-hidden>
        <path d="M6 12.5l4 4 8-9" />
      </svg>
    </button>
  );
}
