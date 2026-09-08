export type Route = "turf-mile" | "dirt-middle";
export type TrainerId = "saeki" | "mihara";
export type Career = {
  stage: "market" | "purchase" | "boarding" | "active" | "ended";
  marketId: string;
  horseId?: string;
  trainerId?: TrainerId;
  nextReview: string;
  route: Route;
  horseGoal: string;
  annualGoal: string;
  reserveYen: number;
  endDate: string;
  pause?: string;
};
export type HorseDetails = {
  speed: number;
  stamina: number;
  turf: number;
  dirt: number;
  idealDistance: number;
  fatigue: number;
  runs: number;
  wins: number;
  registered: boolean;
  gateDate?: string;
  enteredDate?: string;
  lastRaceDate?: string;
  unfitUntil?: string;
  pedigree: string;
  observation: string;
  unknown: string;
};
export type Market = {
  kind: "market";
  id: string;
  date: string;
  lots: {
    horseId: string;
    askingYen: number;
    rivalYen: number;
    status: "open" | "lost" | "won" | "passed";
  }[];
};
export type Invoice = {
  kind: "invoice";
  id: string;
  horseId: string;
  contractId?: string;
  date: string;
  dueDate: string;
  amountYen: number;
  category: "purchase" | "boarding" | "registration" | "transport";
  description: string;
  paid: boolean;
};
export type Consultation = {
  kind: "consultation";
  id: string;
  date: string;
  horseId: string;
  trainerId: TrainerId;
  conclusion: string;
  evidence: string;
  uncertainty: string;
  previous: string;
  resolution?: string;
  reason?: string;
};
export type RaceResult = {
  horseId: string;
  name: string;
  coat: string;
  silk: string;
  seconds: number;
  splits: number[];
};
export type Race = {
  kind: "race";
  id: string;
  date: string;
  deadline: string;
  selectionDate: string;
  course: "東京" | "中山";
  surface: "芝" | "ダート";
  distance: 1600 | 1800;
  raceClass: "新馬" | "未勝利" | "1勝クラス" | "オープン";
  name: string;
  horseId: string;
  status:
    "registered" | "selected" | "excluded" | "cancelled" | "result" | "settled";
  field: string[];
  seed: number;
  result?: RaceResult[];
  prizeYen?: number;
};
export type Opportunity = Omit<
  Race,
  "horseId" | "status" | "field" | "seed" | "result" | "prizeYen"
>;
export type CareerEntity = Market | Invoice | Consultation | Race;
export type CareerCommand =
  | { type: "upgrade" }
  | { type: "bid"; horseId: string; limitYen: number; reason: string }
  | { type: "next-market" }
  | { type: "receive"; name: string; reason: string }
  | { type: "board"; trainerId: TrainerId }
  | {
      type: "consult";
      choice: "race" | "wait" | "route";
      reason: string;
      raceId?: string;
      route?: Route;
    }
  | { type: "cancel-race"; raceId: string; reason: string }
  | { type: "settle"; raceId: string }
  | { type: "pay-invoices" }
  | { type: "end-career"; reason: string }
  | {
      type: "goals";
      goal: string;
      horseGoal: string;
      annualGoal: string;
      reason: string;
    };
