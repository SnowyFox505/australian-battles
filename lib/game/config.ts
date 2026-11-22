import meta from "@/data/regions.meta.json";
import type { RegionMeta } from "./types";

export const REGIONS = meta as RegionMeta[];
export const REGION_BY_ID: Record<string, RegionMeta> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r]),
);

/** Seats shown in every lobby from the start. */
export const DEFAULT_SLOTS = 4;
/**
 * Most seats a host can open. Six keeps the map playable (15 regions, 9 still free at the start)
 * and stays tiny for the free Firebase tier: a game only ever has a handful of listeners.
 */
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const DEFAULT_ROUNDS = 15;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 30;
/** Safety limit so a conquest game cannot run forever. */
export const CONQUEST_ROUND_CAP = 40;

export const PICK_SECONDS = 20;
export const QUESTION_SECONDS = 20;
export const RESULT_SECONDS = 7;

/**
 * Fixed start regions by seat. Not used in normal games any more (starts are drawn at random by
 * `pickStartRegions`); only dev scripts use them, with `ABT_FIXED_STARTS=1` in `.env.local`.
 */
export const START_REGIONS = ["wa-southwest", "qld-southeast", "wa-north", "nt-central", "sa-north", "qld-north"];

/**
 * The 10 colours a player can pick in the lobby. Muted and earthy, readable on the sand-coloured
 * land and the turquoise sea (turquoise itself and sand tones are left out on purpose). `ink` is the
 * text colour on top of the colour (contrast 3.9-7.6, checked); `light` = the ink is light, so the
 * map label gets a dark shadow. The first colours are what players get by default, in this order.
 */
export const PLAYER_COLORS = [
  { name: "Uluru", hex: "#c8582f", ink: "#fffaf0", light: true },
  { name: "Ochre", hex: "#e2ab36", ink: "#2a2214", light: false },
  { name: "Eucalyptus", hex: "#6aa583", ink: "#10261a", light: false },
  { name: "Dusk", hex: "#a093d4", ink: "#1f1a3a", light: false },
  { name: "Coral", hex: "#d9718f", ink: "#34101c", light: false },
  { name: "Sky", hex: "#5f93d6", ink: "#0e2038", light: false },
  { name: "Raspberry", hex: "#a8304f", ink: "#ffeaf0", light: true },
  { name: "Indigo", hex: "#4a52b0", ink: "#eceeff", light: true },
  { name: "Slate", hex: "#56646f", ink: "#eef3f6", light: true },
  { name: "Plum", hex: "#8f4a9c", ink: "#fbeaff", light: true },
] as const;

/** Colour of a player: their pick, or (older rooms) the one that matches their seat. */
export const colorOf = (p: { slot: number; color?: number }) => PLAYER_COLORS[p.color ?? p.slot] ?? PLAYER_COLORS[0];

export const PLAYER_SYMBOLS = ["●", "▲", "■", "◆", "★", "✚"] as const;

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;
