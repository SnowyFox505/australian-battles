/**
 * Builds the lightweight outline paths for the landing-page hero (components/AustraliaArt.tsx).
 * The playable map data has ~17k points; the hero is only a few hundred pixels wide, so it uses
 * strongly simplified shapes. This keeps the landing bundle tiny and the animation smooth on phones.
 *
 * Input : data/regions.geo.json, data/coast.geo.json
 * Output: data/hero-paths.json  { regions: [{ id, d }], coast: "M…Z" }
 *
 * Run: npm run build-hero   (after npm run build-regions)
 */
import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

type Geo = Feature<Polygon | MultiPolygon>;

const root = path.resolve(__dirname, "..");
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as T;

const K = Math.cos((27 * Math.PI) / 180);
const proj = ([lon, lat]: number[]) => [(lon - 112.4) * K * 10, (-9.8 - lat) * 10] as const;

/** Simplify, drop specks, project to the hero viewBox (378 x 346) and serialise as an SVG path. */
function toPath(feature: Geo, tolerance: number, minKm2: number): string {
  const polys = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
  let d = "";
  for (const poly of polys) {
    if (turf.area(turf.polygon(poly)) / 1e6 < minKm2) continue;
    const simple = turf.simplify(turf.polygon(poly), { tolerance, highQuality: true, mutate: false });
    for (const ring of simple.geometry.coordinates) {
      let last = "";
      const pts: string[] = [];
      for (const c of ring) {
        const [x, y] = proj(c);
        const p = `${x.toFixed(1)},${y.toFixed(1)}`;
        if (p !== last) pts.push(p);
        last = p;
      }
      if (pts.length > 3) d += `M${pts.join("L")}Z`;
    }
  }
  return d;
}

const regions = read<{ features: Geo[] }>("data/regions.geo.json").features.map((f) => ({
  id: String(f.properties?.id),
  d: toPath(f, 0.06, 0),
}));
const coast = toPath(read<Geo>("data/coast.geo.json"), 0.08, 3000);

fs.writeFileSync(path.join(root, "data/hero-paths.json"), JSON.stringify({ regions, coast }));
const size = (s: string) => s.split(/[ML]/).length;
console.log("regions points:", regions.reduce((n, r) => n + size(r.d), 0), "coast points:", size(coast));
