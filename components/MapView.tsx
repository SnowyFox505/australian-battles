"use client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import coast from "@/data/coast.geo.json";
import regions from "@/data/regions.geo.json";
import { PLAYER_SYMBOLS, REGIONS, colorOf } from "@/lib/game/config";
import type { PlayerPublic } from "@/lib/game/types";

// Turbopack cannot bundle the MapLibre worker, so it is served as a static file
// (copied from node_modules by the postinstall script).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const AUS_BOUNDS: [[number, number], [number, number]] = [
  [113.2, -43.9],
  [153.9, -10.4],
];
const FIT = { padding: { top: 14, bottom: 14, left: 8, right: 8 }, duration: 0 };

/** Muted turquoise sea, deeper towards the edges. The map itself is transparent. */
const SEA = "radial-gradient(115% 90% at 52% 42%, #3a9ea0 0%, #25808a 48%, #17606d 100%)";

const LAND = "#cdbf9d";
const LAND_SELECTABLE = "#e1d3ad";
const LAND_STROKE = "rgba(88, 70, 40, 0.55)";
const OWNED_STROKE = "rgba(26, 20, 10, 0.5)";
const CREAM = "#fff3d3";
const LABEL_INK = "#2a2214";

type Props = {
  owners: Record<string, string>;
  players: Record<string, PlayerPublic>;
  /** regions the current player may tap */
  selectable?: string[];
  selected?: string | null;
  /** regions currently in play this round (picks revealed) */
  active?: string[];
  onSelect?: (id: string) => void;
  className?: string;
};

export function MapView({ owners, players, selectable = [], selected = null, active = [], onSelect, className = "" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const markers = useRef<Record<string, { m: maplibregl.Marker; node: HTMLDivElement }>>({});
  const prevOwners = useRef<Record<string, string>>({});
  const applied = useRef<Record<string, string>>({}); // last feature state written per region
  const appliedLabels = useRef<Record<string, string>>({}); // last label markup written per region
  const live = useRef({ selectable, onSelect });
  const state = useRef({ owners, players, selectable, selected, active });
  // Keep refs current for the long-lived map callbacks (runs before the effects below).
  useEffect(() => {
    live.current = { selectable, onSelect };
    state.current = { owners, players, selectable, selected, active };
  });

  const apply = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const { owners, players, selectable, selected, active } = state.current;
    // Every snapshot hands us new objects, but usually only one or two regions really changed.
    // Touching only those keeps the map (and the phone) calm.
    for (const r of REGIONS) {
      const owner = owners[r.id];
      const pl = owner ? players[owner] : undefined;
      const slot = pl?.slot;
      const col = pl ? colorOf(pl) : undefined;
      const isSelectable = selectable.includes(r.id);
      const isSelected = selected === r.id;

      const stateKey = `${slot ?? "-"}|${col?.hex ?? "-"}|${isSelectable}|${isSelected}|${active.includes(r.id)}`;
      if (applied.current[r.id] !== stateKey) {
        applied.current[r.id] = stateKey;
        map.setFeatureState(
          { source: "regions", id: r.id },
          {
            owned: !!owner,
            color: col ? col.hex : LAND,
            selectable: isSelectable,
            selected: isSelected,
            active: active.includes(r.id),
          },
        );
      }
      const mk = markers.current[r.id];
      const labelKey = `${slot ?? "-"}|${col?.hex ?? "-"}|${owner || isSelectable || isSelected ? 1 : 0}`;
      if (mk && appliedLabels.current[r.id] !== labelKey) {
        appliedLabels.current[r.id] = labelKey;
        const [first, ...rest] = r.short.split(" ");
        const sym = slot !== undefined ? `${PLAYER_SYMBOLS[slot]} ` : "";
        const ink = col ? col.ink : LABEL_INK;
        const light = !!col?.light;
        mk.node.style.color = ink;
        mk.node.style.textShadow = light ? "0 1px 4px rgba(60,20,5,.55)" : "0 0 6px rgba(255,243,211,.5)";
        mk.node.innerHTML = `<div>${sym}${first}</div>${rest.length ? `<div>${rest.join(" ")}</div>` : ""}<div style="margin:3px auto 0;width:15px;height:15px;line-height:13px;border-radius:8px;border:1px solid currentColor;background:rgba(255,255,255,.16);font-size:8.5px;letter-spacing:0">${r.points}</div>`;
        mk.node.style.opacity = owner || isSelectable || isSelected ? "1" : "0.8";
      }
      // claim flash
      if (owner && prevOwners.current[r.id] !== owner && Object.keys(prevOwners.current).length) flash(map, r.id);
    }
    prevOwners.current = { ...owners };
  };

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      // No external tiles: sea, land and coast are all drawn from our own region data.
      style: { version: 8, sources: {}, layers: [] },
      bounds: AUS_BOUNDS,
      fitBoundsOptions: FIT,
      attributionControl: false,
      interactive: true,
      fadeDuration: 0,
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __abMap?: unknown }).__abMap = map;
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();
    map.keyboard.disable();
    map.dragRotate.disable();
    map.touchPitch.disable();

    const setup = () => {
      const st = (k: string): maplibregl.ExpressionSpecification => ["boolean", ["feature-state", k], false];
      map.addSource("coast", { type: "geojson", data: coast as never });
      map.addSource("regions", { type: "geojson", data: regions as never, promoteId: "id" });

      // Shallow water: two soft, light-turquoise halos around the coast.
      map.addLayer({
        id: "shallows-wide",
        type: "line",
        source: "coast",
        paint: { "line-color": "#8fd9cf", "line-width": 34, "line-blur": 22, "line-opacity": 0.2 },
      });
      map.addLayer({
        id: "shallows",
        type: "line",
        source: "coast",
        paint: { "line-color": "#a9e9dc", "line-width": 12, "line-blur": 8, "line-opacity": 0.32 },
      });

      map.addLayer({
        id: "regions-fill",
        type: "fill",
        source: "regions",
        paint: {
          "fill-color": [
            "case",
            st("owned"), ["coalesce", ["feature-state", "color"], LAND],
            st("selected"), "#efe2bd",
            st("selectable"), LAND_SELECTABLE,
            LAND,
          ],
          "fill-opacity": ["case", st("owned"), 0.94, 1],
        },
      });
      // Cream wash on the selected region and a brief flash when a region is claimed.
      map.addLayer({
        id: "regions-hilite",
        type: "fill",
        source: "regions",
        paint: {
          "fill-color": CREAM,
          "fill-opacity": ["+", ["case", st("selected"), 0.3, 0], ["*", ["coalesce", ["feature-state", "pulse"], 0], 0.55]],
        },
      });
      map.addLayer({
        id: "regions-line",
        type: "line",
        source: "regions",
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["case", st("owned"), OWNED_STROKE, LAND_STROKE],
          "line-width": ["case", st("owned"), 1.1, 0.9],
        },
      });
      // Shoreline: a fine, bright foam edge.
      map.addLayer({
        id: "coast-line",
        type: "line",
        source: "coast",
        layout: { "line-join": "round" },
        paint: { "line-color": "rgba(250, 242, 220, 0.8)", "line-width": 1.1 },
      });
      map.addLayer({
        id: "regions-selectable",
        type: "line",
        source: "regions",
        layout: { "line-join": "round" },
        paint: { "line-color": CREAM, "line-width": 2.4, "line-opacity": ["case", st("selectable"), 0.85, 0] },
      });
      map.addLayer({
        id: "regions-selected",
        type: "line",
        source: "regions",
        layout: { "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3.4, "line-opacity": ["case", st("selected"), 1, 0] },
      });

      // Labels as HTML markers: crisp, themeable, never blocks taps.
      for (const r of REGIONS) {
        const node = document.createElement("div");
        node.style.cssText =
          "pointer-events:none;font:700 9px/1.18 var(--font-jakarta),sans-serif;letter-spacing:.05em;text-transform:uppercase;text-align:center;white-space:nowrap;transition:opacity .4s";
        const m = new maplibregl.Marker({ element: node }).setLngLat(r.label as [number, number]).addTo(map);
        markers.current[r.id] = { m, node };
      }

      map.on("click", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["regions-fill"] })[0];
        const id = f?.properties?.id as string | undefined;
        if (id && live.current.selectable.includes(id)) live.current.onSelect?.(id);
      });
      map.on("mousemove", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["regions-fill"] })[0];
        const id = f?.properties?.id as string | undefined;
        map.getCanvas().style.cursor = id && live.current.selectable.includes(id) ? "pointer" : "";
      });

      ready.current = true;
      apply();

      // Gentle breathing on tappable regions.
      let raf = 0;
      let last = 0;
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (t - last < 66 || document.hidden || !state.current.selectable.length) return;
        last = t;
        const o = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t / 480));
        map.setPaintProperty("regions-selectable", "line-opacity", ["case", st("selectable"), o, 0]);
      };
      raf = requestAnimationFrame(loop);
      map.once("remove", () => cancelAnimationFrame(raf));
    };
    if (map.isStyleLoaded()) setup();
    else map.once("style.load", setup);

    const ro = new ResizeObserver(() => {
      map.resize();
      map.fitBounds(AUS_BOUNDS, FIT);
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      ready.current = false;
      markers.current = {};
      applied.current = {};
      appliedLabels.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(apply, [owners, players, selectable, selected, active]);

  // MapLibre forces `position: relative` on its container, so it gets its own full-size child.
  return (
    <div className={className} style={{ background: SEA }}>
      <div ref={el} className="h-full w-full" />
    </div>
  );
}

/** Short soft flash on a freshly claimed region. */
function flash(map: maplibregl.Map, id: string) {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 900);
    try {
      map.setFeatureState({ source: "regions", id }, { pulse: 1 - k });
    } catch {
      return;
    }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
