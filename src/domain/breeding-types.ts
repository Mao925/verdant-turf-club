import type { Route } from "./career-types.ts";
export type Growth = {
  stage: "foal" | "weanling" | "yearling" | "breaking" | "ready";
  target: { speed: number; stamina: number };
  startedDate?: string;
  readyDate?: string;
  orphanSupport?: boolean;
};
export type Family = {
  sireId?: string;
  damId?: string;
  birthCycleId?: string;
  generation: number;
  growth?: Growth;
  broodmare?: {
    date: string;
    status: "assessment" | "suitable" | "unsuitable";
    dueDate?: string;
    reason: string;
  };
  cycleId?: string;
  restUntil?: string;
};
export type BreedingCareer = { startedDate: string; marketAge: 1 | 2 };
export type BreedingOutcome = {
  result:
    | "empty"
    | "early-loss"
    | "late-loss"
    | "stillbirth"
    | "neonatal-death"
    | "live";
  difficult: boolean;
  motherDies: boolean;
  gestationDays: number;
  neonatalDay: number;
};
export type BreedingCycle = {
  kind: "breeding";
  id: string;
  horseId: string;
  sireId: string;
  date: string;
  season: number;
  status:
    | "applied"
    | "offered"
    | "reserved"
    | "covered"
    | "pregnant"
    | "empty"
    | "lost"
    | "foaled"
    | "completed"
    | "cancelled";
  nextDate?: string;
  matingDate?: string;
  dueDate?: string;
  closedDate?: string;
  foalId?: string;
  outcome?: BreedingOutcome;
  payment: "pregnancy" | "live-foal";
  feeYen: number;
  feeStatus: "conditional" | "invoiced" | "waived" | "refunded";
  feeInvoiceId?: string;
  report: boolean;
  message: string;
  reason: string;
  motherGoal: string;
  motherAnnualGoal: string;
};
export type BreedingCommand =
  | { type: "upgrade-breeding" }
  | { type: "market-age"; age: 1 | 2 }
  | { type: "broodmare-exam"; horseId: string; reason: string }
  | { type: "broodmare-board"; horseId: string; reason: string }
  | {
      type: "apply-breeding";
      horseId: string;
      sireId: string;
      payment: "pregnancy" | "live-foal";
      reason: string;
    }
  | {
      type: "breeding-response";
      cycleId: string;
      accept: boolean;
      reason: string;
    }
  | { type: "acknowledge-breeding"; cycleId: string }
  | { type: "rear-young"; horseId: string; reason: string }
  | { type: "start-breaking"; horseId: string; reason: string }
  | {
      type: "foal-goal";
      horseId: string;
      name: string;
      mode: "inherit" | "new";
      goal: string;
      route: Route;
      reason: string;
    };
