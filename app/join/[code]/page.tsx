"use client";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { RefreshButton } from "@/components/RefreshButton";
import { Glass, Overline, PillButton, softSpring } from "@/components/ui";
import { api, warmUp } from "@/lib/client/api";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = raw.toUpperCase();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    warmUp(); // wake the server and sign in while the player types the name
    try {
      // Reading localStorage after mount keeps server and client markup identical.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(localStorage.getItem("ab:name") ?? "");
    } catch {}
  }, []);

  async function join() {
    if (!name.trim()) return setError("Enter your name first");
    setBusy(true);
    setError("");
    try {
      localStorage.setItem("ab:name", name.trim());
    } catch {}
    try {
      await api("room/join", { code, name });
      router.replace(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-svh w-full max-w-[460px] flex-col justify-center px-6 py-10">
      <RefreshButton className="absolute right-6 top-[calc(20px+var(--safe-top))]" />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
        <Overline>You&apos;re invited</Overline>
        <h1 className="title-xl mt-3">Join the battle</h1>
        <div className="mt-5 inline-flex items-center gap-3 rounded-full border border-line px-5 py-2.5">
          <span className="text-[13px] text-dim">Room</span>
          <span className="text-[22px] font-semibold tracking-[0.28em] text-glow">{code}</span>
        </div>
      </motion.div>
      <Glass className="mt-8 p-5" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.15 }}>
        <label className="eyebrow block">Your name</label>
        <input
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value.slice(0, 14));
            setError("");
          }}
          placeholder="e.g. Charlie"
          className="mt-2 h-12 w-full rounded-2xl border border-line bg-white/[0.03] px-4 text-[17px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong"
        />
        <div className="mt-4">
          <PillButton variant="solid" onClick={join} loading={busy}>
            Join game
          </PillButton>
        </div>
        <p className="min-h-[22px] pt-2 text-[13px] text-bad">{error}</p>
      </Glass>
    </main>
  );
}
