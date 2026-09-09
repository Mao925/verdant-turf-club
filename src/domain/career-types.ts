import type { BreedingCareer, BreedingCommand } from "./breeding-types.ts";
import type {
  CourseName,
  Portfolio,
  RaceClass,
  RaceTerms,
  SeasonCommand,
} from "./season-types.ts";
import type { LifeCareer, LifeCommand } from "./life-types.ts";
export type Route =
  | "turf-sprint"
  | "turf-mile"
  | "turf-middle"
  | "turf-long"
  | "dirt-sprint"
  | "dirt-middle";
export type TrainerId = "saeki" | "mihara";
export type Career = {
  life?: LifeCareer;
  breeding?: BreedingCareer;
  portfolio?: Portfolio;
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
  earnedYen?: number;
  fans?: number;
  turn?: "left" | "right";
  awards?: { date: string; amountYen: number; grade: string }[];
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
  age?: 1 | 2;
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
  category:
    | "purchase"
    | "boarding"
    | "registration"
    | "transport"
    | "medical"
    | "care"
    | "sale-fee"
    | "stud";
  description: string;
  paid: boolean;
  cancelled?: { date: string; reason: string; cycleId: string };
  deferral?: {
    originalDue: string;
    agreedDate: string;
    creditor: string;
    reason: string;
  };
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
  stoppedAt?: number;
  episodeId?: string;
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
  course: CourseName;
  terms?: RaceTerms;
  surface: "芝" | "ダート";
  distance: number;
  raceClass: RaceClass;
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
  | BreedingCommand
  | LifeCommand
  | SeasonCommand
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
