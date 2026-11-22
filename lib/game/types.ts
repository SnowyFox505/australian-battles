export type Phase = "lobby" | "pick" | "question" | "result" | "finished";

export type RegionTier = 1 | 2 | 3;

/** "rounds": fixed number of rounds. "conquest": play until one player owns all of Australia. */
export type GameMode = "rounds" | "conquest";

/** "attack": normal pick round. "counter": follow-up where players whose territory was attacked in vain strike back. */
export type Stage = "attack" | "counter";

/** free = unowned region, attack = region held by another player, counter = revenge strike. */
export type QuestionKind = "free" | "attack" | "counter";

/** Revenge strike unlocked for a defender: regions of the failed attackers next to the defender's land. */
export type Counter = { against: string[]; regions: string[] };

export type RegionMeta = {
  id: string;
  name: string;
  short: string;
  areaKm2: number;
  tier: RegionTier;
  /** score value of the region (1 small ... 4 huge) */
  points: 1 | 2 | 3 | 4;
  label: [number, number];
  neighbours: string[];
};

export type PlayerPublic = {
  uid: string;
  name: string;
  /** seat in the lobby; also decides the symbol and the fixed start region in dev scripts */
  slot: number;
  /** index into PLAYER_COLORS, chosen by the player (unique within a room) */
  color?: number;
  startRegion: string | null;
  score: number;
  /** has locked in a pick this round (pick itself stays hidden) */
  picked: boolean;
  /** has submitted an answer this round */
  answered: boolean;
  /** lost every region: out of the game, only watching */
  eliminated: boolean;
  outRound: number | null;
  outStage: Stage | null;
  /** walked out of a running game: counts as eliminated, their land was freed */
  left?: boolean;
};

export type QuestionPublic = {
  regionId: string;
  tier: RegionTier;
  text: string;
  options: string[];
  /** players who must answer it; more than one = clash */
  players: string[];
  kind: QuestionKind;
  /** current owner of the region (the player being attacked), if any */
  defender: string | null;
  clash: boolean;
};

export type RoundResult = {
  regionId: string;
  kind: QuestionKind;
  defender: string | null;
  clash: boolean;
  winner: string | null;
  /** uid -> { correct, ms } */
  answers: Record<string, { correct: boolean; ms: number | null }>;
  correctIndex: number;
};

export type RoomPublic = {
  code: string;
  hostUid: string;
  phase: Phase;
  round: number;
  mode: GameMode;
  /** open seats in the lobby (4 by default, the host can add more up to MAX_PLAYERS) */
  slots?: number;
  /** chosen number of rounds (rounds mode) */
  rounds: number;
  /** effective round limit: `rounds` in rounds mode, a safety cap in conquest mode */
  maxRounds: number;
  stage: Stage;
  /** increments on every phase change; clients use it to avoid stale advance calls */
  step: number;
  /** defender uid -> revenge strike (only set after the attack stage of a round) */
  counters: Record<string, Counter>;
  /** epoch ms, server clock */
  phaseDeadline: number | null;
  players: Record<string, PlayerPublic>;
  /** regionId -> uid */
  owners: Record<string, string>;
  /** revealed once the question phase starts: uid -> regionId */
  picks: Record<string, string>;
  questions: Record<string, QuestionPublic>;
  results: RoundResult[];
  winners: string[];
  createdAt: number;
};

/** Server-only data (never readable by clients). */
export type RoomPrivate = {
  picks: Record<string, string>;
  /** regionId -> correct option index */
  correct: Record<string, number>;
  /** regionId -> epoch ms when the question was shown */
  shownAt: Record<string, number>;
  /** uid -> { choice, at } */
  answers: Record<string, { choice: number; at: number }>;
  usedQuestionIds: string[];
  /** regionId -> question id */
  questionIds: Record<string, string>;
};
