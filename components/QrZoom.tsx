"use client";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { haptic, spring, useIsClient } from "@/components/ui";

/** Full-screen QR code for scanning from across the table. Tap outside, press Esc or hit the X to close. */
export function QrZoom({ open, url, code, onClose }: { open: boolean; url: string; code: string; onClose: () => void }) {
  const client = useIsClient();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!client) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="qr-zoom"
          role="dialog"
          aria-modal="true"
          aria-label="Invite QR code"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] grid place-items-center px-5 pb-[calc(20px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))]"
          style={{ background: "rgba(4, 11, 13, 0.88)" }}
        >
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              haptic(8);
              onClose();
            }}
            className="absolute right-5 top-[calc(18px+var(--safe-top))] grid h-12 w-12 place-items-center rounded-full border border-white/25 bg-white/[0.06] text-ink outline-none transition-colors hover:bg-white/10 focus-visible:border-white/60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <motion.div
            initial={{ opacity: 0, scale: 0.88, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14 } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center"
          >
            <div className="rounded-[28px] bg-[#f6efe0] p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
              <QRCodeSVG
                value={url}
                size={512}
                marginSize={2}
                fgColor="#07161a"
                bgColor="#f6efe0"
                level="M"
                style={{ width: "min(80vw, 62svh, 520px)", height: "min(80vw, 62svh, 520px)" }}
              />
            </div>
            <div className="mt-5 text-[13px] text-dim">Scan to join</div>
            <div className="glow-text mt-1 text-[40px] font-semibold leading-none tracking-[0.12em] text-glow">{code}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
