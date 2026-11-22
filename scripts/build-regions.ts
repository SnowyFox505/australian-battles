/**
 * Builds the 15 playable regions of Australia from real state outlines.
 *
 * Input : scripts/states.raw.geojson (public Australian state boundaries)
 * Output: data/regions.geo.json   (15 polygons + metadata)
 *         data/regions.meta.json (id, name, tier, area, neighbours, label point)
 *         data/coast.geo.json     (outline of Australia for shoreline and shallows)
 *
 * Run: npm run build-regions
 */
import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

type Geo = Feature<Polygon | MultiPolygon>;

const root = path.resolve(__dirname, "..");
const raw = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/states.raw.geojson"), "utf8"),
) as { features: Geo[] };

const stateByName = (name: string): Geo => {
  const f = raw.features.find((x) => x.properties?.STATE_NAME === name);
  if (!f) throw new Error(`State not found: ${name}`);
  return f;
};

// Merge the ACT into NSW so the tiny territory does not become an unplayable region.
const nsw = turf.union(
  turf.featureCollection([
    stateByName("New South Wales"),
    stateByName("Australian Capital Territory"),
  ]),
) as Geo;

const rect = (w: number, s: number, e: number, n: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});

// Cut boxes share exact edges so the pieces tile their state without gaps.
const BIG = 1000;
type Def = {
  id: string;
  name: string;
  short: string;
  state: () => Geo;
  box: Polygon;
};

const WA = () => stateByName("Western Australia");
const NT = () => stateByName("Northern Territory");
const QLD = () => stateByName("Queensland");
const SA = () => stateByName("South Australia");
const VIC = () => stateByName("Victoria");
const TAS = () => stateByName("Tasmania");

const defs: Def[] = [
  { id: "wa-north", name: "Kimberley & Pilbara", short: "WA North", state: WA, box: rect(-BIG, -24.5, BIG, BIG) },
  { id: "wa-southwest", name: "South-West Coast", short: "WA South-West", state: WA, box: rect(-BIG, -BIG, 121.5, -24.5) },
  { id: "wa-east", name: "Goldfields & Nullarbor", short: "WA East", state: WA, box: rect(121.5, -BIG, BIG, -24.5) },
  { id: "nt-top", name: "Top End", short: "NT Top End", state: NT, box: rect(-BIG, -19, BIG, BIG) },
  { id: "nt-central", name: "Red Centre", short: "NT Central", state: NT, box: rect(-BIG, -BIG, BIG, -19) },
  { id: "qld-north", name: "Far North Queensland", short: "QLD North", state: QLD, box: rect(-BIG, -20.5, BIG, BIG) },
  { id: "qld-west", name: "Outback Queensland", short: "QLD West", state: QLD, box: rect(-BIG, -BIG, 144.5, -20.5) },
  { id: "qld-southeast", name: "South-East Queensland", short: "QLD South-East", state: QLD, box: rect(144.5, -BIG, BIG, -20.5) },
  { id: "sa-north", name: "Outback South Australia", short: "SA North", state: SA, box: rect(-BIG, -30.5, BIG, BIG) },
  { id: "sa-south", name: "Southern South Australia", short: "SA South", state: SA, box: rect(-BIG, -BIG, BIG, -30.5) },
  { id: "nsw-west", name: "Western New South Wales", short: "NSW West", state: () => nsw, box: rect(-BIG, -BIG, 146.5, BIG) },
  { id: "nsw-east", name: "Eastern New South Wales", short: "NSW East", state: () => nsw, box: rect(146.5, -BIG, BIG, BIG) },
  { id: "vic-west", name: "Western Victoria", short: "VIC West", state: VIC, box: rect(-BIG, -BIG, 144.8, BIG) },
  { id: "vic-east", name: "Eastern Victoria", short: "VIC East", state: VIC, box: rect(144.8, -BIG, BIG, BIG) },
  { id: "tasmania", name: "Tasmania", short: "Tasmania", state: TAS, box: rect(-BIG, -BIG, BIG, BIG) },
];

// Land borders are computed; sea links are added by hand.
const SEA_LINKS: [string, string][] = [
  ["tasmania", "vic-west"],
  ["tasmania", "vic-east"],
];

const round = (n: number) => Math.round(n * 1e3) / 1e3;
const roundCoords = (c: unknown): unknown =>
  Array.isArray(c) ? (typeof c[0] === "number" ? (c as number[]).map(round) : c.map(roundCoords)) : c;

const features: Geo[] = defs.map((d) => {
  const clipped = turf.intersect(
    turf.featureCollection([d.state(), turf.feature(d.box)]),
  ) as Geo | null;
  if (!clipped) throw new Error(`Empty region: ${d.id}`);
  // Drop tiny offshore islands (< 150 km²) so regions stay clean and tappable.
  const polys = turf.flatten(clipped).features.filter((p) => turf.area(p) / 1e6 > 150);
  const merged = turf.feature(
    {
      type: "MultiPolygon",
      coordinates: polys.map((p) => (p.geometry as Polygon).coordinates),
    } as MultiPolygon,
  ) as Geo;
  const simplified = turf.simplify(merged, { tolerance: 0.004, highQuality: true });
  simplified.geometry.coordinates = roundCoords(simplified.geometry.coordinates) as never;
  return simplified;
});

const areaKm2 = features.map((f) => turf.area(f) / 1e6);

// Difficulty tier from area: bigger region = harder question.
const tierOf = (km2: number) => (km2 < 200_000 ? 1 : km2 < 600_000 ? 2 : 3);

// Score weight per region (1 = small, 4 = huge). The final ranking is decided by these points.
const pointsOf = (km2: number) => (km2 < 200_000 ? 1 : km2 < 450_000 ? 2 : km2 < 650_000 ? 3 : 4);

// Adjacency via buffered overlap (ignores points where borders only touch).
const buffered = features.map((f) => turf.buffer(f, 2, { units: "kilometers" }) as Geo);
const neighbours: Record<string, Set<string>> = Object.fromEntries(defs.map((d) => [d.id, new Set<string>()]));
for (let i = 0; i < defs.length; i++) {
  for (let j = i + 1; j < defs.length; j++) {
    const ov = turf.intersect(turf.featureCollection([buffered[i], buffered[j]]));
    if (ov && turf.area(ov) / 1e6 > 60) {
      neighbours[defs[i].id].add(defs[j].id);
      neighbours[defs[j].id].add(defs[i].id);
    }
  }
}
for (const [a, b] of SEA_LINKS) {
  neighbours[a].add(b);
  neighbours[b].add(a);
}

const meta = defs.map((d, i) => {
  const label = turf.pointOnFeature(features[i]).geometry.coordinates.map(round);
  return {
    id: d.id,
    name: d.name,
    short: d.short,
    areaKm2: Math.round(areaKm2[i]),
    tier: tierOf(areaKm2[i]) as 1 | 2 | 3,
    points: pointsOf(areaKm2[i]) as 1 | 2 | 3 | 4,
    label,
    neighbours: [...neighbours[d.id]].sort(),
  };
});

const out = turf.featureCollection(
  features.map((f, i) => ({ ...f, id: i, properties: { ...meta[i] } })),
);
fs.writeFileSync(path.join(root, "data/regions.geo.json"), JSON.stringify(out));
fs.writeFileSync(path.join(root, "data/regions.meta.json"), JSON.stringify(meta, null, 2));

// Union outline of Australia, used for the shoreline and the shallow-water halo on the map.
const australia = turf.union(turf.featureCollection(features)) as Geo;
fs.writeFileSync(path.join(root, "data/coast.geo.json"), JSON.stringify(australia));

console.table(meta.map((m) => ({ id: m.id, km2: m.areaKm2, tier: m.tier, points: m.points, neighbours: m.neighbours.join(", ") })));
