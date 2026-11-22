"use client";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { haptic } from "@/components/ui";
import { CODE_ALPHABET, CODE_LENGTH } from "@/lib/game/config";

/** Accepts an invite link (…/join/ABCDE) or a bare room code. Anything else is ignored. */
export function parseRoomCode(text: string): string | null {
  const link = text.match(/\/join\/([A-Za-z0-9]+)/);
  const candidate = (link ? link[1] : text.trim()).toUpperCase();
  if (candidate.length !== CODE_LENGTH) return null;
  return [...candidate].every((c) => CODE_ALPHABET.includes(c)) ? candidate : null;
}

type Status = "starting" | "scanning" | "denied" | "nocamera" | "error";

type NativeDetector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => NativeDetector;

const MESSAGE: Record<Status, string> = {
  starting: "Starting the camera… If your phone asks, allow camera access.",
  scanning: "Point the camera at the QR code on the host's screen. Blurry? Tap the picture to focus.",
  denied: "Camera access is blocked. Allow the camera for this app in your phone or browser settings, or enter the code instead.",
  nocamera: "No camera found on this device. Enter the code instead.",
  error: "The camera could not be started. Enter the code instead.",
};

/**
 * Full-screen QR scanner. Asks for the camera (the browser shows its own permission prompt), then
 * reads frames until it finds a room code. Uses the browser's native QR detector where it exists
 * (Chrome on Android) and falls back to jsQR everywhere else, e.g. iPhone.
 */
export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [ring, setRing] = useState<{ x: number; y: number; id: number } | null>(null);

  /**
   * Tap the picture to focus there. Browsers that allow it (Chrome on Android, most Androids) get a
   * one-shot focus on the tapped point; the camera then goes back to continuous autofocus. iPhones
   * do not let web pages steer the focus, so there the tap only gives the ring and a nudge.
   */
  function focusAt(e: React.PointerEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || status !== "scanning") return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    setRing({ x: px, y: py, id: Date.now() });
    haptic(8);

    const track = trackRef.current;
    if (!track || !video.videoWidth) return;
    // The picture is cropped to fill the square (object-cover): map the tap back onto the full camera frame.
    const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
    const x = (video.videoWidth / 2 + (px - box.width / 2) / scale) / video.videoWidth;
    const y = (video.videoHeight / 2 + (py - box.height / 2) / scale) / video.videoHeight;
    const modes = ((track.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode ?? []) as string[];
    const apply = (advanced: Record<string, unknown>) =>
      track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints).catch(() => {});
    if (modes.includes("single-shot")) {
      apply({ focusMode: "single-shot", pointsOfInterest: [{ x, y }] }).then(() =>
        window.setTimeout(() => modes.includes("continuous") && apply({ focusMode: "continuous" }), 1800),
      );
    } else if (modes.includes("continuous")) {
      apply({ focusMode: "continuous", pointsOfInterest: [{ x, y }] });
    }
  }
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let stream: MediaStream | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setStatus("error");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        const name = (e as DOMException).name;
        if (!alive) return;
        return setStatus(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "nocamera"
              : "error",
        );
      }
      const video = videoRef.current;
      if (!alive || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      trackRef.current = stream.getVideoTracks()[0] ?? null;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (!alive) return;
      setStatus("scanning");

      let detector: NativeDetector | null = null;
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Native) {
        try {
          detector = new Native({ formats: ["qr_code"] });
        } catch {}
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (!alive) return;
        if (video.readyState >= 2 && video.videoWidth) {
          let text: string | null = null;
          try {
            if (detector) {
              text = (await detector.detect(video))[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              // A small copy of the frame is plenty for a QR code and keeps phones cool.
              const scale = Math.min(1, 520 / Math.max(video.videoWidth, video.videoHeight));
              const w = Math.round(video.videoWidth * scale);
              const h = Math.round(video.videoHeight * scale);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          } catch {}
          const code = text ? parseRoomCode(text) : null;
          if (code && alive) {
            alive = false;
            haptic([12, 40, 12]);
            onCodeRef.current(code);
            return;
          }
        }
        timer = window.setTimeout(tick, 110);
      };
      tick();
    }

    start();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const failed = status === "denied" || status === "nocamera" || status === "error";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-[#040d10]"
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR code"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between px-5 pt-[calc(16px+var(--safe-top))]">
        <span className="eyebrow">Join with QR code</span>
        <button
          onClick={onClose}
          aria-label="Close scanner"
          className="grid h-11 w-11 place-items-center rounded-full border border-line text-ink outline-none"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <motion.div
          className="relative aspect-square w-full max-w-[340px] overflow-hidden rounded-[32px] border border-line bg-black"
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        >
          <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
          {/* Tap anywhere on the picture to focus. Sits under the viewfinder corners, which ignore taps. */}
          <div className="absolute inset-0 touch-manipulation" onPointerDown={focusAt} aria-label="Tap to focus" role="presentation" />
          {ring && (
            <motion.span
              key={ring.id}
              className="pointer-events-none absolute h-[68px] w-[68px] rounded-full border-2 border-glow"
              style={{ left: ring.x - 34, top: ring.y - 34 }}
              initial={{ scale: 1.5, opacity: 0.9 }}
              animate={{ scale: 1, opacity: [0.9, 0.9, 0] }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              onAnimationComplete={() => setRing((r) => (r && r.id === ring.id ? null : r))}
            />
          )}
          {status === "scanning" && (
            <>
              <span className="scan-corner left-4 top-4 rounded-tl-2xl border-l-[3px] border-t-[3px]" />
              <span className="scan-corner right-4 top-4 rounded-tr-2xl border-r-[3px] border-t-[3px]" />
              <span className="scan-corner bottom-4 left-4 rounded-bl-2xl border-b-[3px] border-l-[3px]" />
              <span className="scan-corner bottom-4 right-4 rounded-br-2xl border-b-[3px] border-r-[3px]" />
              <span className="scan-line" />
            </>
          )}
          {status === "starting" && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-glow border-t-transparent" />
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 grid place-items-center bg-[#0a1c20] px-8 text-center">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.6A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .8.4L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                <circle cx="12" cy="12.5" r="3.5" />
                <path d="M3 3l18 18" />
              </svg>
            </div>
          )}
        </motion.div>
        <p className="mt-6 max-w-[320px] text-center text-[15px] leading-relaxed text-dim" aria-live="polite">
          {MESSAGE[status]}
        </p>
      </div>

      <div className="px-6 pb-[calc(24px+var(--safe-bottom))]">
        <button
          onClick={onClose}
          className="h-12 w-full rounded-full border border-white/25 bg-white/[0.03] text-[15px] font-medium text-ink outline-none"
        >
          Enter code instead
        </button>
      </div>
    </motion.div>
  );
}
