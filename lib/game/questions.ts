import "server-only";
import type { RegionTier } from "./types";

export type Question = {
  id: string;
  tier: RegionTier;
  text: string;
  options: string[];
  /** index of the correct option */
  answer: number;
};

/**
 * PLACEHOLDER questions so the game loop can be played end to end.
 * The real question set will be supplied later: keep this shape
 * (tier 1 = small region / easy, tier 3 = large region / hard).
 */
export const QUESTIONS: Question[] = [
  { id: "e1", tier: 1, text: "What is the capital city of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2 },
  { id: "e2", tier: 1, text: "Which animal is on the Australian coat of arms next to the emu?", options: ["Koala", "Kangaroo", "Wombat", "Dingo"], answer: 1 },
  { id: "e3", tier: 1, text: "Which ocean lies to the west of Australia?", options: ["Pacific", "Atlantic", "Indian", "Arctic"], answer: 2 },
  { id: "e4", tier: 1, text: "What is the largest coral reef system in the world called?", options: ["Great Barrier Reef", "Coral Triangle", "Ningaloo Reef", "Red Sea Reef"], answer: 0 },
  { id: "e5", tier: 1, text: "Which city hosts the famous Opera House?", options: ["Brisbane", "Sydney", "Adelaide", "Hobart"], answer: 1 },
  { id: "m1", tier: 2, text: "Which Australian state is known as the Apple Isle?", options: ["Victoria", "Tasmania", "South Australia", "Queensland"], answer: 1 },
  { id: "m2", tier: 2, text: "What is the name of the large sandstone monolith in the Northern Territory?", options: ["Uluru", "Mount Augustus", "Kata Tjuta Peak", "Wave Rock"], answer: 0 },
  { id: "m3", tier: 2, text: "Which river is the longest in Australia?", options: ["Murray River", "Darling River", "Murrumbidgee", "Swan River"], answer: 0 },
  { id: "m4", tier: 2, text: "In which year did the Sydney Olympic Games take place?", options: ["1996", "2000", "2004", "1992"], answer: 1 },
  { id: "m5", tier: 2, text: "Which city is the capital of Western Australia?", options: ["Fremantle", "Perth", "Darwin", "Broome"], answer: 1 },
  { id: "h1", tier: 3, text: "What is the highest mountain on the Australian mainland?", options: ["Mount Kosciuszko", "Mount Bogong", "Mount Ossa", "Mount Zeil"], answer: 0 },
  { id: "h2", tier: 3, text: "Which desert covers a large part of Western Australia's interior?", options: ["Gobi", "Great Victoria Desert", "Mojave", "Sahara"], answer: 1 },
  { id: "h3", tier: 3, text: "Roughly how large is Australia's land area?", options: ["2.1 million km²", "4.5 million km²", "7.7 million km²", "10.2 million km²"], answer: 2 },
  { id: "h4", tier: 3, text: "Which strait separates Tasmania from the mainland?", options: ["Torres Strait", "Bass Strait", "Cook Strait", "Bering Strait"], answer: 1 },
  { id: "h5", tier: 3, text: "Which Australian city was the first British settlement in 1788?", options: ["Melbourne", "Sydney", "Hobart", "Newcastle"], answer: 1 },
];

export function pickQuestion(tier: RegionTier, used: string[]): Question {
  const pool = QUESTIONS.filter((q) => q.tier === tier);
  const fresh = pool.filter((q) => !used.includes(q.id));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}
