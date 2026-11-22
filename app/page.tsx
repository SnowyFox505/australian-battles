"use client";
import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AustraliaArt } from "@/components/AustraliaArt";
import { QrScanner } from "@/components/QrScanner";
import { RefreshButton } from "@/components/RefreshButton";
import { Glass, Overline, PillButton } from "@/components/ui";
import { api, warmUp } from "@/lib/client/api";
import { CODE_LENGTH } from "@/lib/game/config";

const NAME_KEY = "ab:name";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    warmUp(); // wake the server and sign in before the first tap
    try {
      // Reading localStorage after mount keeps server and client markup identical.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);

  const needName = () => {
    if (name.trim()) return false;
    setError("Enter your name first");
    return true;
  };
  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {}
  };

  async function host() {
    if (needName()) return;
    setBusy("host");
    setError("");
    try {
      remember();
      const { code } = await api<{ code: string }>("room/create", { name });
      router.push(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function joinWith(roomCode: string) {
    setBusy("join");
    setError("");
    try {
      remember();
      await api("room/join", { code: roomCode, name });
      router.push(`/room/${roomCode}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  function join() {
    if (needName()) return;
    if (code.length !== CODE_LENGTH) return setError("Enter the 5-character code");
    joinWith(code);
  }

  // A scanned code joins right away when the name is already known; otherwise the invite page asks for it.
  function onScanned(scanned: string) {
    setScanning(false);
    setCode(scanned);
    if (name.trim()) joinWith(scanned);
    else router.push(`/join/${scanned}`);
  }

  // `svh` is the stable viewport height: unlike `dvh` it does not change while the browser bars or
  // the PWA chrome settle, which used to make this layout (and the card) jump on phones.
  return (
    // Phone: one column. iPad upright (md): a wider, roomier column. iPad landscape and desktop (lg):
    // two columns, headline and big map on the left, the form card on the right.
    <main className="relative mx-auto flex min-h-svh w-full max-w-[460px] flex-col px-6 pb-[calc(24px+var(--safe-bottom))] pt-[calc(28px+var(--safe-top))] md:max-w-[680px] md:px-10 md:pt-[calc(40px+var(--safe-top))] lg:grid lg:max-w-[1280px] lg:grid-cols-[minmax(0,1.2fr)_minmax(400px,480px)] lg:items-center lg:gap-14 lg:px-14 lg:py-12 xl:gap-24">
      <RefreshButton className="absolute right-6 top-[calc(20px+var(--safe-top))] md:right-10 lg:right-14" />
      <section className="flex flex-1 flex-col lg:flex-none">
        <div className="rise">
          <Overline>Australia · 15 territories</Overline>
          <h1 className="title-hero mt-3">
            Claim the
            <br />
            <span className="glow-text text-glow">continent.</span>
          </h1>
          <p className="mt-4 max-w-[300px] text-[15px] leading-relaxed text-dim md:max-w-[460px] md:text-[18px]">
            Answer questions, take territory, outsmart your friends.
          </p>
          <div className="mt-8 hidden gap-9 md:flex">
            {[
              ["15", "Territories"],
              ["2–6", "Players"],
              ["1", "Code to join"],
            ].map(([n, label]) => (
              <div key={label} className="border-l border-line pl-4 first:border-0 first:pl-0">
                <div className="text-[28px] font-medium leading-none tabular-nums">{n}</div>
                <div className="mt-1.5 text-[13px] text-dim">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pointer-events-none relative -mx-2 my-2 min-h-[110px] flex-1 md:min-h-[320px] lg:mx-0 lg:mt-4 lg:h-[min(38svh,420px)] lg:min-h-0 lg:flex-none">
          <AustraliaArt className="absolute inset-0 h-full w-full lg:origin-left" />
        </div>
      </section>

      <Glass className="rise p-5 md:p-7 lg:p-8" style={{ ["--d" as string]: "0.2s" }}>
        <label className="eyebrow block">Your name</label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value.slice(0, 14));
            setError("");
          }}
          placeholder="e.g. Charlie"
          autoComplete="nickname"
          className="mt-2 h-12 w-full rounded-2xl border border-line bg-white/[0.03] px-4 text-[17px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong"
        />

        <div className="mt-4">
          <PillButton variant="solid" onClick={host} loading={busy === "host"}>
            Host a game
          </PillButton>
        </div>

        <div className="my-4 flex items-center gap-3 text-[12px] text-faint">
          <span className="h-px flex-1 bg-line" />
          or join
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex items-center gap-3">
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH));
              setError("");
            }}
            placeholder="CODE"
            inputMode="text"
            autoCapitalize="characters"
            className="h-14 w-[46%] rounded-full border border-line bg-white/[0.03] px-5 text-center text-[20px] font-medium tracking-[0.3em] text-ink outline-none transition-colors placeholder:tracking-[0.2em] placeholder:text-faint focus:border-line-strong"
          />
          <div className="flex-1">
            <PillButton onClick={join} loading={busy === "join"}>
              Join
            </PillButton>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={busy !== null}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-white/25 bg-white/[0.03] text-[15px] font-medium text-ink outline-none transition-opacity active:opacity-70 disabled:opacity-45"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7.5 12h9" />
          </svg>
          Scan QR code
        </button>

        {/* Space is always reserved, so an error message never shifts the layout. */}
        <p
          className="h-[22px] pt-2 text-[13px] leading-[14px] text-bad transition-opacity duration-200"
          style={{ opacity: error ? 1 : 0 }}
          aria-live="polite"
        >
          {error}
        </p>
      </Glass>

      <AnimatePresence>{scanning && <QrScanner onCode={onScanned} onClose={() => setScanning(false)} />}</AnimatePresence>
    </main>
  );
}
