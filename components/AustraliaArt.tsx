import hero from "@/data/hero-paths.json";

/**
 * Decorative Australia for the landing page, built from simplified region shapes.
 * Phone-friendly on purpose: no SVG filters and no JS animation. The regions light up one after
 * another with CSS opacity keyframes, the coastline draws itself, and the turquoise glow is a plain
 * gradient that fades and breathes on the compositor (see `.hero-*` in globals.css).
 */
export function AustraliaArt({ className = "" }: { className?: string }) {
  return (
    <div className={`hero-art ${className}`} aria-hidden>
      <div className="hero-glow" />
      <svg viewBox="0 0 378 346" className="relative h-full w-full" fill="none" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="aus-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e6c892" stopOpacity="0.42" />
            <stop offset="1" stopColor="#b97a46" stopOpacity="0.16" />
          </linearGradient>
        </defs>
        {hero.regions.map((r, i) => (
          <path
            key={r.id}
            d={r.d}
            className="hero-region"
            style={{ ["--i" as string]: i }}
            fill="url(#aus-fill)"
            stroke="#ecd9b0"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        ))}
        <path d={hero.coast} className="hero-coast" pathLength={1} stroke="#7fd3c9" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
